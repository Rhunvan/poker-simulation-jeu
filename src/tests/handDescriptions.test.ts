import { describe, expect, it } from 'vitest'

import { formatHandDescription } from '../ui/handDescriptions'

describe('formatHandDescription', () => {
  it('formats a high-card description in French', () => {
    expect(formatHandDescription('high-card', 'K High')).toBe('hauteur roi')
  })

  it('formats a pair description when category is pair', () => {
    expect(formatHandDescription('pair', "Pair, A's")).toBe("paire d'as")
  })

  it('formats a two-pair description in French', () => {
    expect(formatHandDescription('two-pair', "Two Pair, A's & T's")).toBe('double paire, as et dix')
  })

  it('formats a flush description with clearer French wording', () => {
    expect(formatHandDescription('flush', 'Flush, Kd High')).toBe('couleur au roi')
  })
})
