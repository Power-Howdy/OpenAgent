import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { packageArgv, readProjectMarkers, type PackageAction } from '../../services/projectCommands.js'
import { runHost, runInSandbox, sandboxReady, SETUP_HINT } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({
  action: z.enum(['install', 'add', 'remove']),
  name: z.string().optional(),
  isolated: z.boolean().optional(),
})

export const PackageTool = {
  name: 'Package',
  userFacingName: () => 'Package',
  description: async () => 'Install, add, or remove a project dependency.',
  prompt: async () => 'Use the project package manager. add and remove require a package name.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>, context: { abortController?: AbortController }) {
    const signal = context.abortController?.signal
    let argv: string[]
    try {
      argv = packageArgv(readProjectMarkers(getCwd()), input.action as PackageAction, input.name)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    if (input.isolated && !(await sandboxReady())) {
      yield { type: 'result' as const, data: SETUP_HINT, resultForAssistant: SETUP_HINT, isError: true }
      return
    }
    const result = input.isolated
      ? await runInSandbox({ argv, network: 'bridge', timeoutMs: 120_000, readonly: false, signal })
      : await runHost(argv, 120_000, signal)
    const text = `${result.stdout}${result.stderr}\nexit ${result.code}`.trim()
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError: result.code !== 0 }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return `${input.action} ${input.name ?? ''}`.trim()
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>
