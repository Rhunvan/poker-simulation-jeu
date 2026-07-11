import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { AFTERNOON_2026_07_11_PROFILE_IDS, botProfilesById } from '../config/botProfiles'
import { tableConfig } from '../config/tableConfig'
import { applyPlayerCommand, resetTableState, startNextHand } from '../engine'
import { decideBotAction } from '../engine/bots/botDecision'
import { nextRandom } from '../engine/core/random'
import type { PlayerCommand, TableState } from '../engine/core/types'
import { getLegalActions } from '../engine/rules/legalActions'

type GameSpeed = 1 | 2 | 4

interface PokerStoreState {
  table: TableState
  activeProfileIds: string[]
  isPaused: boolean
  speed: GameSpeed
  lastClockSyncAt: number | null
  resumeLoop: () => void
  togglePause: () => void
  setSpeed: (speed: GameSpeed) => void
  resetSession: () => void
  configureLineup: (profileIds: string[]) => void
  applyHeroAction: (command: PlayerCommand) => void
  syncClock: () => void
  advanceTime: (milliseconds: number) => void
}

let scheduledTimeout: number | null = null

const defaultActiveProfileIds = AFTERNOON_2026_07_11_PROFILE_IDS.filter((id) => Boolean(botProfilesById[id]))

function sanitizeProfileIds(profileIds: string[]): string[] {
  const knownProfileIds = new Set(Object.keys(botProfilesById))
  const uniqueIds = [...new Set(profileIds)].filter((id) => knownProfileIds.has(id))
  const limitedIds = uniqueIds.slice(0, Math.max(1, tableConfig.maxSeats - (tableConfig.includeHero ? 1 : 0)))

  return limitedIds.length > 0 ? limitedIds : defaultActiveProfileIds.slice(0, 1)
}

function getProfilesForLineup(profileIds: string[]) {
  return sanitizeProfileIds(profileIds)
    .map((id) => botProfilesById[id])
    .filter((profile) => Boolean(profile))
}

function clearScheduledTimeout(): void {
  if (scheduledTimeout !== null) {
    window.clearTimeout(scheduledTimeout)
    scheduledTimeout = null
  }
}

function schedule(callback: () => void, delayMs: number): void {
  clearScheduledTimeout()
  scheduledTimeout = window.setTimeout(callback, delayMs)
}

function withSyncedClock(state: PokerStoreState): Pick<PokerStoreState, 'table' | 'lastClockSyncAt'> {
  if (state.isPaused || state.lastClockSyncAt === null) {
    return {
      table: state.table,
      lastClockSyncAt: state.lastClockSyncAt,
    }
  }

  const now = Date.now()
  return {
    table: {
      ...state.table,
      sessionElapsedMs: state.table.sessionElapsedMs + Math.max(0, now - state.lastClockSyncAt),
    },
    lastClockSyncAt: now,
  }
}

function scheduleLoop(get: () => PokerStoreState, set: (fn: (state: PokerStoreState) => Partial<PokerStoreState>) => void): void {
  clearScheduledTimeout()
  const state = get()
  if (state.isPaused) {
    return
  }

  const table = state.table
  if (!table.handInProgress) {
    const eligiblePlayers = table.players.filter((player) => player.stack > 0 && !player.isSittingOut)
    if (eligiblePlayers.length < 2) {
      return
    }

    schedule(() => {
      set((current) => {
        const synced = withSyncedClock(current)
        return {
          table: startNextHand(synced.table, synced.table.sessionElapsedMs),
          lastClockSyncAt: Date.now(),
        }
      })
      get().resumeLoop()
    }, 1_500 / state.speed)
    return
  }

  const actorId = table.currentActorId
  if (!actorId) {
    schedule(() => {
      get().resumeLoop()
    }, 400)
    return
  }

  const actor = table.players.find((player) => player.id === actorId)
  if (!actor || actor.kind !== 'bot' || !actor.botProfileId) {
    return
  }

  const profile = botProfilesById[actor.botProfileId]
  const roll = nextRandom(table.seed)
  const delay =
    (table.config.botActionDelayMs.min +
      (table.config.botActionDelayMs.max - table.config.botActionDelayMs.min) * roll.value) *
    (profile.decisionTempoMultiplier ?? 1) /
    state.speed

  set((current) => ({
    table: {
      ...current.table,
      seed: roll.seed,
    },
  }))

  schedule(() => {
    set((current) => {
      const synced = withSyncedClock(current)
      const actingTable = structuredClone(synced.table) as TableState
      const decisionResult = decideBotAction(actingTable, actorId, profile)
      actingTable.seed = decisionResult.seed
      const actingPlayer = actingTable.players.find((player) => player.id === actorId)
      if (actingPlayer) {
        actingPlayer.tableTalk = decisionResult.decision.tableTalk ?? null
      }
      return {
        table: applyPlayerCommand(actingTable, actorId, decisionResult.decision.command),
        lastClockSyncAt: Date.now(),
      }
    })
    get().resumeLoop()
  }, delay)
}

export const usePokerStore = create<PokerStoreState>()(
  persist(
    (set, get) => ({
      table: resetTableState(tableConfig, getProfilesForLineup(defaultActiveProfileIds)),
      activeProfileIds: defaultActiveProfileIds,
      isPaused: false,
      speed: 1,
      lastClockSyncAt: Date.now(),
      resumeLoop: () => {
        set((state) => ({
          lastClockSyncAt: state.isPaused ? null : state.lastClockSyncAt ?? Date.now(),
        }))
        scheduleLoop(get, set)
      },
      togglePause: () => {
        clearScheduledTimeout()
        set((state) => {
          if (state.isPaused) {
            return {
              isPaused: false,
              lastClockSyncAt: Date.now(),
            }
          }

          const synced = withSyncedClock(state)
          return {
            isPaused: true,
            table: synced.table,
            lastClockSyncAt: null,
          }
        })

        if (!get().isPaused) {
          get().resumeLoop()
        }
      },
      setSpeed: (speed) => {
        set(() => ({ speed }))
        get().resumeLoop()
      },
      resetSession: () => {
        clearScheduledTimeout()
        set((state) => ({
          table: resetTableState(tableConfig, getProfilesForLineup(state.activeProfileIds), Date.now()),
          isPaused: false,
          speed: 1,
          lastClockSyncAt: Date.now(),
        }))
        get().resumeLoop()
      },
      configureLineup: (profileIds) => {
        const activeProfileIds = sanitizeProfileIds(profileIds)
        clearScheduledTimeout()
        set(() => ({
          table: resetTableState(tableConfig, getProfilesForLineup(activeProfileIds), Date.now()),
          activeProfileIds,
          isPaused: false,
          speed: 1,
          lastClockSyncAt: Date.now(),
        }))
        get().resumeLoop()
      },
      applyHeroAction: (command) => {
        clearScheduledTimeout()
        set((state) => {
          const synced = withSyncedClock(state)
          const actorId = synced.table.currentActorId
          if (!actorId || actorId !== 'hero') {
            return {
              table: synced.table,
              lastClockSyncAt: synced.lastClockSyncAt,
            }
          }

          const legal = getLegalActions(synced.table, actorId)
          if (!legal) {
            return {
              table: synced.table,
              lastClockSyncAt: synced.lastClockSyncAt,
            }
          }

          return {
            table: applyPlayerCommand(synced.table, actorId, command),
            lastClockSyncAt: Date.now(),
          }
        })
        get().resumeLoop()
      },
      syncClock: () => {
        set((state) => withSyncedClock(state))
      },
      advanceTime: (milliseconds) => {
        const elapsed = Math.max(0, Math.round(milliseconds))
        set((state) => ({
          table: {
            ...state.table,
            sessionElapsedMs: state.table.sessionElapsedMs + elapsed,
          },
        }))
      },
    }),
    {
      name: 'local-poker-table-state-v5-configurable-lineup-gto',
      version: 1,
      migrate: (persistedState) => {
        const persisted = persistedState as Partial<PokerStoreState>
        const activeProfileIds = sanitizeProfileIds(persisted.activeProfileIds ?? defaultActiveProfileIds)

        return {
          ...persisted,
          table: resetTableState(tableConfig, getProfilesForLineup(activeProfileIds), Date.now()),
          activeProfileIds,
          isPaused: false,
          speed: 1,
          lastClockSyncAt: Date.now(),
        }
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PokerStoreState>
        const persistedTable = persisted.table
        const activeProfileIds = sanitizeProfileIds(persisted.activeProfileIds ?? currentState.activeProfileIds)

        return {
          ...currentState,
          ...persisted,
          activeProfileIds,
          table: persistedTable
            ? {
                ...currentState.table,
                ...persistedTable,
                players: (persistedTable.players ?? currentState.table.players).map((player) => ({
                  ...player,
                  totalRebuyAmount:
                    player.totalRebuyAmount ?? player.rebuys * currentState.table.config.rebuy.defaultAmount,
                })),
                deck: persistedTable.deck ?? currentState.table.deck,
                board: persistedTable.board ?? currentState.table.board,
                pots: persistedTable.pots ?? currentState.table.pots,
                history: persistedTable.history ?? currentState.table.history,
                showdown: persistedTable.showdown ?? currentState.table.showdown,
                handSummaries: persistedTable.handSummaries ?? currentState.table.handSummaries,
                lastWinnerIds: persistedTable.lastWinnerIds ?? currentState.table.lastWinnerIds,
              }
            : currentState.table,
        }
      },
      partialize: (state) => ({
        table: state.table,
        activeProfileIds: state.activeProfileIds,
        isPaused: state.isPaused,
        speed: state.speed,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return
        }
        state.lastClockSyncAt = state.isPaused ? null : Date.now()
      },
    },
  ),
)
