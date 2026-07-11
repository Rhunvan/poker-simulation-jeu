import { pathToFileURL } from 'url'

import { botProfiles } from '../src/config/botProfiles'
import { PLAYER_PROFILES_BY_ID } from '../src/config/playerProfiles'
import type { BotProfile, NumericRange, TableConfig } from '../src/config/schema'
import { REAL_TABLE_RULES } from '../src/config/tableRules'
import {
  applyPlayerCommandInPlace,
  createInitialTableState,
  startNextHandInPlace,
} from '../src/engine'
import { decideBotAction } from '../src/engine/bots/decisionEngine'
import { RANK_TO_VALUE } from '../src/engine/core/cards'
import { createSeatRing, getOccupiedSeatsClockwiseFrom } from '../src/engine/core/seatRing'
import type { BotDecision, Card, LegalActionState, TableState } from '../src/engine/core/types'
import { nextRandom } from '../src/engine/core/random'
import { getSessionStats } from '../src/engine/sessionStats'
import { getLegalActions } from '../src/engine/rules/legalActions'
import {
  createCounters,
  createHandRuntime,
  finalizeHand,
  recordDecision,
  type PlayerCounters,
} from './simulateProfiles'

export interface StrategyVariant {
  id: string
  label: string
  note: string
  profile: BotProfile
  arnaud: ArnaudStrategyConfig
}

export interface ArnaudStrategyConfig {
  limpTier: 'tight' | 'base' | 'wide'
  premiumRaiseTo: number
  addPerCaller: number
  latePositionPremiumBonus: number
  maxPressurePremiums?: boolean
  postflopProfile: BotProfile['sizingStyle']
}

export interface VariantSummary {
  id: string
  label: string
  note: string
  sessions: number
  handsPerSession: number
  avgNet: number
  medianNet: number
  bestNet: number
  worstNet: number
  positiveSessions: number
  positiveSessionRate: number
  avgHandsEntered: number
  avgRebuys: number
  metrics: Record<string, number>
}

function cloneProfile(profile: BotProfile): BotProfile {
  return structuredClone(profile) as BotProfile
}

function range(min: number, max: number): NumericRange {
  return [min, max]
}

function makeConfig(): TableConfig {
  return {
    ...REAL_TABLE_RULES,
    blindSchedule: REAL_TABLE_RULES.blindSchedule?.map((level) => ({ ...level })),
    rebuy: { ...REAL_TABLE_RULES.rebuy },
    includeHero: false,
    maxSeats: REAL_TABLE_RULES.maxSeats,
    heroSeatIndex: 0,
  }
}

export function makeVariant(
  id: string,
  label: string,
  note: string,
  arnaud: ArnaudStrategyConfig,
  mutate: (profile: BotProfile) => void,
): StrategyVariant {
  const profile = cloneProfile(PLAYER_PROFILES_BY_ID.arnaud)
  mutate(profile)
  profile.sizingStyle = arnaud.postflopProfile
  return {
    id,
    label,
    note,
    profile,
    arnaud,
  }
}

function buildVariants(): StrategyVariant[] {
  return [
    makeVariant(
      'baseline',
      'Premiums 8000',
      'Limp mains jouables type KQ/KJ/JT/77-99/A8-A9, raise fort seulement premium.',
      { limpTier: 'base', premiumRaiseTo: 8_000, addPerCaller: 1_500, latePositionPremiumBonus: 1_500, postflopProfile: 'standard_plus_propre' },
      () => {},
    ),
    makeVariant(
      'tighter',
      'Limp range reduite',
      'Moins de limps moyens: on jette davantage les A faibles et connecteurs limites.',
      { limpTier: 'tight', premiumRaiseTo: 8_000, addPerCaller: 1_500, latePositionPremiumBonus: 1_500, postflopProfile: 'standard_plus_propre' },
      (profile) => {
        profile.targetStats.vpip = range(18, 26)
        profile.targetStats.pfr = range(15, 23)
        profile.targetStats.limp = range(0, 4)
        profile.targetStats.coldCall = range(4, 10)
        profile.targetStats.bluff = range(6, 14)
        profile.targetStats.heroCall = range(24, 40)
      },
    ),
    makeVariant(
      'wider',
      'Limp range plus large',
      'Ajoute des mains jouables en position, toujours sans ouvrir les vraies poubelles.',
      { limpTier: 'wide', premiumRaiseTo: 8_000, addPerCaller: 1_500, latePositionPremiumBonus: 1_500, postflopProfile: 'standard_plus_propre' },
      (profile) => {
        profile.targetStats.vpip = range(28, 40)
        profile.targetStats.pfr = range(15, 24)
        profile.targetStats.limp = range(4, 14)
        profile.targetStats.coldCall = range(10, 20)
        profile.targetStats.bluff = range(9, 18)
        profile.targetStats.heroCall = range(32, 50)
      },
    ),
    makeVariant(
      'bigger_value',
      'Premiums 11000',
      'Meme limp range, mais premiums relancees plus cher pour punir les calls multiway.',
      { limpTier: 'base', premiumRaiseTo: 11_000, addPerCaller: 2_000, latePositionPremiumBonus: 2_000, postflopProfile: 'pression_propre' },
      (profile) => {
        profile.sizingStyle = 'pression_propre'
        profile.targetStats.pfr = range(17, 26)
        profile.targetStats.cbetFlop = range(55, 72)
        profile.targetStats.cbetTurn = range(38, 58)
        profile.targetStats.overbet = range(4, 12)
      },
    ),
    makeVariant(
      'smaller_control',
      'Premiums 15000',
      'Meme separation limp/raise, mais relances premium tres fortes.',
      { limpTier: 'base', premiumRaiseTo: 15_000, addPerCaller: 2_500, latePositionPremiumBonus: 2_500, postflopProfile: 'pression_propre' },
      (profile) => {
        profile.sizingStyle = 'serre_biaise'
        profile.targetStats.pfr = range(13, 20)
        profile.targetStats.coldCall = range(8, 16)
        profile.targetStats.cbetFlop = range(42, 60)
        profile.targetStats.cbetTurn = range(26, 44)
        profile.targetStats.overbet = range(0, 4)
      },
    ),
    makeVariant(
      'premium_pressure',
      'Tight + pression max',
      'Limp range resserree et tres grosses relances avec monstres, jusqu au commit preflop.',
      { limpTier: 'tight', premiumRaiseTo: 12_000, addPerCaller: 2_500, latePositionPremiumBonus: 3_000, maxPressurePremiums: true, postflopProfile: 'pression_propre' },
      (profile) => {
        profile.sizingStyle = 'pression_propre'
        profile.targetStats.vpip = range(18, 28)
        profile.targetStats.pfr = range(18, 28)
        profile.targetStats.limp = range(0, 5)
        profile.targetStats.coldCall = range(3, 9)
        profile.targetStats.threeBet = range(5, 10)
        profile.targetStats.overbet = range(3, 10)
      },
    ),
  ]
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(1))
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) {
    return 0
  }
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

export function summarizeCounters(counters: PlayerCounters): Record<string, number> {
  return {
    vpip: ratio(counters.vpip, counters.hands),
    pfr: ratio(counters.pfr, counters.hands),
    limp: ratio(counters.limp, counters.hands),
    coldCall: ratio(counters.coldCall, counters.hands),
    threeBet: ratio(counters.threeBet, counters.threeBetOpportunities),
    fourBet: ratio(counters.fourBet, counters.fourBetOpportunities),
    cbetFlop: ratio(counters.cbetFlop, counters.cbetFlopOpportunities),
    cbetTurn: ratio(counters.cbetTurn, counters.cbetTurnOpportunities),
    cbetRiver: ratio(counters.cbetRiver, counters.cbetRiverOpportunities),
    heroCallTendency: ratio(counters.heroCall, counters.heroCallOpportunities),
    bluffFrequency: ratio(counters.bluffs, counters.postflopAggression),
    overbetFrequency: ratio(counters.overbets, counters.postflopAggression),
    wtsd: ratio(counters.wentToShowdown, counters.sawFlop),
  }
}

function handKey(cards: Card[]): string {
  const [first, second] = [...cards].sort((left, right) => RANK_TO_VALUE[right.rank] - RANK_TO_VALUE[left.rank])
  if (!first || !second) {
    return ''
  }
  if (first.rank === second.rank) {
    return `${first.rank}${second.rank}`
  }
  return `${first.rank}${second.rank}${first.suit === second.suit ? 's' : 'o'}`
}

function pairValue(key: string): number | null {
  if (key.length !== 2 || key[0] !== key[1]) {
    return null
  }
  return RANK_TO_VALUE[key[0] as keyof typeof RANK_TO_VALUE] ?? null
}

function baseHand(key: string): string {
  return key.endsWith('s') || key.endsWith('o') ? key.slice(0, 2) : key
}

function handRanks(key: string): { high: number; low: number; suited: boolean; gap: number; broadwayCount: number } | null {
  const normalized = baseHand(key)
  if (normalized.length !== 2) {
    return null
  }
  const first = RANK_TO_VALUE[normalized[0] as keyof typeof RANK_TO_VALUE]
  const second = RANK_TO_VALUE[normalized[1] as keyof typeof RANK_TO_VALUE]
  if (!first || !second) {
    return null
  }
  const high = Math.max(first, second)
  const low = Math.min(first, second)
  return {
    high,
    low,
    suited: key.endsWith('s'),
    gap: Math.abs(high - low),
    broadwayCount: [high, low].filter((rank) => rank >= RANK_TO_VALUE.T).length,
  }
}

function isPremiumRaiseHand(key: string): boolean {
  const pair = pairValue(key)
  if (pair !== null) {
    return pair >= RANK_TO_VALUE.J
  }
  return ['AKs', 'AKo', 'AQs', 'AJs'].includes(key)
}

function isMonsterPremium(key: string): boolean {
  return ['AA', 'KK'].includes(key)
}

function isMediumPair(key: string): boolean {
  const pair = pairValue(key)
  return pair !== null && pair >= RANK_TO_VALUE['7'] && pair <= RANK_TO_VALUE.T
}

function isSpeculativePlayable(key: string): boolean {
  if (isMediumPair(key)) {
    return true
  }
  const ranks = handRanks(key)
  if (!ranks) {
    return false
  }

  const suitedConnectorOrGapper = ranks.suited && ranks.low >= RANK_TO_VALUE['5'] && ranks.gap <= 2
  const offsuitHighConnector = !ranks.suited && ranks.low >= RANK_TO_VALUE['9'] && ranks.gap <= 2
  const suitedAce = ranks.suited && ranks.high === RANK_TO_VALUE.A && ranks.low >= RANK_TO_VALUE['2']
  const suitedKingQueen = ranks.suited && ranks.high >= RANK_TO_VALUE.Q && ranks.low >= RANK_TO_VALUE['8']
  const broadwayOrNearBroadway = ranks.broadwayCount >= 1 && ranks.high >= RANK_TO_VALUE.J && ranks.low >= RANK_TO_VALUE['9'] && ranks.gap <= 3

  return suitedConnectorOrGapper || offsuitHighConnector || suitedAce || suitedKingQueen || broadwayOrNearBroadway
}

function isLimpCandidate(key: string, tier: ArnaudStrategyConfig['limpTier']): boolean {
  const pair = pairValue(key)
  if (pair !== null) {
    if (tier === 'tight') {
      return pair >= RANK_TO_VALUE['8'] && pair <= RANK_TO_VALUE.T
    }
    if (tier === 'wide') {
      return pair >= RANK_TO_VALUE['6'] && pair <= RANK_TO_VALUE.T
    }
    return pair >= RANK_TO_VALUE['7'] && pair <= RANK_TO_VALUE.T
  }

  const base = baseHand(key)
  const always = new Set(['KQ', 'KJ', 'QJ', 'JT', 'AT'])
  const suitedBase = new Set(['A9', 'A8', 'KTs', 'QTs', 'JTs', 'T9s'])
  const wideOnly = new Set(['A7s', 'KTo', 'QTo', '98s', '87s'])

  if (always.has(base)) {
    return true
  }
  if (key.endsWith('s') && suitedBase.has(key)) {
    return tier !== 'tight' || ['A9s', 'KTs', 'QTs', 'JTs'].includes(key)
  }
  if (tier === 'wide' && (wideOnly.has(key) || wideOnly.has(base))) {
    return true
  }
  return false
}

function getPreflopPosition(table: TableState, actorId: string): {
  bucket: 'early' | 'middle' | 'late'
  playersBehind: number
} {
  const eligiblePlayers = table.players.filter((player) => !player.hasFolded && player.holeCards.length > 0)
  const ring = createSeatRing(eligiblePlayers, table.config.maxSeats)
  const straddleSeatIndex = table.players.find((player) => player.lastAction?.kind === 'post-straddle')?.seatIndex
  const startFromSeat =
    straddleSeatIndex ??
    table.bigBlindSeatIndex
  const order = getOccupiedSeatsClockwiseFrom(ring, startFromSeat)
    .map((seatIndex) => ring.playersBySeat.get(seatIndex))
    .filter((player): player is (typeof eligiblePlayers)[number] => Boolean(player))
  const actorIndex = order.findIndex((player) => player.id === actorId)
  const playersBehind = actorIndex === -1 ? 0 : Math.max(0, order.length - actorIndex - 1)
  const relativeIndex = order.length <= 1 || actorIndex === -1 ? 1 : actorIndex / (order.length - 1)

  return {
    bucket: relativeIndex < 0.34 ? 'early' : relativeIndex < 0.67 ? 'middle' : 'late',
    playersBehind,
  }
}

function adjustTierForPosition(
  tier: ArnaudStrategyConfig['limpTier'],
  position: ReturnType<typeof getPreflopPosition>,
): ArnaudStrategyConfig['limpTier'] {
  if (position.bucket === 'early') {
    return tier === 'wide' ? 'base' : 'tight'
  }
  if (position.bucket === 'late') {
    return tier === 'tight' ? 'base' : 'wide'
  }
  return tier
}

function countCommittedCallers(table: TableState, actorId: string): number {
  return table.players.filter(
    (player) =>
      player.id !== actorId &&
      !player.hasFolded &&
      player.holeCards.length > 0 &&
      player.currentBet >= table.currentBet &&
      player.currentBet > table.config.bigBlind,
  ).length
}

function potTotal(table: TableState): number {
  return table.pots.reduce((sum, pot) => sum + pot.amount, 0)
}

function clampRaiseTotal(legal: LegalActionState, wantedTotal: number): number {
  const minTotal = legal.minRaiseTo ?? wantedTotal
  const maxTotal = legal.maxRaiseTo ?? wantedTotal
  return Math.min(maxTotal, Math.max(minTotal, wantedTotal))
}

function telemetry(tags: string[], extra: Partial<BotDecision['telemetry']> = {}): BotDecision['telemetry'] {
  return {
    tags,
    ...extra,
  }
}

function decideArnaudStrategy(
  table: TableState,
  actorId: string,
  profile: BotProfile,
  config: ArnaudStrategyConfig,
): { seed: number; decision: BotDecision } {
  // Arnaud is modeled as contextual/EV-driven: limp playable non-premiums when
  // raises will not isolate, raise only premiums hard enough to break call trains.
  const legal = getLegalActions(table, actorId)
  const player = table.players.find((entry) => entry.id === actorId)
  if (!legal || !player) {
    return decideBotAction(table, actorId, profile)
  }

  if (table.street !== 'preflop') {
    return decideBotAction(table, actorId, profile)
  }

  const key = handKey(player.holeCards)
  const position = getPreflopPosition(table, actorId)
  const positionTier = adjustTierForPosition(config.limpTier, position)
  const optionAmount = table.config.straddle?.enabled ? table.config.straddle.amount : table.config.bigBlind
  const hasRaisedBeyondOption = table.currentBet > optionAmount
  const canRaise = legal.options.some((option) => option.kind === 'raise' || option.kind === 'bet')
  const canCall = legal.options.some((option) => option.kind === 'call')
  const canCheck = legal.options.some((option) => option.kind === 'check')
  const canFold = legal.options.some((option) => option.kind === 'fold')
  const premium = isPremiumRaiseHand(key)
  const limpCandidate = isLimpCandidate(key, positionTier)
  const stableExcellentPrice =
    !hasRaisedBeyondOption &&
    legal.toCall <= 3_000 &&
    potTotal(table) >= 10_000 &&
    table.players.filter((entry) => !entry.hasFolded && entry.holeCards.length > 0).length >= 4
  const unstableReraiseSpot = table.fullRaiseCounter >= 2

  if (premium && canRaise) {
    const callerCount = countCommittedCallers(table, actorId)
    const currentPotTotal = potTotal(table)
    const deadMoneyBonus =
      position.bucket === 'late'
        ? config.latePositionPremiumBonus + Math.min(3_000, Math.round(currentPotTotal * 0.12))
        : position.bucket === 'middle'
          ? Math.round(config.latePositionPremiumBonus * 0.45)
          : 0
    let wanted = hasRaisedBeyondOption
      ? Math.max(table.currentBet * 3.4, config.premiumRaiseTo + callerCount * config.addPerCaller + deadMoneyBonus)
      : config.premiumRaiseTo + callerCount * config.addPerCaller + deadMoneyBonus
    if (config.maxPressurePremiums && isMonsterPremium(key)) {
      const maxTotal = legal.maxRaiseTo ?? player.currentBet + player.stack
      const commitTarget = Math.round(Math.min(maxTotal, Math.max(wanted, currentPotTotal * 2.6, 24_000 + callerCount * 4_000)))
      wanted = commitTarget
    }
    const total = clampRaiseTotal(legal, Math.round(wanted))
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: legal.options.some((option) => option.kind === 'raise') ? 'raise' : 'bet', total },
        reason: `Arnaud relance tres fort ${key} en value premium depuis ${position.bucket}`,
        telemetry: telemetry(['arnaud-premium-raise', `hand-${key}`, `position-${position.bucket}`], {
          isOpenRaise: table.fullRaiseCounter === 0,
          isThreeBet: table.fullRaiseCounter === 1,
          isFourBet: table.fullRaiseCounter >= 2,
          sizingBb: total / table.config.bigBlind,
        }),
      },
    }
  }

  if (isSpeculativePlayable(key) && unstableReraiseSpot && canFold) {
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: 'fold' },
        reason: `Arnaud fold ${key}: open plus 3-bet, prix instable et implied odds pas assez propres`,
        telemetry: telemetry(['arnaud-speculative-fold-vs-reraise', `hand-${key}`, `position-${position.bucket}`]),
      },
    }
  }

  if (isSpeculativePlayable(key) && stableExcellentPrice && canCall) {
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: 'call' },
        reason: `Arnaud complete ${key}: prix final connu et excellent dans un gros pot multiway`,
        telemetry: telemetry(['arnaud-speculative-good-price', `hand-${key}`, `position-${position.bucket}`], {
          isColdCall: table.currentBet > table.config.bigBlind,
          isLimp: table.currentBet <= table.config.bigBlind,
        }),
      },
    }
  }

  if (premium && canCall) {
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: 'call' },
        reason: `Arnaud garde ${key} dans le coup faute de relance disponible`,
        telemetry: telemetry(['arnaud-premium-call', `hand-${key}`], { isColdCall: table.fullRaiseCounter > 0 }),
      },
    }
  }

  if (!hasRaisedBeyondOption && limpCandidate && canCall) {
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: 'call' },
        reason: `Arnaud limp/call ${key} depuis ${position.bucket}: main jouable mais pas premium dans une table qui call trop`,
        telemetry: telemetry(['arnaud-controlled-limp', `hand-${key}`, `position-${position.bucket}`, `tier-${positionTier}`], {
          isColdCall: table.currentBet > table.config.bigBlind,
          isLimp: table.currentBet <= table.config.bigBlind,
        }),
      },
    }
  }

  if (!hasRaisedBeyondOption && limpCandidate && canCheck) {
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: 'check' },
        reason: `Arnaud check ${key} quand il peut voir le flop gratuitement`,
        telemetry: telemetry(['arnaud-free-flop', `hand-${key}`]),
      },
    }
  }

  if (canFold) {
    return {
      seed: nextRandom(table.seed).seed,
      decision: {
        command: { kind: 'fold' },
        reason: `Arnaud jette ${key} depuis ${position.bucket}: pas assez fort pour limp/call ou raise dans ce contexte`,
        telemetry: telemetry(['arnaud-disciplined-fold', `hand-${key}`, `position-${position.bucket}`]),
      },
    }
  }

  return {
    seed: nextRandom(table.seed).seed,
    decision: {
      command: { kind: 'check' },
      reason: `Arnaud check ${key}`,
      telemetry: telemetry(['arnaud-check', `hand-${key}`]),
    },
  }
}

export function runSingleSession(
  variant: StrategyVariant,
  handsPerSession: number,
  seed: number,
): { table: TableState; counters: Record<string, PlayerCounters> } {
  const config = makeConfig()
  const profiles = [variant.profile, ...botProfiles]
  const profileById = Object.fromEntries(profiles.map((profile) => [profile.id, profile])) satisfies Record<
    string,
    BotProfile
  >
  const counters = Object.fromEntries(profiles.map((profile) => [profile.id, createCounters()])) satisfies Record<
    string,
    PlayerCounters
  >

  let table = startNextHandInPlace(createInitialTableState(config, profiles, seed), 0)
  let hand = createHandRuntime(table, counters)
  let completedHands = 0

  while (completedHands < handsPerSession) {
    if (!table.handInProgress) {
      finalizeHand(table, hand, counters)
      completedHands += 1
      if (completedHands >= handsPerSession) {
        break
      }
      table = startNextHandInPlace(table, table.sessionElapsedMs)
      hand = createHandRuntime(table, counters)
      continue
    }

    const actorId = table.currentActorId
    if (!actorId) {
      table = startNextHandInPlace(table, table.sessionElapsedMs)
      hand = createHandRuntime(table, counters)
      continue
    }

    const profile = profileById[actorId]
    if (!profile) {
      throw new Error(`Missing profile for ${actorId}`)
    }

    const decision =
      actorId === 'arnaud'
        ? decideArnaudStrategy(table, actorId, profile, variant.arnaud)
        : decideBotAction(table, actorId, profile)
    recordDecision(table, actorId, decision.decision, hand, counters)
    table.seed = decision.seed
    table = applyPlayerCommandInPlace(table, actorId, decision.decision.command)
  }

  return { table, counters }
}

export function optimizeHeroStrategy(options: { sessions?: number; handsPerSession?: number; seed?: number } = {}): {
  sessions: number
  handsPerSession: number
  totalHandsPerVariant: number
  variants: VariantSummary[]
} {
  const sessions = options.sessions ?? 100
  const handsPerSession = options.handsPerSession ?? 70
  const seed = options.seed ?? 81_042
  const variants = buildVariants()

  const summaries = variants.map((variant) => {
    const nets: number[] = []
    let totalHandsEntered = 0
    let totalRebuys = 0
    const aggregateCounters = createCounters()

    for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex += 1) {
      const run = runSingleSession(variant, handsPerSession, seed + sessionIndex * 10_007)
      const stats = getSessionStats(run.table, 'arnaud')
      nets.push(stats.netResult)
      totalHandsEntered += stats.handsEntered
      totalRebuys += stats.rebuys

      const arnaudCounters = run.counters.arnaud
      for (const key of Object.keys(aggregateCounters) as Array<keyof PlayerCounters>) {
        aggregateCounters[key] += arnaudCounters[key]
      }
    }

    const avgNet = nets.reduce((sum, value) => sum + value, 0) / Math.max(1, nets.length)
    const positiveSessions = nets.filter((value) => value > 0).length

    return {
      id: variant.id,
      label: variant.label,
      note: variant.note,
      sessions,
      handsPerSession,
      avgNet: Math.round(avgNet),
      medianNet: Math.round(median(nets)),
      bestNet: Math.max(...nets),
      worstNet: Math.min(...nets),
      positiveSessions,
      positiveSessionRate: ratio(positiveSessions, sessions),
      avgHandsEntered: Number((totalHandsEntered / sessions).toFixed(1)),
      avgRebuys: Number((totalRebuys / sessions).toFixed(2)),
      metrics: summarizeCounters(aggregateCounters),
    } satisfies VariantSummary
  })

  summaries.sort((left, right) => right.avgNet - left.avgNet)

  return {
    sessions,
    handsPerSession,
    totalHandsPerVariant: sessions * handsPerSession,
    variants: summaries,
  }
}

function parseArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) {
    return undefined
  }
  return process.argv[index + 1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sessions = Number(parseArgValue('--sessions') ?? 100)
  const handsPerSession = Number(parseArgValue('--hands') ?? 70)
  const seed = Number(parseArgValue('--seed') ?? 81_042)
  const report = optimizeHeroStrategy({ sessions, handsPerSession, seed })
  console.log(JSON.stringify(report, null, 2))
}
