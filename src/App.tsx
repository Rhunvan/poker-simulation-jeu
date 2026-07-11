import { useEffect } from 'react'

import { botProfiles, botProfilesById } from './config/botProfiles'
import { getHeroAdvice } from './engine/advisor/heroAdvisor'
import { getLegalActions } from './engine/rules/legalActions'
import { TableView } from './ui/TableView'
import { usePokerStore } from './store/usePokerStore'

declare global {
  interface Window {
    render_game_to_text?: () => string
    advanceTime?: (milliseconds: number) => void
  }
}

function App() {
  const table = usePokerStore((state) => state.table)
  const activeProfileIds = usePokerStore((state) => state.activeProfileIds)
  const speed = usePokerStore((state) => state.speed)
  const isPaused = usePokerStore((state) => state.isPaused)
  const resumeLoop = usePokerStore((state) => state.resumeLoop)
  const togglePause = usePokerStore((state) => state.togglePause)
  const setSpeed = usePokerStore((state) => state.setSpeed)
  const resetSession = usePokerStore((state) => state.resetSession)
  const configureLineup = usePokerStore((state) => state.configureLineup)
  const applyHeroAction = usePokerStore((state) => state.applyHeroAction)

  useEffect(() => {
    resumeLoop()
  }, [resumeLoop])

  useEffect(() => {
    window.render_game_to_text = () => {
      const state = usePokerStore.getState()
      const currentTable = state.table
      const hero = currentTable.players.find((player) => player.id === 'hero') ?? null
      const legal = hero ? getLegalActions(currentTable, hero.id) : null
      const advice = hero ? getHeroAdvice(currentTable, botProfilesById, hero.id) : null

      return JSON.stringify({
        coordinateSystem: 'Poker table seats run clockwise; hero seat is the visual bottom anchor.',
        handNumber: currentTable.handNumber,
        street: currentTable.street,
        handInProgress: currentTable.handInProgress,
        currentActorId: currentTable.currentActorId,
        board: currentTable.board.map((card) => card.code),
        pot: currentTable.players.reduce((sum, player) => sum + player.totalCommitted, 0),
        hero: hero
          ? {
              stack: hero.stack,
              cards: hero.holeCards.map((card) => card.code),
              currentBet: hero.currentBet,
              folded: hero.hasFolded,
              legalActions: legal?.options.map((option) => option.kind) ?? [],
            }
          : null,
        advice: advice
          ? {
              action: advice.recommendedAction,
              equity: advice.equity,
              potOdds: advice.potOdds,
              effectiveStackBb: advice.effectiveStackBb,
              suggestedTotal: advice.suggestedTotal ?? null,
              confidence: advice.confidence,
              actionMix: advice.actionMix,
            }
          : null,
        players: currentTable.players.map((player) => ({
          id: player.id,
          name: player.displayName,
          seat: player.seatIndex,
          stack: player.stack,
          folded: player.hasFolded,
          allIn: player.isAllIn,
          lastAction: player.lastAction?.label ?? null,
        })),
      })
    }
    window.advanceTime = (milliseconds) => usePokerStore.getState().advanceTime(milliseconds)

    return () => {
      delete window.render_game_to_text
      delete window.advanceTime
    }
  }, [])

  return (
    <TableView
      table={table}
      speed={speed}
      isPaused={isPaused}
      botProfiles={botProfilesById}
      availableProfiles={botProfiles}
      activeProfileIds={activeProfileIds}
      onHeroAction={applyHeroAction}
      onPauseToggle={togglePause}
      onReset={resetSession}
      onLineupApply={configureLineup}
      onSpeedChange={setSpeed}
    />
  )
}

export default App
