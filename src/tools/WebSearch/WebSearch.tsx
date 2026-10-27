import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { isOffline, OFFLINE_MESSAGE } from '../../services/offline.js'
import { parseSearxng } from '../../services/webGuard.js'
import { SEARXNG_URL, searxngReady, SETUP_HINT } from '../../services/runtime.js'

const inputSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
})

export const WebSearchTool = {
  name: 'WebSearch',
  userFacingName: () => 'Web search',
  description: async () => 'Search the web through the local SearXNG server.',
  prompt: async () => 'Search documentation and current APIs. Results come from local SearXNG.',
  inputSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call({ query, limit = 5 }: z.infer<typeof inputSchema>) {
    const text = await search(query, Math.min(Math.max(limit, 1), 10))
    const isError = text === SETUP_HINT || text === OFFLINE_MESSAGE
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.query
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

export async function search(query: string, limit: number): Promise<string> {
  if (isOffline()) return OFFLINE_MESSAGE
  if (!(await searxngReady())) return SETUP_HINT
  try {
    const response = await fetch(
      `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`,
      { signal: AbortSignal.timeout(20_000) },
    )
    const hits = parseSearxng(await response.text(), limit)
    if (!hits.length) return 'No results.'
    return hits.map(hit => `${hit.title}\n${hit.url}\n${hit.content}`).join('\n\n')
  } catch {
    return SETUP_HINT
  }
}
