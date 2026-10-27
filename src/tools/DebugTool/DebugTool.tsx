import { relative } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { closeDap, dapCommand, debugRunArgs, openDap, waitForDebugPort } from '../../services/dap.js'
import { inspectorCall, inspectorUrl } from '../../services/nodeInspector.js'
import { readThreadContext, writeThreadContext } from '../../services/threadContext.js'
import { runHost, sandboxReady, SETUP_HINT } from '../../services/runtime.js'
import { workspaceFile } from '../../services/lsp.js'
import { getCwd } from '../../utils/state.js'

const inputSchema = z.object({
  action: z.enum(['start', 'breakpoint', 'continue', 'next', 'stack', 'variables', 'stop']),
  language: z.enum(['node', 'python']).optional(),
  file: z.string().optional(),
  line: z.number().optional(),
})

let language: 'node' | 'python' | null = null
let inspector: string | null = null
let debugFile: string | null = null

function remember(thread?: string): void {
  if (!thread) return
  const context = readThreadContext(thread)
  context.debug = JSON.stringify({ language, file: debugFile, inspector })
  writeThreadContext(context, thread)
}

async function recall(thread?: string): Promise<boolean> {
  if (language || !thread) return Boolean(language)
  const raw = readThreadContext(thread).debug
  if (!raw) return false
  try {
    const saved = JSON.parse(raw) as { language?: 'node' | 'python'; file?: string; inspector?: string }
    if (saved.language !== 'node' && saved.language !== 'python') return false
    await waitForDebugPort()
    language = saved.language
    debugFile = saved.file ?? null
    inspector = saved.inspector ?? null
    if (language === 'python') await openDap()
    return true
  } catch {
    return false
  }
}

export const DebugTool = {
  name: 'Debug',
  userFacingName: () => 'Debug',
  description: async () => 'Start a sandbox debugger and inspect the stack.',
  prompt: async () => 'Start a Node inspector or Python debugpy session, then step and read variables.',
  inputSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => true,
  async *call(input: z.infer<typeof inputSchema>, context: ToolUseContext) {
    const text = await debug(input, context.options.messageLogName, context.abortController?.signal)
      .catch(error => error instanceof Error ? error.message : String(error))
    const isError = text === SETUP_HINT
      || text.startsWith('Debugger failed')
      || text.startsWith('Debugger did not')
      || text.startsWith('start requires')
      || text.startsWith('Debug session')
      || text.startsWith('File is outside')
      || text.startsWith('Node inspector')
    yield { type: 'result' as const, data: text, resultForAssistant: text, isError }
  },
  renderToolUseMessage(input: z.infer<typeof inputSchema>) {
    return input.action
  },
  renderToolResultMessage(output: string) {
    return <Text>{output}</Text>
  },
} satisfies Tool<typeof inputSchema, string>

async function debug(input: z.infer<typeof inputSchema>, thread?: string, signal?: AbortSignal): Promise<string> {
  if (input.action === 'stop') {
    closeDap()
    inspector = null
    language = null
    debugFile = null
    remember(thread)
    await runHost(['docker', 'rm', '-f', 'openagent-debug'], 20_000, signal)
    return 'Debugger stopped.'
  }
  if (input.action === 'start') {
    if (!input.language || !input.file) return 'start requires language and file'
    if (!(await sandboxReady())) return SETUP_HINT
    const located = workspaceFile(getCwd(), input.file)
    await runHost(['docker', 'rm', '-f', 'openagent-debug'], 20_000, signal)
    const started = await runHost(
      ['docker', ...debugRunArgs(input.language, located.guest, getCwd(), process.getuid?.() ?? 0, process.getgid?.() ?? 0)],
      20_000,
      signal,
    )
    if (started.code !== 0) return started.stderr || 'Debugger failed to start'
    await waitForDebugPort()
    language = input.language
    debugFile = located.host
    if (language === 'python') {
      await openDap()
      remember(thread)
      return 'Python debugger attached.'
    }
    const listed = await fetch('http://127.0.0.1:19222/json/list', { signal: AbortSignal.timeout(10_000) })
    inspector = inspectorUrl(await listed.json() as { webSocketDebuggerUrl?: string }[])
    if (!inspector) return 'Node inspector did not publish a websocket.'
    await inspectorCall(inspector, 'Debugger.enable', {})
    remember(thread)
    return 'Node debugger attached.'
  }
  if (!language) await recall(thread)
  if (language === 'python') return python(input)
  if (language === 'node' && inspector) return node(input, inspector)
  return 'Debug session is not started'
}

async function python(input: z.infer<typeof inputSchema>): Promise<string> {
  if (input.action === 'breakpoint') {
    return JSON.stringify(await dapCommand('setBreakpoints', {
      source: { path: input.file },
      breakpoints: [{ line: input.line ?? 1 }],
    }))
  }
  if (input.action === 'continue') return JSON.stringify(await dapCommand('continue', { threadId: 1 }))
  if (input.action === 'next') return JSON.stringify(await dapCommand('next', { threadId: 1 }))
  if (input.action === 'stack') return JSON.stringify(await dapCommand('stackTrace', { threadId: 1 }))
  return JSON.stringify(await dapCommand('scopes', { frameId: 1 }))
}

async function node(input: z.infer<typeof inputSchema>, url: string): Promise<string> {
  if (input.action === 'breakpoint') {
    return JSON.stringify(await inspectorCall(url, 'Debugger.setBreakpointByUrl', {
      urlRegex: input.file ?? '',
      lineNumber: (input.line ?? 1) - 1,
    }))
  }
  if (input.action === 'continue') return JSON.stringify(await inspectorCall(url, 'Debugger.resume', {}))
  if (input.action === 'next') return JSON.stringify(await inspectorCall(url, 'Debugger.stepOver', {}))
  if (input.action === 'stack') return JSON.stringify(await inspectorCall(url, 'Debugger.pause', {}))
  return JSON.stringify(await inspectorCall(url, 'Runtime.evaluate', { expression: 'this', returnByValue: true }))
}
