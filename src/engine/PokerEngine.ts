import type { BotProfile, BlindLevel, TableConfig } from '../config/schema'
import {
  createDeck,
  formatCards,
} from './core/cards'
import {
  getFirstActorPostflop,
  getFirstActorPreflop,
  getNextSeat,
  getSeatsInDealOrder,
  isEligibleForNextHand,
  resolveBlindAssignments,
} from './core/positions'
import { normalizeSeed, shuffleWithSeed } from './core/random'
import {
  getPlayerAtSeat,
} from './core/seatRing'
import type {
  ActionKind,
  BettingStreet,
  PlayerCommand,
  PlayerMemory,
  TablePlayer,
  TableState,
} from './core/types'
import { compareHoldemHands } from './eval/handEvaluator'
import {
  canPlayerAct,
  countPlayersAbleToAct,
  getLegalActions,
  getPlayerById,
  isBettingRoundComplete,
  isPlayerStillInHand,
} from './rules/legalActions'
import { buildPots, getOddChipRecipients, getPotTotal } from './rules/pots'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createDefaultMemory(): PlayerMemory {
  return {
    tilt: 0,
    caution: 0,
    confidence: 0.5,
    revengeTargetId: null,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    recentEvents: [],
  }
}

function createHero(seatIndex: number, startingStack: number): TablePlayer {
  return {
    id: 'hero',
    seatIndex,
    kind: 'human',
    displayName: 'Hero',
    stack: startingStack,
    startingStack,
    holeCards: [],
    hasFolded: true,
    isAllIn: false,
    isSittingOut: false,
    currentBet: 0,
    totalCommitted: 0,
    totalWonThisHand: 0,
    hasActedThisRound: false,
    lastFullRaiseSeen: 0,
    lastAction: null,
    cardsVisible: true,
    rebuys: 0,
    tableTalk: null,
    memory: createDefaultMemory(),
  }
}

function createBot(profile: BotProfile, seatIndex: number, startingStack: number): TablePlayer {
  return {
    id: profile.id,
    seatIndex,
    kind: 'bot',
    displayName: profile.displayName,
    stack: startingStack,
    startingStack,
    holeCards: [],
    hasFolded: true,
    isAllIn: false,
    isSittingOut: false,
    currentBet: 0,
    totalCommitted: 0,
    totalWonThisHand: 0,
    hasActedThisRound: false,
    lastFullRaiseSeen: 0,
    lastAction: null,
    cardsVisible: false,
    rebuys: 0,
    botProfileId: profile.id,
    tableTalk: null,
    memory: createDefaultMemory(),
  }
}

function createTablePlayers(
  config: TableConfig,
  profiles: BotProfile[],
  seed: number,
): { players: TablePlayer[]; seed: number } {
  const normalizedSeed = normalizeSeed(seed)
  const heroSeatIndex = config.heroSeatIndex
  const players: TablePlayer[] = config.includeHero ? [createHero(heroSeatIndex, config.startingStack)] : []
  if (config.includeHero && players[0]) {
    players[0].displayName = config.heroDisplayName
  }

  const availableSeatIndices = Array.from({ length: config.maxSeats }, (_, seatIndex) => seatIndex).filter(
    (seatIndex) => !config.includeHero || seatIndex !== heroSeatIndex,
  )
  const selectedProfiles =
    profiles.length > availableSeatIndices.length
      ? shuffleWithSeed(profiles, normalizedSeed).items.slice(0, availableSeatIndices.length)
      : profiles.slice(0, availableSeatIndices.length)
  const shuffledSeats = shuffleWithSeed(availableSeatIndices, normalizedSeed)

  selectedProfiles.forEach((profile, index) => {
    const seatIndex = shuffledSeats.items[index]
    if (seatIndex !== undefined) {
      players.push(createBot(profile, seatIndex, config.startingStack))
    }
  })

  players.sort((left, right) => left.seatIndex - right.seatIndex)

  return {
    players,
    seed: shuffledSeats.seed,
  }
}

function appendHistory(
  state: TableState,
  street: BettingStreet | 'meta',
  text: string,
  actorId?: string,
  amount?: number,
): void {
  state.history.push({
    id: state.nextHistoryId,
    handNumber: state.handNumber,
    street,
    text,
    actorId,
    amount,
  })
  state.nextHistoryId += 1
  if (state.history.length > 350) {
    state.history = state.history.slice(-350)
  }
}

function getBlindLevel(config: TableConfig, index: number): BlindLevel {
  return (
    config.blindSchedule?.[index] ?? {
      level: 1,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      ante: config.ante,
      durationMinutes: 20,
    }
  )
}

function resolveBlindLevelIndex(config: TableConfig, sessionElapsedMs: number): number {
  if (config.mode !== 'tournament' || config.blindProgression !== 'elapsed' || !config.blindSchedule?.length) {
    return 0
  }

  let remainingMinutes = sessionElapsedMs / 60_000
  for (let index = 0; index < config.blindSchedule.length; index += 1) {
    const level = config.blindSchedule[index]
    if (remainingMinutes < level.durationMinutes) {
      return index
    }
    remainingMinutes -= level.durationMinutes
  }

  return Math.max(0, config.blindSchedule.length - 1)
}

function resetPlayerForHand(player: TablePlayer, willParticipate: boolean): void {
  player.holeCards = []
  player.hasFolded = !willParticipate
  player.isAllIn = false
  player.currentBet = 0
  player.totalCommitted = 0
  player.totalWonThisHand = 0
  player.hasActedThisRound = false
  player.lastFullRaiseSeen = 0
  player.lastAction = null
  player.cardsVisible = player.kind === 'human'
  player.tableTalk = null
}

function setAction(
  player: TablePlayer,
  street: BettingStreet,
  kind: ActionKind,
  amount: number,
  label: string,
): void {
  player.lastAction = {
    kind,
    amount,
    label,
    street,
  }
}

function contributeChips(
  player: TablePlayer,
  amount: number,
  includeInCurrentBet: boolean,
): number {
  const actual = Math.min(amount, player.stack)
  player.stack -= actual
  player.totalCommitted += actual
  if (includeInCurrentBet) {
    player.currentBet += actual
  }
  if (player.stack === 0) {
    player.isAllIn = true
  }
  return actual
}

function autoRebuyPlayers(state: TableState): void {
  if (!state.config.rebuy.enabled || state.config.rebuy.policy !== 'auto-when-busted') {
    return
  }

  for (const player of state.players) {
    if (player.stack > 0 || player.isSittingOut) {
      continue
    }

    player.stack = state.config.rebuy.defaultAmount
    player.rebuys += 1
    appendHistory(
      state,
      'meta',
      `${player.displayName} rebuy for ${state.config.rebuy.defaultAmount} ${state.config.currencyLabel}`,
      player.id,
      state.config.rebuy.defaultAmount,
    )
  }
}

function dealHoleCards(state: TableState, participatingSeatIndices: number[], dealerSeatIndex: number): void {
  const participatingSeatSet = new Set(participatingSeatIndices)
  const orderedSeats = getSeatsInDealOrder(
    state.players,
    dealerSeatIndex,
    state.config.maxSeats,
    (player) => participatingSeatSet.has(player.seatIndex),
  )

  for (let round = 0; round < 2; round += 1) {
    for (const seatIndex of orderedSeats) {
      const player = getPlayerAtSeat(state.players, seatIndex)
      const card = state.deck.shift()
      if (player && card) {
        player.holeCards.push(card)
      }
    }
  }
}

function dealCommunityCards(state: TableState, street: BettingStreet): void {
  const count = street === 'flop' ? 3 : 1
  for (let index = 0; index < count; index += 1) {
    const card = state.deck.shift()
    if (card) {
      state.board.push(card)
    }
  }
}

function updatePots(state: TableState): void {
  state.pots = buildPots(state.players)
}

function buildHandSummaryPlayerResults(state: TableState): TableState['handSummaries'][number]['playerResults'] {
  return state.players.map((player) => ({
    playerId: player.id,
    participated: player.holeCards.length > 0 || player.totalCommitted > 0 || player.totalWonThisHand > 0,
    committed: player.totalCommitted,
    wonAmount: player.totalWonThisHand,
    net: player.totalWonThisHand - player.totalCommitted,
  }))
}

function appendHandSummary(
  state: TableState,
  showdown: boolean,
  winners: TableState['handSummaries'][number]['winners'],
  shownHands?: TableState['handSummaries'][number]['shownHands'],
): void {
  state.handSummaries.push({
    handNumber: state.handNumber,
    showdown,
    endedAtSessionMs: state.sessionElapsedMs,
    potAmount: getPotTotal(state.players),
    board: state.board.map((card) => card.code),
    winners,
    shownHands,
    playerResults: buildHandSummaryPlayerResults(state),
  })
}

function getNextUnsettledActorSeat(state: TableState, fromSeatIndex: number): number | null {
  const seatIndex = getNextSeat(
    state.players,
    fromSeatIndex,
    (player) => canPlayerAct(player) && (!player.hasActedThisRound || player.currentBet !== state.currentBet),
    state.config.maxSeats,
  )
  return seatIndex === fromSeatIndex ? null : seatIndex
}

function resolveRemainingActiveIds(state: TableState): string[] {
  return state.players.filter(isPlayerStillInHand).map((player) => player.id)
}

function awardUncontestedPot(state: TableState, winnerId: string): void {
  const winner = getPlayerById(state, winnerId)
  const potAmount = getPotTotal(state.players)
  winner.stack += potAmount
  winner.totalWonThisHand += potAmount
  winner.cardsVisible = true
  state.lastWinnerIds = [winnerId]
  state.handInProgress = false
  state.currentActorId = null
  state.street = 'showdown'
  updatePots(state)
  appendHistory(
    state,
    'showdown',
    `${winner.displayName} wins ${potAmount} ${state.config.currencyLabel} uncontested`,
    winner.id,
    potAmount,
  )
  appendHandSummary(state, false, [
    {
      playerId: winner.id,
      amount: potAmount,
      category: 'uncontested',
      description: 'wins uncontested',
      wonUncontested: true,
    },
  ])
}

function pushMemoryEvent(
  player: TablePlayer,
  type: PlayerMemory['recentEvents'][number]['type'],
  handNumber: number,
  intensity: number,
  targetPlayerId?: string,
): void {
  player.memory.recentEvents.push({
    type,
    handNumber,
    intensity,
    targetPlayerId,
  })
  player.memory.recentEvents = player.memory.recentEvents.slice(-6)
}

function updateMemoriesAfterHand(state: TableState): void {
  const bigBlind = getBlindLevel(state.config, state.currentLevelIndex).bigBlind

  for (const player of state.players) {
    const net = player.totalWonThisHand - player.totalCommitted
    if (net > 0) {
      player.memory.consecutiveWins += 1
      player.memory.consecutiveLosses = 0
      player.memory.confidence = clamp(player.memory.confidence + 0.08, 0, 1)
      player.memory.tilt = clamp(player.memory.tilt - 0.06, 0, 1)
      player.memory.caution = clamp(player.memory.caution - 0.04, 0, 1)
    } else if (net < 0) {
      player.memory.consecutiveLosses += 1
      player.memory.consecutiveWins = 0
      player.memory.confidence = clamp(player.memory.confidence - 0.07, 0, 1)
      player.memory.tilt = clamp(player.memory.tilt + 0.09, 0, 1)
      player.memory.caution = clamp(player.memory.caution + 0.04, 0, 1)
      const revengeTarget = state.lastWinnerIds.find((winnerId) => winnerId !== player.id)
      player.memory.revengeTargetId = revengeTarget ?? player.memory.revengeTargetId
    }

    if (net >= bigBlind * 5) {
      pushMemoryEvent(player, 'won-big', state.handNumber, Math.min(1, net / (bigBlind * 20)))
    }
    if (net <= -bigBlind * 5) {
      pushMemoryEvent(
        player,
        'lost-big',
        state.handNumber,
        Math.min(1, Math.abs(net) / (bigBlind * 20)),
        state.lastWinnerIds[0],
      )
    }
    if (player.memory.consecutiveWins >= 2) {
      pushMemoryEvent(player, 'hot-streak', state.handNumber, clamp(player.memory.consecutiveWins / 5, 0, 1))
    }
    if (player.memory.consecutiveLosses >= 2) {
      pushMemoryEvent(player, 'cold-streak', state.handNumber, clamp(player.memory.consecutiveLosses / 5, 0, 1))
    }
  }
}

function resolveShowdown(state: TableState): void {
  const contenders = state.players.filter((player) => !player.hasFolded && player.holeCards.length === 2)
  for (const player of contenders) {
    player.cardsVisible = true
  }

  updatePots(state)
  const awards: NonNullable<TableState['showdown']>['awards'] = []
  const showdownHands = compareHoldemHands(
    contenders.map((player) => ({
      playerId: player.id,
      holeCards: player.holeCards,
      board: state.board,
    })),
  ).evaluations

  const winnerIds = new Set<string>()
  const winnerAmounts = new Map<string, number>()

  for (const pot of state.pots) {
    const eligibleContenders = contenders.filter((player) => pot.eligiblePlayerIds.includes(player.id))
    if (eligibleContenders.length === 0) {
      continue
    }

    const comparison = compareHoldemHands(
      eligibleContenders.map((player) => ({
        playerId: player.id,
        holeCards: player.holeCards,
        board: state.board,
      })),
    )

    const share = Math.floor(pot.amount / comparison.winners.length)
    const remainder = pot.amount - share * comparison.winners.length
    const oddChipWinnerIds =
      remainder > 0
        ? getOddChipRecipients(
            comparison.winners,
            state.players,
            state.dealerSeatIndex,
            remainder,
            state.config.maxSeats,
          )
        : []

    for (const winnerId of comparison.winners) {
      const winner = getPlayerById(state, winnerId)
      const oddChipBonus = oddChipWinnerIds.filter((entry) => entry === winnerId).length
      const payout = share + oddChipBonus
      winner.stack += payout
      winner.totalWonThisHand += payout
      winnerIds.add(winnerId)
      winnerAmounts.set(winnerId, (winnerAmounts.get(winnerId) ?? 0) + payout)
    }

    awards.push({
      potId: pot.id,
      label: pot.label,
      amount: pot.amount,
      winnerIds: comparison.winners,
      share,
      oddChipWinnerIds: oddChipWinnerIds.length > 0 ? oddChipWinnerIds : undefined,
    })
  }

  state.showdown = {
    hands: showdownHands,
    awards,
  }
  state.lastWinnerIds = [...winnerIds]
  state.currentActorId = null
  state.handInProgress = false
  state.street = 'showdown'

  for (const award of awards) {
    const names = award.winnerIds.map((winnerId) => getPlayerById(state, winnerId).displayName).join(', ')
    appendHistory(
      state,
      'showdown',
      `${award.label}: ${names} win ${award.amount} ${state.config.currencyLabel}`,
    )
  }

  appendHandSummary(
    state,
    true,
    [...winnerIds].map((winnerId) => {
      const hand = showdownHands.find((entry) => entry.playerId === winnerId)
      return {
        playerId: winnerId,
        amount: winnerAmounts.get(winnerId) ?? 0,
        category: hand?.category ?? 'showdown',
        description: hand?.description ?? 'showdown',
        wonUncontested: false,
      }
    }),
    showdownHands.map((hand) => ({
      playerId: hand.playerId,
      category: hand.category,
      description: hand.description,
      holeCards: getPlayerById(state, hand.playerId).holeCards.map((card) => card.code),
    })),
  )
}

function runoutToShowdown(state: TableState): void {
  while (state.board.length < 5) {
    const nextStreet =
      state.board.length === 0 ? 'flop' : state.board.length === 3 ? 'turn' : 'river'
    state.street = nextStreet
    dealCommunityCards(state, nextStreet)
    appendHistory(state, nextStreet, `${nextStreet.toUpperCase()}: ${formatCards(state.board)}`)
  }
  resolveShowdown(state)
}

function advanceStreet(state: TableState): void {
  const nextStreet =
    state.street === 'preflop'
      ? 'flop'
      : state.street === 'flop'
        ? 'turn'
        : state.street === 'turn'
          ? 'river'
          : 'showdown'

  if (nextStreet === 'showdown') {
    resolveShowdown(state)
    return
  }

  for (const player of state.players) {
    player.currentBet = 0
    player.hasActedThisRound = false
    player.lastFullRaiseSeen = 0
  }

  state.street = nextStreet
  state.currentBet = 0
  state.lastFullRaiseSize = getBlindLevel(state.config, state.currentLevelIndex).bigBlind
  state.fullRaiseCounter = 0
  dealCommunityCards(state, nextStreet)
  appendHistory(state, nextStreet, `${nextStreet.toUpperCase()}: ${formatCards(state.board)}`)

  if (countPlayersAbleToAct(state) <= 1 && resolveRemainingActiveIds(state).length > 1) {
    runoutToShowdown(state)
    return
  }

  const firstSeat = getFirstActorPostflop(
    state.players,
    state.dealerSeatIndex,
    canPlayerAct,
    state.config.maxSeats,
  )
  state.currentActorId =
    firstSeat === null ? null : getPlayerAtSeat(state.players, firstSeat)?.id ?? null
  if (!state.currentActorId) {
    resolveShowdown(state)
  }
}

function finalizeAction(state: TableState, actor: TablePlayer): void {
  updatePots(state)

  const activeIds = resolveRemainingActiveIds(state)
  if (activeIds.length === 1) {
    awardUncontestedPot(state, activeIds[0])
    updateMemoriesAfterHand(state)
    return
  }

  if (isBettingRoundComplete(state)) {
    advanceStreet(state)
    if (!state.handInProgress) {
      updateMemoriesAfterHand(state)
    }
    return
  }

  const nextSeat = getNextUnsettledActorSeat(state, actor.seatIndex)
  state.currentActorId =
    nextSeat === null ? null : getPlayerAtSeat(state.players, nextSeat)?.id ?? null
}

function applyCallLikeAction(
  state: TableState,
  actor: TablePlayer,
  labelKind: 'call' | 'all-in',
): void {
  const toCall = Math.max(0, state.currentBet - actor.currentBet)
  const added = contributeChips(actor, toCall, true)
  actor.hasActedThisRound = true
  actor.lastFullRaiseSeen = state.fullRaiseCounter
  const isAllInCall = actor.isAllIn && added < toCall
  setAction(
    actor,
    state.street,
    isAllInCall ? 'all-in' : labelKind,
    added,
    isAllInCall ? `Call all-in ${added}` : `Call ${added}`,
  )
  appendHistory(state, state.street, `${actor.displayName}: ${actor.lastAction?.label}`, actor.id, added)
}

function applyAggressiveAction(
  state: TableState,
  actor: TablePlayer,
  kind: 'bet' | 'raise' | 'all-in',
  requestedTotal: number,
): void {
  const legal = getLegalActions(state, actor.id)
  if (!legal) {
    throw new Error('No legal actions for aggressive action')
  }

  const actionOption = legal.options.find((option) => option.kind === kind || (kind === 'all-in' && option.kind === 'all-in'))
  const minimumTotal =
    kind === 'all-in'
      ? actor.currentBet + Math.max(0, state.currentBet - actor.currentBet)
      : actionOption?.minTotal ?? actor.currentBet + Math.max(0, state.currentBet - actor.currentBet)
  const targetTotal = clamp(
    requestedTotal,
    minimumTotal,
    actor.currentBet + actor.stack,
  )
  const previousBet = state.currentBet
  const previousFullRaiseSize = state.lastFullRaiseSize
  const added = contributeChips(actor, targetTotal - actor.currentBet, true)
  const actualTotal = actor.currentBet
  const raiseDelta = actualTotal - previousBet
  const isOpeningBet = previousBet === 0
  const fullRaise = isOpeningBet
    ? actualTotal >= getBlindLevel(state.config, state.currentLevelIndex).bigBlind
    : raiseDelta >= previousFullRaiseSize

  if (actualTotal > previousBet) {
    state.currentBet = actualTotal
  }

  actor.hasActedThisRound = true

  if (actualTotal > previousBet && fullRaise) {
    state.fullRaiseCounter += 1
    state.lastFullRaiseSize = isOpeningBet ? actualTotal : raiseDelta
    for (const player of state.players) {
      if (player.id !== actor.id && canPlayerAct(player) && isPlayerStillInHand(player)) {
        player.hasActedThisRound = false
      }
    }
  }

  actor.lastFullRaiseSeen = state.fullRaiseCounter
  const label =
    kind === 'bet'
      ? `Bet ${actualTotal}`
      : kind === 'raise'
        ? `Raise to ${actualTotal}`
        : `All-in to ${actualTotal}`
  setAction(actor, state.street, kind, added, label)
  appendHistory(state, state.street, `${actor.displayName}: ${label}`, actor.id, added)
}

export function createInitialTableState(
  config: TableConfig,
  profiles: BotProfile[],
  seed = Date.now(),
): TableState {
  const normalizedSeed = normalizeSeed(seed)
  const tablePlayers = createTablePlayers(config, profiles, normalizedSeed)
  const defaultDealerSeat = config.includeHero ? config.heroSeatIndex : 0

  return {
    config,
    players: tablePlayers.players,
    handNumber: 0,
    dealerSeatIndex: defaultDealerSeat,
    smallBlindSeatIndex: defaultDealerSeat,
    bigBlindSeatIndex: defaultDealerSeat,
    currentActorId: null,
    deck: [],
    board: [],
    street: 'preflop',
    currentBet: 0,
    lastFullRaiseSize: config.bigBlind,
    fullRaiseCounter: 0,
    pots: [],
    history: [],
    showdown: null,
    handSummaries: [],
    currentLevelIndex: 0,
    sessionStartedAt: Date.now(),
    sessionElapsedMs: 0,
    handInProgress: false,
    seed: tablePlayers.seed,
    nextHistoryId: 1,
    lastWinnerIds: [],
  }
}

function startNextHandInternal(
  state: TableState,
  sessionElapsedMs: number,
  mutate: boolean,
): TableState {
  const nextState = mutate ? state : (structuredClone(state) as TableState)
  nextState.sessionElapsedMs = sessionElapsedMs
  nextState.currentLevelIndex = resolveBlindLevelIndex(nextState.config, sessionElapsedMs)
  nextState.showdown = null
  nextState.lastWinnerIds = []
  autoRebuyPlayers(nextState)

  const participants = nextState.players.filter(isEligibleForNextHand)
  if (participants.length < 2) {
    nextState.handInProgress = false
    nextState.currentActorId = null
    appendHistory(nextState, 'meta', 'Not enough players with chips to start the next hand')
    return nextState
  }

  const level = getBlindLevel(nextState.config, nextState.currentLevelIndex)
  const dealerSeatIndex =
    nextState.handNumber === 0
      ? nextState.dealerSeatIndex
      : getNextSeat(
          nextState.players,
          nextState.dealerSeatIndex,
          isEligibleForNextHand,
          nextState.config.maxSeats,
        )

  nextState.handNumber += 1
  nextState.dealerSeatIndex = dealerSeatIndex
  nextState.board = []
  nextState.street = 'preflop'
  nextState.currentBet = level.bigBlind
  nextState.lastFullRaiseSize = level.bigBlind
  nextState.fullRaiseCounter = 0
  nextState.handInProgress = true
  nextState.currentActorId = null

  for (const player of nextState.players) {
    resetPlayerForHand(player, isEligibleForNextHand(player))
  }

  const shuffled = shuffleWithSeed(createDeck(), nextState.seed)
  nextState.seed = shuffled.seed
  nextState.deck = shuffled.items

  const assignments = resolveBlindAssignments(nextState.players, dealerSeatIndex, nextState.config.maxSeats)
  nextState.dealerSeatIndex = assignments.dealerSeatIndex
  nextState.smallBlindSeatIndex = assignments.smallBlindSeatIndex
  nextState.bigBlindSeatIndex = assignments.bigBlindSeatIndex

  const participatingSeatIndices = participants.map((player) => player.seatIndex)
  dealHoleCards(nextState, participatingSeatIndices, assignments.dealerSeatIndex)
  updatePots(nextState)

  appendHistory(
    nextState,
    'meta',
    `--- Hand #${nextState.handNumber} | blinds ${level.smallBlind}/${level.bigBlind}${level.ante > 0 ? ` ante ${level.ante}` : ''} ---`,
  )

  if (level.ante > 0) {
    for (const player of nextState.players.filter((entry) => participatingSeatIndices.includes(entry.seatIndex))) {
      const paid = contributeChips(player, level.ante, false)
      if (paid > 0) {
        setAction(player, 'preflop', 'post-ante', paid, `Ante ${paid}`)
        appendHistory(nextState, 'preflop', `${player.displayName}: posts ante ${paid}`, player.id, paid)
      }
    }
  }

  const smallBlindPlayer = getPlayerAtSeat(nextState.players, assignments.smallBlindSeatIndex)
  const bigBlindPlayer = getPlayerAtSeat(nextState.players, assignments.bigBlindSeatIndex)

  if (!smallBlindPlayer || !bigBlindPlayer) {
    throw new Error('Blind assignments point to missing players')
  }

  const smallBlindPaid = contributeChips(smallBlindPlayer, level.smallBlind, true)
  setAction(smallBlindPlayer, 'preflop', 'post-small-blind', smallBlindPaid, `SB ${smallBlindPaid}`)
  appendHistory(
    nextState,
    'preflop',
    `${smallBlindPlayer.displayName}: posts small blind ${smallBlindPaid}`,
    smallBlindPlayer.id,
    smallBlindPaid,
  )

  const bigBlindPaid = contributeChips(bigBlindPlayer, level.bigBlind, true)
  setAction(bigBlindPlayer, 'preflop', 'post-big-blind', bigBlindPaid, `BB ${bigBlindPaid}`)
  appendHistory(
    nextState,
    'preflop',
    `${bigBlindPlayer.displayName}: posts big blind ${bigBlindPaid}`,
    bigBlindPlayer.id,
    bigBlindPaid,
  )

  updatePots(nextState)

  const firstSeat = getFirstActorPreflop(
    nextState.players,
    assignments.smallBlindSeatIndex,
    assignments.bigBlindSeatIndex,
    assignments.headsUp,
    canPlayerAct,
    nextState.config.maxSeats,
  )

  nextState.currentActorId =
    firstSeat === null ? null : getPlayerAtSeat(nextState.players, firstSeat)?.id ?? null

  if (!nextState.currentActorId || countPlayersAbleToAct(nextState) <= 1) {
    runoutToShowdown(nextState)
    updateMemoriesAfterHand(nextState)
  }

  return nextState
}

export function startNextHand(state: TableState, sessionElapsedMs = state.sessionElapsedMs): TableState {
  return startNextHandInternal(state, sessionElapsedMs, false)
}

export function startNextHandInPlace(state: TableState, sessionElapsedMs = state.sessionElapsedMs): TableState {
  return startNextHandInternal(state, sessionElapsedMs, true)
}

function applyPlayerCommandInternal(
  state: TableState,
  actorId: string,
  command: PlayerCommand,
  mutate = false,
): TableState {
  const nextState = mutate ? state : (structuredClone(state) as TableState)
  if (!nextState.handInProgress || nextState.currentActorId !== actorId) {
    return nextState
  }

  const legal = getLegalActions(nextState, actorId)
  if (!legal) {
    return nextState
  }
  const optionExists = legal.options.some((option) => option.kind === command.kind)
  if (!optionExists) {
    return nextState
  }

  const actor = getPlayerById(nextState, actorId)

  switch (command.kind) {
    case 'fold':
      actor.hasFolded = true
      actor.hasActedThisRound = true
      actor.lastFullRaiseSeen = nextState.fullRaiseCounter
      setAction(actor, nextState.street, 'fold', 0, 'Fold')
      appendHistory(nextState, nextState.street, `${actor.displayName}: Fold`, actor.id)
      break
    case 'check':
      actor.hasActedThisRound = true
      actor.lastFullRaiseSeen = nextState.fullRaiseCounter
      setAction(actor, nextState.street, 'check', 0, 'Check')
      appendHistory(nextState, nextState.street, `${actor.displayName}: Check`, actor.id)
      break
    case 'call':
      applyCallLikeAction(nextState, actor, 'call')
      break
    case 'bet':
      applyAggressiveAction(nextState, actor, 'bet', command.total)
      break
    case 'raise':
      applyAggressiveAction(nextState, actor, 'raise', command.total)
      break
    case 'all-in':
      if (legal.toCall > 0 && actor.stack <= legal.toCall) {
        applyCallLikeAction(nextState, actor, 'all-in')
      } else {
        applyAggressiveAction(nextState, actor, 'all-in', actor.currentBet + actor.stack)
      }
      break
    default:
      break
  }

  finalizeAction(nextState, actor)
  return nextState
}

export function applyPlayerCommand(
  state: TableState,
  actorId: string,
  command: PlayerCommand,
): TableState {
  return applyPlayerCommandInternal(state, actorId, command)
}

export function applyPlayerCommandInPlace(
  state: TableState,
  actorId: string,
  command: PlayerCommand,
): TableState {
  return applyPlayerCommandInternal(state, actorId, command, true)
}

export function resetTableState(config: TableConfig, profiles: BotProfile[], seed = Date.now()): TableState {
  const initial = createInitialTableState(config, profiles, seed)
  return startNextHand(initial, 0)
}

export function getCurrentBlindLevel(state: TableState): BlindLevel {
  return getBlindLevel(state.config, state.currentLevelIndex)
}
