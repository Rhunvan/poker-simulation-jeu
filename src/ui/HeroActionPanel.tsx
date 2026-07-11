import { useMemo, useState } from 'react'

import { botProfilesById } from '../config/botProfiles'
import { getHeroAdvice, HERO_ADVICE_ACTIONS, type HeroAdviceAction } from '../engine/advisor/heroAdvisor'
import { getLegalActions } from '../engine/rules/legalActions'
import type { PlayerCommand, TablePlayer, TableState } from '../engine/core/types'
import { PlayingCard } from './PlayingCard'

interface HeroActionPanelProps {
  table: TableState
  hero: TablePlayer
  onAction: (command: PlayerCommand) => void
  onEditGtoHand: () => void
}

const ACTION_LABELS: Record<HeroAdviceAction, string> = {
  fold: 'Se coucher',
  check: 'Parole',
  call: 'Suivre',
  bet: 'Miser',
  raise: 'Relancer',
  'all-in': 'Tapis',
}

const CONFIDENCE_LABELS = {
  low: 'Confiance prudente',
  medium: 'Confiance moyenne',
  high: 'Confiance élevée',
} as const

function formatAmount(amount: number): string {
  return amount.toLocaleString('fr-FR')
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatStreet(street: TableState['street']): string {
  return street === 'preflop' ? 'Préflop' : street.charAt(0).toUpperCase() + street.slice(1)
}

export function HeroActionPanel({ table, hero, onAction, onEditGtoHand }: HeroActionPanelProps) {
  const legal = useMemo(() => getLegalActions(table, hero.id), [table, hero.id])
  const advice = useMemo(() => getHeroAdvice(table, botProfilesById, hero.id), [table, hero.id])
  const raiseOption = legal?.options.find((option) => option.kind === 'bet' || option.kind === 'raise') ?? null
  const toCall = legal?.toCall ?? 0
  const decisionKey = `${table.handNumber}:${table.street}:${table.currentActorId ?? 'none'}:${raiseOption?.minTotal ?? 0}:${raiseOption?.maxTotal ?? 0}`
  const [raiseSelection, setRaiseSelection] = useState<{ decisionKey: string; value: number } | null>(null)
  const raiseInput = raiseSelection?.decisionKey === decisionKey ? raiseSelection.value : null
  const potTotal = table.players.reduce((sum, player) => sum + player.totalCommitted, 0)
  const advisedRaiseTotal =
    advice?.suggestedTotal !== undefined &&
    (advice.recommendedAction === 'bet' || advice.recommendedAction === 'raise')
      ? advice.suggestedTotal
      : null
  const raiseTo =
    raiseOption && raiseOption.minTotal !== undefined && raiseOption.maxTotal !== undefined
      ? Math.min(
          raiseOption.maxTotal,
          Math.max(raiseOption.minTotal, raiseInput ?? advisedRaiseTotal ?? raiseOption.minTotal),
        )
      : hero.currentBet + hero.stack
  const sizingStep = Math.max(100, Math.round(table.config.bigBlind / 2))
  const sizingPresets = useMemo(() => {
    if (!raiseOption || raiseOption.minTotal === undefined || raiseOption.maxTotal === undefined) {
      return []
    }

    const potAfterCall = potTotal + toCall
    const baseTotal = table.currentBet === 0 ? hero.currentBet : table.currentBet
    const candidates = [
      { label: '½ pot', total: baseTotal + potAfterCall * 0.5 },
      { label: '⅔ pot', total: baseTotal + potAfterCall * 0.67 },
      { label: 'Pot', total: baseTotal + potAfterCall },
      ...(advisedRaiseTotal === null ? [] : [{ label: 'Conseil', total: advisedRaiseTotal }]),
    ]

    const seen = new Set<number>()
    return candidates.flatMap((candidate) => {
      const total = clamp(
        Math.round(candidate.total / sizingStep) * sizingStep,
        raiseOption.minTotal ?? 0,
        raiseOption.maxTotal ?? 0,
      )
      if (seen.has(total)) {
        return []
      }
      seen.add(total)
      return [{ ...candidate, total }]
    })
  }, [advisedRaiseTotal, hero.currentBet, potTotal, raiseOption, sizingStep, table.currentBet, toCall])

  if (!legal) {
    return (
      <div className="hero-panel idle">
        <div>
          <p className="eyebrow">Hero</p>
          <strong>En attente</strong>
          <p>Le prochain spot arrive dès que la main suivante démarre.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="hero-panel">
      <div className="hero-panel-head">
        <div>
          <p className="eyebrow">À toi de jouer</p>
          <strong>Décision en direct</strong>
        </div>
        <div className="hero-callout">
          <span>À payer</span>
          <strong>{formatAmount(legal.toCall)}</strong>
        </div>
      </div>

      <button
        type="button"
        className="hero-hand-preview"
        onClick={onEditGtoHand}
        aria-label="Choisir ma main pour le GTO"
      >
        <div className="hero-preview-cards">
          {hero.holeCards.map((card) => (
            <PlayingCard key={`hero-preview-${card.code}`} card={card} className="hero-preview-card" />
          ))}
        </div>
        <div className="hero-hand-copy">
          <span>Ta main</span>
          <strong>{hero.holeCards.map((card) => card.code).join(' · ')}</strong>
          <small>Appuie pour choisir ta main GTO</small>
        </div>
        <span className="hero-hand-chevron" aria-hidden="true">›</span>
      </button>

      <div className="hero-metrics">
        <div className="hero-metric">
          <span>Stack</span>
          <strong>{formatAmount(hero.stack)}</strong>
        </div>
        <div className="hero-metric">
          <span>Street</span>
          <strong>{formatStreet(table.street)}</strong>
        </div>
        <div className="hero-metric">
          <span>Pot</span>
          <strong>{formatAmount(potTotal)}</strong>
        </div>
      </div>

      {advice ? (
        <section className="gto-advisor" aria-labelledby="gto-advisor-title">
          <div className="gto-advisor-head">
            <div>
              <p className="eyebrow">Conseil en direct</p>
              <strong id="gto-advisor-title">GTO adapté à cette table</strong>
            </div>
            <span className={`gto-confidence gto-confidence-${advice.confidence}`}>
              {CONFIDENCE_LABELS[advice.confidence]}
            </span>
          </div>

          <div className="gto-recommendation">
            <span>Action conseillée</span>
            <strong>
              {ACTION_LABELS[advice.recommendedAction]}
              {advice.suggestedTotal !== undefined && advice.recommendedAction !== 'all-in'
                ? ` à ${formatAmount(advice.suggestedTotal)}`
                : ''}
            </strong>
            {advice.suggestedTotal !== undefined &&
            (advice.recommendedAction === 'bet' || advice.recommendedAction === 'raise') ? (
              <button
                type="button"
                className="gto-use-sizing"
                onClick={() => {
                  if (advice.suggestedTotal !== undefined) {
                    setRaiseSelection({ decisionKey, value: advice.suggestedTotal })
                  }
                }}
              >
                Appliquer
              </button>
            ) : null}
          </div>

          <div className="gto-metrics">
            <div>
              <span>Équité estimée</span>
              <strong>{advice.equity.toFixed(1)} %</strong>
            </div>
            <div>
              <span>Cote du pot</span>
              <strong>{legal.toCall > 0 ? `${advice.potOdds.toFixed(1)} %` : '—'}</strong>
            </div>
            <div>
              <span>Stack effectif</span>
              <strong>{advice.effectiveStackBb.toFixed(1)} BB</strong>
            </div>
          </div>

          <details className="gto-analysis">
            <summary>Voir l’analyse complète</summary>
            <div className="gto-analysis-body">
              <div className="gto-mix" aria-label="Fréquences d’actions conseillées">
                {HERO_ADVICE_ACTIONS.flatMap((action) => {
                  const percentage = advice.actionMix[action]
                  return percentage === undefined
                    ? []
                    : [
                        <span key={action} className={action === advice.recommendedAction ? 'is-primary' : ''}>
                          {ACTION_LABELS[action]} {percentage.toFixed(1)} %
                        </span>,
                      ]
                })}
              </div>

              <ul className="gto-reasons">
                {advice.reasons.slice(0, 3).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <p className="gto-disclaimer">{advice.disclaimer}</p>
            </div>
          </details>
        </section>
      ) : null}

      {raiseOption && raiseOption.minTotal !== undefined && raiseOption.maxTotal !== undefined && (
        <div className="raise-controls">
          <div className="raise-heading">
            <label htmlFor="raise-slider">Relancer à</label>
            <strong>{formatAmount(raiseTo)}</strong>
          </div>
          <div className="sizing-presets" aria-label="Tailles de mise rapides">
            {sizingPresets.map((preset) => (
              <button
                key={`${preset.label}-${preset.total}`}
                type="button"
                className={raiseTo === preset.total ? 'active' : ''}
                onClick={() => setRaiseSelection({ decisionKey, value: preset.total })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            id="raise-slider"
            type="range"
            min={raiseOption.minTotal}
            max={raiseOption.maxTotal}
            step={sizingStep}
            value={raiseTo}
            onChange={(event) => setRaiseSelection({ decisionKey, value: Number(event.target.value) })}
          />
          <div className="range-meta">
            <span>Min {formatAmount(raiseOption.minTotal)}</span>
            <span>Max {formatAmount(raiseOption.maxTotal)}</span>
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
              className={`action-button action-${option.kind} ${option.kind === 'fold' ? 'danger' : ''} ${
                advice?.recommendedAction === option.kind ? 'is-recommended' : ''
              }`}
              onClick={handleClick}
            >
              {option.kind === 'fold'
                ? 'Se coucher'
                : option.kind === 'check'
                  ? 'Parole'
                  : option.kind === 'call'
                    ? `Suivre ${formatAmount(legal.toCall)}`
                    : option.kind === 'bet'
                      ? `Miser ${formatAmount(raiseTo)}`
                      : option.kind === 'raise'
                        ? `Relancer ${formatAmount(raiseTo)}`
                        : `Tapis ${formatAmount(hero.stack)}`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
