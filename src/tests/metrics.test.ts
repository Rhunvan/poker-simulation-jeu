import { describe, expect, it } from 'vitest'

import {
  createCounters,
  createHandRuntime,
  recordDecision,
  runProfileSimulation,
  type PlayerCounters,
} from '../../scripts/simulateProfiles'
import { resetTableState } from '../engine'
import type { DecisionTelemetry, TableState } from '../engine/core/types'
import { makeConfig, getTestProfiles } from './testUtils'

function buildCounterRecord(state: TableState): Record<string, PlayerCounters> {
  return Object.fromEntries(state.players.map((player) => [player.id, createCounters()])) as Record<string, PlayerCounters>
}

function makeTelemetry(overrides: Partial<DecisionTelemetry> = {}): DecisionTelemetry {
  return {
    tags: [],
    ...overrides,
  }
}

describe('calibration metrics semantics', () => {
  it('separates limp, overlimp, and cold call tracking', () => {
    const baseState = resetTableState(makeConfig({ maxSeats: 4 }), getTestProfiles(3), 42)
    const actorId = baseState.currentActorId!

    const limpCounters = buildCounterRecord(baseState)
    recordDecision(
      baseState,
      actorId,
      { command: { kind: 'call' }, telemetry: makeTelemetry({ isLimp: true }) },
      createHandRuntime(baseState, limpCounters),
      limpCounters,
    )

    const overlimpState = structuredClone(baseState) as TableState
    const overlimpCounters = buildCounterRecord(overlimpState)
    recordDecision(
      overlimpState,
      actorId,
      { command: { kind: 'call' }, telemetry: makeTelemetry({ isOverlimp: true }) },
      createHandRuntime(overlimpState, overlimpCounters),
      overlimpCounters,
    )

    const coldCallState = structuredClone(baseState) as TableState
    coldCallState.currentBet = 60
    coldCallState.fullRaiseCounter = 1
    const coldCallCounters = buildCounterRecord(coldCallState)
    recordDecision(
      coldCallState,
      actorId,
      { command: { kind: 'call' }, telemetry: makeTelemetry({ isColdCall: true }) },
      createHandRuntime(coldCallState, coldCallCounters),
      coldCallCounters,
    )

    expect(limpCounters[actorId].limp).toBe(1)
    expect(limpCounters[actorId].overlimp).toBe(0)
    expect(limpCounters[actorId].coldCall).toBe(0)
    expect(overlimpCounters[actorId].limp).toBe(0)
    expect(overlimpCounters[actorId].overlimp).toBe(1)
    expect(overlimpCounters[actorId].coldCall).toBe(0)
    expect(coldCallCounters[actorId].limp).toBe(0)
    expect(coldCallCounters[actorId].overlimp).toBe(0)
    expect(coldCallCounters[actorId].coldCall).toBe(1)
  })

  it('counts only true continuation bets on unopened streets', () => {
    const state = resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42)
    const actorId = state.players.find((player) => player.id !== 'hero')!.id

    const cbetState = structuredClone(state) as TableState
    cbetState.street = 'flop'
    cbetState.currentBet = 0
    cbetState.currentActorId = actorId
    const cbetCounters = buildCounterRecord(cbetState)
    const cbetHand = createHandRuntime(cbetState, cbetCounters)
    cbetHand.preflopAggressorId = actorId
    recordDecision(
      cbetState,
      actorId,
      { command: { kind: 'bet', total: 40 }, telemetry: makeTelemetry() },
      cbetHand,
      cbetCounters,
    )

    const raiseVsDonkState = structuredClone(state) as TableState
    raiseVsDonkState.street = 'flop'
    raiseVsDonkState.currentBet = 40
    raiseVsDonkState.currentActorId = actorId
    const raiseVsDonkCounters = buildCounterRecord(raiseVsDonkState)
    const raiseVsDonkHand = createHandRuntime(raiseVsDonkState, raiseVsDonkCounters)
    raiseVsDonkHand.preflopAggressorId = actorId
    recordDecision(
      raiseVsDonkState,
      actorId,
      { command: { kind: 'raise', total: 120 }, telemetry: makeTelemetry() },
      raiseVsDonkHand,
      raiseVsDonkCounters,
    )

    expect(cbetCounters[actorId].cbetFlopOpportunities).toBe(1)
    expect(cbetCounters[actorId].cbetFlop).toBe(1)
    expect(raiseVsDonkCounters[actorId].cbetFlopOpportunities).toBe(0)
    expect(raiseVsDonkCounters[actorId].cbetFlop).toBe(0)
  })

  it('keeps heroCallTendency bounded between 0 and 100', () => {
    const report = runProfileSimulation({ hands: 120, seed: 4242 })

    for (const player of report.players) {
      expect(player.metrics.heroCallTendency).toBeGreaterThanOrEqual(0)
      expect(player.metrics.heroCallTendency).toBeLessThanOrEqual(100)
    }
  })
})
