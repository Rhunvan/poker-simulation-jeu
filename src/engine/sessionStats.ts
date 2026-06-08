import type { SessionStats, TableState } from './core/types'

export function getSessionStats(state: TableState, playerId = 'hero'): SessionStats {
  const player = state.players.find((entry) => entry.id === playerId) ?? null
  const baseStack = player?.startingStack ?? 0
  const rebuyAmount = (player?.rebuys ?? 0) * state.config.rebuy.defaultAmount

  const stats: SessionStats = {
    playerId,
    handsCompleted: state.handSummaries.length,
    handsEntered: 0,
    handsWon: 0,
    grossWon: 0,
    grossLost: 0,
    netResult: 0,
    biggestWin: 0,
    biggestLoss: 0,
    currentStack: player?.stack ?? 0,
    initialBuyIn: baseStack,
    totalInvested: baseStack + rebuyAmount,
    rebuys: player?.rebuys ?? 0,
    rebuyAmount,
  }

  for (const summary of state.handSummaries) {
    const result = summary.playerResults.find((entry) => entry.playerId === playerId)
    if (!result?.participated) {
      continue
    }

    stats.handsEntered += 1
    stats.netResult += result.net

    if (result.net > 0) {
      stats.handsWon += 1
      stats.grossWon += result.net
      stats.biggestWin = Math.max(stats.biggestWin, result.net)
    }

    if (result.net < 0) {
      const lossAmount = Math.abs(result.net)
      stats.grossLost += lossAmount
      stats.biggestLoss = Math.max(stats.biggestLoss, lossAmount)
    }
  }

  return stats
}
