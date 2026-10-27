import { existsSync } from 'fs'
import { join } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { runHost } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({ action: z.enum(['audit', 'outdated']) })

export const DepsTool = {
  name: 'Deps',
  userFacingName: () => 'Dependencies',
  description: async () => 'List dependency advisories or outdated packages.',
  prompt: async () => 'Audit or list outdated packages. This does not upgrade them.',
  inputSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>) {
    const text = await deps(input.action)
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.action
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

async function deps(action: 'audit' | 'outdated'): Promise<string> {
  const cwd = getCwd()
  const commands: string[][] = []
  if (existsSync(join(cwd, 'package.json'))) {
    commands.push(action === 'audit' ? ['npm', 'audit', '--json'] : ['npm', 'outdated', '--json'])
  }
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt'))) {
    commands.push(action === 'audit' ? ['pip-audit', '--format', 'json'] : ['pip', 'list', '--outdated', '--format', 'json'])
  }
  if (existsSync(join(cwd, 'Cargo.lock'))) {
    commands.push(action === 'audit' ? ['cargo', 'audit', '--json'] : ['cargo', 'outdated'])
  }
  if (existsSync(join(cwd, 'go.mod'))) {
    commands.push(['go', 'list', '-m', '-u', 'all'])
  }
  if (!commands.length) return 'No dependency manifest found.'
  const rows: string[] = []
  for (const argv of commands) {
    const result = await runHost(argv, 120_000)
    if (result.code !== 0 && !result.stdout) {
      rows.push(`${argv[0]} is not available.`)
      continue
    }
    rows.push((result.stdout || result.stderr).split('\n').slice(0, 30).join('\n'))
  }
  return rows.join('\n')
}
