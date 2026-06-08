import { useState } from 'react'

import { createCard } from '../engine/core/cards'
import type { CardCode, HandHistoryEntry, HandSummary, ShowdownResult } from '../engine/core/types'
import { formatHandDescription } from './handDescriptions'
import { PlayingCard } from './PlayingCard'

interface HistoryPanelProps {
  entries: HandHistoryEntry[]
  handSummaries: HandSummary[]
  showdown: ShowdownResult | null
  currencyLabel: string
  playerNames: Record<string, string>
  heroId: string
}

function formatAmount(amount: number, currencyLabel: string): string {
  return `${amount.toLocaleString()} ${currencyLabel}`
}

function formatNet(amount: number, currencyLabel: string): string {
  if (amount === 0) {
    return `0 ${currencyLabel}`
  }

  const sign = amount > 0 ? '+' : '-'
  return `${sign}${Math.abs(amount).toLocaleString()} ${currencyLabel}`
}

function netClassName(amount: number): string {
  if (amount > 0) {
    return 'stat-positive'
  }
  if (amount < 0) {
    return 'stat-negative'
  }
  return ''
}

function renderResultLabel(summary: HandSummary): string {
  if (summary.winners.length === 0) {
    return summary.showdown ? 'abattage' : 'sans abattage'
  }

  if (summary.winners.length > 1) {
    return 'pot partage'
  }

  const winner = summary.winners[0]
  return formatHandDescription(winner.category, winner.description, winner.wonUncontested)
}

export function HistoryPanel({
  entries,
  handSummaries,
  showdown,
  currencyLabel,
  playerNames,
  heroId,
}: HistoryPanelProps) {
  const [activeView, setActiveView] = useState<'actions' | 'hands'>('actions')
  const [isPreviousHandOpen, setIsPreviousHandOpen] = useState(true)
  const activeCount = activeView === 'actions' ? entries.length : handSummaries.length
  const lastCompletedHand = handSummaries[handSummaries.length - 1] ?? null
  const previousHandBoard = lastCompletedHand?.board.map((code) => createCard(code as CardCode)) ?? []
  const previousHandWinnerNames =
    lastCompletedHand?.winners.map((winner) => playerNames[winner.playerId] ?? winner.playerId).join(', ') ?? ''
  const previousHandResultLabel = lastCompletedHand ? renderResultLabel(lastCompletedHand) : ''

  return (
    <aside className="history-panel">
      <div className="history-header">
        <div>
          <p className="eyebrow">{activeView === 'actions' ? 'Live log' : 'Historique de mains'}</p>
          <h2>Historique</h2>
        </div>
        <div className="history-toolbar">
          <div className="history-tabs" role="tablist" aria-label="Historique">
            <button
              type="button"
              className={activeView === 'actions' ? 'active' : ''}
              onClick={() => setActiveView('actions')}
            >
              Actions
            </button>
            <button
              type="button"
              className={activeView === 'hands' ? 'active' : ''}
              onClick={() => setActiveView('hands')}
            >
              Mains
            </button>
          </div>
          <span className="history-count">{activeCount}</span>
        </div>
      </div>

      {lastCompletedHand ? (
        <section className="previous-hand-drawer">
          <button
            type="button"
            className="previous-hand-toggle"
            onClick={() => setIsPreviousHandOpen((open) => !open)}
            aria-expanded={isPreviousHandOpen}
          >
            <div className="previous-hand-toggle-head">
              <div>
                <p className="eyebrow">Main précédente</p>
                <strong>Main #{lastCompletedHand.handNumber}</strong>
              </div>
              <span className="previous-hand-chip">
                {lastCompletedHand.showdown ? 'abattage' : 'sans abattage'}
              </span>
            </div>
            <div className="previous-hand-toggle-meta">
              <span>{previousHandWinnerNames}</span>
              <strong>{previousHandResultLabel}</strong>
              <span>
                {lastCompletedHand.winners.length > 1 ? 'pot partage' : formatAmount(lastCompletedHand.winners[0]?.amount ?? 0, currencyLabel)}
              </span>
            </div>
          </button>

          {isPreviousHandOpen ? (
            <div className="previous-hand-body">
              <div className="previous-hand-section">
                <span className="previous-hand-label">Board final</span>
                <div className="previous-hand-board">
                  {previousHandBoard.map((card) => (
                    <PlayingCard key={`previous-board-${card.code}`} card={card} size="seat" />
                  ))}
                </div>
              </div>

              <div className="previous-hand-section">
                <span className="previous-hand-label">
                  {lastCompletedHand.winners.length > 1 ? 'Gagnants' : 'Gagnant'}
                </span>
                <div className="previous-hand-winners">
                  {lastCompletedHand.winners.map((winner) => (
                    <div key={`winner-${lastCompletedHand.handNumber}-${winner.playerId}`} className="previous-hand-winner">
                      <strong>{playerNames[winner.playerId] ?? winner.playerId}</strong>
                      <span>
                        {formatHandDescription(winner.category, winner.description, winner.wonUncontested)} ·{' '}
                        {formatAmount(winner.amount, currencyLabel)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {lastCompletedHand.showdown && lastCompletedHand.shownHands && lastCompletedHand.shownHands.length > 0 ? (
                <div className="previous-hand-section">
                  <span className="previous-hand-label">Mains montrées</span>
                  <div className="previous-hand-shown-list">
                    {lastCompletedHand.shownHands.map((shownHand) => (
                      <div
                        key={`shown-${lastCompletedHand.handNumber}-${shownHand.playerId}`}
                        className="previous-hand-shown-entry"
                      >
                        <div className="previous-hand-shown-head">
                          <strong>{playerNames[shownHand.playerId] ?? shownHand.playerId}</strong>
                          <span>{formatHandDescription(shownHand.category, shownHand.description)}</span>
                        </div>
                        <div className="previous-hand-hole-cards">
                          {shownHand.holeCards.map((code) => (
                            <PlayingCard key={`shown-card-${shownHand.playerId}-${code}`} card={createCard(code)} size="seat" />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="history-list">
        {activeView === 'actions' ? (
          entries.length === 0 ? (
            <p className="empty-history">Aucune action enregistree pour l instant.</p>
          ) : (
            entries
              .slice()
              .reverse()
              .map((entry) => (
                <div key={entry.id} className="history-entry" data-street={entry.street}>
                  <span className="history-street">{entry.street}</span>
                  <p>{entry.text}</p>
                </div>
              ))
          )
        ) : handSummaries.length === 0 ? (
          <p className="empty-history">Aucune main terminee dans cette session pour l instant.</p>
        ) : (
          handSummaries
            .slice()
            .reverse()
            .map((summary) => {
              const heroResult = summary.playerResults.find((entry) => entry.playerId === heroId)

              return (
                <div key={summary.handNumber} className="hand-summary-entry">
                  <div className="hand-summary-topline">
                    <div>
                      <strong>Main #{summary.handNumber}</strong>
                      <span>{summary.showdown ? 'abattage' : 'sans abattage'}</span>
                    </div>
                    <strong className={netClassName(heroResult?.net ?? 0)}>
                      {formatNet(heroResult?.net ?? 0, currencyLabel)}
                    </strong>
                  </div>

                  <div className="hand-summary-meta">
                    <span>Pot {formatAmount(summary.potAmount, currencyLabel)}</span>
                    <span>{summary.winners.length > 1 ? 'pot partage' : 'pot ramasse'}</span>
                  </div>

                  <div className="hand-summary-winners">
                    {summary.winners.map((winner) => (
                      <div key={`${summary.handNumber}-${winner.playerId}`} className="hand-summary-winner">
                        <strong>{playerNames[winner.playerId] ?? winner.playerId}</strong>
                        <span>
                          {formatHandDescription(winner.category, winner.description, winner.wonUncontested)} ·{' '}
                          {formatAmount(winner.amount, currencyLabel)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
        )}
      </div>

      {activeView === 'actions' && showdown && (
        <div className="showdown-panel">
          <h3>Abattage</h3>
          <div className="showdown-hands">
            {showdown.hands.map((hand) => (
              <div key={hand.playerId}>
                <strong>{playerNames[hand.playerId] ?? hand.playerId}</strong>
                <span>
                  {formatHandDescription(hand.category, hand.description, false)}
                </span>
              </div>
            ))}
          </div>
          <div className="showdown-awards">
            {showdown.awards.map((award) => (
              <div key={award.potId}>
                <strong>{award.label}</strong>
                <span>
                  {award.amount} {currencyLabel} vers{' '}
                  {award.winnerIds.map((winnerId) => playerNames[winnerId] ?? winnerId).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
