import { describe, expect, it } from 'vitest'

import { applyPlayerCommand, createInitialTableState, resetTableState, startNextHand } from '../engine'
import { createCard } from '../engine/core/cards'
import type { CardCode, TableState } from '../engine/core/types'
import { makeConfig, getTestProfiles } from './testUtils'

function toCards(codes: CardCode[]) {
  return codes.map((code) => createCard(code))
}

function setupRiverCheckState(state: TableState): TableState {
  const next = structuredClone(state) as TableState
  next.street = 'river'
  next.currentBet = 0
  next.fullRaiseCounter = 0
  next.lastFullRaiseSize = 20
  return next
}

function createSparseShowdownState(seed = 42): TableState {
  const initial = createInitialTableState(makeConfig({ maxSeats: 9 }), getTestProfiles(3), seed)
  const hero = initial.players[0]!
  const bots = initial.players.slice(1)
  const seatAssignments = {
    [hero.id]: 0,
    [bots[0]!.id]: 2,
    [bots[1]!.id]: 5,
    [bots[2]!.id]: 8,
  }

  for (const player of initial.players) {
    player.seatIndex = seatAssignments[player.id as keyof typeof seatAssignments]
  }
  initial.players.sort((left, right) => left.seatIndex - right.seatIndex)
  initial.dealerSeatIndex = 0

  return setupRiverCheckState(startNextHand(initial, 0))
}

describe('showdown and payout distribution', () => {
  it('builds side pots and distributes them correctly', () => {
    const state = setupRiverCheckState(resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42))
    const hero = state.players.find((player) => player.id === 'hero')!
    const botA = state.players.find((player) => player.id !== 'hero' && player.seatIndex === 1)!
    const botB = state.players.find((player) => player.id !== 'hero' && player.seatIndex === 2)!

    state.board = toCards(['2c', '3d', '4h', '9s', 'Jd'])
    hero.holeCards = toCards(['As', 'Ad'])
    botA.holeCards = toCards(['Ks', 'Kh'])
    botB.holeCards = toCards(['Qh', 'Qc'])

    hero.totalCommitted = 100
    botA.totalCommitted = 200
    botB.totalCommitted = 200
    hero.stack = 0
    botA.stack = 0
    botB.stack = 5
    hero.isAllIn = true
    botA.isAllIn = true
    botB.isAllIn = false
    hero.hasActedThisRound = true
    botA.hasActedThisRound = true
    botB.hasActedThisRound = false
    state.currentActorId = botB.id

    const next = applyPlayerCommand(state, botB.id, { kind: 'check' })

    expect(next.pots.map((pot) => pot.amount)).toEqual([300, 200])
    expect(next.players.find((player) => player.id === 'hero')?.stack).toBe(300)
    expect(next.players.find((player) => player.id === botA.id)?.stack).toBe(200)
    expect(next.players.find((player) => player.id === botB.id)?.stack).toBe(5)
    expect(next.handSummaries).toHaveLength(1)
    expect(next.handSummaries[0]?.showdown).toBe(true)
    expect(next.handSummaries[0]?.winners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: 'hero',
          amount: 300,
          category: 'pair',
        }),
        expect.objectContaining({
          playerId: botA.id,
          amount: 200,
          category: 'pair',
        }),
      ]),
    )
    expect(
      (
        next.handSummaries[0] as (typeof next.handSummaries)[number] & {
          shownHands?: Array<{ playerId: string; category: string; holeCards: string[] }>
        }
      ).shownHands,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ playerId: 'hero', category: 'pair', holeCards: ['As', 'Ad'] }),
        expect.objectContaining({ playerId: botA.id, category: 'pair', holeCards: ['Ks', 'Kh'] }),
        expect.objectContaining({ playerId: botB.id, category: 'pair', holeCards: ['Qh', 'Qc'] }),
      ]),
    )
  })

  it('splits the pot on tied hands', () => {
    const state = setupRiverCheckState(resetTableState(makeConfig({ maxSeats: 2 }), getTestProfiles(1), 42))
    const hero = state.players.find((player) => player.id === 'hero')!
    const bot = state.players.find((player) => player.id !== 'hero')!

    state.board = toCards(['Ah', 'Kd', 'Qs', 'Jc', 'Tc'])
    hero.holeCards = toCards(['2c', '3d'])
    bot.holeCards = toCards(['4s', '5h'])

    hero.totalCommitted = 100
    bot.totalCommitted = 100
    hero.stack = 0
    bot.stack = 1
    hero.isAllIn = true
    bot.isAllIn = false
    hero.hasActedThisRound = true
    bot.hasActedThisRound = false
    state.currentActorId = bot.id

    const next = applyPlayerCommand(state, bot.id, { kind: 'check' })

    expect(next.players.find((player) => player.id === 'hero')?.stack).toBe(100)
    expect(next.players.find((player) => player.id === bot.id)?.stack).toBe(101)
  })

  it('awards blinds correctly when a hand ends without showdown', () => {
    const state = resetTableState(makeConfig({ maxSeats: 2 }), getTestProfiles(1), 42)
    const next = applyPlayerCommand(state, 'hero', { kind: 'fold' })
    const bot = next.players.find((player) => player.id !== 'hero')!
    const hero = next.players.find((player) => player.id === 'hero')!

    expect(bot.stack).toBe(210)
    expect(hero.stack).toBe(190)
  })

  it('awards odd chips by occupied seats on a sparse table', () => {
    const state = createSparseShowdownState()
    const hero = state.players.find((player) => player.id === 'hero')!
    const seatTwo = state.players.find((player) => player.seatIndex === 2)!
    const seatFive = state.players.find((player) => player.seatIndex === 5)!
    const seatEight = state.players.find((player) => player.seatIndex === 8)!

    state.board = toCards(['Ah', 'Kd', 'Qs', 'Jc', 'Tc'])
    hero.holeCards = toCards(['2c', '3d'])
    seatFive.holeCards = toCards(['4s', '5h'])
    seatEight.holeCards = toCards(['7d', '7c'])

    hero.totalCommitted = 50
    seatTwo.totalCommitted = 0
    seatFive.totalCommitted = 50
    seatEight.totalCommitted = 1
    hero.stack = 0
    seatTwo.stack = 200
    seatFive.stack = 1
    seatEight.stack = 5
    hero.hasFolded = false
    seatTwo.hasFolded = true
    seatFive.hasFolded = false
    hero.isAllIn = true
    seatTwo.isAllIn = false
    seatFive.isAllIn = false
    seatEight.hasFolded = true
    seatEight.isAllIn = false
    hero.hasActedThisRound = true
    seatFive.hasActedThisRound = false
    state.currentActorId = seatFive.id

    const next = applyPlayerCommand(state, seatFive.id, { kind: 'check' })

    expect(next.players.find((player) => player.id === hero.id)?.stack).toBe(50)
    expect(next.players.find((player) => player.id === seatFive.id)?.stack).toBe(52)
    expect(next.showdown?.awards[0]?.oddChipWinnerIds).toEqual([seatFive.id])
  })
})
