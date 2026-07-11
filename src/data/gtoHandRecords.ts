import type { BotProfile, TableConfig } from '../config/schema'
import type { HeroAdvice, HeroAdviceAction } from '../engine/advisor/heroAdvisor'
import type {
  RealTablePosition,
  RealTablePressure,
  RealTableSpotInput,
  RealTableStreet,
} from '../engine/advisor/realTableAdvisor'
import type { CardCode } from '../engine/core/types'

export const GTO_HAND_RECORD_SCHEMA_VERSION = 1
export const GTO_ADVISOR_VERSION = 'real-table-v1'

const REAL_TABLE_STREETS: RealTableStreet[] = ['preflop', 'flop', 'turn', 'river']
const REAL_TABLE_POSITIONS: RealTablePosition[] = [
  'early',
  'middle',
  'cutoff',
  'button',
  'small-blind',
  'big-blind',
]
const REAL_TABLE_PRESSURES: RealTablePressure[] = ['none', 'option', 'bet', 'raise', 'all-in']
const HERO_ACTIONS: HeroAdviceAction[] = ['fold', 'check', 'call', 'bet', 'raise', 'all-in']
const CARD_CODE_PATTERN = /^(?:[2-9TJQKA])[shdc]$/
const MAX_AMOUNT = 1_000_000_000
const MAX_NOTE_LENGTH = 2_000

export interface GtoAdviceSnapshot {
  recommendedAction: HeroAdviceAction
  suggestedTotal?: number
  equity: number
  potOdds: number
  effectiveStackBb: number
  confidence: HeroAdvice['confidence']
  actionMix: Partial<Record<HeroAdviceAction, number>>
  reasons: string[]
}

export interface GtoTableContextSnapshot {
  smallBlind: number
  bigBlind: number
  ante: number
  startingStack: number
  straddle: {
    enabled: boolean
    amount: number
    label: string
  } | null
}

export interface GtoProfileSnapshot {
  id: string
  displayName: string
  archetype: string
  targetStats: BotProfile['targetStats']
}

export interface GtoHandRecord {
  id: string
  createdAt: string
  schemaVersion: number
  advisorVersion: string
  spot: RealTableSpotInput
  theoretical: GtoAdviceSnapshot
  adapted: GtoAdviceSnapshot
  tableContext: GtoTableContextSnapshot
  profiles: GtoProfileSnapshot[]
  actualAction?: HeroAdviceAction
  actualAmount?: number
  heroNet?: number
  note: string
}

export interface GtoHandObservationInput {
  actualAction?: HeroAdviceAction
  actualAmount?: number
  heroNet?: number
  note?: string
}

export interface CreateGtoHandRequest extends GtoHandObservationInput {
  spot: RealTableSpotInput
}

export interface GtoHandListResponse {
  hands: GtoHandRecord[]
  count: number
}

export interface GtoHandResponse {
  hand: GtoHandRecord
}

export type CreateGtoHandParseResult =
  | { ok: true; value: CreateGtoHandRequest }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteAmount(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= MAX_AMOUNT
}

function isFiniteChipAmount(value: unknown, minimum: number): value is number {
  return isFiniteAmount(value, minimum) && Number.isInteger(value)
}

function isCardOrEmpty(value: unknown): value is CardCode | '' {
  return value === '' || (typeof value === 'string' && CARD_CODE_PATTERN.test(value))
}

function isStringArray(value: unknown, maximumLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumLength &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 80)
  )
}

function parseSpot(value: unknown): RealTableSpotInput | null {
  if (!isRecord(value)) {
    return null
  }

  const heroCards = value.heroCards
  const board = value.board
  const opponentIds = value.opponentIds
  if (
    !Array.isArray(heroCards) ||
    heroCards.length !== 2 ||
    !heroCards.every(isCardOrEmpty) ||
    !Array.isArray(board) ||
    board.length !== 5 ||
    !board.every(isCardOrEmpty) ||
    !isStringArray(opponentIds, 9)
  ) {
    return null
  }

  if (
    typeof value.street !== 'string' ||
    !REAL_TABLE_STREETS.includes(value.street as RealTableStreet) ||
    typeof value.position !== 'string' ||
    !REAL_TABLE_POSITIONS.includes(value.position as RealTablePosition) ||
    typeof value.pressureType !== 'string' ||
    !REAL_TABLE_PRESSURES.includes(value.pressureType as RealTablePressure) ||
    typeof value.pressureActorId !== 'string' ||
    value.pressureActorId.length > 80 ||
    !isFiniteAmount(value.pot) ||
    !isFiniteAmount(value.toCall) ||
    !isFiniteAmount(value.heroStack, 1) ||
    !isFiniteAmount(value.opponentStack, 1) ||
    typeof value.limperCount !== 'number' ||
    !Number.isInteger(value.limperCount) ||
    value.limperCount < 0 ||
    value.limperCount > 9
  ) {
    return null
  }

  return {
    heroCards: [...heroCards] as RealTableSpotInput['heroCards'],
    board: [...board] as RealTableSpotInput['board'],
    street: value.street as RealTableStreet,
    position: value.position as RealTablePosition,
    pot: value.pot,
    toCall: value.toCall,
    heroStack: value.heroStack,
    opponentStack: value.opponentStack,
    opponentIds: [...opponentIds],
    pressureType: value.pressureType as RealTablePressure,
    pressureActorId: value.pressureActorId,
    limperCount: value.limperCount,
  }
}

export function parseCreateGtoHandRequest(value: unknown): CreateGtoHandParseResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'La main envoyée est invalide.' }
  }

  const spot = parseSpot(value.spot)
  if (!spot) {
    return { ok: false, error: 'Les données du spot sont incomplètes ou invalides.' }
  }

  if (value.note !== undefined && typeof value.note !== 'string') {
    return { ok: false, error: 'La note doit être du texte.' }
  }
  const note = typeof value.note === 'string' ? value.note.trim() : undefined
  if (note && note.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `La note ne peut pas dépasser ${MAX_NOTE_LENGTH} caractères.` }
  }

  if (
    value.actualAction !== undefined &&
    (typeof value.actualAction !== 'string' || !HERO_ACTIONS.includes(value.actualAction as HeroAdviceAction))
  ) {
    return { ok: false, error: 'L’action réellement jouée est invalide.' }
  }
  if (value.actualAmount !== undefined && !isFiniteChipAmount(value.actualAmount, 0)) {
    return { ok: false, error: 'Le montant réellement joué est invalide.' }
  }
  if (
    value.heroNet !== undefined &&
    (typeof value.heroNet !== 'number' ||
      !Number.isFinite(value.heroNet) ||
      !Number.isInteger(value.heroNet) ||
      Math.abs(value.heroNet) > MAX_AMOUNT)
  ) {
    return { ok: false, error: 'Le résultat net de la main est invalide.' }
  }

  return {
    ok: true,
    value: {
      spot,
      ...(value.actualAction ? { actualAction: value.actualAction as HeroAdviceAction } : {}),
      ...(value.actualAmount === undefined ? {} : { actualAmount: value.actualAmount }),
      ...(value.heroNet === undefined ? {} : { heroNet: value.heroNet }),
      ...(note ? { note } : {}),
    },
  }
}

export function serializeCreateGtoHandRequest(
  spot: RealTableSpotInput,
  observation: GtoHandObservationInput | string = {},
): string {
  const normalizedObservation = typeof observation === 'string' ? { note: observation } : observation
  return JSON.stringify({
    spot,
    ...(normalizedObservation.actualAction ? { actualAction: normalizedObservation.actualAction } : {}),
    ...(normalizedObservation.actualAmount === undefined ? {} : { actualAmount: normalizedObservation.actualAmount }),
    ...(normalizedObservation.heroNet === undefined ? {} : { heroNet: normalizedObservation.heroNet }),
    ...(normalizedObservation.note?.trim() ? { note: normalizedObservation.note.trim() } : {}),
  } satisfies CreateGtoHandRequest)
}

export function toGtoAdviceSnapshot(advice: HeroAdvice): GtoAdviceSnapshot {
  const actionMix = Object.fromEntries(
    HERO_ACTIONS.flatMap((action) => {
      const percentage = advice.actionMix[action]
      return typeof percentage === 'number' && Number.isFinite(percentage) ? [[action, percentage]] : []
    }),
  ) as Partial<Record<HeroAdviceAction, number>>

  return {
    recommendedAction: advice.recommendedAction,
    ...(advice.suggestedTotal === undefined ? {} : { suggestedTotal: advice.suggestedTotal }),
    equity: advice.equity,
    potOdds: advice.potOdds,
    effectiveStackBb: advice.effectiveStackBb,
    confidence: advice.confidence,
    actionMix,
    reasons: [...advice.reasons],
  }
}

export function toGtoTableContextSnapshot(config: TableConfig): GtoTableContextSnapshot {
  return {
    smallBlind: config.smallBlind,
    bigBlind: config.bigBlind,
    ante: config.ante,
    startingStack: config.startingStack,
    straddle: config.straddle
      ? {
          enabled: config.straddle.enabled,
          amount: config.straddle.amount,
          label: config.straddle.label,
        }
      : null,
  }
}

export function toGtoProfileSnapshot(profile: BotProfile): GtoProfileSnapshot {
  return {
    id: profile.id,
    displayName: profile.displayName,
    archetype: profile.archetype,
    targetStats: structuredClone(profile.targetStats),
  }
}
