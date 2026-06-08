import type { BotProfile } from '../../config/schema'
import type { DecisionContext } from '../core/types'
import type { EmotionModifiers } from './emotionModel'
import type { PopulationSnapshot } from './populationModel'
import { rangeMid } from './populationModel'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeStat(range: [number, number]): number {
  return rangeMid(range) / 100
}

function favoriteHandMatch(profile: BotProfile, handKey: string): boolean {
  return profile.quirks?.favoriteHands?.includes(handKey) ?? false
}

export function applyPersonaOverlay(
  _context: DecisionContext,
  snapshot: PopulationSnapshot,
  profile: BotProfile,
  emotions: EmotionModifiers,
): PopulationSnapshot {
  const vpip = normalizeStat(profile.targetStats.vpip)
  const pfr = normalizeStat(profile.targetStats.pfr)
  const limp = normalizeStat(profile.targetStats.limp)
  const coldCall = normalizeStat(profile.targetStats.coldCall)
  const overlimp = clamp(limp * 0.65 + coldCall * 0.35, 0, 1)
  const threeBet = normalizeStat(profile.targetStats.threeBet)
  const fourBet = normalizeStat(profile.targetStats.fourBet)
  const bluff = normalizeStat(profile.targetStats.bluff)
  const heroCall = normalizeStat(profile.targetStats.heroCall)
  const overbet = normalizeStat(profile.targetStats.overbet)
  const jamDeep = normalizeStat(profile.targetStats.preflopJamAbove35bb)
  const nextSnapshot: PopulationSnapshot = {
    ...snapshot,
    candidateWeights: { ...snapshot.candidateWeights },
    tags: [...snapshot.tags, `persona:${profile.id}`],
  }

  if (snapshot.street === 'preflop') {
    const entryScore = snapshot.handStrength + snapshot.playability * 0.45 + emotions.curiosityBoost * 0.12
    const requiredEntry = clamp(
      0.8 - vpip * 1.02 - (snapshot.scenario === 'limped-pot' ? 0.08 : 0),
      0.18,
      0.74,
    )
    if (snapshot.scenario === 'unopened' || snapshot.scenario === 'limped-pot') {
      nextSnapshot.candidateWeights.fold *= 1.05 + (1 - vpip) * 1.35
      nextSnapshot.candidateWeights.call *=
        snapshot.scenario === 'unopened' ? 0.28 + limp * 2.2 : 0.34 + overlimp * 1.85
      nextSnapshot.candidateWeights.raise *= 0.38 + pfr * 2.4
      nextSnapshot.candidateWeights.call += limp * 0.35 + overlimp * 0.2
      nextSnapshot.candidateWeights.raise += pfr * 0.4 + emotions.aggressionBoost * 0.08
    } else {
      nextSnapshot.candidateWeights.fold *= 1.08 + (1 - vpip) * 0.9
      nextSnapshot.candidateWeights.call *= 0.32 + coldCall * 2.1 + heroCall * 0.25
      nextSnapshot.candidateWeights.raise *=
        snapshot.raiseCount >= 2 ? 0.04 + fourBet * 1.5 : 0.2 + threeBet * 5.2
      nextSnapshot.candidateWeights.call += coldCall * 0.36 + heroCall * 0.12
      nextSnapshot.candidateWeights.raise +=
        (snapshot.raiseCount >= 2 ? fourBet * 0.05 : threeBet * 0.3) + emotions.aggressionBoost * 0.06
      if (snapshot.raiseCount >= 2 && snapshot.handStrength < 0.9) {
        nextSnapshot.candidateWeights.raise *= 0.25
      }
      if (snapshot.raiseCount >= 2) {
        nextSnapshot.candidateWeights.raise *= 0.52
      }
    }
    if (entryScore < requiredEntry) {
      const penalty = requiredEntry - entryScore
      nextSnapshot.candidateWeights.fold += penalty * 2.2
      nextSnapshot.candidateWeights.call *= 0.42 + vpip
      nextSnapshot.candidateWeights.raise *= 0.28 + pfr * 1.5
      nextSnapshot.tags.push('entry-gated')
    }
    nextSnapshot.candidateWeights['all-in'] += jamDeep * 0.32
  } else if (snapshot.scenario === 'checked-to') {
    const streetCbet =
      snapshot.street === 'flop'
        ? normalizeStat(profile.targetStats.cbetFlop)
        : snapshot.street === 'turn'
          ? normalizeStat(profile.targetStats.cbetTurn)
          : normalizeStat(profile.targetStats.cbetRiver)
    nextSnapshot.candidateWeights.check += Math.max(0, 0.32 - streetCbet) * 0.8
    nextSnapshot.candidateWeights.bet += streetCbet * 1.3 + bluff * 0.36 + emotions.aggressionBoost * 0.1
  } else {
    nextSnapshot.candidateWeights.fold += Math.max(0, 0.36 - heroCall) * 1.15 + emotions.cautionBoost * 0.18
    nextSnapshot.candidateWeights.call += heroCall * 1.4 + coldCall * 0.5
    nextSnapshot.candidateWeights.raise += bluff * 0.85 + overbet * 0.35
  }

  if (snapshot.street !== 'preflop' && bluff < 0.06 && snapshot.handStrength < 0.72) {
    nextSnapshot.candidateWeights.bet *= 0.58
    nextSnapshot.candidateWeights.raise *= 0.42
    nextSnapshot.tags.push('bluff-suppressed')
  }

  if (profile.quirks?.irrationalCalls) {
    nextSnapshot.candidateWeights.call += 0.28 + snapshot.toCallBb * 0.03 + emotions.curiosityBoost * 0.16
    nextSnapshot.candidateWeights.fold *= 0.72
    nextSnapshot.tags.push('irrational-caller')
  }

  if (profile.quirks?.valueHeavyRaises) {
    if (snapshot.valueIntent >= 0.76) {
      nextSnapshot.candidateWeights.raise += 0.22
    } else {
      nextSnapshot.candidateWeights.raise *= 0.52
      nextSnapshot.candidateWeights.bet *= 0.74
    }
    nextSnapshot.candidateWeights.call *= 0.92
    nextSnapshot.tags.push('value-heavy-raises')
  }

  if (profile.quirks?.cleanPressure) {
    nextSnapshot.candidateWeights.raise += snapshot.valueIntent * 0.2 + snapshot.bluffIntent * 0.14
    nextSnapshot.candidateWeights.call *= 0.9
    nextSnapshot.tags.push('clean-pressure')
  }

  if (profile.quirks?.optimisticFoldEquity) {
    nextSnapshot.candidateWeights.raise += snapshot.bluffIntent * 0.28 + emotions.aggressionBoost * 0.18
    nextSnapshot.candidateWeights.bet += snapshot.bluffIntent * 0.24
    nextSnapshot.tags.push('optimistic-fold-equity')
  }

  if (profile.quirks?.kamikazeBursts) {
    nextSnapshot.candidateWeights.raise += 0.24 + emotions.aggressionBoost * 0.18
    nextSnapshot.candidateWeights.bet += 0.18 + snapshot.bluffIntent * 0.16
    nextSnapshot.candidateWeights['all-in'] += snapshot.stackBb > 35 ? 0.02 : 0.08
    nextSnapshot.preferOversize = true
    nextSnapshot.preferOverbet = true
    nextSnapshot.tags.push('kamikaze-burst')
  }

  if (profile.quirks?.scaredMoney) {
    nextSnapshot.candidateWeights.fold += 0.32 + emotions.cautionBoost * 0.22
    nextSnapshot.candidateWeights.raise *= 0.58
    nextSnapshot.candidateWeights.bet *= 0.7
    nextSnapshot.preferOversize = false
    nextSnapshot.tags.push('scared-money')
  }

  if (profile.quirks?.showdownCurious) {
    nextSnapshot.candidateWeights.call += 0.18 + emotions.showdownBoost * 0.24
    nextSnapshot.tags.push('showdown-curious')
  }

  if (profile.quirks?.stickyPairs && snapshot.street !== 'preflop' && snapshot.handStrength >= 0.36) {
    nextSnapshot.candidateWeights.call += 0.18
    nextSnapshot.candidateWeights.fold *= 0.82
    nextSnapshot.tags.push('sticky-pairs')
  }

  if (favoriteHandMatch(profile, snapshot.handKey)) {
    nextSnapshot.candidateWeights.call += 0.22
    nextSnapshot.candidateWeights.raise += 0.12
    nextSnapshot.candidateWeights.fold *= 0.74
    nextSnapshot.tags.push('favorite-hand-bias')
  }

  nextSnapshot.candidateWeights.fold = clamp(nextSnapshot.candidateWeights.fold, 0, 2)
  nextSnapshot.candidateWeights.check = clamp(nextSnapshot.candidateWeights.check, 0, 2)
  nextSnapshot.candidateWeights.call = clamp(nextSnapshot.candidateWeights.call, 0, 2)
  nextSnapshot.candidateWeights.bet = clamp(nextSnapshot.candidateWeights.bet, 0, 2)
  nextSnapshot.candidateWeights.raise = clamp(nextSnapshot.candidateWeights.raise, 0, 2)
  nextSnapshot.candidateWeights['all-in'] = clamp(nextSnapshot.candidateWeights['all-in'], 0, 0.9)

  return nextSnapshot
}
