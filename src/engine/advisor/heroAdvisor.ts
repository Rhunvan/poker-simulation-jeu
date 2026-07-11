import type { BotProfile } from '../../config/schema'
import { createDeck, RANK_TO_VALUE } from '../core/cards'
import { getFirstActorPostflop, getFirstActorPreflop } from '../core/positions'
import { createSeatRing, getOccupiedSeatsClockwiseFrom } from '../core/seatRing'
import type {
  Card,
  LegalActionOption,
  LegalActionState,
  PlayerLastAction,
  TablePlayer,
  TableState,
} from '../core/types'
import { analyzeBoardTexture } from '../eval/boardTexture'
import { compareHoldemHands, evaluateHoldemHand } from '../eval/handEvaluator'
import { getLegalActions } from '../rules/legalActions'
import { getPotTotal } from '../rules/pots'

export type HeroAdviceAction = LegalActionOption['kind']
export type HeroAdviceConfidence = 'low' | 'medium' | 'high'

export interface HeroAdvice {
  recommendedAction: HeroAdviceAction
  /** Percentages (0-100). Only legal actions are included. */
  actionMix: Partial<Record<HeroAdviceAction, number>>
  /** Estimated showdown equity, as a percentage (0-100). */
  equity: number
  /** Immediate price of a call, as a percentage (0-100). */
  potOdds: number
  effectiveStackBb: number
  /** Total amount to have committed on the current street. */
  suggestedTotal?: number
  confidence: HeroAdviceConfidence
  reasons: string[]
  disclaimer: string
}

interface PublicOpponent {
  id: string
  seatIndex: number
  stack: number
  currentBet: number
  totalCommitted: number
  isAllIn: boolean
  lastAction: PlayerLastAction | null
  profile: BotProfile | undefined
}

interface TableModel {
  looseness: number
  calling: number
  aggression: number
  foldability: number
  knownProfileCount: number
}

interface PositionModel {
  score: number
  inPosition: boolean
  playersBehind: number
  label: 'early' | 'middle' | 'late'
}

interface HeroHandModel {
  preflopStrength: number
  playability: number
  madeStrength: number
  drawStrength: number
}

interface RandomSource {
  next: () => number
}

const DISCLAIMER =
  "Estimation locale deterministe adaptee aux profils et aux actions visibles ; ce n'est pas un solveur GTO exact."

const ALL_ADVICE_ACTIONS: HeroAdviceAction[] = ['fold', 'check', 'call', 'bet', 'raise', 'all-in']

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function rangeMid(range: [number, number]): number {
  return (range[0] + range[1]) / 200
}

function round(value: number, precision = 1): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value))
}

function getBigBlind(table: TableState): number {
  const level = table.config.blindSchedule?.[table.currentLevelIndex]
  return Math.max(1, level?.bigBlind ?? table.config.bigBlind)
}

function isPubliclyStillInHand(player: TablePlayer, heroId: string, handInProgress: boolean): boolean {
  if (player.isSittingOut || player.hasFolded) {
    return false
  }

  if (player.id === heroId) {
    return true
  }

  // During a live hand, every non-sitting, non-folded seat is treated as dealt in.
  // Deliberately do not inspect an opponent's holeCards to establish eligibility.
  return handInProgress && (player.stack > 0 || player.isAllIn || player.totalCommitted > 0)
}

function toPublicOpponent(player: TablePlayer, profilesById: Record<string, BotProfile>): PublicOpponent {
  return {
    id: player.id,
    seatIndex: player.seatIndex,
    stack: player.stack,
    currentBet: player.currentBet,
    totalCommitted: player.totalCommitted,
    isAllIn: player.isAllIn,
    lastAction: player.lastAction,
    profile: profilesById[player.botProfileId ?? player.id],
  }
}

function buildTableModel(opponents: PublicOpponent[]): TableModel {
  if (opponents.length === 0) {
    return {
      looseness: 0.3,
      calling: 0.35,
      aggression: 0.3,
      foldability: 0.5,
      knownProfileCount: 0,
    }
  }

  let looseness = 0
  let calling = 0
  let aggression = 0
  let knownProfileCount = 0

  for (const opponent of opponents) {
    const profile = opponent.profile
    if (!profile) {
      looseness += 0.3
      calling += 0.35
      aggression += 0.3
      continue
    }

    knownProfileCount += 1
    const vpip = rangeMid(profile.targetStats.vpip)
    const coldCall = rangeMid(profile.targetStats.coldCall)
    const heroCall = rangeMid(profile.targetStats.heroCall)
    const pfr = rangeMid(profile.targetStats.pfr)
    const threeBet = rangeMid(profile.targetStats.threeBet)
    const bluff = rangeMid(profile.targetStats.bluff)
    const overbet = rangeMid(profile.targetStats.overbet)
    const cbet =
      (rangeMid(profile.targetStats.cbetFlop) +
        rangeMid(profile.targetStats.cbetTurn) +
        rangeMid(profile.targetStats.cbetRiver)) /
      3

    looseness += vpip
    calling += clamp(
      vpip * 0.22 +
        coldCall * 0.2 +
        heroCall * 0.48 +
        (profile.quirks?.irrationalCalls ? 0.08 : 0) +
        (profile.quirks?.showdownCurious ? 0.05 : 0),
      0,
      1,
    )
    aggression += clamp(pfr * 0.28 + threeBet * 0.18 + cbet * 0.25 + bluff * 0.2 + overbet * 0.09, 0, 1)
  }

  const count = opponents.length
  const averageCalling = calling / count
  return {
    looseness: looseness / count,
    calling: averageCalling,
    aggression: aggression / count,
    foldability: clamp(1 - averageCalling * 0.85 - looseness / count * 0.12, 0.08, 0.88),
    knownProfileCount,
  }
}

function getPositionModel(table: TableState, players: TablePlayer[], heroId: string): PositionModel {
  const maxSeats = table.config.maxSeats
  const firstSeat =
    table.street === 'preflop'
      ? getFirstActorPreflop(
          players,
          table.smallBlindSeatIndex,
          table.bigBlindSeatIndex,
          players.length === 2,
          () => true,
          maxSeats,
        )
      : getFirstActorPostflop(players, table.dealerSeatIndex, () => true, maxSeats)

  if (firstSeat === null || players.length <= 1) {
    return { score: 1, inPosition: true, playersBehind: 0, label: 'late' }
  }

  const ring = createSeatRing(players, maxSeats)
  const order = getOccupiedSeatsClockwiseFrom(ring, (firstSeat - 1 + maxSeats) % maxSeats)
    .map((seat) => ring.playersBySeat.get(seat))
    .filter((player): player is TablePlayer => Boolean(player))
  const heroIndex = order.findIndex((player) => player.id === heroId)
  if (heroIndex < 0) {
    return { score: 0.5, inPosition: false, playersBehind: 0, label: 'middle' }
  }

  const playersBehind = Math.max(0, order.length - heroIndex - 1)
  const score = order.length === 1 ? 1 : heroIndex / (order.length - 1)
  return {
    score,
    inPosition: table.street !== 'preflop' && playersBehind === 0,
    playersBehind,
    label: score < 0.34 ? 'early' : score < 0.67 ? 'middle' : 'late',
  }
}

function preflopCardStrength(cards: Card[]): { strength: number; playability: number } {
  const [highCard, lowCard] = [...cards].sort(
    (left, right) => RANK_TO_VALUE[right.rank] - RANK_TO_VALUE[left.rank],
  )
  const high = RANK_TO_VALUE[highCard.rank]
  const low = RANK_TO_VALUE[lowCard.rank]
  const pair = high === low
  const suited = highCard.suit === lowCard.suit
  const gap = pair ? 0 : high - low
  const broadwayCount = Number(high >= 10) + Number(low >= 10)

  if (pair) {
    return {
      strength: clamp(0.47 + high / 27, 0, 0.995),
      playability: clamp(0.38 + high / 26, 0, 0.95),
    }
  }

  const highContribution = ((high - 2) / 12) * 0.49
  const lowContribution = ((low - 2) / 12) * 0.2
  const suitedBonus = suited ? 0.1 : 0
  const connectionBonus = gap <= 1 ? 0.09 : gap === 2 ? 0.055 : gap === 3 ? 0.02 : 0
  const broadwayBonus = broadwayCount === 2 ? 0.08 : broadwayCount === 1 ? 0.025 : 0
  const wheelBonus = high === 14 && low <= 5 ? 0.035 : 0
  const strength = clamp(
    0.04 + highContribution + lowContribution + suitedBonus + connectionBonus + broadwayBonus + wheelBonus,
    0.03,
    0.94,
  )
  const playability = clamp(
    0.08 + suitedBonus * 2.1 + connectionBonus * 1.9 + broadwayBonus + wheelBonus * 1.8 + lowContribution * 0.55,
    0.04,
    0.82,
  )

  return { strength, playability }
}

function buildHeroHandModel(heroCards: Card[], board: Card[]): HeroHandModel {
  const preflop = preflopCardStrength(heroCards)
  if (board.length < 3) {
    return {
      preflopStrength: preflop.strength,
      playability: preflop.playability,
      madeStrength: preflop.strength,
      drawStrength: preflop.playability * 0.35,
    }
  }

  const evaluated = evaluateHoldemHand(heroCards, board)
  const madeStrength = clamp(
    evaluated.normalizedStrength +
      (evaluated.pairType === 'top-pair' ? 0.17 : 0) +
      (evaluated.pairType === 'overpair' ? 0.21 : 0) +
      (evaluated.pairType === 'middle-pair' ? 0.08 : 0) +
      (evaluated.pairType === 'two-pair+' ? 0.17 : 0),
    0,
    1,
  )
  const drawStrength = clamp(
    (evaluated.flushDraw ? 0.42 : 0) +
      (evaluated.openEndedStraightDraw ? 0.36 : 0) +
      (evaluated.gutshotStraightDraw ? 0.18 : 0) +
      (evaluated.comboDraw ? 0.18 : 0),
    0,
    1,
  )

  return {
    preflopStrength: preflop.strength,
    playability: preflop.playability,
    madeStrength,
    drawStrength,
  }
}

function publicStateHash(table: TableState, hero: TablePlayer, opponents: PublicOpponent[]): number {
  const publicSignature = [
    table.handNumber,
    table.street,
    table.currentBet,
    table.lastFullRaiseSize,
    table.fullRaiseCounter,
    table.dealerSeatIndex,
    hero.id,
    hero.stack,
    hero.currentBet,
    hero.totalCommitted,
    hero.holeCards.map((card) => card.code).join(','),
    table.board.map((card) => card.code).join(','),
    ...opponents.flatMap((opponent) => [
      opponent.id,
      opponent.seatIndex,
      opponent.stack,
      opponent.currentBet,
      opponent.totalCommitted,
      opponent.isAllIn ? 1 : 0,
      opponent.lastAction?.street ?? '-',
      opponent.lastAction?.kind ?? '-',
      opponent.lastAction?.amount ?? 0,
    ]),
  ].join('|')

  let hash = 2166136261
  for (let index = 0; index < publicSignature.length; index += 1) {
    hash ^= publicSignature.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createRandomSource(seed: number): RandomSource {
  let value = seed || 0x9e3779b9
  return {
    next: () => {
      value ^= value << 13
      value ^= value >>> 17
      value ^= value << 5
      return (value >>> 0) / 4294967296
    },
  }
}

function isAggressiveAction(action: PlayerLastAction | null, street: TableState['street']): boolean {
  if (!action || action.street !== street) {
    return false
  }
  return action.kind === 'bet' || action.kind === 'raise' || action.kind === 'all-in'
}

function looseAggressorAdjustment(opponent: PublicOpponent, street: TableState['street']): number {
  if (!isAggressiveAction(opponent.lastAction, street) || !opponent.profile) {
    return 0
  }

  const profile = opponent.profile
  const vpip = rangeMid(profile.targetStats.vpip)
  const pfr = rangeMid(profile.targetStats.pfr)
  const bluff = rangeMid(profile.targetStats.bluff)
  return clamp(
    Math.max(0, vpip - 0.32) * 0.45 +
      Math.max(0, pfr - 0.25) * 0.2 +
      Math.max(0, bluff - 0.14) * 0.65 +
      (profile.quirks?.kamikazeBursts ? 0.08 : 0),
    0,
    0.38,
  )
}

function getLooseAggressorAdjustment(
  opponents: PublicOpponent[],
  street: TableState['street'],
): number {
  const adjustments = opponents
    .map((opponent) => looseAggressorAdjustment(opponent, street))
    .filter((adjustment) => adjustment > 0)
  return adjustments.length === 0
    ? 0
    : adjustments.reduce((sum, adjustment) => sum + adjustment, 0) / adjustments.length
}

function preflopRangePreference(cards: Card[], opponent: PublicOpponent, street: TableState['street']): number {
  const strength = preflopCardStrength(cards).strength
  const profile = opponent.profile
  const vpip = profile ? rangeMid(profile.targetStats.vpip) : 0.3
  const pfr = profile ? rangeMid(profile.targetStats.pfr) : 0.18
  const bluff = profile ? rangeMid(profile.targetStats.bluff) : 0.1
  const action = opponent.lastAction

  if (street === 'preflop' && (!action || action.street !== 'preflop' || action.kind.startsWith('post-'))) {
    return 1
  }

  if (action?.street === 'preflop' && isAggressiveAction(action, 'preflop')) {
    const aggressiveRange = clamp(pfr + rangeMid(profile?.targetStats.threeBet ?? [4, 8]) * 0.45, 0.06, 0.7)
    const threshold = 0.79 - aggressiveRange * 0.75
    const valuePreference = sigmoid((strength - threshold) * 11)
    const bluffPreference = bluff * (0.25 + preflopCardStrength(cards).playability * 0.75)
    return clamp(valuePreference * (1 - bluff * 0.75) + bluffPreference, 0.025, 1)
  }

  if (action?.street === 'preflop' && action.kind === 'check') {
    return 1
  }

  const threshold = 0.77 - vpip * 0.72
  return clamp(0.025 + sigmoid((strength - threshold) * 9) * 0.975, 0.025, 1)
}

function fastPostflopShape(cards: Card[], board: Card[]): { made: number; draw: number } {
  const combined = [...cards, ...board]
  const rankCounts = new Map<number, number>()
  const suitCounts = new Map<Card['suit'], number>()
  for (const card of combined) {
    const value = RANK_TO_VALUE[card.rank]
    rankCounts.set(value, (rankCounts.get(value) ?? 0) + 1)
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1)
  }

  const uniqueValues = new Set(rankCounts.keys())
  if (uniqueValues.has(14)) {
    uniqueValues.add(1)
  }
  let straight = false
  let straightDraw = false
  for (let start = 1; start <= 10; start += 1) {
    let hits = 0
    for (let offset = 0; offset < 5; offset += 1) {
      if (uniqueValues.has(start + offset)) {
        hits += 1
      }
    }
    straight ||= hits === 5
    straightDraw ||= hits === 4
  }

  const counts = [...rankCounts.values()]
  const pairCount = counts.filter((count) => count >= 2).length
  const hasTrips = counts.some((count) => count >= 3)
  const hasQuads = counts.some((count) => count >= 4)
  const maxSuitCount = Math.max(0, ...suitCounts.values())
  const flush = maxSuitCount >= 5
  const flushDraw = maxSuitCount === 4
  const fullHouse = hasTrips && pairCount >= 2

  let made = 0.1
  if (hasQuads) {
    made = 0.98
  } else if (fullHouse) {
    made = 0.9
  } else if (flush) {
    made = 0.8
  } else if (straight) {
    made = 0.74
  } else if (hasTrips) {
    made = 0.64
  } else if (pairCount >= 2) {
    made = 0.53
  } else if (pairCount === 1) {
    const topBoardValue = Math.max(...board.map((card) => RANK_TO_VALUE[card.rank]))
    const cardValues = cards.map((card) => RANK_TO_VALUE[card.rank])
    const pocketPair = cardValues[0] === cardValues[1]
    const topPair = cardValues.includes(topBoardValue)
    made = pocketPair && cardValues[0] > topBoardValue ? 0.48 : topPair ? 0.43 : 0.31
  }

  return {
    made,
    draw: clamp((flushDraw ? 0.27 : 0) + (straightDraw ? 0.22 : 0), 0, 0.49),
  }
}

function postflopRangePreference(
  cards: Card[],
  board: Card[],
  opponent: PublicOpponent,
  street: TableState['street'],
): number {
  const preflopPreference = preflopRangePreference(cards, opponent, street)
  const action = opponent.lastAction
  if (!action || action.street !== street || street === 'preflop') {
    return preflopPreference
  }

  const profile = opponent.profile
  const bluff = profile ? rangeMid(profile.targetStats.bluff) : 0.1
  const heroCall = profile ? rangeMid(profile.targetStats.heroCall) : 0.35
  const shape = fastPostflopShape(cards, board)
  const { made, draw } = shape

  let actionPreference = 1
  if (action.kind === 'bet' || action.kind === 'raise' || action.kind === 'all-in') {
    const valuePreference = sigmoid((made + draw * 0.55 - 0.35) * 8)
    const bluffPreference = bluff * (0.28 + draw * 1.1 + (1 - made) * 0.22)
    actionPreference = clamp(valuePreference * (1 - bluff * 0.8) + bluffPreference, 0.025, 1)
  } else if (action.kind === 'call') {
    actionPreference = clamp(
      0.04 + sigmoid((made + draw * 0.8 - 0.25) * 7) * (0.55 + heroCall * 0.45),
      0.03,
      1,
    )
  } else if (action.kind === 'check') {
    actionPreference = clamp(0.5 + (1 - made) * 0.3 + made * 0.2, 0.45, 1)
  }

  return clamp(0.02 + preflopPreference * actionPreference * 0.98, 0.02, 1)
}

function removeCardsAt(deck: Card[], firstIndex: number, secondIndex: number): Card[] {
  const first = deck[firstIndex]
  const second = deck[secondIndex]
  const highIndex = Math.max(firstIndex, secondIndex)
  const lowIndex = Math.min(firstIndex, secondIndex)
  deck.splice(highIndex, 1)
  deck.splice(lowIndex, 1)
  return [first, second]
}

function drawProfiledHand(
  deck: Card[],
  board: Card[],
  opponent: PublicOpponent,
  street: TableState['street'],
  random: RandomSource,
): Card[] {
  let bestIndices: [number, number] = [0, 1]
  let bestPreference = -1

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const firstIndex = Math.floor(random.next() * deck.length)
    let secondIndex = Math.floor(random.next() * (deck.length - 1))
    if (secondIndex >= firstIndex) {
      secondIndex += 1
    }
    const candidate = [deck[firstIndex], deck[secondIndex]]
    const preference =
      street === 'preflop'
        ? preflopRangePreference(candidate, opponent, street)
        : postflopRangePreference(candidate, board, opponent, street)

    if (preference > bestPreference) {
      bestPreference = preference
      bestIndices = [firstIndex, secondIndex]
    }
    if (random.next() <= preference) {
      return removeCardsAt(deck, firstIndex, secondIndex)
    }
  }

  return removeCardsAt(deck, bestIndices[0], bestIndices[1])
}

function drawRandomCard(deck: Card[], random: RandomSource): Card {
  const index = Math.floor(random.next() * deck.length)
  const [card] = deck.splice(index, 1)
  return card
}

function estimateEquity(
  table: TableState,
  hero: TablePlayer,
  opponents: PublicOpponent[],
): { equity: number; samples: number } {
  const knownCodes = new Set([...hero.holeCards, ...table.board].map((card) => card.code))
  const baseDeck = createDeck().filter((card) => !knownCodes.has(card.code))
  const samples = clamp(420 - opponents.length * 24, 220, 380)
  const random = createRandomSource(publicStateHash(table, hero, opponents))
  let heroShare = 0

  for (let sample = 0; sample < samples; sample += 1) {
    const deck = [...baseDeck]
    const opponentHands = opponents.map((opponent) => ({
      playerId: opponent.id,
      holeCards: drawProfiledHand(deck, table.board, opponent, table.street, random),
    }))
    const completedBoard = [...table.board]
    while (completedBoard.length < 5) {
      completedBoard.push(drawRandomCard(deck, random))
    }

    const result = compareHoldemHands([
      { playerId: hero.id, holeCards: hero.holeCards, board: completedBoard },
      ...opponentHands.map((entry) => ({ ...entry, board: completedBoard })),
    ])
    if (result.winners.includes(hero.id)) {
      heroShare += 1 / result.winners.length
    }
  }

  return {
    equity: heroShare / samples,
    samples,
  }
}

function getEffectiveStackBb(hero: TablePlayer, opponents: PublicOpponent[], bigBlind: number): number {
  const heroAvailable = hero.stack + hero.currentBet
  const largestContestableOpponent = opponents.reduce(
    (largest, opponent) => Math.max(largest, opponent.stack + opponent.currentBet),
    0,
  )
  return Math.max(0, Math.min(heroAvailable, largestContestableOpponent) / bigBlind)
}

function createActionScores(legal: LegalActionState): Partial<Record<HeroAdviceAction, number>> {
  return Object.fromEntries(legal.options.map((option) => [option.kind, 0.01]))
}

function setScore(
  scores: Partial<Record<HeroAdviceAction, number>>,
  action: HeroAdviceAction,
  value: number,
): void {
  if (scores[action] !== undefined) {
    scores[action] = Math.max(0.001, value)
  }
}

function getLivePreflopPrice(table: TableState, bigBlind: number): number {
  return table.config.straddle?.enabled
    ? Math.max(bigBlind, table.config.straddle.amount)
    : bigBlind
}

function countVisiblePreflopLimpers(opponents: PublicOpponent[], entryPrice: number): number {
  return opponents.filter(
    (opponent) =>
      opponent.lastAction?.street === 'preflop' &&
      opponent.lastAction.kind === 'call' &&
      opponent.currentBet <= entryPrice,
  ).length
}

function buildPreflopScores(
  legal: LegalActionState,
  heroHand: HeroHandModel,
  equity: number,
  potOdds: number,
  effectiveStackBb: number,
  position: PositionModel,
  tableModel: TableModel,
  opponentCount: number,
  raiseCount: number,
  opponents: PublicOpponent[],
): Partial<Record<HeroAdviceAction, number>> {
  const scores = createActionScores(legal)
  const multiwayTax = Math.max(0, opponentCount - 1) * 0.025
  const callEdge = equity - potOdds
  const openingThreshold =
    0.51 - position.score * 0.14 - tableModel.foldability * 0.06 + tableModel.calling * 0.055 + multiwayTax
  const pressureTax = clamp(potOdds * 0.5, 0, 0.3)
  const looseAggressorDiscount = getLooseAggressorAdjustment(opponents, 'preflop')

  if (legal.toCall === 0) {
    setScore(
      scores,
      'check',
      0.5 + Math.max(0, openingThreshold - heroHand.preflopStrength) * 1.8 + multiwayTax,
    )
    const valueRaise = Math.max(0, heroHand.preflopStrength - openingThreshold) * 4.8
    const stealRaise = tableModel.foldability * position.score * 0.38 * (1 - tableModel.calling * 0.5)
    setScore(scores, 'raise', 0.03 + valueRaise + stealRaise)
    setScore(scores, 'bet', 0.03 + valueRaise + stealRaise)
  } else {
    if (raiseCount === 0) {
      setScore(
        scores,
        'fold',
        0.2 + Math.max(0, -callEdge) * 4.5 + Math.max(0, openingThreshold - heroHand.preflopStrength) * 3,
      )
      setScore(
        scores,
        'call',
        0.18 +
          Math.max(0, callEdge) * 2.6 +
          heroHand.playability * 0.58 +
          position.score * 0.12 -
          Math.max(0, -callEdge) * 3.5 -
          multiwayTax * (0.8 + (callEdge < 0 ? 1.2 - heroHand.playability : 0)),
      )
      const valueRaise = Math.max(0, heroHand.preflopStrength - openingThreshold) * 4.8
      const isolationPenalty = multiwayTax * (1.2 + tableModel.calling * 3)
      const stealRaise = tableModel.foldability * position.score * 0.2 * (1 - tableModel.calling)
      setScore(scores, 'raise', 0.02 + valueRaise + stealRaise - isolationPenalty)
    } else {
      setScore(
        scores,
        'fold',
        0.25 + Math.max(0, -callEdge) * 5.5 + Math.max(0, 0.48 - heroHand.preflopStrength) * 1.8 + pressureTax,
      )
      setScore(
        scores,
        'call',
        0.12 + Math.max(0, callEdge) * 5.2 + heroHand.playability * 0.42 + position.score * 0.14,
      )
      const reraisingThreshold = 0.61 + Math.max(0, raiseCount - 1) * 0.105
      const valueRaise = Math.max(0, heroHand.preflopStrength - reraisingThreshold) * 5
      const bluffRaise =
        tableModel.foldability * position.score * heroHand.playability * 0.34 * (1 - tableModel.calling * 0.75)
      setScore(scores, 'raise', 0.015 + valueRaise + bluffRaise)

      if (looseAggressorDiscount > 0) {
        const strongResponse = clamp((heroHand.preflopStrength - 0.5) / 0.3, 0, 1)
        setScore(
          scores,
          'fold',
          (scores.fold ?? 0.001) - looseAggressorDiscount * (0.9 + strongResponse * 0.6),
        )
        setScore(
          scores,
          'call',
          (scores.call ?? 0.001) + looseAggressorDiscount * (0.9 + heroHand.playability * 0.4),
        )
        setScore(
          scores,
          'raise',
          (scores.raise ?? 0.001) + looseAggressorDiscount * strongResponse * 1.2,
        )
      }
    }
  }

  const shallowPressure = clamp((22 - effectiveStackBb) / 18, 0, 1)
  const jamValue = Math.max(0, heroHand.preflopStrength - (effectiveStackBb <= 14 ? 0.59 : 0.78))
  setScore(
    scores,
    'all-in',
    legal.canRaise ? 0.002 + shallowPressure * jamValue * 5.5 : 0.001,
  )

  return scores
}

function buildPostflopScores(
  table: TableState,
  legal: LegalActionState,
  heroHand: HeroHandModel,
  equity: number,
  potOdds: number,
  effectiveStackBb: number,
  position: PositionModel,
  tableModel: TableModel,
  opponents: PublicOpponent[],
  potTotal: number,
): Partial<Record<HeroAdviceAction, number>> {
  const scores = createActionScores(legal)
  const callEdge = equity - potOdds
  const multiwayTax = Math.max(0, opponents.length - 1) * 0.06
  const pressure = legal.toCall / Math.max(1, potTotal + legal.toCall)
  const aggressiveOpponents = opponents.filter((opponent) => isAggressiveAction(opponent.lastAction, table.street))
  const tightAggressorTax =
    aggressiveOpponents.length === 0
      ? 0
      : aggressiveOpponents.reduce((total, opponent) => {
          const profile = opponent.profile
          if (!profile) {
            return total + 0.04
          }
          const vpip = rangeMid(profile.targetStats.vpip)
          const bluff = rangeMid(profile.targetStats.bluff)
          return total + clamp((0.28 - vpip) * 0.55 + (0.12 - bluff) * 0.5, -0.08, 0.16)
        }, 0) / aggressiveOpponents.length
  const showdownValue = clamp(heroHand.madeStrength + heroHand.drawStrength * 0.32, 0, 1)
  const bluffCandidate = clamp(
    heroHand.drawStrength * 0.65 +
      (1 - heroHand.madeStrength) * 0.18 +
      position.score * 0.12 -
      multiwayTax,
    0,
    1,
  )

  if (legal.toCall === 0) {
    setScore(
      scores,
      'check',
      0.36 + (1 - equity) * 0.2 + multiwayTax + (position.inPosition ? -0.06 : 0.05),
    )
    const valueBet = Math.max(0, equity - (0.47 + multiwayTax * 0.2)) * 4.2
    const exploitBluff =
      tableModel.foldability * bluffCandidate * 0.72 * (1 - tableModel.calling * 0.75)
    const protection = heroHand.madeStrength * Math.max(0, 0.65 - equity) * 0.45
    const betScore = 0.025 + valueBet + exploitBluff + protection
    setScore(scores, 'bet', betScore)
    setScore(scores, 'raise', betScore)
  } else {
    setScore(
      scores,
      'fold',
      0.2 +
        Math.max(0, -callEdge) * 5.8 +
        pressure * 0.35 +
        tightAggressorTax * 1.7 +
        multiwayTax * 0.45,
    )
    setScore(
      scores,
      'call',
      0.1 +
        Math.max(0, callEdge) * 5.5 +
        heroHand.drawStrength * 0.42 +
        position.score * 0.12 +
        tableModel.aggression * 0.08 -
        Math.max(0, tightAggressorTax),
    )
    const valueRaise = Math.max(0, equity - (0.61 + multiwayTax * 0.25)) * 4.4
    const exploitBluff =
      tableModel.foldability * bluffCandidate * 0.48 * (1 - tableModel.calling * 0.82)
    setScore(scores, 'raise', 0.012 + valueRaise + exploitBluff)
  }

  const spr = (effectiveStackBb * getBigBlind(table)) / Math.max(1, potTotal)
  const shallow = clamp((3.2 - spr) / 2.6, 0, 1)
  const jamValue = Math.max(0, equity - 0.57) * 3.2 + heroHand.drawStrength * 0.28
  setScore(
    scores,
    'all-in',
    legal.canRaise ? 0.002 + shallow * jamValue * (1 - tableModel.calling * 0.12) : 0.001,
  )

  // A very strong made hand should not become passive merely because its coarse
  // evaluator category is shared with a weaker hand.
  if (showdownValue >= 0.62 && equity >= 0.62) {
    const aggressiveAction = legal.toCall === 0 ? 'bet' : 'raise'
    if (scores[aggressiveAction] !== undefined) {
      scores[aggressiveAction] = (scores[aggressiveAction] ?? 0) + (equity - 0.55) * 2.2
    }
  }

  return scores
}

function normalizeActionMix(
  legal: LegalActionState,
  scores: Partial<Record<HeroAdviceAction, number>>,
): Partial<Record<HeroAdviceAction, number>> {
  const legalKinds = [...new Set(legal.options.map((option) => option.kind))]
  const total = legalKinds.reduce((sum, kind) => sum + Math.max(0.001, scores[kind] ?? 0.001), 0)
  const result: Partial<Record<HeroAdviceAction, number>> = {}
  let allocated = 0

  legalKinds.forEach((kind, index) => {
    const percentage =
      index === legalKinds.length - 1
        ? round(100 - allocated, 1)
        : round((Math.max(0.001, scores[kind] ?? 0.001) / total) * 100, 1)
    result[kind] = percentage
    allocated += percentage
  })

  return result
}

function pickRecommendedAction(
  legal: LegalActionState,
  mix: Partial<Record<HeroAdviceAction, number>>,
): HeroAdviceAction {
  const legalKinds = [...new Set(legal.options.map((option) => option.kind))]
  return legalKinds.reduce((best, action) =>
    (mix[action] ?? 0) > (mix[best] ?? 0) ? action : best,
  )
}

function roundToChipUnit(value: number, bigBlind: number): number {
  const unit = bigBlind >= 1_000 ? 100 : bigBlind >= 100 ? 25 : bigBlind >= 20 ? 5 : 1
  return Math.round(value / unit) * unit
}

function clampSuggestedTotal(value: number, option: LegalActionOption, bigBlind: number): number | undefined {
  if (option.minTotal === undefined || option.maxTotal === undefined) {
    return undefined
  }
  return clamp(roundToChipUnit(value, bigBlind), option.minTotal, option.maxTotal)
}

function getSuggestedTotal(
  table: TableState,
  hero: TablePlayer,
  opponents: PublicOpponent[],
  legal: LegalActionState,
  recommendedAction: HeroAdviceAction,
  equity: number,
  tableModel: TableModel,
): number | undefined {
  const option = legal.options.find((entry) => entry.kind === recommendedAction)
  if (!option) {
    return undefined
  }

  const bigBlind = getBigBlind(table)
  if (recommendedAction === 'all-in') {
    return hero.currentBet + hero.stack
  }
  if (recommendedAction !== 'bet' && recommendedAction !== 'raise') {
    return undefined
  }

  if (table.street === 'preflop') {
    const entryPrice = getLivePreflopPrice(table, bigBlind)
    const limpers = countVisiblePreflopLimpers(opponents, entryPrice)
    if (table.currentBet <= entryPrice && table.fullRaiseCounter === 0) {
      const openSizeInEntryUnits =
        2.65 + tableModel.calling + limpers * (0.7 + tableModel.calling * 0.5)
      return clampSuggestedTotal(openSizeInEntryUnits * entryPrice, option, bigBlind)
    }

    const position = getPositionModel(
      table,
      table.players.filter((player) => isPubliclyStillInHand(player, hero.id, table.handInProgress)),
      hero.id,
    )
    const multiplier = 3.15 + (position.score < 0.5 ? 0.55 : 0) + tableModel.calling * 0.8
    return clampSuggestedTotal(table.currentBet * multiplier, option, bigBlind)
  }

  const pot = getPotTotal(table.players)
  const boardTexture = analyzeBoardTexture(table.board)
  const valuePremium = equity >= 0.7 ? 0.13 : equity >= 0.58 ? 0.06 : 0
  const texturePremium = clamp(boardTexture.straightPressure * 0.12 + boardTexture.flushPressure * 0.09, 0, 0.16)
  const baseFraction = 0.34 + tableModel.calling * 0.46 + valuePremium + texturePremium
  if (recommendedAction === 'bet') {
    return clampSuggestedTotal(hero.currentBet + pot * baseFraction, option, bigBlind)
  }

  const potAfterCall = pot + legal.toCall
  return clampSuggestedTotal(table.currentBet + potAfterCall * (0.56 + tableModel.calling * 0.34), option, bigBlind)
}

function confidenceFor(
  table: TableState,
  opponents: PublicOpponent[],
  tableModel: TableModel,
  samples: number,
): HeroAdviceConfidence {
  const profileCoverage = tableModel.knownProfileCount / Math.max(1, opponents.length)
  if (profileCoverage < 0.5 || (table.street === 'preflop' && opponents.length >= 5)) {
    return 'low'
  }
  if (table.street === 'river' && opponents.length <= 2 && samples >= 300 && profileCoverage === 1) {
    return 'high'
  }
  return 'medium'
}

function buildReasons(
  table: TableState,
  legal: LegalActionState,
  recommendedAction: HeroAdviceAction,
  equity: number,
  potOdds: number,
  position: PositionModel,
  tableModel: TableModel,
  opponents: PublicOpponent[],
): string[] {
  const opponentCount = opponents.length
  const reasons = [
    `Equite estimee a ${round(equity * 100, 1)} % contre ${opponentCount} adversaire${opponentCount > 1 ? 's' : ''}.`,
  ]

  if (legal.toCall > 0) {
    const edge = equity - potOdds
    reasons.push(
      `Cote du pot ${round(potOdds * 100, 1)} % ; marge d'equite ${edge >= 0 ? '+' : ''}${round(edge * 100, 1)} point${Math.abs(edge * 100) >= 2 ? 's' : ''}.`,
    )
  } else {
    reasons.push('Aucun montant a payer immediatement : check et mise sont compares sans cout de call.')
  }

  if (table.street === 'preflop') {
    const looseAggressor = opponents
      .map((opponent) => ({ opponent, adjustment: looseAggressorAdjustment(opponent, table.street) }))
      .filter((entry) => entry.adjustment >= 0.08)
      .sort((left, right) => right.adjustment - left.adjustment)[0]
    if (looseAggressor?.opponent.profile) {
      reasons.push(
        `${looseAggressor.opponent.profile.displayName} relance tres large et surbluffe : sa pression est modelisee avec une range plus faible qu'une relance standard.`,
      )
    }
  }

  if (tableModel.calling >= 0.48 || tableModel.looseness >= 0.45) {
    reasons.push('Table loose/calling : davantage de value, sizings plus forts et moins de bluffs purs.')
  } else if (tableModel.calling <= 0.3 && tableModel.looseness <= 0.28) {
    reasons.push('Table serree : pression selective et petits sizings gagnent en valeur.')
  } else {
    reasons.push('Profils mixtes : strategie equilibree, corrigee par les actions visibles de ce coup.')
  }

  reasons.push(
    `Position ${position.label}${position.inPosition ? ' (en position)' : ''}, ${position.playersBehind} joueur${position.playersBehind > 1 ? 's' : ''} encore derriere ; action conseillee : ${recommendedAction}.`,
  )

  if (table.street === 'preflop') {
    reasons.push('Estimation preflop fondee sur profondeur, position et ranges deduites des profils publics.')
  }
  return reasons
}

function hasValidKnownCards(hero: TablePlayer, board: Card[]): boolean {
  if (hero.holeCards.length !== 2 || board.length > 5) {
    return false
  }
  const codes = [...hero.holeCards, ...board].map((card) => card.code)
  return new Set(codes).size === codes.length
}

export function getHeroAdvice(
  table: TableState,
  profilesById: Record<string, BotProfile>,
  heroId = 'hero',
): HeroAdvice | null {
  if (
    !table.handInProgress ||
    table.street === 'showdown' ||
    table.currentActorId !== heroId
  ) {
    return null
  }

  const hero = table.players.find((player) => player.id === heroId)
  if (!hero || !hasValidKnownCards(hero, table.board)) {
    return null
  }

  const legal = getLegalActions(table, heroId)
  if (!legal || legal.options.length === 0) {
    return null
  }

  const playersStillInHand = table.players.filter((player) =>
    isPubliclyStillInHand(player, heroId, table.handInProgress),
  )
  const opponents = playersStillInHand
    .filter((player) => player.id !== heroId)
    .map((player) => toPublicOpponent(player, profilesById))
  if (opponents.length === 0) {
    return null
  }

  const bigBlind = getBigBlind(table)
  const potTotal = getPotTotal(table.players)
  const callAmount = Math.min(hero.stack, legal.toCall)
  const potOdds = callAmount > 0 ? callAmount / Math.max(1, potTotal + callAmount) : 0
  const effectiveStackBb = getEffectiveStackBb(hero, opponents, bigBlind)
  const position = getPositionModel(table, playersStillInHand, heroId)
  const tableModel = buildTableModel(opponents)
  const heroHand = buildHeroHandModel(hero.holeCards, table.board)
  const equityEstimate = estimateEquity(table, hero, opponents)
  const scores =
    table.street === 'preflop'
      ? buildPreflopScores(
          legal,
          heroHand,
          equityEstimate.equity,
          potOdds,
          effectiveStackBb,
          position,
          tableModel,
          opponents.length,
          table.fullRaiseCounter,
          opponents,
        )
      : buildPostflopScores(
          table,
          legal,
          heroHand,
          equityEstimate.equity,
          potOdds,
          effectiveStackBb,
          position,
          tableModel,
          opponents,
          potTotal,
        )
  const actionMix = normalizeActionMix(legal, scores)
  const recommendedAction = pickRecommendedAction(legal, actionMix)
  const suggestedTotal = getSuggestedTotal(
    table,
    hero,
    opponents,
    legal,
    recommendedAction,
    equityEstimate.equity,
    tableModel,
  )

  return {
    recommendedAction,
    actionMix,
    equity: round(equityEstimate.equity * 100, 1),
    potOdds: round(potOdds * 100, 1),
    effectiveStackBb: round(effectiveStackBb, 1),
    ...(suggestedTotal === undefined ? {} : { suggestedTotal }),
    confidence: confidenceFor(table, opponents, tableModel, equityEstimate.samples),
    reasons: buildReasons(
      table,
      legal,
      recommendedAction,
      equityEstimate.equity,
      potOdds,
      position,
      tableModel,
      opponents,
    ),
    disclaimer: DISCLAIMER,
  }
}

// Kept exported for consumers that want a stable list when rendering action mixes.
export const HERO_ADVICE_ACTIONS = ALL_ADVICE_ACTIONS
