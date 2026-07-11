import { describe, expect, it } from 'vitest'

import { applyPlayerCommand, createInitialTableState, resetTableState, startNextHand } from '../engine'
import { createDeck } from '../engine/core/cards'
import { getFirstActorPostflop } from '../engine/core/positions'
import { shuffleWithSeed } from '../engine/core/random'
import { createSeatRing, getOccupiedSeatsClockwiseFrom } from '../engine/core/seatRing'
import { getLegalActions } from '../engine/rules/legalActions'
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

  const shuffled = shuffleWithSeed(createDeck(), initial.seed)
  const table = startNextHand(initial, 0)

  return {
    table,
    shuffledDeck: shuffled.items,
  }
}

describe('betting rules', () => {
  it('offers legal preflop actions in the expected order', () => {
    const state = resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42)
    const legal = getLegalActions(state, 'hero')

    expect(legal?.options.map((option) => option.kind)).toEqual(['fold', 'call', 'raise', 'all-in'])
  })

  it('enforces the minimum raise based on the last full raise', () => {
    const state = resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42)
    const afterOpen = applyPlayerCommand(state, 'hero', { kind: 'raise', total: 50 })
    const nextActorId = afterOpen.currentActorId
    const legal = nextActorId ? getLegalActions(afterOpen, nextActorId) : null

    expect(legal?.minRaiseTo).toBe(80)
  })

  it('posts the live option as a straddle and starts action after it', () => {
    const state = resetTableState(
      makeConfig({
        maxSeats: 4,
        straddle: {
          enabled: true,
          amount: 40,
          label: 'Option',
        },
      }),
      getTestProfiles(3),
      42,
    )
    const straddlePlayer = state.players.find((player) => player.lastAction?.kind === 'post-straddle')
    const legal = state.currentActorId ? getLegalActions(state, state.currentActorId) : null

    expect(straddlePlayer?.currentBet).toBe(40)
    expect(state.currentBet).toBe(40)
    expect(state.lastFullRaiseSize).toBe(40)
    expect(state.currentActorId).not.toBe(straddlePlayer?.id)
    expect(legal?.toCall).toBe(40)
    expect(legal?.minRaiseTo).toBe(80)
  })

  it('does not reopen action after an incomplete all-in raise', () => {
    const state = resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42)
    const smallBlind = state.players.find((player) => player.seatIndex === 1)
    if (!smallBlind) {
      throw new Error('Missing small blind')
    }
    smallBlind.stack = 60

    const afterOpen = applyPlayerCommand(state, 'hero', { kind: 'raise', total: 50 })
    const afterShortJam = applyPlayerCommand(afterOpen, afterOpen.currentActorId!, { kind: 'all-in' })
    const afterCall = applyPlayerCommand(afterShortJam, afterShortJam.currentActorId!, { kind: 'call' })
    const legal = getLegalActions(afterCall, 'hero')

    expect(legal?.options.map((option) => option.kind)).toEqual(['fold', 'call'])
  })

  it('uses correct heads-up blind order and rotates the button', () => {
    const state = resetTableState(makeConfig({ maxSeats: 2 }), getTestProfiles(1), 42)
    expect(state.dealerSeatIndex).toBe(0)
    expect(state.smallBlindSeatIndex).toBe(0)
    expect(state.bigBlindSeatIndex).toBe(1)

    const finished = applyPlayerCommand(state, 'hero', { kind: 'fold' })
    const nextHand = startNextHand(finished, finished.sessionElapsedMs)

    expect(nextHand.dealerSeatIndex).toBe(1)
    expect(nextHand.smallBlindSeatIndex).toBe(1)
    expect(nextHand.bigBlindSeatIndex).toBe(0)
  })

  it('rotates the dealer button correctly in three handed play', () => {
    const state = resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42)
    const heroFolded = applyPlayerCommand(state, 'hero', { kind: 'fold' })
    const handFinished = applyPlayerCommand(heroFolded, heroFolded.currentActorId!, { kind: 'fold' })
    const nextHand = startNextHand(handFinished, handFinished.sessionElapsedMs)

    expect(nextHand.dealerSeatIndex).toBe(1)
  })

  it('draws opponent seats on reset while keeping them stable between hands', () => {
    const config = makeConfig({ maxSeats: 8 })
    const firstState = resetTableState(config, getTestProfiles(7), 42)
    const secondState = resetTableState(config, getTestProfiles(7), 99)

    const firstSeatMap = Object.fromEntries(firstState.players.map((player) => [player.id, player.seatIndex]))
    const secondSeatMap = Object.fromEntries(secondState.players.map((player) => [player.id, player.seatIndex]))

    expect(firstSeatMap.hero).toBe(0)
    expect(secondSeatMap.hero).toBe(0)
    expect(new Set(Object.values(firstSeatMap)).size).toBe(8)
    expect(firstSeatMap).not.toEqual(secondSeatMap)

    const threeHanded = resetTableState(makeConfig({ maxSeats: 3 }), getTestProfiles(2), 42)
    const threeHandedSeatMap = Object.fromEntries(threeHanded.players.map((player) => [player.id, player.seatIndex]))
    const heroFolded = applyPlayerCommand(threeHanded, 'hero', { kind: 'fold' })
    const afterSecondFold = applyPlayerCommand(heroFolded, heroFolded.currentActorId!, { kind: 'fold' })
    const nextHand = startNextHand(afterSecondFold, afterSecondFold.sessionElapsedMs)
    const nextHandSeatMap = Object.fromEntries(nextHand.players.map((player) => [player.id, player.seatIndex]))

    expect(nextHandSeatMap).toEqual(threeHandedSeatMap)
  })

  it('preserves the occupied seat ring and deal order on a sparse 9-max table', () => {
    const { table, shuffledDeck } = createSparseNineMaxState()
    const ring = createSeatRing(table.players, table.config.maxSeats)
    const clockwiseFromDealer = getOccupiedSeatsClockwiseFrom(ring, table.dealerSeatIndex)

    expect(ring.occupiedSeatIndices).toEqual([0, 2, 5, 8])
    expect(clockwiseFromDealer).toEqual([2, 5, 8, 0])
    expect(table.players.find((player) => player.seatIndex === 2)?.holeCards.map((card) => card.code)).toEqual([
      shuffledDeck[0]?.code,
      shuffledDeck[4]?.code,
    ])
    expect(table.players.find((player) => player.seatIndex === 5)?.holeCards.map((card) => card.code)).toEqual([
      shuffledDeck[1]?.code,
      shuffledDeck[5]?.code,
    ])
    expect(table.players.find((player) => player.seatIndex === 8)?.holeCards.map((card) => card.code)).toEqual([
      shuffledDeck[2]?.code,
      shuffledDeck[6]?.code,
    ])
    expect(table.players.find((player) => player.seatIndex === 0)?.holeCards.map((card) => card.code)).toEqual([
      shuffledDeck[3]?.code,
      shuffledDeck[7]?.code,
    ])
  })

  it('assigns blinds and action order correctly on a sparse 9-max table', () => {
    const { table } = createSparseNineMaxState()

    expect(table.dealerSeatIndex).toBe(0)
    expect(table.smallBlindSeatIndex).toBe(2)
    expect(table.bigBlindSeatIndex).toBe(5)
    expect(table.currentActorId).toBe(table.players.find((player) => player.seatIndex === 8)?.id ?? null)
    expect(
      getFirstActorPostflop(table.players, table.dealerSeatIndex, () => true, table.config.maxSeats),
    ).toBe(2)
  })
})
