import { useMemo, useState, type CSSProperties } from 'react'

import type { BotProfile } from '../config/schema'
import { evaluateHoldemHand } from '../engine/eval/handEvaluator'
import type { PlayerCommand, TablePlayer, TableState } from '../engine/core/types'
import { getCurrentBlindLevel } from '../engine'
import { getSessionStats } from '../engine/sessionStats'
import { HeroActionPanel } from './HeroActionPanel'
import { HistoryPanel } from './HistoryPanel'
import { formatHandDescription } from './handDescriptions'
import { PlayingCard } from './PlayingCard'
import { PlayerLineupModal } from './PlayerLineupModal'
import { RealTableGtoView } from './RealTableGtoView'
import { SeatView } from './SeatView'
import { SessionStatsModal } from './SessionStatsModal'
import { buildTableDebugSnapshot } from './tableDebug'
import './table.css'

interface TableViewProps {
  table: TableState
  speed: 1 | 2 | 4
  isPaused: boolean
  botProfiles: Record<string, BotProfile>
  availableProfiles: BotProfile[]
  activeProfileIds: string[]
  onHeroAction: (command: PlayerCommand) => void
  onPauseToggle: () => void
  onReset: () => void
  onLineupApply: (profileIds: string[]) => void
  onSpeedChange: (speed: 1 | 2 | 4) => void
}

type SeatPositionStyle = CSSProperties & {
  '--seat-scale': string
  '--seat-depth': string
}

function getSeatPosition(seatIndex: number, maxSeats: number, heroSeatIndex: number): SeatPositionStyle {
  const relativeIndex = (seatIndex - heroSeatIndex + maxSeats) % maxSeats
  const angle = Math.PI / 2 + relativeIndex * ((Math.PI * 2) / maxSeats)
  const xRadius = maxSeats >= 8 ? 41 : 38
  const yRadius = maxSeats >= 8 ? 34 : 31
  const x = 50 + Math.cos(angle) * xRadius
  const y = 50 + Math.sin(angle) * yRadius
  const depth = (Math.sin(angle) + 1) / 2
  const scale = 0.84 + depth * 0.18

  return {
    left: `${x}%`,
    top: `${y}%`,
    '--seat-scale': scale.toFixed(3),
    '--seat-depth': `${Math.round(depth * 100)}`,
  }
}

function formatStack(amount: number, currencyLabel: string): string {
  return `${amount.toLocaleString()} ${currencyLabel}`
}

function formatSignedStack(amount: number, currencyLabel: string): string {
  if (amount === 0) {
    return `0 ${currencyLabel}`
  }

  const sign = amount > 0 ? '+' : '-'
  return `${sign}${Math.abs(amount).toLocaleString()} ${currencyLabel}`
}

function formatStreet(street: TableState['street']): string {
  switch (street) {
    case 'preflop':
      return 'Preflop'
    case 'flop':
      return 'Flop'
    case 'turn':
      return 'Turn'
    case 'river':
      return 'River'
    case 'showdown':
      return 'Abattage'
    default:
      return street
  }
}

export function TableView({
  table,
  speed,
  isPaused,
  botProfiles,
  availableProfiles,
  activeProfileIds,
  onHeroAction,
  onPauseToggle,
  onReset,
  onLineupApply,
  onSpeedChange,
}: TableViewProps) {
  const [isSessionStatsOpen, setIsSessionStatsOpen] = useState(false)
  const [isLineupOpen, setIsLineupOpen] = useState(false)
  const [isRealGtoOpen, setIsRealGtoOpen] = useState(false)
  const [openFirstGtoCardPicker, setOpenFirstGtoCardPicker] = useState(false)
  const [isSeatDebugEnabled, setIsSeatDebugEnabled] = useState(false)
  const level = getCurrentBlindLevel(table)
  const hero = table.players.find((player) => player.id === 'hero') ?? null
  const sessionStats = useMemo(() => getSessionStats(table, hero?.id ?? 'hero'), [table, hero?.id])
  const totalPot = table.players.reduce((sum, player) => sum + player.totalCommitted, 0)
  const heroSeatIndex = hero?.seatIndex ?? table.config.heroSeatIndex
  const activePlayers = table.players.filter((player) => !player.hasFolded && player.holeCards.length > 0).length
  const dealerPlayer = table.players.find((player) => player.seatIndex === table.dealerSeatIndex) ?? null
  const currentActor = table.players.find((player) => player.id === table.currentActorId) ?? null
  const heroHandStrength = useMemo(() => {
    if (!hero || hero.hasFolded || hero.holeCards.length < 2 || table.board.length < 3) {
      return null
    }

    const evaluation = evaluateHoldemHand(hero.holeCards, table.board)
    return formatHandDescription(evaluation.category, evaluation.description)
  }, [hero, table.board])
  const seatDebugSnapshot = useMemo(() => buildTableDebugSnapshot(table, hero?.id ?? 'hero'), [table, hero?.id])
  const seatDebugBySeat = useMemo(
    () => new Map(seatDebugSnapshot.seats.map((seat) => [seat.seatIndex, seat])),
    [seatDebugSnapshot],
  )

  const occupiedSeats = useMemo(() => {
    const entries = new Map<number, TablePlayer>()
    for (const player of table.players) {
      entries.set(player.seatIndex, player)
    }
    return entries
  }, [table.players])

  const playerNames = useMemo(
    () =>
      Object.fromEntries(table.players.map((player) => [player.id, player.displayName])) satisfies Record<string, string>,
    [table.players],
  )

  return (
    <div className="app-shell">
      <div className="table-stage">
        <header className="top-bar">
          <div className="brand-block">
            <p className="eyebrow">{table.config.tableName}</p>
            <div className="headline-row">
              <h1>Cash game privé</h1>
              <span className="table-badge">{table.config.maxSeats}-max</span>
            </div>
            <p className="status-line" aria-label={`${table.config.variant}, ${table.config.mode}`}>
              <span>Blindes {level.smallBlind.toLocaleString()} / {level.bigBlind.toLocaleString()}</span>
              {level.ante > 0 ? <span>Ante {level.ante.toLocaleString()}</span> : null}
              {table.config.straddle?.enabled ? (
                <span>{table.config.straddle.label} {table.config.straddle.amount.toLocaleString()}</span>
              ) : null}
              <span>Cave {table.config.startingStack.toLocaleString()}</span>
              <span>Main #{table.handNumber}</span>
            </p>
          </div>

          <div className="controls">
            <button type="button" className="control-primary" onClick={onPauseToggle}>
              {isPaused ? 'Reprendre' : 'Pause'}
            </button>
            <button
              type="button"
              className="real-gto-trigger"
              onClick={() => {
                setOpenFirstGtoCardPicker(false)
                setIsRealGtoOpen(true)
              }}
            >
              GTO table réelle
            </button>
            <button type="button" className="control-secondary" onClick={() => setIsSessionStatsOpen(true)}>
              Stats
            </button>
            <button type="button" className="control-secondary" onClick={() => setIsLineupOpen(true)}>
              Joueurs {activeProfileIds.length + 1}/{table.config.maxSeats}
            </button>
            <button
              type="button"
              className={`debug-control ${isSeatDebugEnabled ? 'active' : ''}`}
              aria-pressed={isSeatDebugEnabled}
              onClick={() => setIsSeatDebugEnabled((value) => !value)}
            >
              Debug
            </button>
            <div className="speed-group" role="group" aria-label="Vitesse">
              {[1, 2, 4].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={speed === value ? 'active' : ''}
                  onClick={() => onSpeedChange(value as 1 | 2 | 4)}
                >
                  x{value}
                </button>
              ))}
            </div>
            <button type="button" className="danger reset-control" onClick={onReset}>
              Nouvelle session
            </button>
          </div>
        </header>

        <div className="workspace">
          <aside className="decision-rail" aria-label="Décision du Hero">
            {hero && (
              <HeroActionPanel
                table={table}
                hero={hero}
                onAction={onHeroAction}
                onEditGtoHand={() => {
                  setOpenFirstGtoCardPicker(true)
                  setIsRealGtoOpen(true)
                }}
              />
            )}
          </aside>

          <section className="table-panel">
            <div className="table-summary">
              <div className="summary-item">
                <span className="eyebrow">Pot total</span>
                <strong className="summary-value">{formatStack(totalPot, table.config.currencyLabel)}</strong>
              </div>
              <div className="summary-item">
                <span className="eyebrow">En jeu</span>
                <strong className="summary-value">
                  {activePlayers} / {table.players.length}
                </strong>
                <span className="summary-detail">joueurs dans le coup</span>
              </div>
              <div className="summary-item">
                <span className="eyebrow">Tour</span>
                <strong className="summary-value">
                  {table.handInProgress ? formatStreet(table.street) : 'Pause'}
                </strong>
                <span className="summary-detail">
                  {currentActor ? `action: ${currentActor.displayName}` : 'attente prochaine main'}
                </span>
              </div>
              <div className="summary-item">
                <span className="eyebrow">Bouton</span>
                <strong className="summary-value">{dealerPlayer?.displayName ?? 'N/A'}</strong>
                <span className="summary-detail">siège {table.dealerSeatIndex + 1}</span>
              </div>
              <div className="summary-item">
                <span className="eyebrow">Hero session</span>
                <strong className={`summary-value ${sessionStats.netResult > 0 ? 'stat-positive' : sessionStats.netResult < 0 ? 'stat-negative' : ''}`}>
                  {formatSignedStack(sessionStats.netResult, table.config.currencyLabel)}
                </strong>
                <span className="summary-detail">
                  {sessionStats.rebuys} recave{sessionStats.rebuys > 1 ? 's' : ''} · {sessionStats.handsWon} main{sessionStats.handsWon > 1 ? 's' : ''} gagnee{sessionStats.handsWon > 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <div className="table-surface" data-street={table.handInProgress ? table.street : 'idle'}>
              {isSeatDebugEnabled ? (
                <div className="table-debug-overlay" role="status" aria-live="polite">
                  <span className="table-debug-kicker">Debug sparse</span>
                  <div className="table-debug-grid">
                    <div className="table-debug-item">
                      <span>Ordre occupe</span>
                      <strong>{seatDebugSnapshot.occupiedSeatLabels.join(' > ')}</strong>
                    </div>
                    <div className="table-debug-item">
                      <span>Premier preflop</span>
                      <strong>{seatDebugSnapshot.firstActorPreflopLabel ?? 'N/A'}</strong>
                    </div>
                    <div className="table-debug-item">
                      <span>Premier postflop</span>
                      <strong>{seatDebugSnapshot.firstActorPostflopLabel ?? 'N/A'}</strong>
                    </div>
                    {seatDebugSnapshot.heroRelativeLabel ? (
                      <div className="table-debug-item">
                        <span>Hero</span>
                        <strong>{seatDebugSnapshot.heroRelativeLabel}</strong>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="table-oval" aria-hidden="true">
                <div className="table-racetrack" />
                <div className="felt-ring">
                  <div className="betting-line" />
                  <div className="table-emblem" />
                </div>
              </div>
              <div className="dealer-center">
                <div className="board-stage">
                  <span className="street-pill">{table.handInProgress ? formatStreet(table.street) : 'Entre deux mains'}</span>
                  {heroHandStrength ? (
                    <div className="hand-strength-readout" aria-live="polite">
                      <span className="hand-strength-label">Ta main</span>
                      <strong className="hand-strength-value">{heroHandStrength}</strong>
                    </div>
                  ) : null}
                  <div className="board-row">
                    {table.board.length === 0 ? (
                      <span className="empty-board">Le board arrive apres le preflop.</span>
                    ) : (
                      table.board.map((card) => (
                        <PlayingCard key={card.code} card={card} size="board" />
                      ))
                    )}
                  </div>
                  <div className="pot-list">
                    {table.pots.map((pot) => (
                      <div key={pot.id} className="pot-pill">
                        <span>{pot.label}</span>
                        <strong>{formatStack(pot.amount, table.config.currencyLabel)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {Array.from({ length: table.config.maxSeats }, (_, seatIndex) => {
                const player = occupiedSeats.get(seatIndex)
                const seatDebug = seatDebugBySeat.get(seatIndex)
                return (
                  <div
                    key={seatIndex}
                    className="seat-anchor"
                    style={getSeatPosition(seatIndex, table.config.maxSeats, heroSeatIndex)}
                  >
                    {isSeatDebugEnabled && seatDebug?.badges.length ? (
                      <div className="seat-debug-tags" aria-hidden="true">
                        {seatDebug.badges.map((badge) => (
                          <span key={`${seatIndex}-${badge}`} className="seat-debug-badge">
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <SeatView
                      seatIndex={seatIndex}
                      player={player}
                      botProfile={player?.botProfileId ? botProfiles[player.botProfileId] : undefined}
                      isHero={player?.id === 'hero'}
                      isWinner={player ? table.lastWinnerIds.includes(player.id) : false}
                      isDealer={table.dealerSeatIndex === seatIndex}
                      isSmallBlind={table.smallBlindSeatIndex === seatIndex}
                      isBigBlind={table.bigBlindSeatIndex === seatIndex}
                      isCurrentActor={table.currentActorId === player?.id}
                      currencyLabel={table.config.currencyLabel}
                    />
                  </div>
                )
              })}
            </div>
          </section>

          <aside className="history-rail" aria-label="Historique de la table">
            <HistoryPanel
              entries={table.history}
              handSummaries={table.handSummaries}
              showdown={table.showdown}
              currencyLabel={table.config.currencyLabel}
              playerNames={playerNames}
              heroId={hero?.id ?? 'hero'}
            />
          </aside>
        </div>
      </div>

      <SessionStatsModal
        open={isSessionStatsOpen}
        onClose={() => setIsSessionStatsOpen(false)}
        stats={sessionStats}
        currencyLabel={table.config.currencyLabel}
        playerName={hero?.displayName ?? 'Hero'}
      />
      <PlayerLineupModal
        isOpen={isLineupOpen}
        profiles={availableProfiles}
        activeProfileIds={activeProfileIds}
        maxActive={Math.max(1, table.config.maxSeats - 1)}
        onClose={() => setIsLineupOpen(false)}
        onApply={(profileIds) => {
          onLineupApply(profileIds)
          setIsLineupOpen(false)
        }}
      />
      <RealTableGtoView
        key={table.players.map((player) => player.id).join(':')}
        open={isRealGtoOpen}
        openFirstCardPicker={openFirstGtoCardPicker}
        table={table}
        profilesById={botProfiles}
        onClose={() => {
          setIsRealGtoOpen(false)
          setOpenFirstGtoCardPicker(false)
        }}
      />
    </div>
  )
}
