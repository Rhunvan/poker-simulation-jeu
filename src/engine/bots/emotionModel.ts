import type { BotProfile } from '../../config/schema'
import type { TablePlayer } from '../core/types'

export interface EmotionModifiers {
  aggressionBoost: number
  curiosityBoost: number
  cautionBoost: number
  shoveBoost: number
  showdownBoost: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function levelValue(level: BotProfile['emotionalProfile'] extends infer _T ? 'low' | 'medium' | 'high' : never): number {
  if (level === 'high') return 1
  if (level === 'low') return 0.35
  return 0.65
}

export function getEmotionModifiers(player: TablePlayer, profile: BotProfile): EmotionModifiers {
  const tiltSensitivity = levelValue(profile.emotionalProfile?.tiltSensitivity ?? 'medium')
  const revengeFactor = levelValue(profile.emotionalProfile?.revengeFactor ?? 'medium')
  const boredomLeak = levelValue(profile.emotionalProfile?.boredomLeak ?? 'medium')
  const riskAversion = levelValue(profile.emotionalProfile?.riskAversion ?? 'medium')
  const hotStreak = clamp(player.memory.consecutiveWins / 4, 0, 1)
  const coldStreak = clamp(player.memory.consecutiveLosses / 4, 0, 1)
  const revenge = player.memory.revengeTargetId ? revengeFactor * 0.22 : 0
  const tilt = player.memory.tilt * tiltSensitivity
  const confidence = player.memory.confidence
  const boredom = boredomLeak * (player.memory.recentEvents.length === 0 ? 0.18 : 0.1)

  const aggressionBoost = clamp(
    tilt * 0.34 + revenge + hotStreak * 0.1 + boredom + Math.max(0, confidence - 0.5) * 0.1,
    0,
    0.7,
  )
  const curiosityBoost = clamp(
    boredom * 0.9 + revenge * 0.65 + hotStreak * 0.06 + (1 - riskAversion) * 0.1,
    0,
    0.55,
  )
  const cautionBoost = clamp(
    player.memory.caution * 0.28 + riskAversion * 0.24 + coldStreak * 0.12 - confidence * 0.06,
    0,
    0.72,
  )

  return {
    aggressionBoost,
    curiosityBoost,
    cautionBoost,
    shoveBoost: clamp(tilt * 0.08 + revenge * 0.08 + boredom * 0.12 - riskAversion * 0.05, 0, 0.22),
    showdownBoost: clamp(curiosityBoost + (profile.quirks?.showdownCurious ? 0.16 : 0), 0, 0.65),
  }
}
