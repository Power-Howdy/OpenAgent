import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { detectTestArgv, failureLines, readProjectMarkers, tailLines } from '../../services/projectCommands.js'
import { runHost, runInSandbox, sandboxReady, SETUP_HINT } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({
  filter: z.string().optional(),
  isolated: z.boolean().optional(),
})

export const TestTool = {
  name: 'Test',
  userFacingName: () => 'Test',
  description: async () => 'Run the project test command.',
  prompt: async () => 'Run the project tests. Set isolated when the run must stay inside the sandbox.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>, context: { abortController?: AbortController }) {
    const signal = context.abortController?.signal
    const argv = detectTestArgv(readProjectMarkers(getCwd()), input.filter)
    if (!argv) {
      const text = 'No test command found'
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    if (input.isolated && !(await sandboxReady())) {
      yield { type: 'result' as const, data: SETUP_HINT, resultForAssistant: SETUP_HINT, isError: true }
      return
    }
    const result = input.isolated
      ? await runInSandbox({ argv, network: 'none', timeoutMs: 120_000, readonly: false, signal })
      : await runHost(argv, 120_000, signal)
    const body = tailLines(`${result.stdout}\n${result.stderr}`, 200)
    const failures = failureLines(`${result.stdout}\n${result.stderr}`)
    const text = `${failures.length ? `Failures:\n${failures.join('\n')}\n` : ''}${body}\nexit ${result.code}`.trim()
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError: result.code !== 0 }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.filter ?? 'all'
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>
