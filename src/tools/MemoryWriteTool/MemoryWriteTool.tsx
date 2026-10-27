import { mkdirSync, writeFileSync } from 'fs'
import { Box, Text } from 'ink'
import { dirname, join } from 'path'
import * as React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js'
import { Tool } from '../../Tool.js'
import { MEMORY_DIR } from '../../utils/env.js'
import { isPathInside } from '../../utils/permissions/filesystem.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

function memoryPath(filePath: string): string | null {
  if (!filePath || filePath.includes('\0')) return null
  const fullPath = join(MEMORY_DIR, filePath)
  if (!isPathInside(MEMORY_DIR, fullPath)) return null
  return fullPath
}

const inputSchema = z.strictObject({
  file_path: z.string().describe('Path to the memory file to write'),
  content: z.string().describe('Content to write to the file'),
})

export const MemoryWriteTool = {
  name: 'MemoryWrite',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  userFacingName() {
    return 'Write Memory'
  },
  async isEnabled() {
    return true
  },
  isReadOnly() {
    return false
  },
  needsPermissions() {
    return true
  },
  renderResultForAssistant(content) {
    return content
  },
  renderToolUseMessage(input) {
    return Object.entries(input)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ')
  },
  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },
  renderToolResultMessage() {
    return (
      <Box justifyContent="space-between" overflowX="hidden" width="100%">
        <Box flexDirection="row">
          <Text>{'  '}⎿ Updated memory</Text>
        </Box>
      </Box>
    )
  },
  async validateInput({ file_path }) {
    if (!memoryPath(file_path)) {
      return { result: false, message: 'Invalid memory file path' }
    }
    return { result: true }
  },
  async *call({ file_path, content }) {
    const fullPath = memoryPath(file_path)
    if (!fullPath) {
      yield {
        type: 'result',
        data: 'Invalid memory file path',
        resultForAssistant: 'Invalid memory file path',
        isError: true,
      }
      return
    }
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
    yield {
      type: 'result',
      data: 'Saved',
      resultForAssistant: 'Saved',
    }
  },
} satisfies Tool<typeof inputSchema, string>
