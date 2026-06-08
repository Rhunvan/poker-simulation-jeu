import { getFirstActorPostflop, getFirstActorPreflop } from '../engine/core/positions'
import { createSeatRing, getOccupiedSeatsClockwiseFrom } from '../engine/core/seatRing'
import type { TablePlayer, TableState } from '../engine/core/types'

export interface TableDebugSeatSnapshot {
  seatIndex: number
  badges: string[]
}

export interface TableDebugSnapshot {
  occupiedSeatOrder: number[]
  occupiedSeatLabels: string[]
  firstActorPreflopSeatIndex: number | null
  firstActorPreflopLabel: string | null
  firstActorPostflopSeatIndex: number | null
  firstActorPostflopLabel: string | null
  heroRelativeLabel: string | null
  seats: TableDebugSeatSnapshot[]
}

function formatSeatLabel(seatIndex: number): string {
  return `S${seatIndex + 1}`
}

function isDebugParticipant(player: TablePlayer, table: TableState): boolean {
  if (table.handInProgress) {
    return player.holeCards.length > 0 && !player.isSittingOut
  }

  return !player.isSittingOut && player.stack > 0
}

export function buildTableDebugSnapshot(table: TableState, heroId = 'hero'): TableDebugSnapshot {
  const ring = createSeatRing(table.players, table.config.maxSeats)
  const occupiedSeatOrder = getOccupiedSeatsClockwiseFrom(ring, table.dealerSeatIndex)
  const occupiedSeatOrderIndex = new Map(occupiedSeatOrder.map((seatIndex, index) => [seatIndex, index]))
  const participatingPlayers = table.players.filter((player) => isDebugParticipant(player, table))
  const headsUp = participatingPlayers.length === 2
  const canUseSeatForStreet = (player: TablePlayer) => isDebugParticipant(player, table)
  const firstActorPreflopSeatIndex =
    participatingPlayers.length >= 2
      ? getFirstActorPreflop(
          table.players,
          table.smallBlindSeatIndex,
          table.bigBlindSeatIndex,
          headsUp,
          canUseSeatForStreet,
          table.config.maxSeats,
        )
      : null
  const firstActorPostflopSeatIndex =
    participatingPlayers.length >= 2
      ? getFirstActorPostflop(table.players, table.dealerSeatIndex, canUseSeatForStreet, table.config.maxSeats)
      : null

  const hero = table.players.find((player) => player.id === heroId) ?? null
  let heroRelativeLabel: string | null = null
  if (hero) {
    if (hero.seatIndex === table.dealerSeatIndex) {
      heroRelativeLabel = 'BTN'
    } else if (hero.seatIndex === table.smallBlindSeatIndex) {
      heroRelativeLabel = 'SB'
    } else if (hero.seatIndex === table.bigBlindSeatIndex) {
      heroRelativeLabel = 'BB'
    } else {
      const heroOrderIndex = occupiedSeatOrderIndex.get(hero.seatIndex)
      heroRelativeLabel = heroOrderIndex === undefined ? null : `+${heroOrderIndex + 1} depuis BTN`
    }
  }

  const seats = table.players
    .slice()
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((player) => {
      const badges: string[] = []
      if (player.seatIndex === table.dealerSeatIndex) {
        badges.push('BTN')
      }
      if (player.seatIndex === table.smallBlindSeatIndex) {
        badges.push('SB')
      }
      if (player.seatIndex === table.bigBlindSeatIndex) {
        badges.push('BB')
      }
      if (player.seatIndex === firstActorPreflopSeatIndex) {
        badges.push('PF1')
      }
      if (player.seatIndex === firstActorPostflopSeatIndex) {
        badges.push('POST1')
      }

      const occupiedIndex = occupiedSeatOrderIndex.get(player.seatIndex)
      if (occupiedIndex !== undefined) {
        badges.push(`#${occupiedIndex + 1}`)
      }
      if (player.id === heroId) {
        badges.push('Hero')
      }

      return {
        seatIndex: player.seatIndex,
        badges,
      }
    })

  return {
    occupiedSeatOrder,
    occupiedSeatLabels: occupiedSeatOrder.map(formatSeatLabel),
    firstActorPreflopSeatIndex,
    firstActorPreflopLabel:
      firstActorPreflopSeatIndex === null ? null : formatSeatLabel(firstActorPreflopSeatIndex),
    firstActorPostflopSeatIndex,
    firstActorPostflopLabel:
      firstActorPostflopSeatIndex === null ? null : formatSeatLabel(firstActorPostflopSeatIndex),
    heroRelativeLabel,
    seats,
  }
}
