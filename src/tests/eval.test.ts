import { describe, expect, it } from 'vitest'

import { createCard } from '../engine/core/cards'
import type { CardCode } from '../engine/core/types'
import { compareHoldemHands, evaluateHoldemHand } from '../engine/eval/handEvaluator'

function toCards(codes: CardCode[]) {
  return codes.map((code) => createCard(code))
}

describe('hand evaluation', () => {
  it('identifies the winning hand correctly', () => {
    const board = toCards(['Qs', 'Js', 'Ts', '2d', '2c'])
    const result = compareHoldemHands([
      {
        playerId: 'hero',
        holeCards: toCards(['As', 'Ks']),
        board,
      },
      {
        playerId: 'villain',
        holeCards: toCards(['2h', '2s']),
        board,
      },
    ])

    expect(result.winners).toEqual(['hero'])
  })

  it('captures made hand and draw details', () => {
    const evaluation = evaluateHoldemHand(
      toCards(['Ah', 'Qh']),
      toCards(['Kh', '7h', '2c']),
    )

    expect(evaluation.flushDraw).toBe(true)
    expect(evaluation.pairType).toBe('none')
    expect(evaluation.category).toBe('high-card')
  })
})
