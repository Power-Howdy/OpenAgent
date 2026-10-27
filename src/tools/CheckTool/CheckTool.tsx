import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { checkArgv, failureLines, readProjectMarkers, tailLines } from '../../services/projectCommands.js'
import { runHost } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({})

export const CheckTool = {
  name: 'Check',
  userFacingName: () => 'Check',
  description: async () => 'Run the project typecheck.',
  prompt: async () => 'Run the project typecheck after an edit. Fix the file and line it reports.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(_input: z.infer<typeof inputSchema>, context: { abortController?: AbortController }) {
    const argv = checkArgv(readProjectMarkers(getCwd()))
    if (!argv) {
      const text = 'No typecheck command found'
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    const result = await runHost(argv, 120_000, context.abortController?.signal)
    const output = `${result.stdout}\n${result.stderr}`
    const failures = failureLines(output)
    const text = `${failures.length ? `Failures:\n${failures.join('\n')}\n` : ''}${tailLines(output, 200)}\nexit ${result.code}`.trim()
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError: result.code !== 0 }
  },
  renderToolUseMessage() {
    return 'typecheck'
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>
