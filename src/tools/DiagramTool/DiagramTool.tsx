import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { mermaidSource } from '../../services/projectCommands.js'

const inputSchema = z.object({ source: z.string() })

export const DiagramTool = {
  name: 'Diagram',
  userFacingName: () => 'Diagram',
  description: async () => 'Check a Mermaid diagram and return the source.',
  prompt: async () => 'Return Mermaid source for flowchart, sequenceDiagram, classDiagram, or erDiagram.',
  inputSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: () => false,
  async *call(input: z.infer<typeof inputSchema>) {
    const source = mermaidSource(input.source)
    const text = source ?? 'Not a supported Mermaid diagram.'
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage() {
    return 'mermaid'
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>
