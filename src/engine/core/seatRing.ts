import type { TablePlayer } from './types'

export interface SeatRing {
  maxSeats: number
  occupiedSeatIndices: number[]
  playersBySeat: ReadonlyMap<number, TablePlayer>
}

const playerIdCache = new WeakMap<TablePlayer[], Map<string, TablePlayer>>()
const playerSeatCache = new WeakMap<TablePlayer[], Map<number, TablePlayer>>()

export function getPlayersById(players: TablePlayer[]): ReadonlyMap<string, TablePlayer> {
  const cached = playerIdCache.get(players)
  if (cached) {
    return cached
  }

  const map = new Map<string, TablePlayer>()
  for (const player of players) {
    map.set(player.id, player)
  }
  playerIdCache.set(players, map)
  return map
}

export function getPlayersBySeat(players: TablePlayer[]): ReadonlyMap<number, TablePlayer> {
  const cached = playerSeatCache.get(players)
  if (cached) {
    return cached
  }

  const map = new Map<number, TablePlayer>()
  for (const player of players) {
    map.set(player.seatIndex, player)
  }
  playerSeatCache.set(players, map)
  return map
}

export function getPlayerAtSeat(players: TablePlayer[], seatIndex: number): TablePlayer | undefined {
  return getPlayersBySeat(players).get(seatIndex)
}

export function getPlayerByIdFromPlayers(players: TablePlayer[], playerId: string): TablePlayer | undefined {
  return getPlayersById(players).get(playerId)
}

export function createSeatRing(players: TablePlayer[], maxSeats: number): SeatRing {
  const playersBySeat = getPlayersBySeat(players)
  return {
    maxSeats,
    occupiedSeatIndices: [...playersBySeat.keys()].sort((left, right) => left - right),
    playersBySeat,
  }
}

export function getNextOccupiedSeat(
  ring: SeatRing,
  fromSeatIndex: number,
  predicate: (player: TablePlayer) => boolean,
): number {
  for (let offset = 1; offset <= ring.maxSeats; offset += 1) {
    const seatIndex = (fromSeatIndex + offset + ring.maxSeats) % ring.maxSeats
    const player = ring.playersBySeat.get(seatIndex)
    if (player && predicate(player)) {
      return seatIndex
    }
  }
  return fromSeatIndex
}

export function getOccupiedSeatsClockwiseFrom(
  ring: SeatRing,
  fromSeatIndex: number,
  predicate: (player: TablePlayer) => boolean = () => true,
): number[] {
  const seats: number[] = []
  for (let offset = 1; offset <= ring.maxSeats; offset += 1) {
    const seatIndex = (fromSeatIndex + offset + ring.maxSeats) % ring.maxSeats
    const player = ring.playersBySeat.get(seatIndex)
    if (player && predicate(player)) {
      seats.push(seatIndex)
    }
  }
  return seats
}

export function getClockwiseSeatDistance(fromSeatIndex: number, toSeatIndex: number, maxSeats: number): number {
  return (toSeatIndex - fromSeatIndex + maxSeats) % maxSeats
}
