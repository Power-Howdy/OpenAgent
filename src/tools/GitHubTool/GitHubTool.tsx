import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { isPlanMode } from '../../services/planMode.js'
import { runHost } from '../../services/runtime.js'

const inputSchema = z.object({
  action: z.enum(['issue_list', 'issue_view', 'issue_create', 'pr_diff', 'pr_comment']),
  number: z.number().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
})

const WRITES = new Set(['issue_create', 'pr_comment'])

export const GitHubTool = {
  name: 'GitHub',
  userFacingName: () => 'GitHub',
  description: async () => 'List, view, and create GitHub issues, and read or comment on a pull request.',
  prompt: async () => 'Use the host gh command. Jira and Linear stay on MCP.',
  inputSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: (input?: { action?: string }) => input?.action === 'issue_create' || input?.action === 'pr_comment',
  async *call(input: z.infer<typeof inputSchema>) {
    if (WRITES.has(input.action) && isPlanMode()) {
      const text = 'Plan mode only allows GitHub reads.'
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    const text = await github(input)
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.number ? `${input.action} ${input.number}` : input.action
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

async function github(input: z.infer<typeof inputSchema>): Promise<string> {
  const argv = githubArgv(input)
  if (!argv) return 'That GitHub action needs a number, title, or body.'
  const result = await runHost(argv, 30_000)
  if (result.code !== 0 && !result.stdout && !result.stderr) {
    return 'Install GitHub CLI and run gh auth login.'
  }
  return (result.stdout || result.stderr).slice(0, 20_000)
}

export function githubArgv(input: z.infer<typeof inputSchema>): string[] | null {
  if (input.action === 'issue_list') return ['gh', 'issue', 'list', '--limit', '20', '--json', 'number,title,state']
  if (input.action === 'issue_view') {
    if (!input.number) return null
    return ['gh', 'issue', 'view', String(input.number), '--json', 'number,title,body,comments']
  }
  if (input.action === 'issue_create') {
    if (!input.title || !input.body) return null
    return ['gh', 'issue', 'create', '--title', input.title, '--body', input.body]
  }
  if (input.action === 'pr_diff') {
    if (!input.number) return null
    return ['gh', 'pr', 'diff', String(input.number)]
  }
  if (!input.number || !input.body) return null
  return ['gh', 'pr', 'comment', String(input.number), '--body', input.body]
}
