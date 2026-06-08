import type { BotProfile } from '../config/schema'
import type { TablePlayer } from '../engine/core/types'
import { PlayingCard } from './PlayingCard'

interface SeatViewProps {
  seatIndex: number
  player?: TablePlayer
  botProfile?: BotProfile
  isHero: boolean
  isWinner: boolean
  isDealer: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
  isCurrentActor: boolean
  currencyLabel: string
}

function formatStack(amount: number, currencyLabel: string): string {
  return `${amount.toLocaleString()} ${currencyLabel}`
}

function statRangeLabel(range: [number, number]): string {
  return `${range[0]}-${range[1]}`
}

export function SeatView({
  seatIndex,
  player,
  botProfile,
  isHero,
  isWinner,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isCurrentActor,
  currencyLabel,
}: SeatViewProps) {
  if (!player) {
    return (
      <div className="seat seat-empty">
        <span className="seat-slot">Siege {seatIndex + 1}</span>
        <strong>Libre</strong>
      </div>
    )
  }

  const profileSummary = botProfile
    ? `${botProfile.summary}\n${botProfile.archetype}\nVPIP ${statRangeLabel(botProfile.targetStats.vpip)} · PFR ${statRangeLabel(botProfile.targetStats.pfr)}\nLimp ${statRangeLabel(botProfile.targetStats.limp)} · Cold call ${statRangeLabel(botProfile.targetStats.coldCall)}`
    : undefined

  return (
    <div
      className={[
        'seat',
        isHero ? 'seat-hero' : '',
        isWinner ? 'seat-winner' : '',
        isCurrentActor ? 'seat-active' : '',
        player.hasFolded ? 'seat-folded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="seat-topline">
        <span className="seat-slot">Siege {seatIndex + 1}</span>
        <div className="badge-row">
          {isDealer && <span className="badge">D</span>}
          {isSmallBlind && <span className="badge">SB</span>}
          {isBigBlind && <span className="badge">BB</span>}
          {isWinner && <span className="badge">+pot</span>}
          {botProfile && <span className="badge info-badge">Profil</span>}
        </div>
      </div>

      <div className="seat-header">
        <strong>{player.displayName}</strong>
        <span className="stack-chip">{formatStack(player.stack, currencyLabel)}</span>
      </div>

      <div className="seat-meta">
        <div className="action-line">{player.lastAction?.label ?? 'En attente'}</div>
        <div className="bet-line">
          Mise courante <strong>{player.currentBet}</strong>
        </div>
      </div>

      <div className="hole-cards">
        {player.holeCards.length === 0
          ? [0, 1].map((index) => (
              <PlayingCard key={index} hidden />
            ))
          : player.holeCards.map((card) => (
              <PlayingCard key={card.code} card={card} hidden={!player.cardsVisible} />
            ))}
      </div>

      {player.tableTalk && <div className="talk-bubble">{player.tableTalk}</div>}

      {botProfile && (
        <div className="profile-popover" role="note" aria-label={`Profil de ${player.displayName}`} title={profileSummary}>
          <strong>{botProfile.archetype}</strong>
          <p>{botProfile.summary}</p>
          <p>
            VPIP {statRangeLabel(botProfile.targetStats.vpip)} · PFR {statRangeLabel(botProfile.targetStats.pfr)} ·
            Limp {statRangeLabel(botProfile.targetStats.limp)}
          </p>
          <p>
            Cold call {statRangeLabel(botProfile.targetStats.coldCall)} · 3bet {statRangeLabel(botProfile.targetStats.threeBet)} ·
            Bluff {statRangeLabel(botProfile.targetStats.bluff)}
          </p>
          <ul>
            {botProfile.specificRules.slice(0, 3).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
