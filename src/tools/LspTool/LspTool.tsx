import { readFileSync } from 'fs'
import { relative } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { isPlanMode } from '../../services/planMode.js'
import {
  applyTextEdits,
  askLsp,
  editsFromResult,
  hostPathFromUri,
  languageId,
  readWorkspaceText,
  workspaceFile,
} from '../../services/lsp.js'
import { ensureSession, readInstalledLangs } from '../../services/runtime.js'
import { writeTextContent } from '../../utils/file.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({
  action: z.enum(['hover', 'definition', 'references', 'rename']),
  file: z.string(),
  line: z.number(),
  character: z.number(),
  newName: z.string().optional(),
})

const METHOD = {
  hover: 'textDocument/hover',
  definition: 'textDocument/definition',
  references: 'textDocument/references',
  rename: 'textDocument/rename',
} as const

export const LspTool = {
  name: 'Lsp',
  userFacingName: () => 'LSP',
  description: async () => 'Hover, go to definition, find references, or rename through a language server in the sandbox.',
  prompt: async () => 'Use hover, definition, or references to navigate. line and character are 1-based. Rename asks for permission and writes the edit.',
  inputSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: (input?: { action?: string }) => input?.action === 'rename',
  async *call(input: z.infer<typeof inputSchema>) {
    if (input.action === 'rename' && isPlanMode()) {
      const text = 'Plan mode only allows LSP reads.'
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    const language = languageId(input.file)
    const langKey = language === 'js' ? 'ts' : language
    if (!language || !langKey || !readInstalledLangs().has(langKey)) {
      const text = `Run openagent setup --lang ${langKey ?? 'ts'}.`
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    let located: ReturnType<typeof workspaceFile>
    try {
      located = workspaceFile(getCwd(), input.file)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    await ensureSession('lsp')
    const position = { line: Math.max(0, input.line - 1), character: Math.max(0, input.character - 1) }
    const params = input.action === 'rename'
      ? { textDocument: { uri: located.uri }, position, newName: input.newName ?? '' }
      : input.action === 'references'
        ? { textDocument: { uri: located.uri }, position, context: { includeDeclaration: true } }
        : { textDocument: { uri: located.uri }, position }
    let textBody = ''
    try {
      textBody = readWorkspaceText(located.host)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      yield { type: 'result' as const, data: text, resultForAssistant: text, isError: true }
      return
    }
    const response = await askLsp(language, METHOD[input.action], params, { uri: located.uri, text: textBody })
    if ('error' in response) {
      yield { type: 'result' as const, data: response.error, resultForAssistant: response.error, isError: true }
      return
    }
    if (input.action !== 'rename') {
      const text = JSON.stringify(response.result).slice(0, 20_000)
      yield { type: 'result' as const, data: text, resultForAssistant: text }
      return
    }
    const edits = editsFromResult(response.result)
    const written: string[] = []
    for (const change of edits) {
      const host = hostPathFromUri(getCwd(), change.uri)
      if (!host) continue
      const source = readFileSync(host, 'utf8')
      const next = applyTextEdits(source, change.edits)
      writeTextContent(host, next, 'utf8', source.includes('\r\n') ? 'CRLF' : 'LF')
      written.push(host)
    }
    const text = written.length ? `Renamed in ${written.join(', ')}` : 'Rename returned no edits.'
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError: written.length === 0 }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return `${input.action} ${relative(getCwd(), input.file)}:${input.line}`
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>
