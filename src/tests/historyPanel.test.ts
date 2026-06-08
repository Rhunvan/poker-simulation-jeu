import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { HandSummary } from '../engine/core/types'
import { HistoryPanel } from '../ui/HistoryPanel'

type HistoryHandSummary = HandSummary & {
  shownHands?: Array<{
    playerId: string
    description: string
    category: string
    holeCards: string[]
  }>
}

describe('HistoryPanel', () => {
  it('renders the compact previous-hand drawer with showdown details', () => {
    const markup = renderToStaticMarkup(
      createElement(HistoryPanel, {
        entries: [],
        handSummaries: [
          {
            handNumber: 12,
            showdown: true,
            endedAtSessionMs: 120_000,
            potAmount: 120,
            board: ['As', 'Td', '7h', '3c', '2d'],
            winners: [
              {
                playerId: 'hero',
                amount: 120,
                category: 'flush',
                description: 'Flush, Kd High',
                wonUncontested: false,
              },
            ],
            playerResults: [
              {
                playerId: 'hero',
                participated: true,
                committed: 40,
                wonAmount: 120,
                net: 80,
              },
            ],
            shownHands: [
              {
                playerId: 'hero',
                category: 'flush',
                description: 'Flush, Kd High',
                holeCards: ['Kd', '8d'],
              },
              {
                playerId: 'bot-1',
                category: 'two-pair',
                description: "Two Pair, A's & T's",
                holeCards: ['Ac', 'Th'],
              },
            ],
          } as HistoryHandSummary,
        ],
        showdown: null,
        currencyLabel: '€',
        playerNames: { hero: 'Hero', 'bot-1': 'Nina' },
        heroId: 'hero',
      }),
    )

    expect(markup).toContain('Main précédente')
    expect(markup).toContain('Main #12')
    expect(markup).toContain('couleur au roi')
    expect(markup).toContain('Hero')
    expect(markup).toContain('Nina')
    expect(markup).toContain('120 €')
    expect(markup).toContain('aria-label="As de pique"')
  })
})
