export type NumericRange = [number, number]

export type PokerVariant = 'texas-holdem-no-limit'

export type GameMode = 'cash' | 'tournament'

export interface BlindLevel {
  level: number
  smallBlind: number
  bigBlind: number
  ante: number
  durationMinutes: number
}

export interface ActionDelayConfig {
  min: number
  max: number
}

export interface TableRebuyConfig {
  enabled: boolean
  defaultAmount: number
  maxStackFraction: number
  availabilityRule: 'half-max-stack'
  notes: string
  policy: 'auto-when-busted' | 'manual'
}

export interface TableStraddleConfig {
  enabled: boolean
  amount: number
  label: string
}

export interface TableRules {
  tableName: string
  variant: PokerVariant
  mode: GameMode
  maxSeats: number
  smallBlind: number
  bigBlind: number
  ante: number
  startingStack: number
  buyInDefault: number
  currencyLabel: string
  rake: number
  botActionDelayMs: ActionDelayConfig
  heroSeatIndex: number
  heroDisplayName: string
  includeHero: boolean
  fixedSeatOrder?: string[]
  oddChipRule: 'first-left-of-dealer'
  blindProgression: 'static' | 'elapsed'
  blindSchedule?: BlindLevel[]
  straddle?: TableStraddleConfig
  rebuy: TableRebuyConfig
}

export type PopulationDescriptor =
  | 'very_low'
  | 'low'
  | 'low_to_medium_unbalanced'
  | 'medium'
  | 'elevated'
  | 'high'
  | 'rare'

export interface TablePopulation {
  description: string
  averageLimpRate: PopulationDescriptor
  averageColdCallRate: PopulationDescriptor
  averageOpenSizeBb: number[]
  rareOversizeOpenBb: number[]
  threeBetEnvironment: PopulationDescriptor
  fourBetEnvironment: PopulationDescriptor
  preflopJamSuppressionAboveBb: number
  riverBluffPopulation: PopulationDescriptor
  showdownCuriosityPopulation: PopulationDescriptor
  stickyPlayersExist: boolean
  scaredMoneyPlayersExist: boolean
  irrationalAggroPlayersExist: boolean
  limpCallCulture: 'normalized' | 'rare' | 'penalized'
  oversizedNonJamRaisesPreferred: boolean
  curiosityCombos: string[]
}

export type PlayerSizingStyle =
  | 'passif_irrationnel'
  | 'volatile_aggressif'
  | 'random_passif'
  | 'face_up_serre'
  | 'standard_plus_propre'
  | 'pression_propre'
  | 'overbet_heavy_kamikaze'
  | 'serre_biaise'
  | 'scared_money'

export type EmotionalLevel = 'low' | 'medium' | 'high'

export interface PlayerEmotionalProfile {
  tiltSensitivity?: EmotionalLevel
  revengeFactor?: EmotionalLevel
  boredomLeak?: EmotionalLevel
  riskAversion?: EmotionalLevel
}

export interface PlayerTargetStats {
  vpip: NumericRange
  pfr: NumericRange
  limp: NumericRange
  coldCall: NumericRange
  threeBet: NumericRange
  fourBet: NumericRange
  cbetFlop: NumericRange
  cbetTurn: NumericRange
  cbetRiver: NumericRange
  bluff: NumericRange
  heroCall: NumericRange
  overbet: NumericRange
  preflopJamAbove35bb: NumericRange
}

export interface PlayerQuirks {
  optimisticFoldEquity?: boolean
  irrationalCalls?: boolean
  valueHeavyRaises?: boolean
  cleanPressure?: boolean
  kamikazeBursts?: boolean
  showdownCurious?: boolean
  scaredMoney?: boolean
  favoriteHands?: string[]
  favoriteHandsNotes?: string
  stickyPairs?: boolean
}

export interface PlayerProfile {
  id: string
  displayName: string
  archetype: string
  summary: string
  targetStats: PlayerTargetStats
  emotionalProfile?: PlayerEmotionalProfile
  sizingStyle: PlayerSizingStyle
  specificRules: string[]
  quirks?: PlayerQuirks
  tableTalkStyle?: 'quiet' | 'relaxed' | 'taunting' | 'calm' | 'reactive'
  decisionTempoMultiplier?: number
}

export type TableConfig = TableRules
export type BotProfile = PlayerProfile
export type BetSizingStyle = PlayerSizingStyle
