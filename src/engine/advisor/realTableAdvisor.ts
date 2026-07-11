import type { BotProfile, TableConfig } from '../../config/schema'
import { resetTableState } from '../PokerEngine'
import { createCard } from '../core/cards'
import type { BettingStreet, CardCode, LegalActionState, TablePlayer, TableState } from '../core/types'
import { getLegalActions } from '../rules/legalActions'
import { getHeroAdvice, type HeroAdvice } from './heroAdvisor'

export type RealTableStreet = Exclude<BettingStreet, 'showdown'>
export type RealTablePosition = 'early' | 'middle' | 'cutoff' | 'button' | 'small-blind' | 'big-blind'
export type RealTablePressure = 'none' | 'option' | 'bet' | 'raise' | 'all-in'

export interface RealTableSpotInput {
  heroCards: [CardCode | '', CardCode | '']
  board: [CardCode | '', CardCode | '', CardCode | '', CardCode | '', CardCode | '']
  street: RealTableStreet
  position: RealTablePosition
  pot: number
  toCall: number
  heroStack: number
  opponentStack: number
  opponentIds: string[]
  pressureType: RealTablePressure
  pressureActorId: string
  limperCount: number
}

export interface RealTableAnalysis {
  state: TableState
  legal: LegalActionState
  theoretical: HeroAdvice
  adapted: HeroAdvice
  input: RealTableSpotInput
}

export interface RealTableAnalysisResult {
  analysis: RealTableAnalysis | null
  errors: string[]
}

export function getRequiredBoardCount(street: RealTableStreet): number {
  switch (street) {
    case 'preflop':
      return 0
    case 'flop':
      return 3
    case 'turn':
      return 4
    case 'river':
      return 5
  }
}

function uniqueKnownProfiles(
  opponentIds: string[],
  profilesById: Record<string, BotProfile>,
): BotProfile[] {
  return [...new Set(opponentIds)].flatMap((id) => {
    const profile = profilesById[id]
    return profile ? [profile] : []
  })
}

function getHeroSeat(position: RealTablePosition, seatCount: number): number {
  switch (position) {
    case 'small-blind':
      return 0
    case 'big-blind':
      return Math.min(1, seatCount - 1)
    case 'early':
      return Math.min(2, seatCount - 1)
    case 'middle':
      return Math.min(seatCount - 1, 2 + Math.floor(Math.max(0, seatCount - 4) / 2))
    case 'cutoff':
      return Math.max(0, seatCount - 2)
    case 'button':
      return seatCount - 1
  }
}

function assignSeats(state: TableState, position: RealTablePosition): void {
  const seatCount = state.players.length
  const hero = state.players.find((player) => player.id === 'hero')
  if (!hero) {
    return
  }

  const heroSeat = getHeroSeat(position, seatCount)
  const remainingSeats = Array.from({ length: seatCount }, (_, index) => index).filter((seat) => seat !== heroSeat)
  hero.seatIndex = heroSeat
  state.players
    .filter((player) => player.id !== hero.id)
    .forEach((player, index) => {
      player.seatIndex = remainingSeats[index] ?? index
    })
  state.players.sort((left, right) => left.seatIndex - right.seatIndex)
  state.dealerSeatIndex = Math.max(0, seatCount - 1)
  state.smallBlindSeatIndex = 0
  state.bigBlindSeatIndex = Math.min(1, seatCount - 1)
  state.config.heroSeatIndex = heroSeat
}

function configurePlayerForRealSpot(player: TablePlayer, heroStack: number, opponentStack: number): void {
  const stack = player.id === 'hero' ? heroStack : opponentStack
  player.stack = stack
  player.startingStack = stack
  player.holeCards = []
  player.hasFolded = false
  player.isAllIn = false
  player.isSittingOut = false
  player.currentBet = 0
  player.totalCommitted = 0
  player.totalWonThisHand = 0
  player.hasActedThisRound = player.id !== 'hero'
  player.lastFullRaiseSeen = 0
  player.lastAction = null
  player.cardsVisible = player.id === 'hero'
  player.tableTalk = null
}

function actionLabel(kind: RealTablePressure, amount: number): string {
  switch (kind) {
    case 'option':
      return `Option ${amount}`
    case 'bet':
      return `Mise ${amount}`
    case 'raise':
      return `Relance à ${amount}`
    case 'all-in':
      return `Tapis ${amount}`
    case 'none':
      return 'Aucune pression'
  }
}

function prepareState(
  input: RealTableSpotInput,
  config: TableConfig,
  profilesById: Record<string, BotProfile>,
): { state: TableState | null; errors: string[] } {
  const errors: string[] = []
  const profiles = uniqueKnownProfiles(input.opponentIds, profilesById)

  if (profiles.length !== new Set(input.opponentIds).size) {
    errors.push('Un des joueurs sélectionnés ne possède pas de profil connu.')
  }
  if (profiles.length === 0) {
    errors.push('Garde au moins un adversaire dans le coup.')
  }
  if (profiles.length > config.maxSeats - 1) {
    errors.push(`Cette table accepte au maximum ${config.maxSeats - 1} adversaires.`)
  }
  if (!Number.isFinite(input.heroStack) || input.heroStack <= 0) {
    errors.push('Ton stack doit être supérieur à zéro.')
  }
  if (!Number.isFinite(input.opponentStack) || input.opponentStack <= 0) {
    errors.push('Le stack adverse effectif doit être supérieur à zéro.')
  }
  if (!Number.isFinite(input.pot) || input.pot < 0) {
    errors.push('Le pot ne peut pas être négatif.')
  }
  if (!Number.isFinite(input.toCall) || input.toCall < 0) {
    errors.push('Le montant à payer ne peut pas être négatif.')
  } else if (input.toCall > input.heroStack) {
    errors.push('Le montant à payer ne peut pas dépasser ton stack.')
  }
  const maxLimpers = Math.max(0, profiles.length - (input.pressureType === 'none' ? 0 : 1))
  if (!Number.isInteger(input.limperCount) || input.limperCount < 0 || input.limperCount > maxLimpers) {
    errors.push('Le nombre de limpers est incohérent avec les joueurs encore dans le coup.')
  }
  if (input.street !== 'preflop' && input.pressureType === 'option') {
    errors.push('L’option ne peut être indiquée que préflop.')
  }
  if (input.pressureType !== 'none' && !input.opponentIds.includes(input.pressureActorId)) {
    errors.push('Choisis le joueur à l’origine de la dernière action.')
  }

  const requiredBoardCount = getRequiredBoardCount(input.street)
  const visibleBoard = input.board.slice(0, requiredBoardCount)
  if (input.heroCards.some((card) => card === '')) {
    errors.push('Ajoute tes deux cartes.')
  }
  if (visibleBoard.some((card) => card === '')) {
    errors.push(`Ajoute les ${requiredBoardCount} cartes du board pour cette street.`)
  }
  const knownCards = [...input.heroCards, ...visibleBoard].filter((card): card is CardCode => card !== '')
  if (new Set(knownCards).size !== knownCards.length) {
    errors.push('Une même carte ne peut apparaître deux fois.')
  }

  if (errors.length > 0) {
    return { state: null, errors }
  }

  const seatCount = profiles.length + 1
  const spotConfig: TableConfig = {
    ...structuredClone(config),
    tableName: 'GTO table réelle',
    maxSeats: seatCount,
    fixedSeatOrder: undefined,
    heroSeatIndex: 0,
    startingStack: Math.max(input.heroStack, input.opponentStack),
    buyInDefault: Math.max(input.heroStack, input.opponentStack),
  }
  const state = resetTableState(spotConfig, profiles, 20_260_711)
  assignSeats(state, input.position)
  state.handNumber = 1
  state.handInProgress = true
  state.currentActorId = 'hero'
  state.street = input.street
  state.board = visibleBoard.map((card) => createCard(card as CardCode))
  state.deck = []
  state.pots = []
  state.history = []
  state.handSummaries = []
  state.showdown = null
  state.lastWinnerIds = []
  state.fullRaiseCounter = input.pressureType === 'bet' || input.pressureType === 'raise' || input.pressureType === 'all-in' ? 1 : 0
  state.currentBet = input.toCall
  state.lastFullRaiseSize = Math.max(config.bigBlind, input.toCall)

  for (const player of state.players) {
    configurePlayerForRealSpot(player, input.heroStack, input.opponentStack)
  }

  const hero = state.players.find((player) => player.id === 'hero')
  if (!hero) {
    return { state: null, errors: ['Le siège Hero est introuvable.'] }
  }
  hero.holeCards = input.heroCards.map((card) => createCard(card as CardCode))

  const opponents = state.players.filter((player) => player.id !== hero.id)
  const pressureActor = opponents.find((player) => player.id === input.pressureActorId) ?? null
  if (pressureActor && input.pressureType !== 'none') {
    pressureActor.currentBet = input.toCall
    pressureActor.lastAction = {
      kind: input.pressureType === 'option' ? 'post-straddle' : input.pressureType,
      amount: input.toCall,
      label: actionLabel(input.pressureType, input.toCall),
      street: input.street,
    }
    if (input.pressureType === 'all-in') {
      pressureActor.isAllIn = true
      pressureActor.stack = 0
    }
  }

  const entryPrice = config.straddle?.enabled
    ? Math.max(config.bigBlind, config.straddle.amount)
    : config.bigBlind
  opponents
    .filter((player) => player.id !== pressureActor?.id)
    .slice(0, input.limperCount)
    .forEach((player) => {
      player.currentBet = Math.min(entryPrice, Math.max(entryPrice, input.toCall))
      player.lastAction = {
        kind: 'call',
        amount: player.currentBet,
        label: `Suit ${player.currentBet}`,
        street: input.street,
      }
    })

  const minimumPot = state.players.reduce((sum, player) => sum + player.currentBet, 0)
  if (input.pot < minimumPot) {
    return {
      state: null,
      errors: [`Le pot doit être au moins de ${minimumPot.toLocaleString('fr-FR')} pour couvrir les mises indiquées.`],
    }
  }

  const extraPot = input.pot - minimumPot
  const baseExtra = Math.floor(extraPot / state.players.length)
  let allocatedExtra = 0
  state.players.forEach((player, index) => {
    const extra = index === state.players.length - 1 ? extraPot - allocatedExtra : baseExtra
    player.totalCommitted = player.currentBet + extra
    allocatedExtra += extra
    player.lastFullRaiseSeen = player.id === hero.id ? 0 : state.fullRaiseCounter
  })

  return { state, errors: [] }
}

export function analyzeRealTableSpot(
  input: RealTableSpotInput,
  config: TableConfig,
  profilesById: Record<string, BotProfile>,
): RealTableAnalysisResult {
  const prepared = prepareState(input, config, profilesById)
  if (!prepared.state) {
    return { analysis: null, errors: prepared.errors }
  }

  const legal = getLegalActions(prepared.state, 'hero')
  const theoretical = getHeroAdvice(prepared.state, {}, 'hero')
  const adapted = getHeroAdvice(prepared.state, profilesById, 'hero')
  if (!legal || !theoretical || !adapted) {
    return {
      analysis: null,
      errors: ['Le spot est incomplet ou ne produit aucune décision légale.'],
    }
  }

  return {
    analysis: {
      state: prepared.state,
      legal,
      theoretical,
      adapted,
      input: structuredClone(input),
    },
    errors: [],
  }
}
