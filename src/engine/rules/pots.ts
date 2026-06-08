import type { Pot, TablePlayer } from '../core/types'
import { createSeatRing, getOccupiedSeatsClockwiseFrom } from '../core/seatRing'

export function buildPots(players: TablePlayer[]): Pot[] {
  const contributionLevels = [...new Set(players.map((player) => player.totalCommitted))]
    .filter((amount) => amount > 0)
    .sort((left, right) => left - right)

  const pots: Pot[] = []
  let previousLevel = 0

  for (const level of contributionLevels) {
    const contributors = players.filter((player) => player.totalCommitted >= level)
    const amount = (level - previousLevel) * contributors.length

    if (amount > 0) {
      const eligiblePlayerIds = contributors
        .filter((player) => !player.hasFolded)
        .map((player) => player.id)

      pots.push({
        id: `pot-${pots.length + 1}`,
        label: pots.length === 0 ? 'Main pot' : `Side pot ${pots.length}`,
        amount,
        eligiblePlayerIds,
        contributorIds: contributors.map((player) => player.id),
      })
    }

    previousLevel = level
  }

  return pots
}

export function getPotTotal(players: TablePlayer[]): number {
  return players.reduce((total, player) => total + player.totalCommitted, 0)
}

export function getOddChipRecipients(
  winnerIds: string[],
  players: TablePlayer[],
  dealerSeatIndex: number,
  remainder: number,
  maxSeats: number,
): string[] {
  if (winnerIds.length === 0) {
    return []
  }

  const recipients: string[] = []
  const ring = createSeatRing(players, maxSeats)
  const clockwiseSeats = getOccupiedSeatsClockwiseFrom(
    ring,
    dealerSeatIndex,
    (player) => winnerIds.includes(player.id),
  )
  for (const seatIndex of clockwiseSeats) {
    const player = ring.playersBySeat.get(seatIndex)
    if (player) {
      recipients.push(player.id)
      if (recipients.length === remainder) {
        break
      }
    }
  }

  return recipients.length > 0 ? recipients : winnerIds.slice(0, remainder)
}
