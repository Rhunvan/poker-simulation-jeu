const CATEGORY_LABELS: Record<string, string> = {
  'high-card': 'hauteur',
  pair: 'paire',
  'one-pair': 'paire',
  'two-pair': 'double paire',
  'three-of-a-kind': 'brelan',
  straight: 'suite',
  flush: 'couleur',
  'full-house': 'full',
  'four-of-a-kind': 'carre',
  'straight-flush': 'quinte flush',
  'royal-flush': 'quinte flush royale',
  uncontested: 'sans abattage',
  showdown: 'abattage',
}

const RANK_NAMES: Record<string, { singular: string; plural: string }> = {
  A: { singular: 'as', plural: 'as' },
  K: { singular: 'roi', plural: 'rois' },
  Q: { singular: 'dame', plural: 'dames' },
  J: { singular: 'valet', plural: 'valets' },
  T: { singular: 'dix', plural: 'dix' },
  '9': { singular: 'neuf', plural: 'neufs' },
  '8': { singular: 'huit', plural: 'huit' },
  '7': { singular: 'sept', plural: 'sept' },
  '6': { singular: 'six', plural: 'sixes' },
  '5': { singular: 'cinq', plural: 'cinq' },
  '4': { singular: 'quatre', plural: 'quatre' },
  '3': { singular: 'trois', plural: 'trois' },
  '2': { singular: 'deux', plural: 'deux' },
}

export function rankName(rank: string, plural = false): string {
  const fallback = plural ? rank : rank
  const labels = RANK_NAMES[rank.toUpperCase()]
  if (!labels) {
    return fallback
  }
  return plural ? labels.plural : labels.singular
}

function formatPairLabel(rank: string): string {
  const pluralRank = rankName(rank, true)
  if (pluralRank === 'as') {
    return "paire d'as"
  }
  return `paire de ${pluralRank}`
}

export function formatHandDescription(category: string, description: string, wonUncontested = false): string {
  if (wonUncontested) {
    return 'sans abattage'
  }

  if (description === 'Royal Flush') {
    return 'quinte flush royale'
  }

  const highCardMatch = description.match(/^([2-9TJQKA]) High$/)
  if (highCardMatch) {
    return `hauteur ${rankName(highCardMatch[1])}`
  }

  const pairMatch = description.match(/^Pair, ([2-9TJQKA])'s$/)
  if (pairMatch) {
    return formatPairLabel(pairMatch[1])
  }

  const twoPairMatch = description.match(/^Two Pair, ([2-9TJQKA])'s? & ([2-9TJQKA])'s$/)
  if (twoPairMatch) {
    return `double paire, ${rankName(twoPairMatch[1])} et ${rankName(twoPairMatch[2])}`
  }

  const tripsMatch = description.match(/^Three of a Kind, ([2-9TJQKA])'s$/)
  if (tripsMatch) {
    return `brelan de ${rankName(tripsMatch[1], true)}`
  }

  const fullHouseMatch = description.match(/^Full House, ([2-9TJQKA])'s over ([2-9TJQKA])'s$/)
  if (fullHouseMatch) {
    return `full, ${rankName(fullHouseMatch[1], true)} par ${rankName(fullHouseMatch[2], true)}`
  }

  const quadsMatch = description.match(/^Four of a Kind, ([2-9TJQKA])'s$/)
  if (quadsMatch) {
    return `carre de ${rankName(quadsMatch[1], true)}`
  }

  const straightMatch = description.match(/^Straight, ([2-9TJQKA])[cdhs]? High$/)
  if (straightMatch) {
    return `suite au ${rankName(straightMatch[1])}`
  }

  const flushMatch = description.match(/^Flush, ([2-9TJQKA])[cdhs]? High$/)
  if (flushMatch) {
    return `couleur au ${rankName(flushMatch[1])}`
  }

  const straightFlushMatch = description.match(/^Straight Flush, ([2-9TJQKA])[cdhs]? High$/)
  if (straightFlushMatch) {
    return `quinte flush au ${rankName(straightFlushMatch[1])}`
  }

  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ')
}
