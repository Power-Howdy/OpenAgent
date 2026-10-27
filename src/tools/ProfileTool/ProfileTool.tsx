import { readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { topCpuProf } from '../../services/projectCommands.js'
import { runHost } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({
  language: z.enum(['node', 'python']),
  file: z.string(),
})

export const ProfileTool = {
  name: 'Profile',
  userFacingName: () => 'Profile',
  description: async () => 'Profile a Node or Python file and return the hottest functions.',
  prompt: async () => 'Profile on the host so the result matches the user binaries.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>) {
    const text = input.language === 'node' ? await profileNode(input.file) : await profilePython(input.file)
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return `${input.language} ${input.file}`
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

async function profileNode(file: string): Promise<string> {
  const before = new Set(readdirSync(getCwd()))
  const result = await runHost(['node', '--cpu-prof', '--cpu-prof-interval=1000', file], 60_000)
  const created = readdirSync(getCwd()).filter(name => name.endsWith('.cpuprofile') && !before.has(name))
  const newest = created.sort((left, right) => statSync(join(getCwd(), right)).mtimeMs - statSync(join(getCwd(), left)).mtimeMs)[0]
  if (!newest) return result.stderr || 'No CPU profile was written.'
  const path = join(getCwd(), newest)
  const summary = topCpuProf(JSON.parse(readFileSync(path, 'utf8'))).join('\n')
  rmSync(path, { force: true })
  return summary
}

async function profilePython(file: string): Promise<string> {
  const profile = join(tmpdir(), 'openagent.cprofile')
  const ran = await runHost(['python3', '-m', 'cProfile', '-o', profile, file], 60_000)
  if (ran.code !== 0) return ran.stderr || 'Python profiler failed.'
  const printed = await runHost([
    'python3',
    '-c',
    `import pstats; stats = pstats.Stats(${JSON.stringify(profile)}); stats.sort_stats('cumulative'); stats.print_stats(20)`,
  ], 20_000)
  rmSync(profile, { force: true })
  return printed.stdout || printed.stderr
}
