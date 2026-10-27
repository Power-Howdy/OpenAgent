import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { McpServerConfig } from '../utils/config.js'

export type McpTransport = 'stdio' | 'sse' | 'http'

export type NormalizedMcpServer = {
  name: string
  source: string
  transport: McpTransport
  command?: string
  args: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export const PROJECT_MCP_FILES: { path: string; flat: boolean }[] = [
  { path: '.mcp.json', flat: false },
  { path: '.mcprc', flat: true },
  { path: '.cursor/mcp.json', flat: false },
  { path: '.claude/mcp.json', flat: false },
  { path: '.claude/settings.json', flat: false },
  { path: '.claude/settings.local.json', flat: false },
  { path: 'opencode.json', flat: false },
  { path: '.opencode/opencode.json', flat: false },
]

export const USER_MCP_FILES: { path: string; flat: boolean }[] = [
  { path: '.cursor/mcp.json', flat: false },
  { path: '.claude.json', flat: false },
  { path: '.claude/mcp.json', flat: false },
  { path: '.config/opencode/opencode.json', flat: false },
]

type ServerShape = Omit<NormalizedMcpServer, 'name' | 'source'>

export function serversFromDocument(
  text: string,
  flat: boolean,
): { name: string; server: ServerShape }[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const root = asRecord(parsed)
  if (!root) return []
  const map = asRecord(root.mcpServers) ?? asRecord(root.mcp) ?? (flat ? root : null)
  if (!map) return []
  const found: { name: string; server: ServerShape }[] = []
  for (const [name, value] of Object.entries(map)) {
    const server = normalizeServerEntry(value)
    if (server) found.push({ name, server })
  }
  return found
}

export function normalizeServerEntry(raw: unknown): ServerShape | null {
  const record = asRecord(raw)
  if (!record) return null
  if (record.disabled === true || record.enabled === false) return null

  const type =
    typeof record.type === 'string'
      ? record.type
      : typeof record.transport === 'string'
        ? record.transport
        : ''
  const url = typeof record.url === 'string' ? record.url : ''
  const commandField = record.command
  let command = ''
  let args: string[] = []
  if (typeof commandField === 'string' && commandField) {
    command = commandField
    args = stringList(record.args)
  } else if (Array.isArray(commandField) && typeof commandField[0] === 'string' && commandField[0]) {
    command = commandField[0]
    args = commandField.slice(1).filter((item): item is string => typeof item === 'string')
  }

  const env = stringMap(record.env) ?? stringMap(record.environment)
  const headers = stringMap(record.headers)
  const lower = type.toLowerCase()
  const wantsHttp = ['sse', 'http', 'http+sse', 'streamable-http', 'remote'].includes(lower)
  const wantsStdio = ['stdio', 'local', 'command'].includes(lower)
  if (url && (wantsHttp || (!command && !wantsStdio))) {
    const transport: McpTransport = lower === 'sse' || lower === 'http+sse' ? 'sse' : 'http'
    return { transport, url, headers, args: [], env }
  }
  if (command) {
    return { transport: 'stdio', command, args, env }
  }
  return null
}

export function toMcpServerConfig(server: ServerShape): McpServerConfig {
  if (server.transport === 'stdio') {
    return {
      type: 'stdio',
      command: server.command,
      args: server.args,
      env: server.env,
    }
  }
  return {
    type: server.transport,
    url: server.url,
    headers: server.headers,
  }
}

export function readMcpFiles(
  dir: string,
  files: { path: string; flat: boolean }[],
): NormalizedMcpServer[] {
  const byName = new Map<string, NormalizedMcpServer>()
  for (const file of files) {
    const full = join(dir, file.path)
    if (!existsSync(full)) continue
    let text = ''
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    for (const entry of serversFromDocument(text, file.flat)) {
      byName.set(entry.name, { name: entry.name, source: full, ...entry.server })
    }
  }
  return [...byName.values()]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringMap(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') out[key] = item
  }
  return Object.keys(out).length ? out : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
