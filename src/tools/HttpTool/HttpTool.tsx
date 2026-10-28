import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { isOffline } from '../../services/offline.js'
import { guardedFetch, isLoopback } from '../../services/webGuard.js'

const inputSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

export const HttpTool = {
  name: 'Http',
  userFacingName: () => 'HTTP',
  description: async () => 'Call an HTTP endpoint and return the status and body.',
  prompt: async () => 'Call a local or public endpoint. Metadata addresses are blocked.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>, context: { abortController?: AbortController }) {
    const outcome = await request(input, context.abortController?.signal).catch(error => ({
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    }))
    yield { type: 'result' as const, data: outcome.text, resultForAssistant: outcome.text, isError: outcome.isError }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return `${input.method} ${input.url}`
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

async function request(input: z.infer<typeof inputSchema>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
  const timeout = AbortSignal.timeout(20_000)
  const response = await guardedFetch(input.url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  }, 'http', url => !isOffline() || isLoopback(url.hostname))
  const body = (await response.text()).slice(0, 20_000)
  return { text: `${response.status}\n${body}`, isError: response.status >= 400 }
}
