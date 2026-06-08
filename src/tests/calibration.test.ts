import { describe, expect, it } from 'vitest'

import { runProfileSimulation } from '../../scripts/simulateProfiles'

function getMetric(
  report: ReturnType<typeof runProfileSimulation>,
  playerId: string,
  metric: string,
): number {
  const player = report.players.find((entry) => entry.id === playerId)
  if (!player) {
    throw new Error(`Missing player ${playerId}`)
  }
  return player.metrics[metric] ?? 0
}

describe('profile calibration smoke test', () => {
  it('produces differentiated tendencies with deep preflop jams suppressed', () => {
    const report = runProfileSimulation({ hands: 400, seed: 4242 })

    expect(report.handsSimulated).toBe(400)
    expect(report.players).toHaveLength(9)
    expect(getMetric(report, 'pierre', 'limp')).toBeGreaterThan(getMetric(report, 'david', 'limp'))
    expect(getMetric(report, 'eric_b', 'coldCall')).toBeGreaterThan(getMetric(report, 'fabrice', 'coldCall'))
    expect(getMetric(report, 'martin', 'overbetFrequency')).toBeGreaterThan(getMetric(report, 'pierre', 'overbetFrequency'))
    expect(getMetric(report, 'pascal', 'pfr')).toBeLessThan(getMetric(report, 'fabrice', 'pfr'))
    expect(getMetric(report, 'pierre', 'preflopJamAbove35bb')).toBeLessThanOrEqual(1)
    expect(getMetric(report, 'pascal', 'preflopJamAbove35bb')).toBeLessThanOrEqual(1)
    for (const player of report.players) {
      for (const metric of Object.values(player.metrics)) {
        expect(metric).toBeGreaterThanOrEqual(0)
        expect(metric).toBeLessThanOrEqual(100)
      }
    }
  })
})
