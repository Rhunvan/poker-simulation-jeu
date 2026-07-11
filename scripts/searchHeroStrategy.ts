import { pathToFileURL } from 'url'

import type { BotProfile } from '../src/config/schema'
import { createCounters, type PlayerCounters } from './simulateProfiles'
import {
  makeVariant,
  median,
  runSingleSession,
  summarizeCounters,
  type ArnaudStrategyConfig,
  type StrategyVariant,
  type VariantSummary,
} from './optimizeHeroStrategy'
import { getSessionStats } from '../src/engine/sessionStats'

interface CandidateResult extends VariantSummary {
  score: number
}

function parseArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  if (index === -1) {
    return undefined
  }
  return process.argv[index + 1]
}

function range(min: number, max: number): [number, number] {
  return [min, max]
}

function mutateForTier(profile: BotProfile, tier: ArnaudStrategyConfig['limpTier']): void {
  if (tier === 'tight') {
    profile.targetStats.vpip = range(16, 24)
    profile.targetStats.pfr = range(15, 24)
    profile.targetStats.limp = range(0, 4)
    profile.targetStats.coldCall = range(3, 9)
    profile.targetStats.bluff = range(3, 9)
    profile.targetStats.heroCall = range(22, 36)
    return
  }

  if (tier === 'wide') {
    profile.targetStats.vpip = range(26, 38)
    profile.targetStats.pfr = range(14, 23)
    profile.targetStats.limp = range(4, 14)
    profile.targetStats.coldCall = range(9, 18)
    profile.targetStats.bluff = range(4, 10)
    profile.targetStats.heroCall = range(30, 46)
    return
  }

  profile.targetStats.vpip = range(20, 30)
  profile.targetStats.pfr = range(15, 24)
  profile.targetStats.limp = range(1, 8)
  profile.targetStats.coldCall = range(6, 14)
  profile.targetStats.bluff = range(3, 10)
  profile.targetStats.heroCall = range(26, 42)
}

function buildCandidateGrid(mode: 'full' | 'focused' | 'refine' = 'full'): StrategyVariant[] {
  const variants: StrategyVariant[] = []
  const tiers: Array<ArnaudStrategyConfig['limpTier']> =
    mode === 'refine' ? ['base', 'wide'] : mode === 'focused' ? ['tight', 'base', 'wide'] : ['tight', 'base', 'wide']
  const premiumRaises =
    mode === 'refine'
      ? [9_000, 10_000, 11_000, 12_000]
      : mode === 'focused'
        ? [10_000, 12_000, 15_000, 18_000]
        : [8_000, 10_000, 12_000, 15_000, 18_000]
  const addPerCallers = mode === 'refine' ? [1_500, 2_000, 2_500] : mode === 'focused' ? [2_000, 3_000] : [1_000, 2_000, 3_000]
  const lateBonuses = mode === 'refine' ? [3_000, 4_000, 5_000] : mode === 'focused' ? [2_000, 4_000] : [0, 2_000, 4_000]
  const postflopStyles: Array<BotProfile['sizingStyle']> =
    mode === 'refine'
      ? ['standard_plus_propre', 'serre_biaise']
      : mode === 'focused'
        ? ['standard_plus_propre', 'serre_biaise']
        : ['standard_plus_propre', 'pression_propre', 'serre_biaise']
  const maxPressureOptions = mode === 'refine' ? [true] : [false, true]

  for (const tier of tiers) {
    for (const premiumRaiseTo of premiumRaises) {
      for (const addPerCaller of addPerCallers) {
        for (const latePositionPremiumBonus of lateBonuses) {
          for (const postflopProfile of postflopStyles) {
            for (const maxPressurePremiums of maxPressureOptions) {
              const id = [
                tier,
                `p${premiumRaiseTo}`,
                `c${addPerCaller}`,
                `l${latePositionPremiumBonus}`,
                postflopProfile,
                maxPressurePremiums ? 'max' : 'normal',
              ].join('-')
              variants.push(
                makeVariant(
                  id,
                  id,
                  `tier=${tier}, premium=${premiumRaiseTo}, caller=${addPerCaller}, late=${latePositionPremiumBonus}, post=${postflopProfile}, max=${maxPressurePremiums}`,
                  {
                    limpTier: tier,
                    premiumRaiseTo,
                    addPerCaller,
                    latePositionPremiumBonus,
                    maxPressurePremiums,
                    postflopProfile,
                  },
                  (profile) => {
                    mutateForTier(profile, tier)
                    profile.sizingStyle = postflopProfile
                    profile.targetStats.overbet = postflopProfile === 'pression_propre' ? range(3, 10) : range(0, 5)
                    profile.targetStats.cbetFlop = postflopProfile === 'serre_biaise' ? range(40, 58) : range(52, 70)
                    profile.targetStats.cbetTurn = postflopProfile === 'serre_biaise' ? range(25, 42) : range(35, 55)
                  },
                ),
              )
            }
          }
        }
      }
    }
  }

  return variants
}

function evaluateVariant(
  variant: StrategyVariant,
  sessions: number,
  handsPerSession: number,
  seed: number,
): CandidateResult {
  const nets: number[] = []
  let totalHandsEntered = 0
  let totalRebuys = 0
  const aggregateCounters = createCounters()

  for (let sessionIndex = 0; sessionIndex < sessions; sessionIndex += 1) {
    const run = runSingleSession(variant, handsPerSession, seed + sessionIndex * 10_007)
    const stats = getSessionStats(run.table, 'arnaud')
    nets.push(stats.netResult)
    totalHandsEntered += stats.handsEntered
    totalRebuys += stats.rebuys

    const arnaudCounters = run.counters.arnaud
    for (const key of Object.keys(aggregateCounters) as Array<keyof PlayerCounters>) {
      aggregateCounters[key] += arnaudCounters[key]
    }
  }

  const avgNet = nets.reduce((sum, value) => sum + value, 0) / Math.max(1, nets.length)
  const positiveSessions = nets.filter((value) => value > 0).length
  const positiveSessionRate = Number(((positiveSessions / sessions) * 100).toFixed(1))
  const medianNet = Math.round(median(nets))
  const roundedAvgNet = Math.round(avgNet)

  return {
    id: variant.id,
    label: variant.label,
    note: variant.note,
    sessions,
    handsPerSession,
    avgNet: roundedAvgNet,
    medianNet,
    bestNet: Math.max(...nets),
    worstNet: Math.min(...nets),
    positiveSessions,
    positiveSessionRate,
    avgHandsEntered: Number((totalHandsEntered / sessions).toFixed(1)),
    avgRebuys: Number((totalRebuys / sessions).toFixed(2)),
    metrics: summarizeCounters(aggregateCounters),
    score: roundedAvgNet / 10_000 + medianNet / 15_000 + positiveSessionRate * 2,
  }
}

export function searchHeroStrategy(options: {
  mode?: 'full' | 'focused' | 'refine'
  scanSessions?: number
  validateSessions?: number
  handsPerSession?: number
  seed?: number
  top?: number
} = {}): {
  scanned: number
  scanSessions: number
  validateSessions: number
  handsPerSession: number
  thresholdHits: CandidateResult[]
  finalists: CandidateResult[]
} {
  const scanSessions = options.scanSessions ?? 40
  const validateSessions = options.validateSessions ?? 300
  const handsPerSession = options.handsPerSession ?? 70
  const seed = options.seed ?? 120_042
  const top = options.top ?? 18
  const candidates = buildCandidateGrid(options.mode ?? 'full')
  const scanned = candidates.map((candidate, index) =>
    evaluateVariant(candidate, scanSessions, handsPerSession, seed + index * 431),
  )
  scanned.sort((left, right) => right.score - left.score)

  const finalistIds = new Set([
    ...scanned.filter((entry) => entry.positiveSessionRate >= 50).map((entry) => entry.id),
    ...scanned.slice(0, top).map((entry) => entry.id),
  ])
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const finalists = [...finalistIds]
    .map((id, index) => evaluateVariant(candidateById.get(id)!, validateSessions, handsPerSession, seed + 80_000 + index * 997))
    .sort((left, right) => right.score - left.score)

  return {
    scanned: candidates.length,
    scanSessions,
    validateSessions,
    handsPerSession,
    thresholdHits: finalists.filter((entry) => entry.positiveSessionRate >= 50),
    finalists,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scanSessions = Number(parseArgValue('--scan-sessions') ?? 40)
  const validateSessions = Number(parseArgValue('--validate-sessions') ?? 300)
  const handsPerSession = Number(parseArgValue('--hands') ?? 70)
  const seed = Number(parseArgValue('--seed') ?? 120_042)
  const top = Number(parseArgValue('--top') ?? 18)
  const mode = (parseArgValue('--mode') ?? 'full') as 'full' | 'focused' | 'refine'
  console.log(JSON.stringify(searchHeroStrategy({ mode, scanSessions, validateSessions, handsPerSession, seed, top }), null, 2))
}
