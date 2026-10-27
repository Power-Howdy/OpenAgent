import { spawn } from 'child_process'
import { Box, Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js'
import { authoringAllowed } from '../../services/capabilities.js'
import {
  blueprintCloneDir,
  blueprintIsCloned,
  loadBlueprintIndex,
  saveAuthoredBlueprint,
  selectBlueprint,
  topBlueprints,
} from '../../services/blueprintStore.js'

function rejected() {
  return <FallbackToolUseRejectedMessage />
}

export const ListBlueprintsTool = {
  name: 'ListBlueprints',
  inputSchema: z.object({
    query: z.string().describe('The task you might split across workers'),
  }),
  async description() {
    return 'List stored NVIDIA and authored blueprints that match this task.'
  },
  async prompt() {
    return 'Check for a blueprint before inventing a team. A normal coding task stays with you and your tools.'
  },
  isReadOnly() {
    return true
  },
  isEnabled() {
    return true
  },
  userFacingName() {
    return 'Blueprints'
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
    const items = topBlueprints(query, 3)
    const text = items.length
      ? items
          .map(item => `${item.id} [${item.source}] ${item.title}: ${item.description}`)
          .join('\n')
      : 'No blueprint is close to this task. Keep it as one thread unless it has two or more independent workstreams.'
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
}

export const ReadBlueprintTool = {
  name: 'ReadBlueprint',
  inputSchema: z.object({
    id: z.string(),
  }),
  async description() {
    return 'Clone a NVIDIA blueprint on demand and return its summary. This does not deploy it.'
  },
  async prompt() {
    return 'Read a blueprint as reference material. Do not start docker unless the user asked to deploy it.'
  },
  isReadOnly() {
    return false
  },
  isEnabled() {
    return true
  },
  userFacingName() {
    return 'Read blueprint'
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
  async *call({ id }: { id: string }) {
    const record = loadBlueprintIndex().find(item => item.id === id)
    if (!record) {
      const text = `Unknown blueprint ${id}`
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    if (record.source === 'nvidia' && record.repoUrl && !blueprintIsCloned(id)) {
      await new Promise<void>(resolve => {
        const child = spawn(
          'git',
          ['clone', '--depth', '1', record.repoUrl, blueprintCloneDir(id)],
          { stdio: 'ignore' },
        )
        child.on('exit', () => resolve())
        child.on('error', () => resolve())
      })
    }
    const text = [
      `${record.title}`,
      record.description,
      record.pageUrl ? `Page: ${record.pageUrl}` : '',
      record.repoUrl ? `Repo: ${record.repoUrl}` : '',
      'Use this as reference. Read specific files with the file tools. Do not deploy unless the user asks.',
    ]
      .filter(Boolean)
      .join('\n')
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
}

export const SaveBlueprintTool = {
  name: 'SaveBlueprint',
  inputSchema: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    workers: z
      .array(
        z.object({
          role: z.string(),
          task: z.string(),
          files: z.array(z.string()).optional(),
        }),
      )
      .min(2)
      .max(3),
    succeeded: z.boolean().describe('True only after the worker run succeeded'),
  }),
  async description() {
    return 'Save an authored team plan after a successful run of two or three independent workstreams.'
  },
  async prompt() {
    return 'Save a blueprint only after the workers succeeded, and only when no stored blueprint matched.'
  },
  isReadOnly() {
    return false
  },
  isEnabled() {
    return true
  },
  userFacingName() {
    return 'Save blueprint'
  },
  needsPermissions(input?: { id?: string }) {
    const exists = loadBlueprintIndex().some(item => item.id === input?.id)
    return !exists
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
  async *call(input: {
    id: string
    title: string
    description: string
    workers: { role: string; task: string; files?: string[] }[]
    succeeded: boolean
  }) {
    if (!authoringAllowed()) {
      const text = 'This model cannot author a blueprint.'
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    if (!input.succeeded || selectBlueprint(input.description)) {
      const text =
        'Blueprint not saved. It is saved only after a successful run of independent workstreams with no stored match.'
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    try {
      const dir = saveAuthoredBlueprint(input)
      const text = `Saved blueprint ${input.id} at ${dir}`
      yield { type: 'result' as const, data: text, resultForAssistant: text }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      yield { type: 'result' as const, data: text, resultForAssistant: text }
    }
  },
}
