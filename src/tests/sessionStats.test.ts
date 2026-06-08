import { describe, expect, it } from 'vitest'

import { applyPlayerCommand, resetTableState, startNextHand } from '../engine'
import { getSessionStats } from '../engine/sessionStats'
import { makeConfig, getTestProfiles } from './testUtils'

describe('session stats and recaves', () => {
  it('tracks uncontested hands in the session summary', () => {
    const state = resetTableState(makeConfig({ maxSeats: 2 }), getTestProfiles(1), 42)
    const next = applyPlayerCommand(state, 'hero', { kind: 'fold' })

    expect(next.handSummaries).toHaveLength(1)
    expect(next.handSummaries[0]?.showdown).toBe(false)
    expect(next.handSummaries[0]?.winners[0]?.wonUncontested).toBe(true)

    const heroStats = getSessionStats(next, 'hero')
    expect(heroStats.handsCompleted).toBe(1)
    expect(heroStats.handsEntered).toBe(1)
    expect(heroStats.handsWon).toBe(0)
    expect(heroStats.grossLost).toBe(10)
    expect(heroStats.netResult).toBe(-10)
    expect(heroStats.biggestLoss).toBe(10)
  })

  it('includes automatic recaves in the session stats', () => {
    const state = resetTableState(makeConfig({ maxSeats: 2 }), getTestProfiles(1), 42)
    const hero = state.players.find((player) => player.id === 'hero')!

    hero.stack = 0
    state.handInProgress = false
    state.currentActorId = null

    const next = startNextHand(state, 0)
    const heroStats = getSessionStats(next, 'hero')

    expect(next.players.find((player) => player.id === 'hero')?.rebuys).toBe(1)
    expect(heroStats.rebuys).toBe(1)
    expect(heroStats.rebuyAmount).toBe(200)
    expect(heroStats.totalInvested).toBe(400)
  })
})
