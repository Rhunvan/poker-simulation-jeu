import { REAL_TABLE_POPULATION } from '../../config/tablePopulation'
import type { NumericRange } from '../../config/schema'
import type { BettingStreet, DecisionContext, PlayerCommand } from '../core/types'
import { RANK_TO_VALUE } from '../core/cards'
import { getFirstActorPostflop, getFirstActorPreflop } from '../core/positions'
import { createSeatRing, getOccupiedSeatsClockwiseFrom } from '../core/seatRing'
import { analyzeBoardTexture } from '../eval/boardTexture'
import { evaluateHoldemHand } from '../eval/handEvaluator'
import type { EmotionModifiers } from './emotionModel'

export type DecisionCommandKind = PlayerCommand['kind']

export type DecisionScenario =
  | 'unopened'
  | 'limped-pot'
  | 'facing-open'
  | 'facing-3bet'
  | 'facing-4bet'
  | 'checked-to'
  | 'facing-bet'

export interface PopulationSnapshot {
  street: BettingStreet
  scenario: DecisionScenario
  handStrength: number
  playability: number
  handKey: string
  stackBb: number
  effectiveStackBb: number
  toCallBb: number
  potBb: number
  currentBetBb: number
  limperCount: number
  raiseCount: number
  playersInHand: number
  positionScore: number
  positionBucket: 'early' | 'middle' | 'late'
  isInPosition: boolean
  playersBehind: number
  candidateWeights: Record<DecisionCommandKind, number>
  valueIntent: number
  bluffIntent: number
  jamIntent: number
  preferOversize: boolean
  preferOverbet: boolean
  preferNonAllInBigRaise: boolean
  tags: string[]
}

interface PreflopSnapshot {
  strength: number
  playability: number
  handKey: string
  pair: boolean
  suited: boolean
  gap: number
  high: number
  low: number
  broadwayCount: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function descriptorValue(
  descriptor:
    | 'very_low'
    | 'low'
    | 'low_to_medium_unbalanced'
    | 'medium'
    | 'elevated'
    | 'high'
    | 'rare',
): number {
  switch (descriptor) {
    case 'very_low':
      return 0.08
    case 'low':
      return 0.18
    case 'low_to_medium_unbalanced':
      return 0.28
    case 'medium':
      return 0.42
    case 'elevated':
      return 0.58
    case 'high':
      return 0.74
    case 'rare':
      return 0.05
    default:
      return 0.3
  }
}

export function rangeMid(range: NumericRange): number {
  return (range[0] + range[1]) / 2
}

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100
}

function canonicalStartingHand(context: DecisionContext): string {
  const [firstCard, secondCard] = [...context.player.holeCards].sort(
    (left, right) => RANK_TO_VALUE[right.rank] - RANK_TO_VALUE[left.rank],
  )
  const suffix = firstCard.suit === secondCard.suit ? 's' : 'o'
  if (firstCard.rank === secondCard.rank) {
    return `${firstCard.rank}${secondCard.rank}`
  }
  return `${firstCard.rank}${secondCard.rank}${suffix}`
}

function analyzePreflopHand(context: DecisionContext): PreflopSnapshot {
  const [cardA, cardB] = [...context.player.holeCards].sort(
    (left, right) => RANK_TO_VALUE[right.rank] - RANK_TO_VALUE[left.rank],
  )
  const high = RANK_TO_VALUE[cardA.rank]
  const low = RANK_TO_VALUE[cardB.rank]
  const pair = high === low
  const suited = cardA.suit === cardB.suit
  const gap = pair ? 0 : high - low
  const broadwayCount = [high, low].filter((value) => value >= 10).length
  let strength = 0
  let playability = 0

  if (pair) {
    strength = 0.46 + high / 24
    playability = 0.24 + high / 28
  } else {
    strength =
      (high >= 14 ? 0.28 : high >= 13 ? 0.24 : high >= 12 ? 0.2 : high >= 11 ? 0.16 : high >= 10 ? 0.12 : 0.06) +
      (low >= 10 ? 0.12 : low >= 8 ? 0.07 : low >= 6 ? 0.04 : 0.01)
    playability =
      (suited ? 0.14 : 0.02) +
      (gap <= 1 ? 0.14 : gap === 2 ? 0.08 : gap === 3 ? 0.03 : -0.02) +
      (broadwayCount === 2 ? 0.11 : 0) +
      (high === 14 && low <= 5 ? 0.09 : 0)

    if (high <= 8 && low <= 5 && !suited && gap >= 3) {
      strength -= 0.08
      playability -= 0.06
    }
  }

  return {
    strength: clamp(roundToHundredth(strength), 0, 1),
    playability: clamp(roundToHundredth(playability), 0, 1),
    handKey: canonicalStartingHand(context),
    pair,
    suited,
    gap,
    high,
    low,
    broadwayCount,
  }
}

function getBigBlind(context: DecisionContext): number {
  return context.state.config.blindSchedule?.[context.state.currentLevelIndex]?.bigBlind ?? context.state.config.bigBlind
}

function getEffectiveStackBb(context: DecisionContext, bb: number): number {
  const actorTotal = context.player.stack + context.player.currentBet
  const opponentTotal = context.playersStillInHand
    .filter((entry) => entry.id !== context.player.id)
    .reduce((best, entry) => Math.min(best, entry.stack + entry.currentBet), actorTotal)
  return Math.max(0, Math.min(actorTotal, opponentTotal) / bb)
}

function getPlayersInActionOrder(context: DecisionContext) {
  const players = context.playersStillInHand
  const maxSeats = context.state.config.maxSeats
  const firstSeat =
    context.state.street === 'preflop'
      ? getFirstActorPreflop(
          players,
          context.state.smallBlindSeatIndex,
          context.state.bigBlindSeatIndex,
          players.length === 2,
          () => true,
          maxSeats,
        )
      : getFirstActorPostflop(players, context.state.dealerSeatIndex, () => true, maxSeats)

  if (firstSeat === null) {
    return [...players].sort((left, right) => left.seatIndex - right.seatIndex)
  }

  const ring = createSeatRing(players, maxSeats)
  const seats = getOccupiedSeatsClockwiseFrom(ring, (firstSeat - 1 + maxSeats) % maxSeats)
  return seats
    .map((seatIndex) => ring.playersBySeat.get(seatIndex))
    .filter((player): player is (typeof players)[number] => Boolean(player))
}

function getPositionDescriptor(context: DecisionContext): {
  score: number
  bucket: 'early' | 'middle' | 'late'
  isInPosition: boolean
  playersBehind: number
} {
  const orderedPlayers = getPlayersInActionOrder(context)
  const actingIndex = orderedPlayers.findIndex((player) => player.id === context.player.id)
  const playersBehind = actingIndex === -1 ? 0 : Math.max(0, orderedPlayers.length - actingIndex - 1)
  const totalPlayers = Math.max(1, orderedPlayers.length)
  const orderAdvantage = totalPlayers <= 1 ? 1 : 1 - playersBehind / (totalPlayers - 1)
  const multiwayTax = Math.max(0, totalPlayers - 2) * 0.05
  const isInPosition = context.state.street !== 'preflop' && playersBehind === 0 && totalPlayers > 1
  const score = clamp(
    orderAdvantage - multiwayTax + (isInPosition ? 0.18 : 0) - (context.state.street !== 'preflop' && !isInPosition ? 0.08 : 0),
    0,
    1,
  )
  const relativeIndex = totalPlayers <= 1 ? 1 : actingIndex / (totalPlayers - 1)
  const bucket =
    relativeIndex < 0.34 ? 'early' : relativeIndex < 0.67 ? 'middle' : 'late'

  return {
    score,
    bucket,
    isInPosition,
    playersBehind,
  }
}

function countLimpers(context: DecisionContext, bb: number): number {
  if (context.state.street !== 'preflop' || context.state.fullRaiseCounter > 0) {
    return 0
  }

  return context.state.players.filter((entry) => {
    if (entry.id === context.player.id || entry.hasFolded || entry.holeCards.length === 0) {
      return false
    }
    if (entry.seatIndex === context.state.bigBlindSeatIndex) {
      return false
    }
    return entry.hasActedThisRound && entry.currentBet === bb
  }).length
}

function createWeightRecord(): Record<DecisionCommandKind, number> {
  return {
    fold: 0,
    check: 0,
    call: 0,
    bet: 0,
    raise: 0,
    'all-in': 0,
  }
}

function buildPreflopSnapshot(context: DecisionContext, emotions: EmotionModifiers): PopulationSnapshot {
  const bb = getBigBlind(context)
  const hand = analyzePreflopHand(context)
  const stackBb = (context.player.stack + context.player.currentBet) / bb
  const effectiveStackBb = getEffectiveStackBb(context, bb)
  const toCallBb = context.legalActions.toCall / bb
  const potBb = context.potTotal / bb
  const limperCount = countLimpers(context, bb)
  const raiseCount = context.state.fullRaiseCounter
  const currentBetBb = context.state.currentBet / bb
  const looseEntryBase =
    descriptorValue(REAL_TABLE_POPULATION.averageLimpRate) * 0.22 +
    descriptorValue(REAL_TABLE_POPULATION.averageColdCallRate) * 0.18
  const position = getPositionDescriptor(context)
  const multiwayTax = Math.max(0, context.playersStillInHand.length - 2) * 0.03
  const scenario: DecisionScenario =
    raiseCount === 0 && currentBetBb <= 1
      ? limperCount > 0
        ? 'limped-pot'
        : 'unopened'
      : raiseCount <= 1
        ? 'facing-open'
        : raiseCount === 2
          ? 'facing-3bet'
          : 'facing-4bet'
  const weights = createWeightRecord()
  const positionScore = position.score
  const valueIntent = clamp(hand.strength + hand.playability * 0.22 + positionScore * 0.08 - multiwayTax, 0, 1.2)
  const bluffIntent = clamp(
    (REAL_TABLE_POPULATION.irrationalAggroPlayersExist ? 0.12 : 0.05) +
      emotions.aggressionBoost * 0.16 -
      emotions.cautionBoost * 0.12,
    0,
    0.45,
  )
  const jamIntent =
    stackBb <= 18
      ? clamp((hand.strength - 0.64) * 1.8 + emotions.shoveBoost * 0.8, 0, 0.55)
      : clamp(emotions.shoveBoost * 0.12, 0, 0.08)

  if (scenario === 'unopened') {
    weights.fold = clamp(0.98 - hand.strength * 1.42 - hand.playability * 0.52 - looseEntryBase, 0.03, 1)
    weights.call = clamp(0.09 + looseEntryBase * 1.35 + hand.playability * 0.62 - hand.strength * 0.22, 0, 1.15)
    weights.raise = clamp(
      (hand.strength - 0.34) * 1.52 + hand.playability * 0.18 + positionScore * 0.14,
      0,
      1.25,
    )
    weights['all-in'] = jamIntent * 0.1
  } else if (scenario === 'limped-pot') {
    weights.fold = clamp(0.86 - hand.strength * 1.18 - hand.playability * 0.45 - looseEntryBase * 0.5, 0.02, 0.82)
    weights.call = clamp(
      0.24 + looseEntryBase * 1.1 + hand.playability * 0.65 + limperCount * 0.08 + positionScore * 0.08 - toCallBb * 0.06,
      0,
      1.35,
    )
    weights.raise = clamp(
      (hand.strength - 0.42) * 1.5 + limperCount * 0.08 + positionScore * 0.12 + emotions.aggressionBoost * 0.12,
      0,
      1.2,
    )
    weights['all-in'] = jamIntent * 0.08
  } else if (scenario === 'facing-open') {
    weights.fold = clamp(0.88 - hand.strength * 0.82 - hand.playability * 0.3 + toCallBb * 0.06, 0.03, 1.15)
    weights.call = clamp(
      0.12 + hand.playability * 0.62 + looseEntryBase * 0.82 + positionScore * 0.08 - toCallBb * 0.08,
      0,
      1.2,
    )
    weights.raise = clamp((hand.strength - 0.56) * 1.6 + hand.playability * 0.12 + emotions.aggressionBoost * 0.1, 0, 1.05)
    weights['all-in'] = jamIntent * 0.28
  } else if (scenario === 'facing-3bet') {
    weights.fold = clamp(1.02 - hand.strength * 0.92 - hand.playability * 0.16 + toCallBb * 0.05, 0.05, 1.2)
    weights.call = clamp(0.04 + hand.strength * 0.54 + hand.playability * 0.22 - toCallBb * 0.05, 0, 0.95)
    weights.raise = clamp((hand.strength - 0.76) * 1.5 + emotions.aggressionBoost * 0.08, 0, 0.62)
    weights['all-in'] = jamIntent * 0.55
  } else {
    weights.fold = clamp(1.08 - hand.strength * 0.88 + toCallBb * 0.04, 0.08, 1.25)
    weights.call = clamp(0.02 + hand.strength * 0.42 - toCallBb * 0.06, 0, 0.6)
    weights.raise = clamp((hand.strength - 0.84) * 1.35, 0, 0.35)
    weights['all-in'] = jamIntent * 0.72
  }

  return {
    street: 'preflop',
    scenario,
    handStrength: hand.strength,
    playability: hand.playability,
    handKey: hand.handKey,
    stackBb,
    effectiveStackBb,
    toCallBb,
    potBb,
    currentBetBb,
    limperCount,
    raiseCount,
    playersInHand: context.playersStillInHand.length,
    positionScore,
    positionBucket: position.bucket,
    isInPosition: position.isInPosition,
    playersBehind: position.playersBehind,
    candidateWeights: weights,
    valueIntent,
    bluffIntent,
    jamIntent,
    preferOversize: hand.strength > 0.55 || emotions.aggressionBoost > 0.16,
    preferOverbet: false,
    preferNonAllInBigRaise: REAL_TABLE_POPULATION.oversizedNonJamRaisesPreferred,
    tags: [
      scenario === 'unopened' ? 'home-game-unopened' : `scenario:${scenario}`,
      `position:${position.bucket}`,
      position.isInPosition ? 'in-position' : 'out-of-position',
      limperCount > 0 ? `limpers:${limperCount}` : 'no-limpers-yet',
      hand.pair ? 'pair-starting-hand' : hand.suited ? 'suited-starting-hand' : 'offsuit-starting-hand',
    ],
  }
}

function buildPostflopSnapshot(context: DecisionContext, emotions: EmotionModifiers): PopulationSnapshot {
  const bb = getBigBlind(context)
  const evaluated = evaluateHoldemHand(context.player.holeCards, context.state.board)
  const board = analyzeBoardTexture(context.state.board)
  const stackBb = (context.player.stack + context.player.currentBet) / bb
  const effectiveStackBb = getEffectiveStackBb(context, bb)
  const toCallBb = context.legalActions.toCall / bb
  const potBb = context.potTotal / bb
  const currentBetBb = context.state.currentBet / bb
  const pressure = context.legalActions.toCall / Math.max(1, context.potTotal)
  const position = getPositionDescriptor(context)
  const spr = effectiveStackBb / Math.max(0.5, potBb)
  const multiwayPenalty = Math.max(0, context.playersStillInHand.length - 2) * 0.08
  const drawStrength =
    (evaluated.flushDraw ? 0.16 : 0) +
    (evaluated.openEndedStraightDraw ? 0.14 : 0) +
    (evaluated.gutshotStraightDraw ? 0.07 : 0) +
    (evaluated.comboDraw ? 0.1 : 0)
  const madeStrength =
    evaluated.normalizedStrength +
    (evaluated.pairType === 'overpair' ? 0.18 : 0) +
    (evaluated.pairType === 'top-pair' ? 0.1 : 0) +
    (evaluated.pairType === 'two-pair+' ? 0.12 : 0)
  const handStrength = clamp(madeStrength + drawStrength * 0.55, 0, 1.25)
  const weights = createWeightRecord()
  const bluffPopulation =
    context.state.street === 'river'
      ? descriptorValue(REAL_TABLE_POPULATION.riverBluffPopulation)
      : descriptorValue('medium')
  const valueIntent = clamp(handStrength + emotions.aggressionBoost * 0.08 + position.score * 0.06, 0, 1.3)
  const bluffIntent = clamp(
    bluffPopulation * 0.38 +
      board.straightPressure * 0.18 +
      board.flushPressure * 0.12 +
      emotions.aggressionBoost * 0.18 -
      emotions.cautionBoost * 0.15 -
      context.playersStillInHand.length * 0.05 +
      position.score * 0.08 -
      multiwayPenalty * 0.35,
    0,
    0.72,
  )
  const jamIntent =
    effectiveStackBb <= 16
      ? clamp(
          valueIntent * 0.25 +
            drawStrength * 0.12 +
            emotions.shoveBoost * 0.45 +
            (spr <= 2.5 ? 0.08 : 0) +
            (pressure > 0.6 ? 0.05 : 0),
          0,
          0.45,
        )
      : clamp(emotions.shoveBoost * 0.08, 0, 0.08)

  if (context.legalActions.toCall === 0) {
    weights.check = clamp(
      0.62 -
        valueIntent * 0.24 -
        bluffIntent * 0.08 +
        context.playersStillInHand.length * 0.04 +
        multiwayPenalty * 0.55 +
        (position.isInPosition ? -0.08 : 0.06),
      0.08,
      1,
    )
    weights.bet = clamp(
      valueIntent * 0.95 +
        drawStrength * 0.42 +
        bluffIntent * 0.44 +
        position.score * 0.18 -
        multiwayPenalty * (handStrength < 0.8 ? 0.28 : 0.14) +
        (spr < 3 ? 0.06 : 0),
      0,
      1.32,
    )
    weights['all-in'] = jamIntent * 0.25
  } else {
    weights.fold = clamp(
      0.76 -
        handStrength * 0.42 -
        drawStrength * 0.18 +
        pressure * 0.24 +
        multiwayPenalty * 0.42 +
        (position.isInPosition ? -0.04 : 0.05),
      0.03,
      1.05,
    )
    weights.call = clamp(
      0.08 +
        handStrength * 0.56 +
        drawStrength * 0.54 +
        emotions.curiosityBoost * 0.26 +
        position.score * 0.14 -
        pressure * 0.18 -
        multiwayPenalty * 0.22 +
        (spr > 7 ? -0.04 : 0.04),
      0,
      1.3,
    )
    weights.raise = clamp(
      valueIntent * 0.44 +
        drawStrength * 0.18 +
        bluffIntent * 0.16 +
        position.score * 0.12 -
        context.playersStillInHand.length * 0.05 -
        multiwayPenalty * 0.28 -
        Math.max(0, spr - 5) * 0.03,
      0,
      0.92,
    )
    weights['all-in'] = jamIntent * (effectiveStackBb <= 10 ? 0.6 : 0.28)
  }

  return {
    street: context.state.street,
    scenario: context.legalActions.toCall === 0 ? 'checked-to' : 'facing-bet',
    handStrength,
    playability: drawStrength,
    handKey: canonicalStartingHand(context),
    stackBb,
    effectiveStackBb,
    toCallBb,
    potBb,
    currentBetBb,
    limperCount: 0,
    raiseCount: context.state.fullRaiseCounter,
    playersInHand: context.playersStillInHand.length,
    positionScore: position.score,
    positionBucket: position.bucket,
    isInPosition: position.isInPosition,
    playersBehind: position.playersBehind,
    candidateWeights: weights,
    valueIntent,
    bluffIntent,
    jamIntent,
    preferOversize: false,
    preferOverbet: context.state.street !== 'flop' && bluffIntent > 0.24,
    preferNonAllInBigRaise: true,
    tags: [
      context.legalActions.toCall === 0 ? 'checked-to' : 'under-pressure',
      `position:${position.bucket}`,
      position.isInPosition ? 'in-position' : 'out-of-position',
      evaluated.category,
      board.paired ? 'paired-board' : 'unpaired-board',
    ],
  }
}

export function buildPopulationSnapshot(
  context: DecisionContext,
  emotions: EmotionModifiers,
): PopulationSnapshot {
  return context.state.street === 'preflop'
    ? buildPreflopSnapshot(context, emotions)
    : buildPostflopSnapshot(context, emotions)
}
