import { describe, expect, it } from 'vitest'

import { AFTERNOON_2026_07_11_PROFILE_IDS, botProfiles } from '../config/botProfiles'
import { tableConfig } from '../config/tableConfig'

describe('config loading', () => {
  it('loads the central table config with required fields', () => {
    expect(tableConfig.variant).toBe('texas-holdem-no-limit')
    expect(tableConfig.maxSeats).toBeGreaterThanOrEqual(2)
    expect(tableConfig.rake).toBe(0)
    expect(tableConfig.currencyLabel).toBe('MGA')
    expect(tableConfig.smallBlind).toBe(500)
    expect(tableConfig.bigBlind).toBe(1_000)
    expect(tableConfig.maxSeats).toBe(10)
    expect(tableConfig.fixedSeatOrder).toEqual([
      'hero',
      'eric_b',
      'pierre',
      'david',
      'guillaume',
      'bruno',
      'pascal_2',
      'fabrice',
      'philippe',
      'gerard',
    ])
    expect(tableConfig.startingStack).toBe(40_000)
    expect(tableConfig.buyInDefault).toBe(40_000)
    expect(tableConfig.straddle).toMatchObject({ enabled: false, amount: 2_000, label: 'Option' })
    expect(tableConfig.rebuy).toMatchObject({
      defaultAmount: 40_000,
      maxStackFraction: 0.5,
      availabilityRule: 'half-max-stack',
    })
  })

  it('loads distinct bot profiles', () => {
    const ids = new Set(botProfiles.map((profile) => profile.id))
    expect(ids.size).toBe(botProfiles.length)
    expect([...ids]).toEqual([
      'eric_b',
      'gilles',
      'pierre',
      'david',
      'guillaume',
      'bruno',
      'pascal_2',
      'fabrice',
      'philippe',
      'gerard',
    ])
    expect(botProfiles.every((profile) => profile.displayName.length > 0)).toBe(true)
    expect([...AFTERNOON_2026_07_11_PROFILE_IDS]).toEqual([
      'gilles',
      'eric_b',
      'david',
      'philippe',
      'gerard',
      'pierre',
      'fabrice',
    ])

    const philippe = botProfiles.find((profile) => profile.id === 'philippe')
    const gerard = botProfiles.find((profile) => profile.id === 'gerard')
    const jesus = botProfiles.find((profile) => profile.id === 'gilles')
    expect(jesus?.displayName).toBe('Jésus')
    expect(philippe?.targetStats.vpip[1]).toBeLessThanOrEqual(17)
    expect(philippe?.targetStats.bluff[1]).toBeLessThanOrEqual(4)
    expect(philippe?.quirks?.valueHeavyRaises).toBe(true)
    expect(gerard?.targetStats.vpip[0]).toBeGreaterThanOrEqual(68)
    expect(gerard?.targetStats.bluff[0]).toBeGreaterThanOrEqual(32)
    expect(gerard?.targetStats.overbet[0]).toBeGreaterThanOrEqual(24)
  })
})
