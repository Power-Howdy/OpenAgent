import { relative } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { isPlanMode } from '../../services/planMode.js'
import { runHost, runInSandbox, sandboxReady, SETUP_HINT } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({
  file: z.string().optional(),
  database: z.enum(['postgres', 'mysql']).optional(),
  url: z.string().optional(),
  statement: z.string(),
  write: z.boolean().optional(),
})

export const SqlTool = {
  name: 'Sql',
  userFacingName: () => 'SQL',
  description: async () => 'Run a SQL statement against a local sqlite file or a host database client.',
  prompt: async () => 'Query sqlite read-only unless write is true. Postgres and MySQL use the host client.',
  inputSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: (input?: { write?: boolean }) => input?.write === true,
  async *call(input: z.infer<typeof inputSchema>) {
    if (input.write && isPlanMode()) {
      const text = 'Plan mode only allows read-only SQL.'
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    const text = await query(input).catch(error => error instanceof Error ? error.message : String(error))
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.statement
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

async function query(input: z.infer<typeof inputSchema>): Promise<string> {
  if (input.database === 'postgres') {
    if (!input.url) return 'url is required'
    const result = await runHost(['psql', input.url, '-c', input.statement], 20_000)
    return result.code === 0 ? result.stdout : 'Install the host psql client.'
  }
  if (input.database === 'mysql') {
    if (!input.url) return 'url is required'
    const result = await runHost(['mysql', input.url, '-e', input.statement], 20_000)
    return result.code === 0 ? result.stdout : 'Install the host mysql client.'
  }
  if (!input.file) return 'file is required'
  if (!(await sandboxReady())) return SETUP_HINT
  const guest = `/workspace/${relative(getCwd(), input.file)}`
  const argv = input.write
    ? ['sqlite3', guest, input.statement]
    : ['sqlite3', '-readonly', guest, input.statement]
  const result = await runInSandbox({
    argv,
    network: 'none',
    timeoutMs: 20_000,
    readonly: !input.write,
  })
  return `${result.stdout}${result.stderr}`.trim() || `exit ${result.code}`
}
