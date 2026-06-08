import { botProfiles } from '../config/botProfiles'
import type { TableConfig } from '../config/schema'
import { tableConfig } from '../config/tableConfig'

export function makeConfig(overrides: Partial<TableConfig> = {}): TableConfig {
  return {
    ...structuredClone(tableConfig),
    tableName: 'Test table',
    mode: 'cash',
    maxSeats: overrides.maxSeats ?? 3,
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    startingStack: 200,
    buyInDefault: 200,
    includeHero: true,
    heroDisplayName: 'Hero',
    blindSchedule: [
      {
        level: 1,
        smallBlind: 10,
        bigBlind: 20,
        ante: 0,
        durationMinutes: 20,
      },
    ],
    rebuy: {
      enabled: true,
      defaultAmount: 200,
      specialRebuyAmount: 400,
      availabilityRule: 'configurable',
      notes: 'TODO_MATCH_REAL_TABLE',
      policy: 'auto-when-busted',
    },
    ...overrides,
  }
}

export function getTestProfiles(count: number) {
  return botProfiles.slice(0, count)
}
