import type { Card, Rank, Suit } from '../engine/core/types'
import { getPlayingCardClassNames } from './playingCardTheme'

interface PlayingCardProps {
  card?: Card
  hidden?: boolean
  className?: string
  size?: 'seat' | 'board'
}

interface PipSlot {
  column: 1 | 2 | 3
  row: 1 | 2 | 3 | 4 | 5 | 6 | 7
}

const DISPLAY_RANKS: Record<Rank, string> = {
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  T: '10',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
}

const RANK_NAMES: Record<Rank, string> = {
  '2': 'Deux',
  '3': 'Trois',
  '4': 'Quatre',
  '5': 'Cinq',
  '6': 'Six',
  '7': 'Sept',
  '8': 'Huit',
  '9': 'Neuf',
  T: 'Dix',
  J: 'Valet',
  Q: 'Dame',
  K: 'Roi',
  A: 'As',
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  c: '♣',
  d: '♦',
  h: '♥',
  s: '♠',
}

const SUIT_NAMES: Record<Suit, string> = {
  c: 'trefle',
  d: 'carreau',
  h: 'coeur',
  s: 'pique',
}

const COURT_NAMES = {
  J: 'Valet',
  Q: 'Dame',
  K: 'Roi',
} as const

const PIP_LAYOUTS: Partial<Record<Rank, PipSlot[]>> = {
  '2': [
    { column: 2, row: 1 },
    { column: 2, row: 7 },
  ],
  '3': [
    { column: 2, row: 1 },
    { column: 2, row: 4 },
    { column: 2, row: 7 },
  ],
  '4': [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
  '5': [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 2, row: 4 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
  '6': [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 1, row: 4 },
    { column: 3, row: 4 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
  '7': [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 4 },
    { column: 3, row: 4 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
  '8': [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 4 },
    { column: 3, row: 4 },
    { column: 2, row: 6 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
  '9': [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 4 },
    { column: 2, row: 4 },
    { column: 3, row: 4 },
    { column: 2, row: 6 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
  T: [
    { column: 1, row: 1 },
    { column: 3, row: 1 },
    { column: 2, row: 2 },
    { column: 1, row: 3 },
    { column: 3, row: 3 },
    { column: 1, row: 5 },
    { column: 3, row: 5 },
    { column: 2, row: 6 },
    { column: 1, row: 7 },
    { column: 3, row: 7 },
  ],
}

function getCardLabel(card: Card): string {
  return `${RANK_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`
}

function renderCardCenter(card: Card, suitSymbol: string, size: PlayingCardProps['size']) {
  if (card.rank === 'A') {
    return (
      <span className="card-center card-center-ace" aria-hidden="true">
        <span className="card-ace-rank">{DISPLAY_RANKS[card.rank]}</span>
        <span className="card-ace-symbol">{suitSymbol}</span>
      </span>
    )
  }

  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
    if (size === 'seat') {
      return (
        <span className="card-center card-center-court is-compact" aria-hidden="true">
          <span className="card-court-crest card-court-crest-compact">
            <span className="card-court-rank">{DISPLAY_RANKS[card.rank]}</span>
            <span className="card-court-suit">{suitSymbol}</span>
          </span>
        </span>
      )
    }

    return (
      <span className="card-center card-center-court" aria-hidden="true">
        <span className="card-court-crest">
          <span className="card-court-rank">{DISPLAY_RANKS[card.rank]}</span>
          <span className="card-court-suit">{suitSymbol}</span>
        </span>
        <span className="card-court-band">{COURT_NAMES[card.rank]}</span>
        <span className="card-court-crest is-inverted">
          <span className="card-court-rank">{DISPLAY_RANKS[card.rank]}</span>
          <span className="card-court-suit">{suitSymbol}</span>
        </span>
      </span>
    )
  }

  const pips = PIP_LAYOUTS[card.rank]
  if (!pips) {
    return null
  }

  return (
    <span className="card-center" aria-hidden="true">
      <span className="card-pips">
        {pips.map((pip, index) => (
          <span
            key={`${card.code}-${index}`}
            className={`card-pip ${pip.row >= 5 ? 'is-inverted' : ''}`}
            style={{ gridColumn: pip.column, gridRow: pip.row }}
          >
            {suitSymbol}
          </span>
        ))}
      </span>
    </span>
  )
}

export function PlayingCard({ card, hidden = false, className, size = 'seat' }: PlayingCardProps) {
  const isFaceUp = !hidden && Boolean(card)
  const suitSymbol = card ? SUIT_SYMBOLS[card.suit] : '♠'
  const rankLabel = card ? DISPLAY_RANKS[card.rank] : ''
  const cardClassName = getPlayingCardClassNames({
    hidden,
    size,
    suit: card?.suit,
    className,
  }).join(' ')

  return (
    <span
      className={cardClassName}
      role="img"
      aria-label={isFaceUp && card ? getCardLabel(card) : 'Carte cachee'}
    >
      <span className="card-shine" aria-hidden="true" />
      {isFaceUp && card ? <span className="card-watermark" aria-hidden="true">{suitSymbol}</span> : null}
      {isFaceUp && card ? (
        <>
          <span className="card-corner card-corner-top" aria-hidden="true">
            <span className="card-rank">{rankLabel}</span>
            <span className="card-suit">{suitSymbol}</span>
          </span>
          {renderCardCenter(card, suitSymbol, size)}
          <span className="card-corner card-corner-bottom" aria-hidden="true">
            <span className="card-rank">{rankLabel}</span>
            <span className="card-suit">{suitSymbol}</span>
          </span>
        </>
      ) : (
        <span className="card-back-inner" aria-hidden="true">
          <span className="card-back-corner card-back-corner-top">♠</span>
          <span className="card-back-emblem">
            <span className="card-back-mark">♠</span>
          </span>
          <span className="card-back-corner card-back-corner-bottom">♠</span>
        </span>
      )}
    </span>
  )
}
