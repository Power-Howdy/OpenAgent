const STOP = new Set([
  'a',
  'an',
  'the',
  'to',
  'for',
  'of',
  'and',
  'or',
  'in',
  'on',
  'with',
  'this',
  'that',
  'is',
  'it',
  'be',
  'as',
  'at',
  'by',
  'from',
  'use',
  'using',
])

export const MATCH_MIN = 0.34
export const MATCH_MARGIN = 0.08

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2 && !STOP.has(token))
}

export function scoreText(query: string, document: string): number {
  const queryTokens = tokens(query)
  if (!queryTokens.length) return 0
  const doc = new Set(tokens(document))
  let hits = 0
  for (const token of queryTokens) {
    if (doc.has(token)) hits++
  }
  return hits / queryTokens.length
}

export type Scored<T> = { item: T; score: number }

export function rankItems<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string,
): Scored<T>[] {
  return items
    .map(item => ({ item, score: scoreText(query, textOf(item)) }))
    .sort((a, b) => b.score - a.score)
}

export function selectMatch<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string,
  min = MATCH_MIN,
  margin = MATCH_MARGIN,
): T | null {
  const ranked = rankItems(query, items, textOf)
  const best = ranked[0]
  if (!best || best.score < min) return null
  const second = ranked[1]?.score ?? 0
  if (best.score - second < margin) return null
  return best.item
}

export function topK<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string,
  k = 5,
): T[] {
  return rankItems(query, items, textOf)
    .filter(item => item.score > 0)
    .slice(0, k)
    .map(item => item.item)
}
