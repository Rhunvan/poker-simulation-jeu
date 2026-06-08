export function normalizeSeed(seed: number): number {
  return (seed >>> 0) || 1
}

export function nextRandom(seed: number): { seed: number; value: number } {
  const nextSeed = normalizeSeed(seed + 0x6d2b79f5)
  let value = nextSeed
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  const normalized = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  return {
    seed: nextSeed,
    value: normalized,
  }
}

export function randomInt(
  seed: number,
  minInclusive: number,
  maxInclusive: number,
): { seed: number; value: number } {
  const { seed: nextSeed, value } = nextRandom(seed)
  const span = maxInclusive - minInclusive + 1
  return {
    seed: nextSeed,
    value: minInclusive + Math.floor(value * span),
  }
}

export function shuffleWithSeed<T>(
  items: T[],
  seed: number,
): { seed: number; items: T[] } {
  const copy = [...items]
  let nextSeed = seed
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const result = randomInt(nextSeed, 0, index)
    nextSeed = result.seed
    const swapIndex = result.value
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return {
    seed: nextSeed,
    items: copy,
  }
}

export function weightedChoice<T>(
  seed: number,
  entries: Array<{ item: T; weight: number }>,
): { seed: number; item: T } {
  const positive = entries.filter((entry) => entry.weight > 0)
  if (positive.length === 0) {
    return {
      seed,
      item: entries[0].item,
    }
  }

  const total = positive.reduce((sum, entry) => sum + entry.weight, 0)
  const { seed: nextSeed, value } = nextRandom(seed)
  let cursor = value * total

  for (const entry of positive) {
    cursor -= entry.weight
    if (cursor <= 0) {
      return {
        seed: nextSeed,
        item: entry.item,
      }
    }
  }

  return {
    seed: nextSeed,
    item: positive[positive.length - 1].item,
  }
}
