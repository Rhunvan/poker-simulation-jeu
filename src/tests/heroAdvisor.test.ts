import { describe, expect, it } from 'vitest'

import { botProfiles, botProfilesById } from '../config/botProfiles'
import type { BotProfile } from '../config/schema'
import { getHeroAdvice } from '../engine/advisor/heroAdvisor'
import { createCard } from '../engine/core/cards'
import type { BettingStreet, CardCode, TableState } from '../engine/core/types'
import { resetTableState } from '../engine/PokerEngine'
import { getLegalActions } from '../engine/rules/legalActions'
import { makeConfig } from './testUtils'

interface AdviceStateOptions {
  street?: BettingStreet
  heroCards?: [CardCode, CardCode]
  board?: CardCode[]
  opponentCount?: number
  toCall?: number
  pot?: number
  stack?: number
}

function makeAdviceState(options: AdviceStateOptions = {}): TableState {
  const opponentCount = options.opponentCount ?? 2
  const stack = options.stack ?? 400
  const state = resetTableState(
    makeConfig({
      maxSeats: opponentCount + 1,
      startingStack: stack,
      buyInDefault: stack,
    }),
    botProfiles.slice(0, opponentCount),
    42,
  )
  const hero = state.players.find((player) => player.id === 'hero')
  if (!hero) {
    throw new Error('Missing hero')
  }

  state.handInProgress = true
  state.currentActorId = hero.id
  state.street = options.street ?? 'flop'
  state.board = (options.board ?? ['Ac', '7d', '2h']).map(createCard)
  hero.holeCards = (options.heroCards ?? ['As', 'Ah']).map(createCard)
  hero.stack = stack
  hero.currentBet = 0
  hero.hasFolded = false
  hero.isAllIn = false
  hero.isSittingOut = false
  hero.hasActedThisRound = false
  hero.lastFullRaiseSeen = 0

  const toCall = options.toCall ?? 0
  state.currentBet = toCall
  state.lastFullRaiseSize = Math.max(state.config.bigBlind, toCall)
  state.fullRaiseCounter = toCall > 0 ? 1 : 0

  const pot = options.pot ?? 120
  const baseContribution = Math.floor(pot / state.players.length)
  let allocated = 0
  state.players.forEach((player, index) => {
    player.hasFolded = false
    player.isSittingOut = false
    player.isAllIn = false
    player.stack = stack
    player.hasActedThisRound = player.id !== hero.id
    player.currentBet = player.id === hero.id ? 0 : toCall
    player.totalCommitted = index === state.players.length - 1 ? pot - allocated : baseContribution
    allocated += player.totalCommitted
  })

  return state
}

function mapEveryOpponentTo(state: TableState, profile: BotProfile): Record<string, BotProfile> {
  return Object.fromEntries(
    state.players
      .filter((player) => player.kind === 'bot')
      .map((player) => [player.botProfileId ?? player.id, profile]),
  )
}

describe('hero advisor', () => {
  it('only advises when hero owns two cards and is the current legal actor', () => {
    const state = makeAdviceState()
    expect(getHeroAdvice(state, botProfilesById)).not.toBeNull()

    const notHeroTurn = structuredClone(state)
    notHeroTurn.currentActorId = notHeroTurn.players.find((player) => player.kind === 'bot')?.id ?? null
    expect(getHeroAdvice(notHeroTurn, botProfilesById)).toBeNull()

    const missingCard = structuredClone(state)
    const hero = missingCard.players.find((player) => player.id === 'hero')!
    hero.holeCards = [createCard('As')]
    expect(getHeroAdvice(missingCard, botProfilesById)).toBeNull()
  })

  it('never changes its answer when hidden opponent cards, deck, or engine seed change', () => {
    const state = makeAdviceState({
      street: 'turn',
      heroCards: ['Qh', 'Jh'],
      board: ['Th', '9c', '2h', '4s'],
      toCall: 40,
      pot: 180,
    })
    const baseline = getHeroAdvice(state, botProfilesById)

    const hiddenCardsChanged = structuredClone(state)
    hiddenCardsChanged.players
      .filter((player) => player.kind === 'bot')
      .forEach((player, index) => {
        player.holeCards = index % 2 === 0 ? [createCard('Ad'), createCard('Ac')] : []
      })
    hiddenCardsChanged.deck.reverse()
    hiddenCardsChanged.seed = 987_654_321

    expect(getHeroAdvice(hiddenCardsChanged, botProfilesById)).toEqual(baseline)
  })

  it('computes call pot odds from visible commitments', () => {
    const state = makeAdviceState({ toCall: 40, pot: 100 })
    const advice = getHeroAdvice(state, botProfilesById)

    expect(advice?.potOdds).toBe(28.6)
  })

  it('returns only legal actions, a legal recommendation, and bounded percentages', () => {
    const state = makeAdviceState({
      heroCards: ['8h', '7h'],
      board: ['6h', '5c', 'Kd'],
      toCall: 35,
      pot: 145,
    })
    const advice = getHeroAdvice(state, botProfilesById)
    const legal = getLegalActions(state, 'hero')

    expect(advice).not.toBeNull()
    expect(legal).not.toBeNull()
    const legalKinds = legal!.options.map((option) => option.kind)
    expect(legalKinds).toContain(advice!.recommendedAction)
    expect(Object.keys(advice!.actionMix).sort()).toEqual([...new Set(legalKinds)].sort())
    expect(Object.values(advice!.actionMix).reduce((total, percentage) => total + percentage, 0)).toBeCloseTo(100, 5)
    expect(Object.values(advice!.actionMix).every((percentage) => percentage >= 0 && percentage <= 100)).toBe(true)
    expect(advice!.equity).toBeGreaterThanOrEqual(0)
    expect(advice!.equity).toBeLessThanOrEqual(100)
    expect(advice!.potOdds).toBeGreaterThanOrEqual(0)
    expect(advice!.potOdds).toBeLessThanOrEqual(100)
    expect(advice!.effectiveStackBb).toBeGreaterThanOrEqual(0)
  })

  it('values a strong hand with a larger sizing against a loose/calling table than a tight table', () => {
    const state = makeAdviceState({
      heroCards: ['As', 'Ah'],
      board: ['Ac', '7d', '2h'],
      pot: 180,
      stack: 800,
    })
    const tightProfile = botProfilesById.philippe
    const looseProfile = botProfilesById.gerard
    if (!tightProfile || !looseProfile) {
      throw new Error('Expected Philippe and Gerard profiles')
    }

    const tightAdvice = getHeroAdvice(state, mapEveryOpponentTo(state, tightProfile))
    const looseAdvice = getHeroAdvice(state, mapEveryOpponentTo(state, looseProfile))

    expect(tightAdvice?.recommendedAction).toBe('bet')
    expect(looseAdvice?.recommendedAction).toBe('bet')
    expect(looseAdvice!.suggestedTotal).toBeGreaterThan(tightAdvice!.suggestedTotal!)
    expect(looseAdvice?.reasons.some((reason) => reason.includes('loose/calling'))).toBe(true)
    expect(tightAdvice?.reasons.some((reason) => reason.includes('Table serree'))).toBe(true)
  })

  it('treats the live option as the entry price when sizing over limpers', () => {
    const state = makeAdviceState({
      street: 'preflop',
      board: [],
      heroCards: ['As', 'Ah'],
      opponentCount: 3,
      toCall: 40,
      pot: 160,
      stack: 800,
    })
    state.config.straddle = { enabled: true, amount: 40, label: 'Option' }
    state.currentBet = 40
    state.fullRaiseCounter = 0
    state.lastFullRaiseSize = 20
    state.players
      .filter((player) => player.id !== 'hero')
      .forEach((player) => {
        player.currentBet = 40
        player.lastAction = { kind: 'call', amount: 40, label: 'Call 40', street: 'preflop' }
      })

    const gerard = botProfilesById.gerard
    if (!gerard) {
      throw new Error('Expected Gerard profile')
    }
    const advice = getHeroAdvice(state, mapEveryOpponentTo(state, gerard))

    expect(advice?.recommendedAction).toBe('raise')
    expect(advice?.suggestedTotal).toBeGreaterThanOrEqual(200)
  })

  it('folds a weak suited hand when its equity misses the price in a very multiway option pot', () => {
    const state = makeAdviceState({
      street: 'preflop',
      board: [],
      heroCards: ['Qc', '3c'],
      opponentCount: 7,
      toCall: 40,
      pot: 230,
      stack: 800,
    })
    state.config.straddle = { enabled: true, amount: 40, label: 'Option' }
    state.currentBet = 40
    state.fullRaiseCounter = 0
    state.lastFullRaiseSize = 20
    state.players
      .filter((player) => player.id !== 'hero')
      .forEach((player) => {
        player.currentBet = 40
        player.lastAction = { kind: 'call', amount: 40, label: 'Call 40', street: 'preflop' }
      })

    const advice = getHeroAdvice(state, botProfilesById)

    expect(advice?.equity).toBeLessThan(advice?.potOdds ?? 0)
    expect(advice?.recommendedAction).toBe('fold')
  })
})
