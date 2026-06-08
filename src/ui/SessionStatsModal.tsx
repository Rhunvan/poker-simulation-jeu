import { useEffect } from 'react'

import type { SessionStats } from '../engine/core/types'

interface SessionStatsModalProps {
  open: boolean
  onClose: () => void
  stats: SessionStats
  currencyLabel: string
  playerName: string
}

function formatAmount(amount: number, currencyLabel: string): string {
  return `${amount.toLocaleString()} ${currencyLabel}`
}

function formatSignedAmount(amount: number, currencyLabel: string): string {
  if (amount === 0) {
    return `0 ${currencyLabel}`
  }

  const sign = amount > 0 ? '+' : '-'
  return `${sign}${Math.abs(amount).toLocaleString()} ${currencyLabel}`
}

function netClassName(amount: number): string {
  if (amount > 0) {
    return 'stat-positive'
  }
  if (amount < 0) {
    return 'stat-negative'
  }
  return ''
}

export function SessionStatsModal({
  open,
  onClose,
  stats,
  currencyLabel,
  playerName,
}: SessionStatsModalProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div className="session-modal-backdrop" onClick={onClose}>
      <div
        className="session-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-stats-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-modal-head">
          <div>
            <p className="eyebrow">Session</p>
            <h2 id="session-stats-title">Stats de {playerName}</h2>
          </div>
          <button type="button" className="session-close" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className="session-kpis">
          <div className="session-kpi">
            <span>Resultat net</span>
            <strong className={netClassName(stats.netResult)}>{formatSignedAmount(stats.netResult, currencyLabel)}</strong>
          </div>
          <div className="session-kpi">
            <span>Stack actuel</span>
            <strong>{formatAmount(stats.currentStack, currencyLabel)}</strong>
          </div>
          <div className="session-kpi">
            <span>Recaves</span>
            <strong>{stats.rebuys}</strong>
          </div>
        </div>

        <div className="session-detail-grid">
          <div className="session-detail-card">
            <span>Mains jouees</span>
            <strong>{stats.handsCompleted}</strong>
          </div>
          <div className="session-detail-card">
            <span>Mains entrees</span>
            <strong>{stats.handsEntered}</strong>
          </div>
          <div className="session-detail-card">
            <span>Mains gagnees</span>
            <strong>{stats.handsWon}</strong>
          </div>
          <div className="session-detail-card">
            <span>Gagne brut</span>
            <strong className={netClassName(stats.grossWon)}>{formatAmount(stats.grossWon, currencyLabel)}</strong>
          </div>
          <div className="session-detail-card">
            <span>Perdu brut</span>
            <strong className={stats.grossLost > 0 ? 'stat-negative' : ''}>{formatAmount(stats.grossLost, currencyLabel)}</strong>
          </div>
          <div className="session-detail-card">
            <span>Plus gros gain</span>
            <strong className={netClassName(stats.biggestWin)}>{formatAmount(stats.biggestWin, currencyLabel)}</strong>
          </div>
          <div className="session-detail-card">
            <span>Plus grosse perte</span>
            <strong className={stats.biggestLoss > 0 ? 'stat-negative' : ''}>{formatAmount(stats.biggestLoss, currencyLabel)}</strong>
          </div>
          <div className="session-detail-card">
            <span>Cave de depart</span>
            <strong>{formatAmount(stats.initialBuyIn, currencyLabel)}</strong>
          </div>
          <div className="session-detail-card">
            <span>Recaves ajoutees</span>
            <strong>{formatAmount(stats.rebuyAmount, currencyLabel)}</strong>
          </div>
          <div className="session-detail-card">
            <span>Total investi</span>
            <strong>{formatAmount(stats.totalInvested, currencyLabel)}</strong>
          </div>
        </div>

        <p className="session-note">
          Les recaves automatiques sont incluses ici, pour que tu voies enfin ce que la session t a vraiment coute.
        </p>
      </div>
    </div>
  )
}
