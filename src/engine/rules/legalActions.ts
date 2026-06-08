import type { LegalActionState, TablePlayer, TableState } from '../core/types'
import { getPlayerByIdFromPlayers } from '../core/seatRing'

function getBlindBig(state: TableState): number {
  const level = state.config.blindSchedule?.[state.currentLevelIndex]
  return level?.bigBlind ?? state.config.bigBlind
}

export function getPlayerById(state: TableState, playerId: string): TablePlayer {
  const player = getPlayerByIdFromPlayers(state.players, playerId)
  if (!player) {
    throw new Error(`Unknown player ${playerId}`)
  }
  return player
}

export function isPlayerStillInHand(player: TablePlayer): boolean {
  return !player.isSittingOut && !player.hasFolded && (player.holeCards.length > 0 || player.totalCommitted > 0)
}

export function canPlayerAct(player: TablePlayer): boolean {
  return !player.isSittingOut && !player.hasFolded && !player.isAllIn && player.stack > 0
}

export function countPlayersAbleToAct(state: TableState): number {
  return state.players.filter(canPlayerAct).length
}

export function countPlayersStillInHand(state: TableState): number {
  return state.players.filter(isPlayerStillInHand).length
}

export function isPlayerSettledForRound(player: TablePlayer, state: TableState): boolean {
  if (!isPlayerStillInHand(player) || player.isAllIn) {
    return true
  }

  if (state.currentBet === 0) {
    return player.hasActedThisRound
  }

  return player.hasActedThisRound && player.currentBet === state.currentBet
}

export function isBettingRoundComplete(state: TableState): boolean {
  const playersInHand = state.players.filter(isPlayerStillInHand)
  if (playersInHand.length <= 1) {
    return true
  }

  return playersInHand.every((player) => isPlayerSettledForRound(player, state))
}

export function getLegalActions(state: TableState, actorId = state.currentActorId): LegalActionState | null {
  if (!actorId) {
    return null
  }

  const player = getPlayerById(state, actorId)
  if (!canPlayerAct(player)) {
    return null
  }

  const toCall = Math.max(0, state.currentBet - player.currentBet)
  const hasRaiseRights = !player.hasActedThisRound || state.fullRaiseCounter > player.lastFullRaiseSeen
  const maxTotal = player.currentBet + player.stack
  const minRaiseTo =
    state.currentBet === 0
      ? Math.min(maxTotal, Math.max(getBlindBig(state), 1))
      : state.currentBet + state.lastFullRaiseSize
  const canRaise = player.stack > toCall && hasRaiseRights

  const options: LegalActionState['options'] = []

  if (toCall > 0) {
    options.push({
      kind: 'fold',
      label: 'Fold',
    })
    options.push({
      kind: 'call',
      label: player.stack <= toCall ? `Call ${player.stack}` : `Call ${toCall}`,
      amount: Math.min(player.stack, toCall),
    })
  } else {
    options.push({
      kind: 'check',
      label: 'Check',
    })
  }

  if (state.currentBet === 0 && canRaise) {
    if (maxTotal > 0) {
      options.push({
        kind: 'bet',
        label: 'Bet',
        minTotal: minRaiseTo,
        maxTotal,
      })
    }
  } else if (state.currentBet > 0 && canRaise && maxTotal >= minRaiseTo) {
    options.push({
      kind: 'raise',
      label: 'Raise',
      minTotal: minRaiseTo,
      maxTotal,
    })
  }

  if (player.stack > 0 && (toCall === 0 || player.stack <= toCall || canRaise)) {
    options.push({
      kind: 'all-in',
      label: `All-in ${player.stack}`,
      amount: player.stack,
      minTotal: maxTotal,
      maxTotal,
    })
  }

  return {
    actorId: player.id,
    toCall,
    canRaise,
    minRaiseTo: canRaise ? minRaiseTo : null,
    maxRaiseTo: canRaise ? maxTotal : null,
    options,
  }
}
