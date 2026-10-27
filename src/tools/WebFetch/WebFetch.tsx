import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { isOffline, OFFLINE_MESSAGE } from '../../services/offline.js'
import { runHost, SETUP_HINT } from '../../services/runtime.js'
import { guardedFetch, stripHtml } from '../../services/webGuard.js'
import { getCwd } from '../../utils/state.js'
import { search } from '../WebSearch/WebSearch.js'

const fetchSchema = z.object({ url: z.string() })

async function fetchText(raw: string, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
  if (isOffline()) return { text: OFFLINE_MESSAGE, isError: true }
  const timeout = AbortSignal.timeout(20_000)
  const response = await guardedFetch(raw, {
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  }, 'public')
  const body = await response.text()
  const type = response.headers.get('content-type') ?? ''
  const text = type.includes('html') ? stripHtml(body) : body.slice(0, 20_000)
  return { text, isError: response.status >= 400 }
}

export const WebFetchTool = {
  name: 'WebFetch',
  userFacingName: () => 'Web fetch',
  description: async () => 'Fetch a public http or https page as text.',
  prompt: async () => 'Fetch a public documentation page. Loopback and private addresses are blocked.',
  inputSchema: fetchSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof fetchSchema>, context: { abortController?: AbortController }) {
    const outcome = await fetchText(input.url, context.abortController?.signal).catch(error => ({
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    }))
    yield { type: 'result' as const, data: outcome.text, resultForAssistant: outcome.text, isError: outcome.isError }
  },
  renderToolUseMessage(input: z.infer<typeof fetchSchema>) {
    return input.url
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof fetchSchema, string>

const docsSchema = z.object({ library: z.string(), symbol: z.string() })

export const DocsTool = {
  name: 'Docs',
  userFacingName: () => 'Docs',
  description: async () => 'Look up a library symbol in the project, then on the web.',
  prompt: async () => 'Search local type definitions and READMEs before searching the web.',
  inputSchema: docsSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof docsSchema>) {
    const local = await runHost(
      ['rg', '-n', '-F', '--glob', '*.d.ts', '--glob', 'README*', '--glob', '*.md', input.symbol, getCwd()],
      10_000,
    )
    if (local.code === 0 && local.stdout.trim()) {
      const text = local.stdout.slice(0, 20_000)
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    const text = await search(`${input.library} ${input.symbol} documentation`, 5)
    const isError = text === SETUP_HINT || text === OFFLINE_MESSAGE
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError }
  },
  renderToolUseMessage(input: z.infer<typeof docsSchema>) {
    return `${input.library} ${input.symbol}`
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof docsSchema, string>
