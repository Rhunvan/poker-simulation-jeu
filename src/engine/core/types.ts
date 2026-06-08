import type { BotProfile, TableConfig } from '../../config/schema'

export type Suit = 'c' | 'd' | 'h' | 's'

export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A'

export type CardCode = `${Rank}${Suit}`

export interface Card {
  rank: Rank
  suit: Suit
  code: CardCode
}

export type BettingStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export type PlayerKind = 'human' | 'bot'

export type ActionKind =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'all-in'
  | 'post-ante'
  | 'post-small-blind'
  | 'post-big-blind'
  | 'collect'
  | 'showdown'

export interface PlayerMemoryEvent {
  type:
    | 'won-big'
    | 'lost-big'
    | 'bad-beat'
    | 'hot-streak'
    | 'cold-streak'
    | 'bluffed-off'
  handNumber: number
  intensity: number
  targetPlayerId?: string
}

export interface PlayerMemory {
  tilt: number
  caution: number
  confidence: number
  revengeTargetId: string | null
  consecutiveLosses: number
  consecutiveWins: number
  recentEvents: PlayerMemoryEvent[]
}

export interface PlayerLastAction {
  kind: ActionKind
  amount: number
  label: string
  street: BettingStreet
}

export interface TablePlayer {
  id: string
  seatIndex: number
  kind: PlayerKind
  displayName: string
  stack: number
  startingStack: number
  holeCards: Card[]
  hasFolded: boolean
  isAllIn: boolean
  isSittingOut: boolean
  currentBet: number
  totalCommitted: number
  totalWonThisHand: number
  hasActedThisRound: boolean
  lastFullRaiseSeen: number
  lastAction: PlayerLastAction | null
  cardsVisible: boolean
  rebuys: number
  botProfileId?: string
  tableTalk: string | null
  memory: PlayerMemory
}

export interface HandHistoryEntry {
  id: number
  handNumber: number
  street: BettingStreet | 'meta'
  text: string
  actorId?: string
  amount?: number
}

export interface Pot {
  id: string
  label: string
  amount: number
  eligiblePlayerIds: string[]
  contributorIds: string[]
}

export interface EvaluatedShowdownHand {
  playerId: string
  description: string
  category: string
  rank: number
  cards: string[]
}

export interface PotAward {
  potId: string
  label: string
  amount: number
  winnerIds: string[]
  share: number
  oddChipWinnerIds?: string[]
}

export interface ShowdownResult {
  hands: EvaluatedShowdownHand[]
  awards: PotAward[]
}

export interface HandSummaryWinner {
  playerId: string
  amount: number
  category: string
  description: string
  wonUncontested: boolean
}

export interface HandSummaryShownHand {
  playerId: string
  category: string
  description: string
  holeCards: CardCode[]
}

export interface HandSummaryPlayerResult {
  playerId: string
  participated: boolean
  committed: number
  wonAmount: number
  net: number
}

export interface HandSummary {
  handNumber: number
  showdown: boolean
  endedAtSessionMs: number
  potAmount: number
  board: CardCode[]
  winners: HandSummaryWinner[]
  shownHands?: HandSummaryShownHand[]
  playerResults: HandSummaryPlayerResult[]
}

export interface SessionStats {
  playerId: string
  handsCompleted: number
  handsEntered: number
  handsWon: number
  grossWon: number
  grossLost: number
  netResult: number
  biggestWin: number
  biggestLoss: number
  currentStack: number
  initialBuyIn: number
  totalInvested: number
  rebuys: number
  rebuyAmount: number
}

export interface TableState {
  config: TableConfig
  players: TablePlayer[]
  handNumber: number
  dealerSeatIndex: number
  smallBlindSeatIndex: number
  bigBlindSeatIndex: number
  currentActorId: string | null
  deck: Card[]
  board: Card[]
  street: BettingStreet
  currentBet: number
  lastFullRaiseSize: number
  fullRaiseCounter: number
  pots: Pot[]
  history: HandHistoryEntry[]
  showdown: ShowdownResult | null
  handSummaries: HandSummary[]
  currentLevelIndex: number
  sessionStartedAt: number
  sessionElapsedMs: number
  handInProgress: boolean
  seed: number
  nextHistoryId: number
  lastWinnerIds: string[]
}

export interface LegalActionOption {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'
  label: string
  amount?: number
  minTotal?: number
  maxTotal?: number
}

export interface LegalActionState {
  actorId: string
  toCall: number
  canRaise: boolean
  minRaiseTo: number | null
  maxRaiseTo: number | null
  options: LegalActionOption[]
}

export type PlayerCommand =
  | { kind: 'fold' | 'check' | 'call' }
  | { kind: 'bet' | 'raise'; total: number }
  | { kind: 'all-in' }

export interface BotDecision {
  command: PlayerCommand
  reason: string
  tableTalk?: string
  telemetry?: DecisionTelemetry
}

export interface DecisionContext {
  state: TableState
  player: TablePlayer
  profile: BotProfile
  legalActions: LegalActionState
  activePlayers: TablePlayer[]
  potTotal: number
  playersStillInHand: TablePlayer[]
}

export interface DecisionTelemetry {
  tags: string[]
  sizingBb?: number
  sizingPot?: number
  isLimp?: boolean
  isOverlimp?: boolean
  isOpenRaise?: boolean
  isColdCall?: boolean
  isThreeBet?: boolean
  isFourBet?: boolean
  isPreflopJam?: boolean
  isSuppressedJam?: boolean
  isCbet?: boolean
  isBarrel?: boolean
  isBluff?: boolean
  isHeroCallOpportunity?: boolean
  isHeroCall?: boolean
  isOverbet?: boolean
}
