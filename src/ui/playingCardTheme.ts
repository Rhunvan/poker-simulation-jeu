import type { Suit } from '../engine/core/types'

type PlayingCardSize = 'seat' | 'board'

interface PlayingCardThemeInput {
  hidden: boolean
  size: PlayingCardSize
  suit?: Suit
  className?: string
}

const SUIT_CLASS_NAMES: Record<Suit, string> = {
  c: 'suit-clubs',
  d: 'suit-diamonds',
  h: 'suit-hearts',
  s: 'suit-spades',
}

const SUIT_TONE_CLASS_NAMES: Record<Suit, string> = {
  c: 'green',
  d: 'blue',
  h: 'red',
  s: 'black',
}

export function getPlayingCardClassNames(input: PlayingCardThemeInput): string[] {
  const isFaceUp = !input.hidden && Boolean(input.suit)

  return [
    'card',
    input.size === 'board' ? 'card-board' : 'card-seat',
    isFaceUp ? 'face' : 'back',
    isFaceUp && input.suit ? SUIT_TONE_CLASS_NAMES[input.suit] : '',
    isFaceUp && input.suit ? SUIT_CLASS_NAMES[input.suit] : '',
    input.className ?? '',
  ].filter(Boolean)
}
