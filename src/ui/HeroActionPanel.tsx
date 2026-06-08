import { useMemo, useState } from 'react'

import { getLegalActions } from '../engine/rules/legalActions'
import type { PlayerCommand, TablePlayer, TableState } from '../engine/core/types'

interface HeroActionPanelProps {
  table: TableState
  hero: TablePlayer
  onAction: (command: PlayerCommand) => void
}

export function HeroActionPanel({ table, hero, onAction }: HeroActionPanelProps) {
  const legal = useMemo(() => getLegalActions(table, hero.id), [table, hero.id])
  const raiseOption = legal?.options.find((option) => option.kind === 'bet' || option.kind === 'raise') ?? null
  const [raiseInput, setRaiseInput] = useState<number | null>(null)
  const potTotal = table.players.reduce((sum, player) => sum + player.totalCommitted, 0)
  const raiseTo =
    raiseOption && raiseOption.minTotal !== undefined && raiseOption.maxTotal !== undefined
      ? Math.min(
          raiseOption.maxTotal,
          Math.max(raiseOption.minTotal, raiseInput ?? raiseOption.minTotal),
        )
      : hero.currentBet + hero.stack

  if (!legal) {
    return (
      <div className="hero-panel idle">
        <div>
          <p className="eyebrow">Hero</p>
          <strong>En attente</strong>
          <p>Le prochain spot arrive des que la main suivante demarre.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="hero-panel">
      <div className="hero-panel-head">
        <div>
          <p className="eyebrow">Hero</p>
          <strong>Decision en direct</strong>
        </div>
        <div className="hero-callout">
          <span>A payer</span>
          <strong>{legal.toCall}</strong>
        </div>
      </div>

      <div className="hero-metrics">
        <div className="hero-metric">
          <span>Stack</span>
          <strong>{hero.stack}</strong>
        </div>
        <div className="hero-metric">
          <span>Street</span>
          <strong>{table.street}</strong>
        </div>
        <div className="hero-metric">
          <span>Pot</span>
          <strong>{potTotal}</strong>
        </div>
      </div>

      {raiseOption && raiseOption.minTotal !== undefined && raiseOption.maxTotal !== undefined && (
        <div className="raise-controls">
          <label htmlFor="raise-slider">Raise / bet size: {raiseTo}</label>
          <input
            id="raise-slider"
            type="range"
            min={raiseOption.minTotal}
            max={raiseOption.maxTotal}
            step={1}
            value={raiseTo}
            onChange={(event) => setRaiseInput(Number(event.target.value))}
          />
          <div className="range-meta">
            <span>{raiseOption.minTotal}</span>
            <span>{raiseOption.maxTotal}</span>
          </div>
        </div>
      )}

      <div className="hero-actions">
        {legal.options.map((option) => {
          const handleClick = () => {
            if (option.kind === 'bet' || option.kind === 'raise') {
              onAction({ kind: option.kind, total: raiseTo })
              return
            }
            onAction({ kind: option.kind })
          }

          return (
            <button
              key={option.kind}
              type="button"
              className={`action-button action-${option.kind} ${option.kind === 'fold' ? 'danger' : ''}`}
              onClick={handleClick}
            >
              {option.kind === 'bet' || option.kind === 'raise'
                ? `${option.label} ${raiseTo}`
                : option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
