import type { Card, CardCode, Rank, Suit } from './types'

export const RANKS: Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
]

export const SUITS: Suit[] = ['c', 'd', 'h', 's']

export const RANK_TO_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

export function createCard(code: CardCode): Card {
  return {
    rank: code[0] as Rank,
    suit: code[1] as Suit,
    code,
  }
}

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(createCard(`${rank}${suit}`))
    }
  }
  return deck
}

export function formatCards(cards: Card[]): string {
  return cards.map((card) => card.code).join(' ')
}

export function compareCardCodes(a: Card, b: Card): number {
  return RANK_TO_VALUE[b.rank] - RANK_TO_VALUE[a.rank]
}
