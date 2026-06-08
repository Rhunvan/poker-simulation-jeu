import { REAL_TABLE_POPULATION } from '../../config/tablePopulation'
import type { BotProfile } from '../../config/schema'
import type { DecisionContext, DecisionTelemetry } from '../core/types'
import { weightedChoice } from '../core/random'
import type { EmotionModifiers } from './emotionModel'
import type { PopulationSnapshot } from './populationModel'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundChip(amount: number): number {
  return Math.max(1, Math.round(amount))
}

function leaveBehindTarget(maxTotal: number, bb: number): number {
  return Math.max(0, maxTotal - bb * 5)
}

function pickWeightedNumber(seed: number, entries: Array<{ item: number; weight: number }>): { seed: number; value: number } {
  const chosen = weightedChoice(seed, entries)
  return {
    seed: chosen.seed,
    value: chosen.item,
  }
}

function getPostflopFractions(style: BotProfile['sizingStyle']): number[] {
  switch (style) {
    case 'passif_irrationnel':
      return [0.45, 0.58, 0.72]
    case 'volatile_aggressif':
      return [0.6, 0.8, 1.05]
    case 'random_passif':
      return [0.36, 0.5, 0.78]
    case 'face_up_serre':
      return [0.52, 0.72, 0.92]
    case 'standard_plus_propre':
      return [0.55, 0.72, 0.9]
    case 'pression_propre':
      return [0.66, 0.82, 1.05]
    case 'overbet_heavy_kamikaze':
      return [0.78, 1.05, 1.35, 1.55]
    case 'serre_biaise':
      return [0.5, 0.64, 0.88]
    case 'scared_money':
      return [0.34, 0.48, 0.65]
    default:
      return [0.55, 0.72, 0.95]
  }
}

function getOpenWeights(style: BotProfile['sizingStyle'], preferOversize: boolean): Array<{ item: number; weight: number }> {
  const base = REAL_TABLE_POPULATION.averageOpenSizeBb.map((sizeBb) => ({
    item: sizeBb,
    weight:
      style === 'scared_money'
        ? sizeBb <= 5
          ? 1.35
          : 0.4
        : style === 'passif_irrationnel' || style === 'random_passif'
          ? sizeBb <= 6
            ? 1.2
            : 0.65
          : style === 'pression_propre' || style === 'standard_plus_propre'
            ? sizeBb <= 7
              ? 1.3
              : 0.75
            : 1,
  }))
  const rare = REAL_TABLE_POPULATION.rareOversizeOpenBb.map((sizeBb) => ({
    item: sizeBb,
    weight:
      preferOversize &&
      (style === 'volatile_aggressif' || style === 'overbet_heavy_kamikaze' || style === 'pression_propre')
        ? sizeBb <= 20
          ? 0.45
          : 0.18
        : 0.05,
  }))
  return [...base, ...rare]
}

function getReraiseMultipliers(style: BotProfile['sizingStyle']): Array<{ item: number; weight: number }> {
  switch (style) {
    case 'volatile_aggressif':
      return [
        { item: 3.8, weight: 1 },
        { item: 4.5, weight: 0.9 },
        { item: 5.4, weight: 0.55 },
        { item: 7.5, weight: 0.18 },
      ]
    case 'overbet_heavy_kamikaze':
      return [
        { item: 4.2, weight: 0.95 },
        { item: 5.2, weight: 0.85 },
        { item: 6.5, weight: 0.6 },
        { item: 8.2, weight: 0.22 },
      ]
    case 'pression_propre':
      return [
        { item: 3.5, weight: 1.05 },
        { item: 4.2, weight: 0.92 },
        { item: 5, weight: 0.45 },
      ]
    case 'scared_money':
      return [
        { item: 3.2, weight: 1.1 },
        { item: 3.8, weight: 0.5 },
      ]
    default:
      return [
        { item: 3.4, weight: 1 },
        { item: 4, weight: 0.88 },
        { item: 4.8, weight: 0.42 },
      ]
  }
}

function buildTelemetry(
  context: DecisionContext,
  snapshot: PopulationSnapshot,
  total: number,
  potFraction: number,
): DecisionTelemetry {
  return {
    tags: [...snapshot.tags],
    sizingBb: Math.round((total / context.state.config.bigBlind) * 10) / 10,
    sizingPot: Math.round(potFraction * 100) / 100,
    isOverbet: potFraction > 1.05,
  }
}

export function resolveAggressiveTotal(
  context: DecisionContext,
  snapshot: PopulationSnapshot,
  profile: BotProfile,
  seed: number,
  emotions: EmotionModifiers,
  suppressJam: boolean,
): { seed: number; total: number; telemetry: DecisionTelemetry } {
  const maxTotal = context.legalActions.maxRaiseTo ?? context.player.currentBet + context.player.stack
  const minTotal = context.legalActions.minRaiseTo ?? (context.player.currentBet + context.legalActions.toCall)
  const bb = context.state.config.bigBlind

  if (snapshot.street === 'preflop') {
    if (snapshot.scenario === 'unopened' || snapshot.scenario === 'limped-pot') {
      const openChoices = getOpenWeights(profile.sizingStyle, snapshot.preferOversize || emotions.aggressionBoost > 0.18)
      const picked = pickWeightedNumber(seed, openChoices)
      const rawTargetBb =
        picked.value +
        (snapshot.scenario === 'limped-pot' ? snapshot.limperCount * (profile.sizingStyle === 'scared_money' ? 0.7 : 1.2) : 0)
      const cappedMax = suppressJam ? leaveBehindTarget(maxTotal, bb) : maxTotal
      const total = clamp(roundChip(rawTargetBb * bb), minTotal, Math.max(minTotal, cappedMax))
      return {
        seed: picked.seed,
        total,
        telemetry: buildTelemetry(context, snapshot, total, total / Math.max(1, context.potTotal)),
      }
    }

    const multipliers = getReraiseMultipliers(profile.sizingStyle)
    const picked = pickWeightedNumber(seed, multipliers)
    const extraPressure = snapshot.raiseCount >= 2 ? snapshot.raiseCount * 0.15 : 0
    const rawTarget = roundChip(context.state.currentBet * (picked.value + extraPressure) + snapshot.limperCount * bb * 0.5)
    const cappedMax = suppressJam ? leaveBehindTarget(maxTotal, bb) : maxTotal
    const total = clamp(rawTarget, minTotal, Math.max(minTotal, cappedMax))
    const raisePortion = Math.max(0, total - context.state.currentBet) / Math.max(1, context.potTotal)
    return {
      seed: picked.seed,
      total,
      telemetry: buildTelemetry(context, snapshot, total, raisePortion),
    }
  }

  const fractions = getPostflopFractions(profile.sizingStyle)
  const entries = fractions.map((fraction) => ({
    item: fraction,
    weight:
      snapshot.preferOverbet && fraction > 1
        ? 0.95
        : snapshot.valueIntent > 0.78
          ? fraction >= 0.72
            ? 1
            : 0.65
          : snapshot.bluffIntent > 0.28
            ? fraction <= 1.05
              ? 0.92
              : 0.45
            : 0.85,
  }))
  const picked = pickWeightedNumber(seed, entries)
  const baseTarget =
    context.state.currentBet === 0
      ? roundChip(context.potTotal * picked.value)
      : roundChip(context.state.currentBet + context.potTotal * picked.value)
  const cappedMax = suppressJam ? leaveBehindTarget(maxTotal, bb) : maxTotal
  const total = clamp(baseTarget, minTotal, Math.max(minTotal, cappedMax))
  const raisePortion =
    context.state.currentBet === 0
      ? total / Math.max(1, context.potTotal)
      : Math.max(0, total - context.state.currentBet) / Math.max(1, context.potTotal)

  return {
    seed: picked.seed,
    total,
    telemetry: buildTelemetry(context, snapshot, total, raisePortion),
  }
}
