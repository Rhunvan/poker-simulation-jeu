import { describe, expect, it } from 'vitest'

import { createInitialTableState, startNextHand } from '../engine'
import { buildTableDebugSnapshot } from '../ui/tableDebug'
import { makeConfig, getTestProfiles } from './testUtils'

function createSparseNineMaxState(seed = 42) {
  const initial = createInitialTableState(makeConfig({ maxSeats: 9 }), getTestProfiles(3), seed)
  const hero = initial.players[0]!
  const bots = initial.players.slice(1)
  const [botA, botB, botC] = bots
  const seatAssignments = {
    [hero.id]: 0,
    [botA!.id]: 2,
    [botB!.id]: 5,
    [botC!.id]: 8,
  }

  for (const player of initial.players) {
    player.seatIndex = seatAssignments[player.id as keyof typeof seatAssignments]
  }
  initial.players.sort((left, right) => left.seatIndex - right.seatIndex)
  initial.dealerSeatIndex = 0

  return startNextHand(initial, 0)
}

describe('table debug overlay helpers', () => {
  it('exposes sparse-table seat order and actor markers for the UI overlay', () => {
    const table = createSparseNineMaxState()

    const snapshot = buildTableDebugSnapshot(table)

    expect(snapshot.occupiedSeatLabels).toEqual(['S3', 'S6', 'S9', 'S1'])
    expect(snapshot.firstActorPreflopLabel).toBe('S9')
    expect(snapshot.firstActorPostflopLabel).toBe('S3')
    expect(snapshot.heroRelativeLabel).toBe('BTN')
    expect(snapshot.seats).toEqual([
      { seatIndex: 0, badges: ['BTN', '#4', 'Hero'] },
      { seatIndex: 2, badges: ['SB', 'POST1', '#1'] },
      { seatIndex: 5, badges: ['BB', '#2'] },
      { seatIndex: 8, badges: ['PF1', '#3'] },
    ])
  })
})
