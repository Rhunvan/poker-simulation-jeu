import type { BotProfile } from '../../config/schema'
import type {
  BotDecision,
  DecisionContext,
  DecisionTelemetry,
  LegalActionState,
  PlayerCommand,
  TableState,
} from '../core/types'
import { nextRandom, weightedChoice } from '../core/random'
import { getPlayerByIdFromPlayers } from '../core/seatRing'
import { canPlayerAct, getLegalActions, isPlayerStillInHand } from '../rules/legalActions'
import { getPotTotal } from '../rules/pots'
import { getEmotionModifiers } from './emotionModel'
import { applyPersonaOverlay } from './personaOverlay'
import { buildPopulationSnapshot, rangeMid } from './populationModel'
import { resolveAggressiveTotal } from './sizingModel'

function buildContext(state: TableState, actorId: string, profile: BotProfile): DecisionContext | null {
  const player = getPlayerByIdFromPlayers(state.players, actorId)
  const legalActions = getLegalActions(state, actorId)
  if (!player || !legalActions) {
    return null
  }

  const activePlayers = state.players.filter(canPlayerAct)
  const playersStillInHand = state.players.filter(isPlayerStillInHand)

  return {
    state,
    player,
    profile,
    legalActions,
    activePlayers,
    potTotal: getPotTotal(state.players),
    playersStillInHand,
  }
}

function hasOption(legal: LegalActionState, kind: PlayerCommand['kind']): boolean {
  return legal.options.some((option) => option.kind === kind)
}

function commandChoices(legal: LegalActionState): PlayerCommand['kind'][] {
  return legal.options.map((option) => option.kind)
}

function deepJamRate(profile: BotProfile): number {
  return rangeMid(profile.targetStats.preflopJamAbove35bb) / 100
}

function isAggressiveCommand(legal: LegalActionState, command: PlayerCommand): boolean {
  if (command.kind === 'bet' || command.kind === 'raise') {
    return true
  }
  if (command.kind !== 'all-in') {
    return false
  }

  return legal.toCall === 0 || legal.canRaise
}

function isHeroCallOpportunity(
  snapshot: ReturnType<typeof buildPopulationSnapshot>,
  legal: LegalActionState,
): boolean {
  return (
    snapshot.street !== 'preflop' &&
    snapshot.scenario === 'facing-bet' &&
    snapshot.handStrength < 0.58 &&
    hasOption(legal, 'call') &&
    hasOption(legal, 'fold')
  )
}

function shouldAllowPreflopJam(
  context: DecisionContext,
  snapshot: ReturnType<typeof buildPopulationSnapshot>,
  profile: BotProfile,
  seed: number,
  legalHasRaise: boolean,
): { seed: number; allow: boolean } {
  if (!hasOption(context.legalActions, 'all-in')) {
    return { seed, allow: false }
  }

  if (snapshot.street !== 'preflop') {
    return { seed, allow: snapshot.effectiveStackBb <= 14 || !legalHasRaise }
  }

  if (snapshot.effectiveStackBb <= 18) {
    return { seed, allow: snapshot.handStrength >= 0.68 || snapshot.jamIntent >= 0.3 }
  }

  if (snapshot.effectiveStackBb <= 35) {
    return {
      seed,
      allow:
        snapshot.handStrength >= 0.84 &&
        (snapshot.raiseCount >= 2 || snapshot.currentBetBb >= 8 || snapshot.jamIntent >= 0.18),
    }
  }

  const premiumGate =
    snapshot.handStrength >= 0.94 ||
    (profile.quirks?.kamikazeBursts === true &&
      snapshot.handStrength >= 0.88 &&
      (snapshot.raiseCount >= 2 || snapshot.currentBetBb >= 12))
  if (!premiumGate) {
    return { seed, allow: false }
  }

  const { seed: nextSeed, value } = nextRandom(seed)
  const baseRate = deepJamRate(profile)
  const dynamicFactor = snapshot.raiseCount >= 2 || snapshot.currentBetBb >= 12 ? 2.3 : 0.5
  return {
    seed: nextSeed,
    allow: value < Math.max(0, baseRate * dynamicFactor),
  }
}

function pickWeightedCommand(
  legal: LegalActionState,
  snapshot: ReturnType<typeof buildPopulationSnapshot>,
  seed: number,
): { seed: number; kind: PlayerCommand['kind'] } {
  const allowedKinds = commandChoices(legal)
  const weighted = weightedChoice(
    seed,
    allowedKinds.map((kind) => ({
      item: kind,
      weight:
        snapshot.candidateWeights[kind] > 0
          ? snapshot.candidateWeights[kind]
          : kind === 'check'
            ? 0.08
            : kind === 'call'
              ? 0.04
              : kind === 'fold'
                ? 0.02
                : 0.01,
    })),
  )

  return {
    seed: weighted.seed,
    kind: weighted.item,
  }
}

function maybeTableTalk(seed: number, profile: BotProfile, decision: BotDecision): { seed: number; tableTalk?: string } {
  const { seed: nextSeed, value } = nextRandom(seed)
  if (value > 0.14) {
    return { seed: nextSeed }
  }

  const phrasesByStyle = {
    quiet: ['hmm', 'ok'],
    relaxed: ['on regarde', 'allez'],
    taunting: ['tu laches ?', 'on y va'],
    calm: ['tranquille', 'continue'],
    reactive: ['pas fini', 'je repars'],
  }

  const style = profile.tableTalkStyle ?? 'quiet'
  const phrases = phrasesByStyle[style]
  const choice = Math.floor(value * phrases.length) % phrases.length
  const suffix = decision.command.kind === 'all-in' ? '...' : ''

  return {
    seed: nextSeed,
    tableTalk: `${phrases[choice]}${suffix}`,
  }
}

function buildReason(snapshot: ReturnType<typeof buildPopulationSnapshot>, profile: BotProfile, command: PlayerCommand): string {
  if (command.kind === 'all-in' && snapshot.street === 'preflop') {
    return `${profile.displayName} ne jam que dans un spot deja justifie`
  }
  if (snapshot.street === 'preflop') {
    return `${profile.displayName} joue un spot ${snapshot.scenario} avec logique ${profile.archetype}`
  }
  return `${profile.displayName} suit son profil ${profile.archetype} sur ${snapshot.street}`
}

function mergeTelemetry(base: DecisionTelemetry | undefined, extra: Partial<DecisionTelemetry>): DecisionTelemetry {
  return {
    tags: [...(base?.tags ?? []), ...(extra.tags ?? [])],
    sizingBb: extra.sizingBb ?? base?.sizingBb,
    sizingPot: extra.sizingPot ?? base?.sizingPot,
    isLimp: extra.isLimp ?? base?.isLimp,
    isOverlimp: extra.isOverlimp ?? base?.isOverlimp,
    isOpenRaise: extra.isOpenRaise ?? base?.isOpenRaise,
    isColdCall: extra.isColdCall ?? base?.isColdCall,
    isThreeBet: extra.isThreeBet ?? base?.isThreeBet,
    isFourBet: extra.isFourBet ?? base?.isFourBet,
    isPreflopJam: extra.isPreflopJam ?? base?.isPreflopJam,
    isSuppressedJam: extra.isSuppressedJam ?? base?.isSuppressedJam,
    isCbet: extra.isCbet ?? base?.isCbet,
    isBarrel: extra.isBarrel ?? base?.isBarrel,
    isBluff: extra.isBluff ?? base?.isBluff,
    isHeroCallOpportunity: extra.isHeroCallOpportunity ?? base?.isHeroCallOpportunity,
    isHeroCall: extra.isHeroCall ?? base?.isHeroCall,
    isOverbet: extra.isOverbet ?? base?.isOverbet,
  }
}

export function decideBotAction(
  state: TableState,
  actorId: string,
  profile: BotProfile,
): { seed: number; decision: BotDecision } {
  const context = buildContext(state, actorId, profile)
  if (!context) {
    return {
      seed: state.seed,
      decision: {
        command: { kind: 'fold' },
        reason: 'missing context',
        telemetry: { tags: ['missing-context'] },
      },
    }
  }

  const emotions = getEmotionModifiers(context.player, profile)
  const baseline = buildPopulationSnapshot(context, emotions)
  const snapshot = applyPersonaOverlay(context, baseline, profile, emotions)
  const legalHasAggressiveRaise = hasOption(context.legalActions, 'raise') || hasOption(context.legalActions, 'bet')
  const jamCheck = shouldAllowPreflopJam(context, snapshot, profile, state.seed, legalHasAggressiveRaise)
  let nextSeed = jamCheck.seed
  if (!jamCheck.allow) {
    snapshot.candidateWeights['all-in'] *= snapshot.street === 'preflop' ? 0.02 : 0.2
    snapshot.tags.push(snapshot.street === 'preflop' ? 'anti-jam-guardrail' : 'postflop-jam-capped')
  }

  let commandChoice = pickWeightedCommand(context.legalActions, snapshot, nextSeed)
  nextSeed = commandChoice.seed
  if (
    snapshot.street === 'preflop' &&
    snapshot.raiseCount >= 2 &&
    (commandChoice.kind === 'raise' || commandChoice.kind === 'all-in')
  ) {
    const fourBetThreshold =
      profile.id === 'martin'
        ? 0.84
        : profile.id === 'fabrice'
          ? 0.88
          : 0.92
    if (snapshot.handStrength < fourBetThreshold) {
      commandChoice = {
        seed: nextSeed,
        kind: hasOption(context.legalActions, 'call') ? 'call' : 'fold',
      }
      snapshot.tags.push('4bet-suppressed')
    }
  }
  let command: PlayerCommand
  let telemetry: DecisionTelemetry = {
    tags: [...snapshot.tags],
  }

  if (commandChoice.kind === 'bet' || commandChoice.kind === 'raise') {
    const sizing = resolveAggressiveTotal(context, snapshot, profile, nextSeed, emotions, false)
    nextSeed = sizing.seed
    command = { kind: commandChoice.kind, total: sizing.total }
    telemetry = mergeTelemetry(telemetry, sizing.telemetry)
  } else if (commandChoice.kind === 'all-in') {
    if (snapshot.street === 'preflop' && !jamCheck.allow && legalHasAggressiveRaise) {
      const sizing = resolveAggressiveTotal(context, snapshot, profile, nextSeed, emotions, true)
      nextSeed = sizing.seed
      command = {
        kind: hasOption(context.legalActions, 'raise') ? 'raise' : 'bet',
        total: sizing.total,
      }
      telemetry = mergeTelemetry(telemetry, {
        ...sizing.telemetry,
        isPreflopJam: false,
        isSuppressedJam: true,
      })
    } else {
      command = { kind: 'all-in' }
    }
  } else {
    command = { kind: commandChoice.kind }
  }

  const heroCallOpportunity = isHeroCallOpportunity(snapshot, context.legalActions)
  const aggressive = isAggressiveCommand(context.legalActions, command)
  telemetry = mergeTelemetry(telemetry, {
    isLimp: snapshot.street === 'preflop' && snapshot.scenario === 'unopened' && command.kind === 'call',
    isOverlimp: snapshot.street === 'preflop' && snapshot.scenario === 'limped-pot' && command.kind === 'call',
    isOpenRaise: snapshot.street === 'preflop' && snapshot.raiseCount === 0 && aggressive,
    isColdCall:
      snapshot.street === 'preflop' &&
      (snapshot.scenario === 'facing-open' || snapshot.scenario === 'facing-3bet' || snapshot.scenario === 'facing-4bet') &&
      command.kind === 'call',
    isThreeBet: snapshot.street === 'preflop' && snapshot.raiseCount === 1 && aggressive,
    isFourBet: snapshot.street === 'preflop' && snapshot.raiseCount >= 2 && aggressive,
    isPreflopJam: snapshot.street === 'preflop' && command.kind === 'all-in' && aggressive,
    isBluff: snapshot.street !== 'preflop' && aggressive && snapshot.bluffIntent > snapshot.valueIntent,
    isHeroCallOpportunity: heroCallOpportunity,
    isHeroCall: heroCallOpportunity && command.kind === 'call',
  })

  const decision: BotDecision = {
    command,
    reason: buildReason(snapshot, profile, command),
    telemetry,
  }

  const tableTalk = maybeTableTalk(nextSeed, profile, decision)

  return {
    seed: tableTalk.seed,
    decision: {
      ...decision,
      tableTalk: tableTalk.tableTalk,
    },
  }
}
