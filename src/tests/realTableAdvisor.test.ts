import { describe, expect, it } from 'vitest'

import { botProfilesById } from '../config/botProfiles'
import { tableConfig } from '../config/tableConfig'
import {
  analyzeRealTableSpot,
  type RealTableSpotInput,
} from '../engine/advisor/realTableAdvisor'

function makeSpot(overrides: Partial<RealTableSpotInput> = {}): RealTableSpotInput {
  return {
    heroCards: ['As', 'Ah'],
    board: ['', '', '', '', ''],
    street: 'preflop',
    position: 'button',
    pot: 3_500,
    toCall: 2_000,
    heroStack: 40_000,
    opponentStack: 40_000,
    opponentIds: ['gilles', 'eric_b', 'david', 'philippe', 'gerard', 'pierre', 'fabrice'],
    pressureType: 'option',
    pressureActorId: 'david',
    limperCount: 0,
    ...overrides,
  }
}

describe('real table advisor', () => {
  it('builds an isolated public spot and compares theory with the active profiles', () => {
    const result = analyzeRealTableSpot(makeSpot(), tableConfig, botProfilesById)

    expect(result.errors).toEqual([])
    expect(result.analysis).not.toBeNull()
    expect(result.analysis?.state.players).toHaveLength(8)
    expect(result.analysis?.legal.toCall).toBe(2_000)
    expect(result.analysis?.theoretical.recommendedAction).toBeTruthy()
    expect(result.analysis?.adapted.recommendedAction).toBeTruthy()
    expect(
      result.analysis?.state.players
        .filter((player) => player.kind === 'bot')
        .every((player) => player.holeCards.length === 0),
    ).toBe(true)
    expect(
      result.analysis?.state.players.reduce((sum, player) => sum + player.totalCommitted, 0),
    ).toBe(3_500)
  })

  it('rejects duplicate cards and an incomplete board', () => {
    const result = analyzeRealTableSpot(
      makeSpot({
        heroCards: ['As', 'As'],
        street: 'flop',
        board: ['Kh', 'Qh', '', '', ''],
      }),
      tableConfig,
      botProfilesById,
    )

    expect(result.analysis).toBeNull()
    expect(result.errors).toContain('Une même carte ne peut apparaître deux fois.')
    expect(result.errors.some((error) => error.includes('3 cartes du board'))).toBe(true)
  })

  it('rejects impossible amounts without touching the simulation state', () => {
    const result = analyzeRealTableSpot(
      makeSpot({ heroStack: 10_000, toCall: 12_000, pot: 1_000 }),
      tableConfig,
      botProfilesById,
    )

    expect(result.analysis).toBeNull()
    expect(result.errors).toContain('Le montant à payer ne peut pas dépasser ton stack.')
  })
})
