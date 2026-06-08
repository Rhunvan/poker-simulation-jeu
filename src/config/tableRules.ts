import type { TableRules } from './schema'

export const REAL_TABLE_RULES: TableRules = {
  tableName: 'Table privee cash game',
  variant: 'texas-holdem-no-limit',
  mode: 'cash',
  maxSeats: 9,
  smallBlind: 100,
  bigBlind: 200,
  ante: 0,
  startingStack: 20_000,
  buyInDefault: 20_000,
  currencyLabel: 'MGA',
  rake: 0,
  botActionDelayMs: {
    min: 600,
    max: 1_800,
  },
  heroSeatIndex: 0,
  heroDisplayName: 'Hero',
  includeHero: true,
  oddChipRule: 'first-left-of-dealer',
  blindProgression: 'static',
  rebuy: {
    enabled: true,
    defaultAmount: 20_000,
    specialRebuyAmount: 40_000,
    availabilityRule: 'configurable',
    notes: 'TODO_MATCH_REAL_TABLE',
    policy: 'auto-when-busted',
  },
}
