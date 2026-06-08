import { describe, expect, it } from 'vitest'

import { getPlayingCardClassNames } from '../ui/playingCardTheme'

describe('getPlayingCardClassNames', () => {
  it('returns face and red classes for a visible heart card', () => {
    expect(
      getPlayingCardClassNames({
        hidden: false,
        size: 'board',
        suit: 'h',
        className: 'extra',
      }),
    ).toEqual(['card', 'card-board', 'face', 'red', 'suit-hearts', 'extra'])
  })

  it('returns a green class for a visible club card', () => {
    expect(
      getPlayingCardClassNames({
        hidden: false,
        size: 'seat',
        suit: 'c',
      }),
    ).toEqual(['card', 'card-seat', 'face', 'green', 'suit-clubs'])
  })

  it('returns a blue class for a visible diamond card', () => {
    expect(
      getPlayingCardClassNames({
        hidden: false,
        size: 'board',
        suit: 'd',
      }),
    ).toEqual(['card', 'card-board', 'face', 'blue', 'suit-diamonds'])
  })

  it('returns back classes for a hidden card', () => {
    expect(
      getPlayingCardClassNames({
        hidden: true,
        size: 'seat',
      }),
    ).toEqual(['card', 'card-seat', 'back'])
  })
})
