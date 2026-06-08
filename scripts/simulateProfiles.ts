import { pathToFileURL } from 'url'

import { PLAYER_PROFILES, PLAYER_PROFILES_BY_ID } from '../src/config/playerProfiles'
import { REAL_TABLE_RULES } from '../src/config/tableRules'
import type { TableConfig } from '../src/config/schema'
import {
  applyPlayerCommandInPlace,
  createInitialTableState,
  startNextHandInPlace,
} from '../src/engine'
import { decideBotAction } from '../src/engine/bots/decisionEngine'
import type { DecisionTelemetry, PlayerCommand, TableState } from '../src/engine/core/types'
import { getLegalActions, isPlayerStillInHand } from '../src/engine/rules/legalActions'

type StreetKey = 'preflop' | 'flop' | 'turn' | 'river'

export interface PlayerCounters {
  hands: number
  vpip: number
  pfr: number
  limp: number
  overlimp: number
  coldCall: number
  threeBet: number
  threeBetOpportunities: number
  fourBet: number
  fourBetOpportunities: number
  preflopJamAbove35bb: number
  cbetFlop: number
  cbetFlopOpportunities: number
  cbetTurn: number
  cbetTurnOpportunities: number
  cbetRiver: number
  cbetRiverOpportunities: number
  foldToThreeBet: number
  foldToThreeBetOpportunities: number
  heroCall: number
  heroCallOpportunities: number
  bluffs: number
  postflopAggression: number
  overbets: number
  sawFlop: number
  wentToShowdown: number
}

export interface HandRuntime {
  handNumber: number
  countedVpip: Set<string>
  countedPfr: Set<string>
  countedLimp: Set<string>
  countedOverlimp: Set<string>
  countedColdCall: Set<string>
  countedThreeBetOpp: Set<string>
  countedFourBetOpp: Set<string>
  countedFoldToThreeBetOpp: Set<string>
  markedSawFlop: boolean
  openRaiserId: string | null
  preflopAggressorId: string | null
  flopAggressorId: string | null
  turnAggressorId: string | null
  streetOpeners: Partial<Record<StreetKey, string>>
}

export interface SimulationPlayerReport {
  id: string
  displayName: string
  hands: number
  metrics: Record<string, number>
}

export interface SimulationReport {
  handsSimulated: number
  seed: number
  players: SimulationPlayerReport[]
}

export function createCounters(): PlayerCounters {
  return {
    hands: 0,
    vpip: 0,
    pfr: 0,
    limp: 0,
    overlimp: 0,
    coldCall: 0,
    threeBet: 0,
    threeBetOpportunities: 0,
    fourBet: 0,
    fourBetOpportunities: 0,
    preflopJamAbove35bb: 0,
    cbetFlop: 0,
    cbetFlopOpportunities: 0,
    cbetTurn: 0,
    cbetTurnOpportunities: 0,
    cbetRiver: 0,
    cbetRiverOpportunities: 0,
    foldToThreeBet: 0,
    foldToThreeBetOpportunities: 0,
    heroCall: 0,
    heroCallOpportunities: 0,
    bluffs: 0,
    postflopAggression: 0,
    overbets: 0,
    sawFlop: 0,
    wentToShowdown: 0,
  }
}

function makeSimulationConfig(): TableConfig {
  return {
    ...REAL_TABLE_RULES,
    blindSchedule: REAL_TABLE_RULES.blindSchedule?.map((level) => ({ ...level })),
    rebuy: { ...REAL_TABLE_RULES.rebuy },
    includeHero: false,
    maxSeats: 9,
    heroSeatIndex: 0,
  }
}

export function createHandRuntime(table: TableState, counters: Record<string, PlayerCounters>): HandRuntime {
  for (const player of table.players) {
    if (player.botProfileId) {
      counters[player.id].hands += 1
    }
  }

  return {
    handNumber: table.handNumber,
    countedVpip: new Set(),
    countedPfr: new Set(),
    countedLimp: new Set(),
    countedOverlimp: new Set(),
    countedColdCall: new Set(),
    countedThreeBetOpp: new Set(),
    countedFourBetOpp: new Set(),
    countedFoldToThreeBetOpp: new Set(),
    markedSawFlop: false,
    openRaiserId: null,
    preflopAggressorId: null,
    flopAggressorId: null,
    turnAggressorId: null,
    streetOpeners: {},
  }
}

function isAggressiveCommand(command: PlayerCommand, table: TableState, actorId: string): boolean {
  if (command.kind === 'bet' || command.kind === 'raise') {
    return true
  }
  if (command.kind !== 'all-in') {
    return false
  }

  const legal = getLegalActions(table, actorId)
  if (!legal) {
    return false
  }
  return legal.toCall === 0 || table.players.find((player) => player.id === actorId)?.stack !== legal.toCall
}

function markSawFlop(table: TableState, hand: HandRuntime, counters: Record<string, PlayerCounters>): void {
  if (hand.markedSawFlop || table.board.length < 3) {
    return
  }

  hand.markedSawFlop = true
  for (const player of table.players.filter(isPlayerStillInHand)) {
    counters[player.id].sawFlop += 1
  }
}

function recordStreetContinuationOpportunity(
  hand: HandRuntime,
  street: StreetKey,
  actorId: string,
  table: TableState,
  counters: Record<string, PlayerCounters>,
): void {
  if (table.currentBet > 0 || hand.streetOpeners[street]) {
    return
  }
  const initiativeHolder =
    street === 'flop'
      ? hand.preflopAggressorId
      : street === 'turn'
        ? hand.flopAggressorId
        : hand.turnAggressorId

  if (initiativeHolder !== actorId) {
    return
  }

  if (street === 'flop') {
    counters[actorId].cbetFlopOpportunities += 1
  } else if (street === 'turn') {
    counters[actorId].cbetTurnOpportunities += 1
  } else if (street === 'river') {
    counters[actorId].cbetRiverOpportunities += 1
  }
}

function recordStreetContinuationResult(
  hand: HandRuntime,
  street: StreetKey,
  actorId: string,
  table: TableState,
  counters: Record<string, PlayerCounters>,
): void {
  if (table.currentBet > 0 || hand.streetOpeners[street]) {
    return
  }

  hand.streetOpeners[street] = actorId
  const initiativeHolder =
    street === 'flop'
      ? hand.preflopAggressorId
      : street === 'turn'
        ? hand.flopAggressorId
        : hand.turnAggressorId

  if (initiativeHolder !== actorId) {
    return
  }

  if (street === 'flop') {
    counters[actorId].cbetFlop += 1
  } else if (street === 'turn') {
    counters[actorId].cbetTurn += 1
  } else if (street === 'river') {
    counters[actorId].cbetRiver += 1
  }
}

export function recordDecision(
  table: TableState,
  actorId: string,
  decision: { command: PlayerCommand; telemetry?: DecisionTelemetry },
  hand: HandRuntime,
  counters: Record<string, PlayerCounters>,
): void {
  const telemetry = decision.telemetry
  const actorCounters = counters[actorId]
  if (table.street === 'preflop') {
    if ((decision.command.kind === 'call' || decision.command.kind === 'raise' || decision.command.kind === 'all-in') && !hand.countedVpip.has(actorId)) {
      actorCounters.vpip += 1
      hand.countedVpip.add(actorId)
    }
    if ((decision.command.kind === 'raise' || decision.command.kind === 'all-in') && !hand.countedPfr.has(actorId) && isAggressiveCommand(decision.command, table, actorId)) {
      actorCounters.pfr += 1
      hand.countedPfr.add(actorId)
    }
    if (telemetry?.isLimp && !hand.countedLimp.has(actorId)) {
      actorCounters.limp += 1
      hand.countedLimp.add(actorId)
    }
    if (telemetry?.isOverlimp && !hand.countedOverlimp.has(actorId)) {
      actorCounters.overlimp += 1
      hand.countedOverlimp.add(actorId)
    }
    if (telemetry?.isColdCall && !hand.countedColdCall.has(actorId)) {
      actorCounters.coldCall += 1
      hand.countedColdCall.add(actorId)
    }
    if (table.fullRaiseCounter === 1 && table.currentBet > 0 && hasRaiseOption(table, actorId) && !hand.countedThreeBetOpp.has(actorId)) {
      actorCounters.threeBetOpportunities += 1
      hand.countedThreeBetOpp.add(actorId)
    }
    if (table.fullRaiseCounter >= 2 && hasRaiseOption(table, actorId) && !hand.countedFourBetOpp.has(actorId)) {
      actorCounters.fourBetOpportunities += 1
      hand.countedFourBetOpp.add(actorId)
    }
    if (telemetry?.isThreeBet) {
      actorCounters.threeBet += 1
    }
    if (telemetry?.isFourBet) {
      actorCounters.fourBet += 1
    }
    if (telemetry?.isPreflopJam && table.players.find((player) => player.id === actorId) && currentEffectiveStackBb(table, actorId) > 35) {
      actorCounters.preflopJamAbove35bb += 1
    }
    if (telemetry?.isOpenRaise) {
      hand.openRaiserId = actorId
      hand.preflopAggressorId = actorId
    } else if (telemetry?.isThreeBet || telemetry?.isFourBet || (decision.command.kind === 'all-in' && isAggressiveCommand(decision.command, table, actorId))) {
      hand.preflopAggressorId = actorId
    }
    if (hand.openRaiserId === actorId && table.fullRaiseCounter >= 2 && table.currentBet > 0 && !hand.countedFoldToThreeBetOpp.has(actorId)) {
      actorCounters.foldToThreeBetOpportunities += 1
      hand.countedFoldToThreeBetOpp.add(actorId)
      if (decision.command.kind === 'fold') {
        actorCounters.foldToThreeBet += 1
      }
    }
    return
  }

  markSawFlop(table, hand, counters)
  if (table.street !== 'showdown') {
    recordStreetContinuationOpportunity(hand, table.street, actorId, table, counters)
  }

  if (telemetry?.isHeroCallOpportunity) {
    actorCounters.heroCallOpportunities += 1
  }
  if (telemetry?.isHeroCall) {
    actorCounters.heroCall += 1
  }

  if (isAggressiveCommand(decision.command, table, actorId)) {
    actorCounters.postflopAggression += 1
    if (telemetry?.isBluff) {
      actorCounters.bluffs += 1
    }
    if (telemetry?.isOverbet) {
      actorCounters.overbets += 1
    }
    if (table.street !== 'showdown') {
      recordStreetContinuationResult(hand, table.street, actorId, table, counters)
    }
    if (table.street === 'flop') {
      hand.flopAggressorId = actorId
    } else if (table.street === 'turn') {
      hand.turnAggressorId = actorId
    }
  }
}

function hasRaiseOption(table: TableState, actorId: string): boolean {
  const legal = getLegalActions(table, actorId)
  return legal?.options.some((option) => option.kind === 'raise' || option.kind === 'bet') ?? false
}

function currentEffectiveStackBb(table: TableState, actorId: string): number {
  const actor = table.players.find((player) => player.id === actorId)
  if (!actor) {
    return 0
  }
  const actorTotal = actor.stack + actor.currentBet
  const opponentTotal = table.players
    .filter((player) => player.id !== actorId && isPlayerStillInHand(player))
    .reduce((best, player) => Math.min(best, player.stack + player.currentBet), actorTotal)
  return Math.min(actorTotal, opponentTotal) / table.config.bigBlind
}

function finalizeHand(table: TableState, hand: HandRuntime, counters: Record<string, PlayerCounters>): void {
  markSawFlop(table, hand, counters)
  if (!table.showdown) {
    return
  }

  for (const showdownHand of table.showdown.hands) {
    counters[showdownHand.playerId].wentToShowdown += 1
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0
  }

  const bounded = Math.min(Math.max(numerator, 0), denominator)
  return Number(((bounded / denominator) * 100).toFixed(1))
}

export function runProfileSimulation(options: { hands?: number; seed?: number } = {}): SimulationReport {
  const handsTarget = options.hands ?? 10_000
  const seed = options.seed ?? 2_604_160
  const config = makeSimulationConfig()
  const counters = Object.fromEntries(PLAYER_PROFILES.map((profile) => [profile.id, createCounters()])) satisfies Record<
    string,
    PlayerCounters
  >
  let table = startNextHandInPlace(createInitialTableState(config, PLAYER_PROFILES, seed), 0)
  let hand = createHandRuntime(table, counters)
  let completedHands = 0

  while (completedHands < handsTarget) {
    if (!table.handInProgress) {
      finalizeHand(table, hand, counters)
      completedHands += 1
      if (completedHands >= handsTarget) {
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

    const profile = PLAYER_PROFILES_BY_ID[actorId]
    if (!profile) {
      throw new Error(`Missing bot profile for ${actorId}`)
    }

    const decision = decideBotAction(table, actorId, profile)
    recordDecision(table, actorId, decision.decision, hand, counters)
    table.seed = decision.seed
    table = applyPlayerCommandInPlace(table, actorId, decision.decision.command)
  }

  return {
    handsSimulated: completedHands,
    seed,
    players: PLAYER_PROFILES.map((profile) => {
      const stats = counters[profile.id]
      return {
        id: profile.id,
        displayName: profile.displayName,
        hands: stats.hands,
        metrics: {
          vpip: ratio(stats.vpip, stats.hands),
          pfr: ratio(stats.pfr, stats.hands),
          limp: ratio(stats.limp, stats.hands),
          overlimp: ratio(stats.overlimp, stats.hands),
          coldCall: ratio(stats.coldCall, stats.hands),
          threeBet: ratio(stats.threeBet, stats.threeBetOpportunities),
          fourBet: ratio(stats.fourBet, stats.fourBetOpportunities),
          preflopJamAbove35bb: ratio(stats.preflopJamAbove35bb, stats.hands),
          cbetFlop: ratio(stats.cbetFlop, stats.cbetFlopOpportunities),
          cbetTurn: ratio(stats.cbetTurn, stats.cbetTurnOpportunities),
          cbetRiver: ratio(stats.cbetRiver, stats.cbetRiverOpportunities),
          foldToThreeBet: ratio(stats.foldToThreeBet, stats.foldToThreeBetOpportunities),
          heroCallTendency: ratio(stats.heroCall, stats.heroCallOpportunities),
          bluffFrequency: ratio(stats.bluffs, stats.postflopAggression),
          overbetFrequency: ratio(stats.overbets, stats.postflopAggression),
          wtsd: ratio(stats.wentToShowdown, stats.sawFlop),
        },
      }
    }),
  }
}

function formatRow(report: SimulationPlayerReport): string {
  const metrics = report.metrics
  return [
    report.displayName.padEnd(9, ' '),
    `${String(metrics.vpip).padStart(5, ' ')} VPIP`,
    `${String(metrics.pfr).padStart(5, ' ')} PFR`,
    `${String(metrics.limp).padStart(5, ' ')} limp`,
    `${String(metrics.overlimp).padStart(5, ' ')} over`,
    `${String(metrics.coldCall).padStart(5, ' ')} cold`,
    `${String(metrics.threeBet).padStart(5, ' ')} 3b`,
    `${String(metrics.fourBet).padStart(5, ' ')} 4b`,
    `${String(metrics.preflopJamAbove35bb).padStart(5, ' ')} jam35+`,
    `${String(metrics.bluffFrequency).padStart(5, ' ')} bluff`,
    `${String(metrics.overbetFrequency).padStart(5, ' ')} overbet`,
    `${String(metrics.wtsd).padStart(5, ' ')} WTSD`,
  ].join(' | ')
}

function parseArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) {
    return undefined
  }
  return process.argv[index + 1]
}

function main(): void {
  const hands = Number.parseInt(parseArgValue('--hands') ?? '10000', 10)
  const seed = Number.parseInt(parseArgValue('--seed') ?? '2604160', 10)
  const json = process.argv.includes('--json')
  const report = runProfileSimulation({ hands, seed })

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log(`Simulation profils | mains ${report.handsSimulated} | seed ${report.seed}`)
  console.log('---')
  for (const player of report.players) {
    console.log(formatRow(player))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
