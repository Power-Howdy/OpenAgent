import { spawn } from 'child_process'
import { Box, Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js'
import { authoringAllowed } from '../../services/capabilities.js'
import { getCwd } from '../../utils/state.js'
import {
  appendToolUsage,
  readToolCode,
  saveStoredTool,
  searchStoredTools,
  toolExists,
  toolItemDir,
  validToolId,
} from '../../tool-store/store.js'

function rejected() {
  return <FallbackToolUseRejectedMessage />
}

export const ListStoredToolsTool = {
  name: 'ListStoredTools',
  inputSchema: z.object({
    query: z.string().describe('What the task needs a stored tool to do'),
  }),
  async description() {
    return 'List the closest stored tools for this task. Returns names and descriptions, not script bodies.'
  },
  async prompt() {
    return 'Search the shared tool store before writing a new script. Use the query that describes the task.'
  },
  isReadOnly() {
    return true
  },
  isEnabled() {
    return true
  },
  userFacingName() {
    return 'Stored tools'
  },
  needsPermissions() {
    return false
  },
  renderToolUseMessage(input: { query: string }) {
    return `query: ${JSON.stringify(input.query)}`
  },
  renderToolResultMessage(output: string) {
    return (
      <Box>
        <Text>{output}</Text>
      </Box>
    )
  },
  renderToolUseRejectedMessage: rejected,
  renderResultForAssistant(output: string) {
    return output
  },
  async *call({ query }: { query: string }) {
    const items = searchStoredTools(query, 5)
    const text = items.length
      ? items.map(item => `${item.id}: ${item.description}`).join('\n')
      : 'No stored tools match.'
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
}

export const RunStoredToolTool = {
  name: 'RunStoredTool',
  inputSchema: z.object({
    id: z.string(),
    args: z.array(z.string()).optional(),
  }),
  async description() {
    return 'Run a script from the shared tool store. This asks for permission like a shell command.'
  },
  async prompt() {
    return 'Run a stored tool by id. Pass args as an array. Do not pass a shell string.'
  },
  isReadOnly() {
    return false
  },
  isEnabled() {
    return true
  },
  userFacingName() {
    return 'Run stored tool'
  },
  needsPermissions() {
    return true
  },
  renderToolUseMessage(input: { id: string }) {
    return `id: ${input.id}`
  },
  renderToolResultMessage(output: string) {
    return (
      <Box>
        <Text>{output}</Text>
      </Box>
    )
  },
  renderToolUseRejectedMessage: rejected,
  renderResultForAssistant(output: string) {
    return output
  },
  async *call({ id, args }: { id: string; args?: string[] }) {
    if (!validToolId(id) || !toolExists(id)) {
      const text = `Unknown stored tool ${id}`
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    const code = toolItemDir(id) + '/code'
    void readToolCode
    const output = await new Promise<string>(resolve => {
      const child = spawn(code, args ?? [], { cwd: getCwd() })
      let text = ''
      const timer = setTimeout(() => {
        child.kill()
        resolve(text + '\nTimed out')
      }, 30_000)
      child.stdout.on('data', chunk => {
        text += String(chunk)
      })
      child.stderr.on('data', chunk => {
        text += String(chunk)
      })
      child.on('close', () => {
        clearTimeout(timer)
        resolve(text.slice(0, 20_000))
      })
      child.on('error', error => {
        clearTimeout(timer)
        resolve(error.message)
      })
    })
    appendToolUsage(id, !output.endsWith('Timed out'))
    yield { type: 'result' as const, data: output || '(no output)', resultForAssistant: output || '(no output)' }
  },
}

export const SaveStoredToolTool = {
  name: 'SaveStoredTool',
  inputSchema: z.object({
    id: z.string(),
    description: z.string(),
    code: z.string(),
  }),
  async description() {
    return 'Save a script into the shared tool store. Capable models only. The first save of an id asks the user.'
  },
  async prompt() {
    return 'Write a small reusable script. The id must be lowercase letters, numbers, and hyphens. The file is stored only under the tool store.'
  },
  isReadOnly() {
    return false
  },
  isEnabled() {
    return true
  },
  userFacingName() {
    return 'Save stored tool'
  },
  needsPermissions(input?: { id?: string }) {
    return !input?.id || !toolExists(input.id)
  },
  renderToolUseMessage(input: { id: string }) {
    return `id: ${input.id}`
  },
  renderToolResultMessage(output: string) {
    return (
      <Box>
        <Text>{output}</Text>
      </Box>
    )
  },
  renderToolUseRejectedMessage: rejected,
  renderResultForAssistant(output: string) {
    return output
  },
  async *call({ id, description, code }: { id: string; description: string; code: string }) {
    if (!authoringAllowed()) {
      const text = 'This model can call stored tools, but it cannot write them.'
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    try {
      saveStoredTool(
        { id, description, language: 'shell', updatedAt: new Date().toISOString() },
        code,
      )
      const text = `Saved ${id}`
      yield { type: 'result' as const, data: text, resultForAssistant: text }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      yield { type: 'result' as const, data: text, resultForAssistant: text }
    }
  },
}
