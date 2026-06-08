import type { TablePlayer } from './types'
import {
  createSeatRing,
  getNextOccupiedSeat,
  getOccupiedSeatsClockwiseFrom,
  getPlayerAtSeat,
} from './seatRing'

export function isEligibleForNextHand(player: TablePlayer): boolean {
  return !player.isSittingOut && player.stack > 0
}

export function getParticipatingSeats(players: TablePlayer[]): number[] {
  return players
    .filter((player) => isEligibleForNextHand(player))
    .map((player) => player.seatIndex)
    .sort((left, right) => left - right)
}

export function getNextSeat(
  players: TablePlayer[],
  fromSeatIndex: number,
  predicate: (player: TablePlayer) => boolean,
  maxSeats: number,
): number {
  return getNextOccupiedSeat(createSeatRing(players, maxSeats), fromSeatIndex, predicate)
}

export function resolveBlindAssignments(
  players: TablePlayer[],
  dealerSeatIndex: number,
  maxSeats: number,
): {
  dealerSeatIndex: number
  smallBlindSeatIndex: number
  bigBlindSeatIndex: number
  headsUp: boolean
} {
  const participatingSeats = getParticipatingSeats(players)
  if (participatingSeats.length < 2) {
    return {
      dealerSeatIndex,
      smallBlindSeatIndex: dealerSeatIndex,
      bigBlindSeatIndex: dealerSeatIndex,
      headsUp: false,
    }
  }

  const normalizedDealerSeatIndex = participatingSeats.includes(dealerSeatIndex)
    ? dealerSeatIndex
    : getNextSeat(players, dealerSeatIndex, isEligibleForNextHand, maxSeats)

  if (participatingSeats.length === 2) {
    const bigBlindSeatIndex = getNextSeat(
      players,
      normalizedDealerSeatIndex,
      isEligibleForNextHand,
      maxSeats,
    )
    return {
      dealerSeatIndex: normalizedDealerSeatIndex,
      smallBlindSeatIndex: normalizedDealerSeatIndex,
      bigBlindSeatIndex,
      headsUp: true,
    }
  }

  const smallBlindSeatIndex = getNextSeat(
    players,
    normalizedDealerSeatIndex,
    isEligibleForNextHand,
    maxSeats,
  )
  const bigBlindSeatIndex = getNextSeat(
    players,
    smallBlindSeatIndex,
    isEligibleForNextHand,
    maxSeats,
  )

  return {
    dealerSeatIndex: normalizedDealerSeatIndex,
    smallBlindSeatIndex,
    bigBlindSeatIndex,
    headsUp: false,
  }
}

export function getFirstActorPreflop(
  players: TablePlayer[],
  smallBlindSeatIndex: number,
  bigBlindSeatIndex: number,
  headsUp: boolean,
  canAct: (player: TablePlayer) => boolean,
  maxSeats: number,
): number | null {
  if (headsUp) {
    const smallBlind = getPlayerAtSeat(players, smallBlindSeatIndex)
    return smallBlind && canAct(smallBlind) ? smallBlindSeatIndex : null
  }

  const seatIndex = getNextSeat(players, bigBlindSeatIndex, canAct, maxSeats)
  const player = getPlayerAtSeat(players, seatIndex)
  return player && canAct(player) ? seatIndex : null
}

export function getFirstActorPostflop(
  players: TablePlayer[],
  dealerSeatIndex: number,
  canAct: (player: TablePlayer) => boolean,
  maxSeats: number,
): number | null {
  const seatIndex = getNextSeat(players, dealerSeatIndex, canAct, maxSeats)
  const player = getPlayerAtSeat(players, seatIndex)
  return player && canAct(player) ? seatIndex : null
}

export function getSeatsInDealOrder(
  players: TablePlayer[],
  dealerSeatIndex: number,
  maxSeats: number,
  predicate: (player: TablePlayer) => boolean,
): number[] {
  return getOccupiedSeatsClockwiseFrom(createSeatRing(players, maxSeats), dealerSeatIndex, predicate)
}
