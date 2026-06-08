import pokersolver from 'pokersolver'

import { RANK_TO_VALUE } from '../core/cards'
import type { Card, EvaluatedShowdownHand } from '../core/types'
import { analyzeDrawProfile } from './boardTexture'

const { Hand } = pokersolver

export interface EvaluatedHoldemHand {
  category: string
  description: string
  rank: number
  normalizedStrength: number
  pairType:
    | 'none'
    | 'underpair'
    | 'middle-pair'
    | 'top-pair'
    | 'overpair'
    | 'two-pair+'
  flushDraw: boolean
  openEndedStraightDraw: boolean
  gutshotStraightDraw: boolean
  comboDraw: boolean
  bestCards: string[]
}

function normalizeCategory(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-')
}

function inferPairType(holeCards: Card[], board: Card[], category: string): EvaluatedHoldemHand['pairType'] {
  if (category !== 'one-pair') {
    return category === 'two-pair' || category === 'three-of-a-kind' ? 'two-pair+' : 'none'
  }

  const boardValues = board.map((card) => RANK_TO_VALUE[card.rank]).sort((left, right) => right - left)
  const holeValues = holeCards.map((card) => RANK_TO_VALUE[card.rank]).sort((left, right) => right - left)
  const topBoard = boardValues[0] ?? 0
  const secondBoard = boardValues[1] ?? 0

  if (holeValues[0] === holeValues[1]) {
    if (holeValues[0] > topBoard) {
      return 'overpair'
    }
    return 'underpair'
  }

  if (holeValues.includes(topBoard)) {
    return 'top-pair'
  }
  if (holeValues.includes(secondBoard)) {
    return 'middle-pair'
  }
  return 'underpair'
}

export function evaluateHoldemHand(holeCards: Card[], board: Card[]): EvaluatedHoldemHand {
  const solved = Hand.solve([...holeCards, ...board].map((card) => card.code))
  const category = normalizeCategory(solved.name)
  const draws = analyzeDrawProfile(holeCards, board)

  return {
    category,
    description: solved.descr,
    rank: solved.rank,
    normalizedStrength: solved.rank / 9,
    pairType: inferPairType(holeCards, board, category),
    flushDraw: draws.flushDraw,
    openEndedStraightDraw: draws.openEndedStraightDraw,
    gutshotStraightDraw: draws.gutshotStraightDraw,
    comboDraw: draws.comboDraw,
    bestCards: solved.cards.map((card) => card.toString()),
  }
}

export function compareHoldemHands(
  entries: Array<{ playerId: string; holeCards: Card[]; board: Card[] }>,
): {
  winners: string[]
  evaluations: EvaluatedShowdownHand[]
} {
  const solvedHands = entries.map((entry) => ({
    playerId: entry.playerId,
    solved: Hand.solve([...entry.holeCards, ...entry.board].map((card) => card.code)),
  }))

  const winnerHands = Hand.winners(solvedHands.map((entry) => entry.solved))
  const winners = solvedHands
    .filter((entry) => winnerHands.includes(entry.solved))
    .map((entry) => entry.playerId)

  return {
    winners,
    evaluations: solvedHands.map((entry) => ({
      playerId: entry.playerId,
      description: entry.solved.descr,
      category: normalizeCategory(entry.solved.name),
      rank: entry.solved.rank,
      cards: entry.solved.cards.map((card) => card.toString()),
    })),
  }
}
