import { RANK_TO_VALUE } from '../core/cards'
import type { Card } from '../core/types'

export interface BoardTexture {
  paired: boolean
  twoTone: boolean
  monotone: boolean
  connectedness: number
  highCardCount: number
  straightPressure: number
  flushPressure: number
}

export interface DrawProfile {
  flushDraw: boolean
  openEndedStraightDraw: boolean
  gutshotStraightDraw: boolean
  comboDraw: boolean
}

export function analyzeBoardTexture(board: Card[]): BoardTexture {
  const suitCounts = board.reduce<Record<string, number>>((counts, card) => {
    counts[card.suit] = (counts[card.suit] ?? 0) + 1
    return counts
  }, {})

  const rankCounts = board.reduce<Record<string, number>>((counts, card) => {
    counts[card.rank] = (counts[card.rank] ?? 0) + 1
    return counts
  }, {})

  const sortedValues = board
    .map((card) => RANK_TO_VALUE[card.rank])
    .sort((left, right) => left - right)

  let connectedness = 0
  for (let index = 1; index < sortedValues.length; index += 1) {
    connectedness += Math.max(0, 4 - (sortedValues[index] - sortedValues[index - 1]))
  }

  const maxSuitCount = Math.max(0, ...Object.values(suitCounts))

  return {
    paired: Object.values(rankCounts).some((count) => count >= 2),
    twoTone: maxSuitCount >= 2,
    monotone: maxSuitCount >= 3,
    connectedness,
    highCardCount: board.filter((card) => RANK_TO_VALUE[card.rank] >= 11).length,
    straightPressure: connectedness / Math.max(1, board.length * 3),
    flushPressure: maxSuitCount / Math.max(1, board.length),
  }
}

function getStraightWindows(cards: Card[]): Array<{ hits: number; missingEdges: boolean }> {
  const values = new Set(cards.map((card) => RANK_TO_VALUE[card.rank]))
  if (values.has(14)) {
    values.add(1)
  }

  const allValues = [...values]
  const windows: Array<{ hits: number; missingEdges: boolean }> = []

  for (let start = 1; start <= 10; start += 1) {
    const window = [start, start + 1, start + 2, start + 3, start + 4]
    const hits = window.filter((value) => allValues.includes(value)).length
    const missing = window.filter((value) => !allValues.includes(value))
    windows.push({
      hits,
      missingEdges: missing.length === 1 && (missing[0] === start || missing[0] === start + 4),
    })
  }

  return windows
}

export function analyzeDrawProfile(holeCards: Card[], board: Card[]): DrawProfile {
  const combined = [...holeCards, ...board]
  const suitCounts = combined.reduce<Record<string, number>>((counts, card) => {
    counts[card.suit] = (counts[card.suit] ?? 0) + 1
    return counts
  }, {})

  const windows = getStraightWindows(combined)
  const openEndedStraightDraw = windows.some((window) => window.hits === 4 && window.missingEdges)
  const gutshotStraightDraw = windows.some((window) => window.hits === 4 && !window.missingEdges)
  const flushDraw = Object.values(suitCounts).some((count) => count === 4)

  return {
    flushDraw,
    openEndedStraightDraw,
    gutshotStraightDraw,
    comboDraw: flushDraw && (openEndedStraightDraw || gutshotStraightDraw),
  }
}
