import { describe, expect, it } from 'vitest'

import { botProfiles } from '../config/botProfiles'
import { tableConfig } from '../config/tableConfig'

describe('config loading', () => {
  it('loads the central table config with required fields', () => {
    expect(tableConfig.variant).toBe('texas-holdem-no-limit')
    expect(tableConfig.maxSeats).toBeGreaterThanOrEqual(2)
    expect(tableConfig.rake).toBe(0)
    expect(tableConfig.currencyLabel).toBe('MGA')
    expect(tableConfig.rebuy.specialRebuyAmount).toBe(40_000)
  })

  it('loads distinct bot profiles', () => {
    const ids = new Set(botProfiles.map((profile) => profile.id))
    expect(ids.size).toBe(botProfiles.length)
    expect(botProfiles.every((profile) => profile.displayName.length > 0)).toBe(true)
  })
})
