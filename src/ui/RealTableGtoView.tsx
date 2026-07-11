import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import type { BotProfile } from '../config/schema'
import {
  HERO_ADVICE_ACTIONS,
  type HeroAdvice,
  type HeroAdviceAction,
} from '../engine/advisor/heroAdvisor'
import {
  analyzeRealTableSpot,
  getRequiredBoardCount,
  type RealTableAnalysis,
  type RealTablePosition,
  type RealTablePressure,
  type RealTableSpotInput,
  type RealTableStreet,
} from '../engine/advisor/realTableAdvisor'
import type { CardCode, Rank, Suit, TableState } from '../engine/core/types'
import { PlayingCard } from './PlayingCard'
import './realTableGto.css'

interface RealTableGtoViewProps {
  open: boolean
  table: TableState
  profilesById: Record<string, BotProfile>
  onClose: () => void
}

const ACTION_LABELS: Record<HeroAdviceAction, string> = {
  fold: 'Se coucher',
  check: 'Parole',
  call: 'Suivre',
  bet: 'Miser',
  raise: 'Relancer',
  'all-in': 'Tapis',
}

const POSITION_LABELS: Record<RealTablePosition, string> = {
  early: 'Début de parole',
  middle: 'Milieu de parole',
  cutoff: 'Cut-off',
  button: 'Bouton',
  'small-blind': 'Petite blinde',
  'big-blind': 'Grosse blinde',
}

const STREET_LABELS: Record<RealTableStreet, string> = {
  preflop: 'Préflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

const PRESSURE_LABELS: Record<RealTablePressure, string> = {
  none: 'Blinds / aucune pression',
  option: 'Option postée',
  bet: 'Mise adverse',
  raise: 'Relance adverse',
  'all-in': 'Tapis adverse',
}

const PROFILE_ADJUSTMENTS: Record<string, string> = {
  gilles: 'Isole plus cher en value. Son entrée préflop ne représente presque jamais une main forte.',
  eric_b: 'Laisse ses bluffs continuer quand sa ligne raconte mal une grosse main; relance surtout pour value.',
  david: 'Reste cohérent dans les sizings et attaque les lignes qui ne correspondent pas au board.',
  philippe: 'Vole davantage quand il reste passif, mais accorde beaucoup de crédit à ses grosses agressions.',
  gerard: 'Défends plus souvent avec des mains moyennes solides et value-raise ses mises trop larges.',
  pierre: 'Value plus cher et bluffe moins : il paie trop, mais relance rarement sans force réelle.',
  fabrice: 'Garde une construction plus équilibrée; évite les gros écarts exploitants sans information visible.',
}

const RANKS: Rank[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS: Suit[] = ['s', 'h', 'd', 'c']
const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const CARD_OPTIONS = RANKS.flatMap((rank) =>
  SUITS.map((suit) => ({
    value: `${rank}${suit}` as CardCode,
    label: `${rank === 'T' ? '10' : rank}${SUIT_SYMBOLS[suit]}`,
  })),
)

function formatAmount(amount: number): string {
  return amount.toLocaleString('fr-FR')
}

function formatCardCode(card: CardCode | ''): string {
  if (!card) {
    return '—'
  }
  const rank = card[0] === 'T' ? '10' : card[0]
  return `${rank}${SUIT_SYMBOLS[card[1] as Suit]}`
}

function midpoint(range: [number, number]): number {
  return Math.round((range[0] + range[1]) / 2)
}

function getActiveOpponentIds(table: TableState): string[] {
  return table.players
    .filter((player) => player.kind === 'bot')
    .map((player) => player.botProfileId ?? player.id)
}

function createDefaultSpot(table: TableState): RealTableSpotInput {
  const opponentIds = getActiveOpponentIds(table)
  const optionAmount = table.config.straddle?.enabled ? table.config.straddle.amount : 0
  const openingPot = table.config.smallBlind + table.config.bigBlind + optionAmount
  const preferredActor = opponentIds.includes('david') ? 'david' : (opponentIds[0] ?? '')
  return {
    heroCards: ['', ''],
    board: ['', '', '', '', ''],
    street: 'preflop',
    position: 'button',
    pot: openingPot,
    toCall: Math.max(table.config.bigBlind, optionAmount),
    heroStack: table.config.startingStack,
    opponentStack: table.config.startingStack,
    opponentIds,
    pressureType: optionAmount > 0 ? 'option' : 'none',
    pressureActorId: preferredActor,
    limperCount: 0,
  }
}

function getActionText(advice: HeroAdvice): string {
  const label = ACTION_LABELS[advice.recommendedAction]
  if (advice.suggestedTotal === undefined || advice.recommendedAction === 'all-in') {
    return label
  }
  return `${label} à ${formatAmount(advice.suggestedTotal)}`
}

function getAlternative(advice: HeroAdvice): { action: HeroAdviceAction; percentage: number } | null {
  const entries = HERO_ADVICE_ACTIONS.flatMap((action) => {
    const percentage = advice.actionMix[action]
    return percentage === undefined ? [] : [{ action, percentage }]
  }).sort((left, right) => right.percentage - left.percentage)
  return entries.find((entry) => entry.action !== advice.recommendedAction) ?? null
}

function getDeltaSummary(analysis: RealTableAnalysis): string {
  const base = analysis.theoretical
  const adapted = analysis.adapted
  if (base.recommendedAction !== adapted.recommendedAction) {
    return `Les profils font passer le repère de « ${ACTION_LABELS[base.recommendedAction]} » à « ${ACTION_LABELS[adapted.recommendedAction]} ».`
  }
  if (base.suggestedTotal !== undefined && adapted.suggestedTotal !== undefined) {
    const difference = adapted.suggestedTotal - base.suggestedTotal
    if (difference !== 0) {
      return `Même action, mais le sizing table réelle bouge de ${difference > 0 ? '+' : '−'}${formatAmount(Math.abs(difference))}.`
    }
  }
  return 'L’action reste la même; les fréquences sont ajustées à la capacité réelle de cette table à suivre ou bluffer.'
}

function CardSelect({
  id,
  label,
  value,
  usedCards,
  inputRef,
  onChange,
}: {
  id: string
  label: string
  value: CardCode | ''
  usedCards: Set<CardCode>
  inputRef?: React.RefObject<HTMLSelectElement | null>
  onChange: (value: CardCode | '') => void
}) {
  return (
    <label className="real-gto-card-field" htmlFor={id}>
      <span>{label}</span>
      <select
        ref={inputRef}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as CardCode | '')}
      >
        <option value="">—</option>
        {CARD_OPTIONS.map((card) => (
          <option key={card.value} value={card.value} disabled={usedCards.has(card.value) && card.value !== value}>
            {card.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function AdviceComparison({ analysis }: { analysis: RealTableAnalysis }) {
  const actions = HERO_ADVICE_ACTIONS.flatMap((action) => {
    const theory = analysis.theoretical.actionMix[action]
    const adapted = analysis.adapted.actionMix[action]
    return theory === undefined || adapted === undefined ? [] : [{ action, theory, adapted }]
  })

  return (
    <section className="real-gto-comparison" aria-labelledby="real-gto-comparison-title">
      <div className="real-gto-section-heading">
        <div>
          <span>Comparaison</span>
          <h3 id="real-gto-comparison-title">Base théorique vs table réelle</h3>
        </div>
        <p>{getDeltaSummary(analysis)}</p>
      </div>

      <div className="real-gto-comparison-cards">
        <article className="real-gto-compare-card real-gto-compare-theory">
          <span>Repère théorique · GTO approché</span>
          <strong>{getActionText(analysis.theoretical)}</strong>
          <small>Équité estimée {analysis.theoretical.equity.toFixed(1)} %</small>
        </article>
        <article className="real-gto-compare-card real-gto-compare-adapted">
          <span>Adaptation aux profils présents</span>
          <strong>{getActionText(analysis.adapted)}</strong>
          <small>Équité estimée {analysis.adapted.equity.toFixed(1)} %</small>
        </article>
      </div>

      <div className="real-gto-mix" aria-label="Comparaison des fréquences proposées">
        <div className="real-gto-mix-legend" aria-hidden="true">
          <span><i className="is-theory" /> Base</span>
          <span><i className="is-adapted" /> Table réelle</span>
        </div>
        {actions.map(({ action, theory, adapted }) => (
          <div className="real-gto-mix-row" key={action}>
            <div className="real-gto-mix-label">
              <strong>{ACTION_LABELS[action]}</strong>
              <span>{theory.toFixed(1)} → {adapted.toFixed(1)} %</span>
            </div>
            <div className="real-gto-progress-pair">
              <progress className="is-theory" max="100" value={theory}>{theory}%</progress>
              <progress className="is-adapted" max="100" value={adapted}>{adapted}%</progress>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function RealTableGtoView({ open, table, profilesById, onClose }: RealTableGtoViewProps) {
  const [draft, setDraft] = useState<RealTableSpotInput>(() => createDefaultSpot(table))
  const [analysis, setAnalysis] = useState<RealTableAnalysis | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const firstCardRef = useRef<HTMLSelectElement>(null)
  const resultRef = useRef<HTMLElement>(null)
  const requiredBoardCount = getRequiredBoardCount(draft.street)
  const usedCards = useMemo(
    () => new Set([...draft.heroCards, ...draft.board].filter((card): card is CardCode => card !== '')),
    [draft.board, draft.heroCards],
  )
  const availableProfiles = useMemo(
    () => getActiveOpponentIds(table).flatMap((id) => {
      const profile = profilesById[id]
      return profile ? [profile] : []
    }),
    [profilesById, table],
  )

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  const updateDraft = (patch: Partial<RealTableSpotInput>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors([])
    if (analysis) {
      setIsDirty(true)
    }
  }

  const updateCard = (group: 'hero' | 'board', index: number, value: CardCode | '') => {
    if (group === 'hero') {
      const heroCards = [...draft.heroCards] as RealTableSpotInput['heroCards']
      heroCards[index] = value
      updateDraft({ heroCards })
      return
    }
    const board = [...draft.board] as RealTableSpotInput['board']
    board[index] = value
    updateDraft({ board })
  }

  const toggleOpponent = (profileId: string) => {
    const opponentIds = draft.opponentIds.includes(profileId)
      ? draft.opponentIds.filter((id) => id !== profileId)
      : [...draft.opponentIds, profileId]
    const pressureActorId = opponentIds.includes(draft.pressureActorId)
      ? draft.pressureActorId
      : (opponentIds[0] ?? '')
    updateDraft({
      opponentIds,
      pressureActorId,
      limperCount: Math.min(draft.limperCount, opponentIds.length),
    })
  }

  const handleStreetChange = (street: RealTableStreet) => {
    const boardCount = getRequiredBoardCount(street)
    const board = draft.board.map((card, index) => (index < boardCount ? card : '')) as RealTableSpotInput['board']
    updateDraft({
      street,
      board,
      ...(street !== 'preflop' && draft.pressureType === 'option'
        ? { pressureType: draft.toCall > 0 ? 'bet' : 'none' }
        : {}),
    })
  }

  const runAnalysis = () => {
    const result = analyzeRealTableSpot(draft, table.config, profilesById)
    setErrors(result.errors)
    if (result.analysis) {
      setAnalysis(result.analysis)
      setIsDirty(false)
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }))
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    runAnalysis()
  }

  const resetRealHand = () => {
    const defaults = createDefaultSpot(table)
    setDraft((current) => ({
      ...current,
      heroCards: ['', ''],
      board: ['', '', '', '', ''],
      street: 'preflop',
      pot: defaults.pot,
      toCall: defaults.toCall,
      pressureType: defaults.pressureType,
      pressureActorId: current.opponentIds.includes(defaults.pressureActorId)
        ? defaults.pressureActorId
        : (current.opponentIds[0] ?? ''),
      limperCount: 0,
    }))
    setAnalysis(null)
    setErrors([])
    setIsDirty(false)
    requestAnimationFrame(() => firstCardRef.current?.focus())
  }

  const resultProfiles = (analysis?.input.opponentIds ?? draft.opponentIds).flatMap((id) => {
    const profile = profilesById[id]
    return profile ? [profile] : []
  })
  const averageVpip = resultProfiles.length === 0
    ? 0
    : Math.round(resultProfiles.reduce((sum, profile) => sum + midpoint(profile.targetStats.vpip), 0) / resultProfiles.length)
  const looseCount = resultProfiles.filter((profile) => midpoint(profile.targetStats.vpip) >= 45).length
  const alternative = analysis ? getAlternative(analysis.adapted) : null
  const adaptedEdge = analysis ? analysis.adapted.equity - analysis.adapted.potOdds : 0
  const analysisHero = analysis?.state.players.find((player) => player.id === 'hero') ?? null

  return (
    <div className="real-gto-backdrop" onClick={onClose}>
      <section
        className="real-gto-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="real-gto-title"
        aria-describedby="real-gto-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="real-gto-header">
          <div className="real-gto-heading">
            <span className="real-gto-live-mark"><i /> Assistant de décision</span>
            <h2 id="real-gto-title">GTO approché — table réelle</h2>
            <p id="real-gto-description">Saisis uniquement le coup visible. Les 7 profils présents ajustent ensuite le repère théorique.</p>
          </div>
          <div className="real-gto-header-meta">
            <span>{table.config.smallBlind.toLocaleString()} / {table.config.bigBlind.toLocaleString()}</span>
            <span>{draft.opponentIds.length + 1} joueurs</span>
            <button type="button" className="real-gto-new-hand" onClick={resetRealHand}>Nouvelle main</button>
            <button ref={closeButtonRef} type="button" className="real-gto-close" onClick={onClose}>← Simulation</button>
          </div>
        </header>

        <div className="real-gto-body">
          <form className="real-gto-editor" onSubmit={handleSubmit}>
            <div className="real-gto-editor-head">
              <div>
                <span>Le coup réel</span>
                <h3>Ce que tu vois à la table</h3>
              </div>
              <small>Aucune carte adverse demandée</small>
            </div>

            <fieldset className="real-gto-fieldset">
              <legend>1. Ta main et la street</legend>
              <div className="real-gto-card-grid real-gto-card-grid-hero">
                <CardSelect id="real-hero-card-1" label="Carte 1" value={draft.heroCards[0]} usedCards={usedCards} inputRef={firstCardRef} onChange={(value) => updateCard('hero', 0, value)} />
                <CardSelect id="real-hero-card-2" label="Carte 2" value={draft.heroCards[1]} usedCards={usedCards} onChange={(value) => updateCard('hero', 1, value)} />
              </div>
              <div className="real-gto-choice-grid real-gto-choice-grid-street" role="radiogroup" aria-label="Street">
                {(Object.keys(STREET_LABELS) as RealTableStreet[]).map((street) => (
                  <button key={street} type="button" role="radio" aria-checked={draft.street === street} className={draft.street === street ? 'is-active' : ''} onClick={() => handleStreetChange(street)}>
                    {STREET_LABELS[street]}
                  </button>
                ))}
              </div>
              {requiredBoardCount > 0 ? (
                <div className="real-gto-card-grid real-gto-board-grid">
                  {Array.from({ length: requiredBoardCount }, (_, index) => (
                    <CardSelect key={index} id={`real-board-card-${index + 1}`} label={`Board ${index + 1}`} value={draft.board[index]} usedCards={usedCards} onChange={(value) => updateCard('board', index, value)} />
                  ))}
                </div>
              ) : null}
            </fieldset>

            <fieldset className="real-gto-fieldset">
              <legend>2. Situation</legend>
              <div className="real-gto-input-grid">
                <label>
                  <span>Pot actuel</span>
                  <input type="number" inputMode="numeric" min="0" step="100" value={draft.pot} onChange={(event) => updateDraft({ pot: Number(event.target.value) })} />
                </label>
                <label>
                  <span>À payer</span>
                  <input type="number" inputMode="numeric" min="0" step="100" value={draft.toCall} onChange={(event) => updateDraft({ toCall: Number(event.target.value) })} />
                </label>
                <label>
                  <span>Ton stack restant</span>
                  <input type="number" inputMode="numeric" min="1" step="500" value={draft.heroStack} onChange={(event) => updateDraft({ heroStack: Number(event.target.value) })} />
                </label>
                <label>
                  <span>Stack adverse effectif</span>
                  <input type="number" inputMode="numeric" min="1" step="500" value={draft.opponentStack} onChange={(event) => updateDraft({ opponentStack: Number(event.target.value) })} />
                </label>
                <label>
                  <span>Ta position</span>
                  <select value={draft.position} onChange={(event) => updateDraft({ position: event.target.value as RealTablePosition })}>
                    {(Object.keys(POSITION_LABELS) as RealTablePosition[]).map((position) => <option key={position} value={position}>{POSITION_LABELS[position]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Limpers avant toi</span>
                  <input type="number" inputMode="numeric" min="0" max={Math.max(0, draft.opponentIds.length - (draft.pressureType === 'none' ? 0 : 1))} step="1" value={draft.limperCount} onChange={(event) => updateDraft({ limperCount: Number(event.target.value) })} />
                </label>
              </div>
            </fieldset>

            <fieldset className="real-gto-fieldset">
              <legend>3. Action visible avant toi</legend>
              <div className="real-gto-input-grid">
                <label>
                  <span>Dernière pression</span>
                  <select value={draft.pressureType} onChange={(event) => updateDraft({ pressureType: event.target.value as RealTablePressure })}>
                    {(Object.keys(PRESSURE_LABELS) as RealTablePressure[]).map((pressure) => <option key={pressure} value={pressure}>{PRESSURE_LABELS[pressure]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Joueur concerné</span>
                  <select value={draft.pressureActorId} disabled={draft.pressureType === 'none'} onChange={(event) => updateDraft({ pressureActorId: event.target.value })}>
                    {draft.opponentIds.map((id) => <option key={id} value={id}>{profilesById[id]?.displayName ?? id}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="real-gto-fieldset">
              <legend>4. Joueurs encore dans le coup</legend>
              <div className="real-gto-player-checks">
                {availableProfiles.map((profile) => (
                  <label key={profile.id} className={draft.opponentIds.includes(profile.id) ? 'is-selected' : ''}>
                    <input type="checkbox" checked={draft.opponentIds.includes(profile.id)} onChange={() => toggleOpponent(profile.id)} />
                    <span>
                      <strong>{profile.displayName}</strong>
                      <small>{profile.archetype}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {errors.length > 0 ? (
              <div className="real-gto-errors" role="alert">
                <strong>Spot à compléter</strong>
                <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
              </div>
            ) : null}

            <button type="button" className="real-gto-analyze" onClick={runAnalysis}>Analyser ce spot</button>
          </form>

          <main ref={resultRef} className="real-gto-result">
            {analysis ? (
              <>
                <section className="real-gto-decision" aria-labelledby="real-gto-decision-title" aria-live="polite" aria-atomic="true">
                  <div className="real-gto-decision-topline">
                    <span className="real-gto-ready"><i /> Conseil prêt</span>
                    <span className={`real-gto-confidence real-gto-confidence-${analysis.adapted.confidence}`}>Confiance {analysis.adapted.confidence === 'low' ? 'prudente' : analysis.adapted.confidence === 'medium' ? 'moyenne' : 'élevée'}</span>
                  </div>
                  <div className="real-gto-hand-context">
                    <div className="real-gto-hand-cards">
                      {analysisHero?.holeCards.map((card) => <PlayingCard key={card.code} card={card} size="board" />)}
                    </div>
                    <div>
                      <span className="real-gto-hand-code">{analysis.input.heroCards.map(formatCardCode).join(' · ')}</span>
                      <span>{STREET_LABELS[analysis.input.street]} · {POSITION_LABELS[analysis.input.position]}</span>
                      <strong>Pot {formatAmount(analysis.input.pot)} · à payer {formatAmount(analysis.legal.toCall)}</strong>
                    </div>
                  </div>
                  <span className="real-gto-decision-label">Action conseillée</span>
                  <h3 id="real-gto-decision-title">{getActionText(analysis.adapted)}</h3>
                  {alternative ? <p className="real-gto-alternative">Alternative : {ACTION_LABELS[alternative.action]} — {alternative.percentage.toFixed(1)} %</p> : null}
                  <div className="real-gto-kpis">
                    <div><span>Équité estimée</span><strong>{analysis.adapted.equity.toFixed(1)} %</strong></div>
                    <div><span>Cote requise</span><strong>{analysis.adapted.potOdds > 0 ? `${analysis.adapted.potOdds.toFixed(1)} %` : '—'}</strong></div>
                    <div><span>Marge</span><strong className={adaptedEdge >= 0 ? 'is-positive' : 'is-negative'}>{adaptedEdge >= 0 ? '+' : ''}{adaptedEdge.toFixed(1)} pts</strong></div>
                  </div>
                  {isDirty ? <p className="real-gto-dirty">Données modifiées — relance l’analyse pour mettre le conseil à jour.</p> : null}
                </section>

                <AdviceComparison analysis={analysis} />

                <section className="real-gto-why" aria-labelledby="real-gto-why-title">
                  <div className="real-gto-section-heading">
                    <div><span>Lecture du spot</span><h3 id="real-gto-why-title">Pourquoi maintenant</h3></div>
                  </div>
                  <ol>{analysis.adapted.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ol>
                </section>
              </>
            ) : (
              <section className="real-gto-empty">
                <span className="real-gto-ready"><i /> Prêt pour la table réelle</span>
                <h3>Ajoute tes deux cartes, puis analyse.</h3>
                <p>Le résultat restera stable pendant que tu le lis. Rien ne sera repris des cartes cachées de la simulation.</p>
                <button type="button" onClick={() => firstCardRef.current?.focus()}>Saisir le coup</button>
              </section>
            )}

            <section className="real-gto-table-plan" aria-labelledby="real-gto-plan-title">
              <div className="real-gto-section-heading">
                <div>
                  <span>Composition active</span>
                  <h3 id="real-gto-plan-title">Le plan contre cette table</h3>
                </div>
                <p>VPIP profilé moyen ≈ {averageVpip} % · {looseCount} joueur{looseCount > 1 ? 's' : ''} très loose</p>
              </div>
              <div className="real-gto-profile-grid">
                {resultProfiles.map((profile) => (
                  <article key={profile.id}>
                    <div><strong>{profile.displayName}</strong><span>{profile.archetype}</span></div>
                    <small>VPIP {profile.targetStats.vpip[0]}–{profile.targetStats.vpip[1]} · PFR {profile.targetStats.pfr[0]}–{profile.targetStats.pfr[1]}</small>
                    <p>{PROFILE_ADJUSTMENTS[profile.id] ?? profile.specificRules[0] ?? profile.summary}</p>
                  </article>
                ))}
              </div>
            </section>

            <footer className="real-gto-disclaimer">
              <strong>Ce que le calcul utilise</strong>
              <p>Ta main, le board, les montants, la position, les actions visibles et les profils configurés. Jamais les cartes adverses. Estimation locale et déterministe : c’est un repère GTO approché, pas un solveur professionnel exact.</p>
            </footer>
          </main>
        </div>
      </section>
    </div>
  )
}
