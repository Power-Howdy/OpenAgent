import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { runInSandbox, sandboxReady, SETUP_HINT } from '../../services/runtime.js'

const inputSchema = z.object({
  language: z.enum(['node', 'python', 'bash']),
  code: z.string(),
})

const BIN = { node: 'node', python: 'python3', bash: 'bash' } as const

export const RunCodeTool = {
  name: 'RunCode',
  userFacingName: () => 'Run code',
  description: async () => 'Run one snippet in the sandbox with no network.',
  prompt: async () => 'Use this for an untrusted snippet. It cannot change the project or use the network.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>, context: { abortController?: AbortController }) {
    if (!(await sandboxReady())) {
      yield { type: 'result' as const, data: SETUP_HINT, resultForAssistant: SETUP_HINT, isError: true }
      return
    }
    const dir = mkdtempSync(join(tmpdir(), 'openagent-snippet-'))
    const file = join(dir, 'snippet')
    writeFileSync(file, input.code)
    const result = await runInSandbox({
      argv: [BIN[input.language], '/snippet'],
      network: 'none',
      timeoutMs: 10_000,
      readonly: true,
      signal: context.abortController?.signal,
      mounts: [{ host: file, guest: '/snippet', readonly: true }],
    })
    const text = `${result.stdout}${result.stderr}\nexit ${result.code}`.trim()
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError: result.code !== 0 }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.language
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>
