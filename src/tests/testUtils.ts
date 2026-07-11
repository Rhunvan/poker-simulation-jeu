import { botProfiles } from '../config/botProfiles'
import type { TableConfig } from '../config/schema'
import { tableConfig } from '../config/tableConfig'

export function makeConfig(overrides: Partial<TableConfig> = {}): TableConfig {
  return {
    ...structuredClone(tableConfig),
    tableName: 'Test table',
    mode: 'cash',
    maxSeats: overrides.maxSeats ?? 3,
    fixedSeatOrder: undefined,
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    straddle: {
      enabled: false,
      amount: 0,
      label: 'Option',
    },
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
      maxStackFraction: 0.5,
      availabilityRule: 'half-max-stack',
      notes: 'Test half-max-stack rule',
      policy: 'auto-when-busted',
    },
    ...overrides,
  }
}

export function getTestProfiles(count: number) {
  return botProfiles.slice(0, count)
}
