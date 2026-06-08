import { useEffect } from 'react'

import { botProfilesById } from './config/botProfiles'
import { TableView } from './ui/TableView'
import { usePokerStore } from './store/usePokerStore'

function App() {
  const table = usePokerStore((state) => state.table)
  const speed = usePokerStore((state) => state.speed)
  const isPaused = usePokerStore((state) => state.isPaused)
  const resumeLoop = usePokerStore((state) => state.resumeLoop)
  const togglePause = usePokerStore((state) => state.togglePause)
  const setSpeed = usePokerStore((state) => state.setSpeed)
  const resetSession = usePokerStore((state) => state.resetSession)
  const applyHeroAction = usePokerStore((state) => state.applyHeroAction)

  useEffect(() => {
    resumeLoop()
  }, [resumeLoop])

  return (
    <TableView
      table={table}
      speed={speed}
      isPaused={isPaused}
      botProfiles={botProfilesById}
      onHeroAction={applyHeroAction}
      onPauseToggle={togglePause}
      onReset={resetSession}
      onSpeedChange={setSpeed}
    />
  )
}

export default App
