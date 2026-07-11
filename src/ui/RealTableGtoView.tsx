import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import type { BotProfile } from '../config/schema'
import {
  serializeCreateGtoHandRequest,
  type GtoHandObservationInput,
  type GtoHandListResponse,
  type GtoHandRecord,
  type GtoHandResponse,
} from '../data/gtoHandRecords'
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
  openFirstCardPicker?: boolean
  table: TableState
  profilesById: Record<string, BotProfile>
  onClose: () => void
}

type SavedHandsStatus = 'idle' | 'loading' | 'ready' | 'error'
type SaveHandStatus = 'idle' | 'saving' | 'success' | 'error'

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
const SUIT_LABELS: Record<Suit, string> = { s: 'Pique', h: 'Cœur', d: 'Carreau', c: 'Trèfle' }

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

function getConfiguredOpponentIds(table: TableState): string[] {
  return table.players
    .filter((player) => player.kind === 'bot')
    .map((player) => player.botProfileId ?? player.id)
}

function getDefaultOpponentIds(table: TableState): string[] {
  const configuredIds = getConfiguredOpponentIds(table)
  if (!table.handInProgress) {
    return configuredIds
  }
  const stillInHand = table.players
    .filter((player) => player.kind === 'bot' && !player.hasFolded && !player.isSittingOut)
    .map((player) => player.botProfileId ?? player.id)
  return stillInHand.length > 0 ? stillInHand : configuredIds
}

function createDefaultSpot(table: TableState): RealTableSpotInput {
  const opponentIds = getDefaultOpponentIds(table)
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

function getActionText(advice: Pick<HeroAdvice, 'recommendedAction' | 'suggestedTotal'>): string {
  const label = ACTION_LABELS[advice.recommendedAction]
  if (advice.suggestedTotal === undefined || advice.recommendedAction === 'all-in') {
    return label
  }
  return `${label} à ${formatAmount(advice.suggestedTotal)}`
}

function formatSavedDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Date inconnue'
  }
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function parseOptionalInteger(value: string): number | null | undefined {
  if (value.trim() === '') {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null
}

async function getResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown }
    return typeof payload.error === 'string' && payload.error ? payload.error : fallback
  } catch {
    return fallback
  }
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

function CardPicker({
  id,
  label,
  value,
  usedCards,
  inputRef,
  nextInputRef,
  initiallyOpen = false,
  onChange,
}: {
  id: string
  label: string
  value: CardCode | ''
  usedCards: Set<CardCode>
  inputRef?: React.RefObject<HTMLButtonElement | null>
  nextInputRef?: React.RefObject<HTMLButtonElement | null>
  initiallyOpen?: boolean
  onChange: (value: CardCode | '') => void
}) {
  const ownTriggerRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const triggerRef = inputRef ?? ownTriggerRef
  const [isOpen, setIsOpen] = useState(initiallyOpen)
  const [pendingRank, setPendingRank] = useState<Rank | null>(null)
  const [pendingSuit, setPendingSuit] = useState<Suit | null>(null)
  const selectedSuit = value ? value[1] as Suit : null
  const pendingCard = pendingRank && pendingSuit ? `${pendingRank}${pendingSuit}` as CardCode : null
  const isDuplicate = pendingCard !== null && usedCards.has(pendingCard) && pendingCard !== value
  const dialogTitleId = `${id}-picker-title`
  const dialogHelpId = `${id}-picker-help`

  function openPicker() {
    setPendingRank(null)
    setPendingSuit(null)
    setIsOpen(true)
  }

  function closePicker() {
    setIsOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function commitCard(rank: Rank, suit: Suit) {
    const card = `${rank}${suit}` as CardCode
    if (usedCards.has(card) && card !== value) {
      return
    }
    onChange(card)
    setIsOpen(false)
    requestAnimationFrame(() => {
      if (nextInputRef?.current) {
        nextInputRef.current.click()
      } else {
        triggerRef.current?.focus()
      }
    })
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, triggerRef])

  return (
    <div className="real-gto-card-field">
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`real-gto-card-trigger ${value ? 'is-set' : 'is-empty'}`}
        onClick={openPicker}
        aria-labelledby={`${id}-label ${id}-instruction`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span className={`real-gto-card-face ${selectedSuit === 'h' || selectedSuit === 'd' ? 'is-red' : ''}`} aria-hidden="true">
          {value ? (
            <>
              <strong>{value[0] === 'T' ? '10' : value[0]}</strong>
              <i>{SUIT_SYMBOLS[selectedSuit as Suit]}</i>
            </>
          ) : (
            <strong>+</strong>
          )}
        </span>
        <span className="real-gto-card-trigger-copy" id={`${id}-instruction`}>
          <strong>{value ? formatCardCode(value) : 'Choisir une carte'}</strong>
          <small>{value ? 'Appuie pour changer' : 'Appuie ici'}</small>
        </span>
      </button>

      {isOpen ? (
        <div
          className="real-gto-card-picker-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePicker()
            }
          }}
        >
          <section
            className="real-gto-card-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogHelpId}
          >
            <header>
              <div>
                <span className="real-gto-picker-kicker">Ta main</span>
                <h3 id={dialogTitleId}>Choisir {label.toLowerCase()}</h3>
              </div>
              <button ref={closeButtonRef} type="button" className="real-gto-picker-close" onClick={closePicker} aria-label="Fermer le choix de carte">
                ×
              </button>
            </header>

            <p id={dialogHelpId}>Choisis la valeur puis la couleur. La carte est validée automatiquement.</p>

            <div className={`real-gto-picker-preview ${pendingSuit === 'h' || pendingSuit === 'd' ? 'is-red' : ''}`} aria-live="polite">
              <strong>{pendingRank ? (pendingRank === 'T' ? '10' : pendingRank) : '?'}</strong>
              <i>{pendingSuit ? SUIT_SYMBOLS[pendingSuit] : '♠'}</i>
            </div>

            <div className="real-gto-picker-group">
              <h4>1. Valeur</h4>
              <div className="real-gto-rank-grid">
                {RANKS.map((rank) => (
                  <button
                    key={rank}
                    type="button"
                    className={pendingRank === rank ? 'is-selected' : ''}
                    onClick={() => {
                      setPendingRank(rank)
                      if (pendingSuit) {
                        commitCard(rank, pendingSuit)
                      }
                    }}
                    aria-pressed={pendingRank === rank}
                  >
                    {rank === 'T' ? '10' : rank}
                  </button>
                ))}
              </div>
            </div>

            <div className="real-gto-picker-group">
              <h4>2. Couleur</h4>
              <div className="real-gto-suit-grid">
                {SUITS.map((suit) => (
                  <button
                    key={suit}
                    type="button"
                    className={`${pendingSuit === suit ? 'is-selected' : ''} ${suit === 'h' || suit === 'd' ? 'is-red' : ''}`}
                    onClick={() => {
                      setPendingSuit(suit)
                      if (pendingRank) {
                        commitCard(pendingRank, suit)
                      }
                    }}
                    aria-pressed={pendingSuit === suit}
                  >
                    <strong>{SUIT_SYMBOLS[suit]}</strong>
                    <span>{SUIT_LABELS[suit]}</span>
                  </button>
                ))}
              </div>
            </div>

            {isDuplicate ? <p className="real-gto-picker-error" role="alert">Cette carte est déjà utilisée dans le coup.</p> : null}

            <footer>
              <span className="real-gto-picker-auto">Validation automatique</span>
              {value ? (
                <button
                  type="button"
                  className="real-gto-picker-clear"
                  onClick={() => {
                    onChange('')
                    closePicker()
                  }}
                >
                  Effacer
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
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

export function RealTableGtoView({ open, openFirstCardPicker = false, table, profilesById, onClose }: RealTableGtoViewProps) {
  const [draft, setDraft] = useState<RealTableSpotInput>(() => createDefaultSpot(table))
  const [analysis, setAnalysis] = useState<RealTableAnalysis | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [savedHands, setSavedHands] = useState<GtoHandRecord[]>([])
  const [savedHandCount, setSavedHandCount] = useState(0)
  const [savedHandsStatus, setSavedHandsStatus] = useState<SavedHandsStatus>('idle')
  const [savedHandsError, setSavedHandsError] = useState('')
  const [savedHandsReloadKey, setSavedHandsReloadKey] = useState(0)
  const [isSavedHandsOpen, setIsSavedHandsOpen] = useState(false)
  const [deletingHandId, setDeletingHandId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveHandStatus>('idle')
  const [saveError, setSaveError] = useState('')
  const [lastSavedHandId, setLastSavedHandId] = useState<string | null>(null)
  const [actualAction, setActualAction] = useState<HeroAdviceAction | ''>('')
  const [actualAmount, setActualAmount] = useState('')
  const [heroNet, setHeroNet] = useState('')
  const [observationNote, setObservationNote] = useState('')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const firstCardRef = useRef<HTMLButtonElement>(null)
  const secondCardRef = useRef<HTMLButtonElement>(null)
  const boardCard1Ref = useRef<HTMLButtonElement>(null)
  const boardCard2Ref = useRef<HTMLButtonElement>(null)
  const boardCard3Ref = useRef<HTMLButtonElement>(null)
  const boardCard4Ref = useRef<HTMLButtonElement>(null)
  const boardCard5Ref = useRef<HTMLButtonElement>(null)
  const boardCardRefs = [boardCard1Ref, boardCard2Ref, boardCard3Ref, boardCard4Ref, boardCard5Ref]
  const resultRef = useRef<HTMLElement>(null)
  const saveRequestInFlightRef = useRef(false)
  const deleteRequestInFlightRef = useRef<string | null>(null)
  const requiredBoardCount = getRequiredBoardCount(draft.street)
  const usedCards = useMemo(
    () => new Set([...draft.heroCards, ...draft.board].filter((card): card is CardCode => card !== '')),
    [draft.board, draft.heroCards],
  )
  const availableProfiles = useMemo(
    () => getConfiguredOpponentIds(table).flatMap((id) => {
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

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const controller = new AbortController()
    setSavedHandsStatus('loading')
    setSavedHandsError('')

    void fetch('/api/gto-hands?limit=50', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await getResponseError(response, 'Impossible de charger les mains enregistrées.'))
        }
        return response.json() as Promise<GtoHandListResponse>
      })
      .then((payload) => {
        if (!Array.isArray(payload.hands)) {
          throw new Error('La liste des mains reçue est invalide.')
        }
        const hands = [...payload.hands].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )
        setSavedHands(hands)
        setSavedHandCount(Number.isFinite(payload.count) ? payload.count : hands.length)
        setSavedHandsStatus('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        setSavedHandsStatus('error')
        setSavedHandsError(error instanceof Error ? error.message : 'Impossible de charger les mains enregistrées.')
      })

    return () => controller.abort()
  }, [open, savedHandsReloadKey])

  if (!open) {
    return null
  }

  const updateDraft = (patch: Partial<RealTableSpotInput>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors([])
    setSaveStatus('idle')
    setSaveError('')
    setLastSavedHandId(null)
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

  const handlePressureActorChange = (profileId: string) => {
    updateDraft({
      pressureActorId: profileId,
      opponentIds: [profileId],
      limperCount: 0,
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
    const nextBoardIndex = board.findIndex((card, index) => index < boardCount && !card)
    if (draft.heroCards.every(Boolean) && nextBoardIndex >= 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => boardCardRefs[nextBoardIndex]?.current?.click())
      })
    }
  }

  const runAnalysis = () => {
    const result = analyzeRealTableSpot(draft, table.config, profilesById)
    setErrors(result.errors)
    if (result.analysis) {
      setAnalysis(result.analysis)
      setIsDirty(false)
      setSaveStatus('idle')
      setSaveError('')
      setLastSavedHandId(null)
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
    setSaveStatus('idle')
    setSaveError('')
    setLastSavedHandId(null)
    setActualAction('')
    setActualAmount('')
    setHeroNet('')
    setObservationNote('')
    requestAnimationFrame(() => firstCardRef.current?.focus())
  }

  const startNextRealHand = () => {
    resetRealHand()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => firstCardRef.current?.click())
    })
  }

  const toggleSavedHands = () => {
    const willOpen = !isSavedHandsOpen
    setIsSavedHandsOpen(willOpen)
    if (willOpen) {
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }))
    }
  }

  const resumeSavedHand = (hand: GtoHandRecord) => {
    const spot = structuredClone(hand.spot)
    const result = analyzeRealTableSpot(spot, table.config, profilesById)
    setDraft(spot)
    setAnalysis(result.analysis)
    setErrors(result.errors)
    setIsDirty(false)
    setActualAction(hand.actualAction ?? '')
    setActualAmount(hand.actualAmount === undefined ? '' : String(hand.actualAmount))
    setHeroNet(hand.heroNet === undefined ? '' : String(hand.heroNet))
    setObservationNote(hand.note)
    setLastSavedHandId(hand.id)
    setSaveStatus('success')
    setSaveError('')
    setIsSavedHandsOpen(false)
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }))
  }

  const deleteSavedHand = async (handId: string) => {
    if (deleteRequestInFlightRef.current !== null) {
      return
    }
    deleteRequestInFlightRef.current = handId
    setDeletingHandId(handId)
    setSavedHandsError('')

    try {
      const response = await fetch(`/api/gto-hands/${encodeURIComponent(handId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        throw new Error(await getResponseError(response, 'La main n’a pas pu être supprimée.'))
      }
      setSavedHands((current) => current.filter((hand) => hand.id !== handId))
      setSavedHandCount((current) => Math.max(0, current - 1))
      if (lastSavedHandId === handId) {
        setLastSavedHandId(null)
        setSaveStatus('idle')
      }
    } catch (error: unknown) {
      setSavedHandsError(error instanceof Error ? error.message : 'La main n’a pas pu être supprimée.')
    } finally {
      deleteRequestInFlightRef.current = null
      setDeletingHandId(null)
    }
  }

  const saveAnalyzedHand = async (): Promise<boolean> => {
    if (!analysis || isDirty || saveStatus === 'success' || saveRequestInFlightRef.current) {
      return false
    }

    const parsedActualAmount = parseOptionalInteger(actualAmount)
    const parsedHeroNet = parseOptionalInteger(heroNet)
    if (parsedActualAmount === null || (parsedActualAmount !== undefined && parsedActualAmount < 0)) {
      setSaveStatus('error')
      setSaveError('Le montant joué doit être un nombre entier positif.')
      return false
    }
    if (parsedHeroNet === null) {
      setSaveStatus('error')
      setSaveError('Le gain ou la perte doit être un nombre entier, par exemple -12000 ou 8000.')
      return false
    }

    const observation: GtoHandObservationInput = {
      ...(actualAction ? { actualAction } : {}),
      ...(parsedActualAmount === undefined ? {} : { actualAmount: parsedActualAmount }),
      ...(parsedHeroNet === undefined ? {} : { heroNet: parsedHeroNet }),
      ...(observationNote.trim() ? { note: observationNote.trim() } : {}),
    }

    saveRequestInFlightRef.current = true
    setSaveStatus('saving')
    setSaveError('')

    try {
      const response = await fetch('/api/gto-hands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: serializeCreateGtoHandRequest(analysis.input, observation),
      })
      if (!response.ok) {
        throw new Error(await getResponseError(response, 'La main n’a pas pu être enregistrée.'))
      }
      const payload = await response.json() as GtoHandResponse
      if (!payload.hand?.id) {
        throw new Error('La sauvegarde reçue est incomplète.')
      }
      const alreadyPresent = savedHands.some((hand) => hand.id === payload.hand.id)
      setSavedHands((current) => [payload.hand, ...current.filter((hand) => hand.id !== payload.hand.id)])
      if (!alreadyPresent) {
        setSavedHandCount((current) => current + 1)
      }
      setLastSavedHandId(payload.hand.id)
      setSaveStatus('success')
      setSavedHandsStatus('ready')
      return true
    } catch (error: unknown) {
      setSaveStatus('error')
      setSaveError(error instanceof Error ? error.message : 'La main n’a pas pu être enregistrée.')
      return false
    } finally {
      saveRequestInFlightRef.current = false
    }
  }

  const saveAndStartNext = async () => {
    if (await saveAnalyzedHand()) {
      startNextRealHand()
    }
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
            <button
              type="button"
              className={`real-gto-memory-toggle ${isSavedHandsOpen ? 'is-active' : ''}`}
              aria-expanded={isSavedHandsOpen}
              onClick={toggleSavedHands}
            >
              Mains enregistrées <strong>{savedHandsStatus === 'loading' ? '…' : savedHandCount}</strong>
            </button>
            <button type="button" className="real-gto-new-hand" onClick={startNextRealHand}>Nouvelle main</button>
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
                <CardPicker id="real-hero-card-1" label="Carte 1" value={draft.heroCards[0]} usedCards={usedCards} inputRef={firstCardRef} nextInputRef={secondCardRef} initiallyOpen={openFirstCardPicker} onChange={(value) => updateCard('hero', 0, value)} />
                <CardPicker id="real-hero-card-2" label="Carte 2" value={draft.heroCards[1]} usedCards={usedCards} inputRef={secondCardRef} nextInputRef={requiredBoardCount > 0 ? boardCard1Ref : undefined} onChange={(value) => updateCard('hero', 1, value)} />
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
                    <CardPicker
                      key={index}
                      id={`real-board-card-${index + 1}`}
                      label={`Board ${index + 1}`}
                      value={draft.board[index]}
                      usedCards={usedCards}
                      inputRef={boardCardRefs[index]}
                      nextInputRef={index + 1 < requiredBoardCount ? boardCardRefs[index + 1] : undefined}
                      onChange={(value) => updateCard('board', index, value)}
                    />
                  ))}
                </div>
              ) : null}
            </fieldset>

            <fieldset className="real-gto-fieldset">
              <legend>2. Situation</legend>
              <div className="real-gto-input-grid">
                <label>
                  <span>Pot actuel</span>
                  <input type="number" inputMode="numeric" min="0" step="100" value={draft.pot} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateDraft({ pot: Number(event.target.value) })} />
                </label>
                <label>
                  <span>À payer</span>
                  <input type="number" inputMode="numeric" min="0" step="100" value={draft.toCall} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateDraft({ toCall: Number(event.target.value) })} />
                </label>
                <label>
                  <span>Ton stack restant</span>
                  <input type="number" inputMode="numeric" min="1" step="500" value={draft.heroStack} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateDraft({ heroStack: Number(event.target.value) })} />
                </label>
                <label>
                  <span>Stack adverse effectif</span>
                  <input type="number" inputMode="numeric" min="1" step="500" value={draft.opponentStack} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateDraft({ opponentStack: Number(event.target.value) })} />
                </label>
                <label>
                  <span>Ta position</span>
                  <select value={draft.position} onChange={(event) => updateDraft({ position: event.target.value as RealTablePosition })}>
                    {(Object.keys(POSITION_LABELS) as RealTablePosition[]).map((position) => <option key={position} value={position}>{POSITION_LABELS[position]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Limpers avant toi</span>
                  <input type="number" inputMode="numeric" min="0" max={Math.max(0, draft.opponentIds.length - (draft.pressureType === 'none' ? 0 : 1))} step="1" value={draft.limperCount} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateDraft({ limperCount: Number(event.target.value) })} />
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
                  <select value={draft.pressureActorId} disabled={draft.pressureType === 'none'} onChange={(event) => handlePressureActorChange(event.target.value)}>
                    {availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}
                  </select>
                </label>
              </div>
              {draft.pressureType !== 'none' && draft.pressureActorId ? (
                <p className="real-gto-opponent-mode" aria-live="polite">
                  {draft.opponentIds.length === 1
                    ? `Calcul en tête-à-tête contre ${profilesById[draft.pressureActorId]?.displayName ?? draft.pressureActorId}.`
                    : `Calcul multiway contre ${draft.opponentIds.length} adversaires. Décoche ceux qui ne sont plus dans le coup.`}
                </p>
              ) : null}
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

            <button type="button" className="real-gto-analyze" onClick={runAnalysis}>Analyser ma main</button>
          </form>

          <main ref={resultRef} className="real-gto-result">
            {isSavedHandsOpen ? (
              <section className="real-gto-saved-panel" aria-labelledby="real-gto-saved-title">
                <div className="real-gto-section-heading real-gto-saved-heading">
                  <div>
                    <span>Mémoire</span>
                    <h3 id="real-gto-saved-title">Mains enregistrées</h3>
                  </div>
                  <p>{savedHandCount} main{savedHandCount > 1 ? 's' : ''} conservée{savedHandCount > 1 ? 's' : ''}</p>
                </div>

                {savedHandsError ? <p className="real-gto-saved-error" role="alert">{savedHandsError}</p> : null}

                {savedHandsStatus === 'loading' ? (
                  <div className="real-gto-saved-state" aria-live="polite">Chargement des mains…</div>
                ) : null}

                {savedHandsStatus === 'error' ? (
                  <div className="real-gto-saved-state">
                    <button type="button" onClick={() => setSavedHandsReloadKey((value) => value + 1)}>Réessayer</button>
                  </div>
                ) : null}

                {savedHandsStatus === 'ready' && savedHands.length === 0 ? (
                  <div className="real-gto-saved-state">
                    <strong>Aucune main pour le moment.</strong>
                    <span>Analyse un spot puis utilise « Enregistrer cette main ».</span>
                  </div>
                ) : null}

                {savedHands.length > 0 ? (
                  <div className="real-gto-saved-list">
                    {savedHands.map((hand) => (
                      <article className="real-gto-saved-row" key={hand.id}>
                        <div className="real-gto-saved-cards" aria-label={`Cartes ${hand.spot.heroCards.map(formatCardCode).join(' ')}`}>
                          {hand.spot.heroCards.map((card) => <span key={card || 'empty'}>{formatCardCode(card)}</span>)}
                        </div>
                        <div className="real-gto-saved-summary">
                          <div>
                            <strong>{STREET_LABELS[hand.spot.street]} · {getActionText(hand.adapted)}</strong>
                            <time dateTime={hand.createdAt}>{formatSavedDate(hand.createdAt)}</time>
                          </div>
                          <small>
                            Pot {formatAmount(hand.spot.pot)}
                            {hand.actualAction ? ` · joué ${ACTION_LABELS[hand.actualAction]}` : ''}
                            {hand.heroNet === undefined ? '' : ` · net ${hand.heroNet >= 0 ? '+' : ''}${formatAmount(hand.heroNet)}`}
                          </small>
                          {hand.note ? <p>{hand.note}</p> : null}
                        </div>
                        <div className="real-gto-saved-actions">
                          <button type="button" className="is-resume" onClick={() => resumeSavedHand(hand)}>Reprendre</button>
                          <button
                            type="button"
                            className="is-delete"
                            disabled={deletingHandId !== null}
                            aria-label={`Supprimer la main ${hand.spot.heroCards.map(formatCardCode).join(' ')}`}
                            onClick={() => void deleteSavedHand(hand.id)}
                          >
                            {deletingHandId === hand.id ? '…' : 'Supprimer'}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
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
                      <span className="real-gto-opponent-count">
                        {analysis.input.opponentIds.length === 1
                          ? `Calculé contre ${profilesById[analysis.input.opponentIds[0]]?.displayName ?? analysis.input.opponentIds[0]} uniquement`
                          : `Calculé contre ${analysis.input.opponentIds.length} adversaires encore dans le coup`}
                      </span>
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
                  <div className="real-gto-quick-save">
                    <button
                      type="button"
                      disabled={isDirty || saveStatus === 'saving' || saveStatus === 'success'}
                      onClick={() => void saveAndStartNext()}
                    >
                      {saveStatus === 'saving' ? 'Enregistrement…' : 'Enregistrer + main suivante'}
                    </button>
                    {saveStatus === 'error'
                      ? <small className="is-error" role="alert">{saveError}</small>
                      : <small>Un appui suffit. Résultat et note restent facultatifs.</small>}
                  </div>
                  {isDirty ? <p className="real-gto-dirty">Données modifiées — relance l’analyse pour mettre le conseil à jour.</p> : null}
                </section>

                <details className="real-gto-memory">
                  <summary className="real-gto-memory-summary">
                    <span>
                      <strong>Ajouter le résultat ou une note</strong>
                      <small>Action jouée, gain ou lecture du coup</small>
                    </span>
                    <em>Ouvrir si besoin</em>
                  </summary>

                  <div className="real-gto-memory-content">

                    <div className="real-gto-memory-grid">
                      <label>
                        <span>Action réellement jouée</span>
                        <select
                          value={actualAction}
                          disabled={isDirty || saveStatus === 'saving' || saveStatus === 'success'}
                          onChange={(event) => {
                            setActualAction(event.target.value as HeroAdviceAction | '')
                            setSaveStatus('idle')
                            setSaveError('')
                          }}
                        >
                          <option value="">Non renseignée</option>
                          {HERO_ADVICE_ACTIONS.map((action) => <option key={action} value={action}>{ACTION_LABELS[action]}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Montant réellement joué</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="100"
                          placeholder="Facultatif"
                          value={actualAmount}
                          disabled={isDirty || saveStatus === 'saving' || saveStatus === 'success'}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => {
                            setActualAmount(event.target.value)
                            setSaveStatus('idle')
                            setSaveError('')
                          }}
                        />
                      </label>
                      <label>
                        <span>Gain / perte net</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          step="100"
                          placeholder="Ex. -12000 ou 8000"
                          value={heroNet}
                          disabled={isDirty || saveStatus === 'saving' || saveStatus === 'success'}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => {
                            setHeroNet(event.target.value)
                            setSaveStatus('idle')
                            setSaveError('')
                          }}
                        />
                      </label>
                      <label className="real-gto-memory-note">
                        <span>Note</span>
                        <textarea
                          rows={2}
                          maxLength={2000}
                          placeholder="Lecture, showdown, détail à retenir…"
                          value={observationNote}
                          disabled={isDirty || saveStatus === 'saving' || saveStatus === 'success'}
                          onChange={(event) => {
                            setObservationNote(event.target.value)
                            setSaveStatus('idle')
                            setSaveError('')
                          }}
                        />
                      </label>
                    </div>

                    {saveStatus === 'error' ? <p className="real-gto-memory-error" role="alert">{saveError}</p> : null}
                    {isDirty ? <p className="real-gto-memory-hint">Relance l’analyse avant d’enregistrer ce spot modifié.</p> : null}

                    <div className="real-gto-memory-footer">
                      <small>Les détails saisis seront associés à cette main.</small>
                      <button
                        type="button"
                        disabled={isDirty || saveStatus === 'saving' || saveStatus === 'success'}
                        onClick={() => void saveAndStartNext()}
                      >
                        {saveStatus === 'saving' ? 'Enregistrement…' : 'Enregistrer + main suivante'}
                      </button>
                    </div>
                  </div>
                </details>

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
                <button type="button" onClick={() => firstCardRef.current?.click()}>Saisir le coup</button>
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
