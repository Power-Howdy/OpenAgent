import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { readFileSync } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'

export function encodeRpc(message: unknown): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

export function decodeRpc(input: string | Buffer): { messages: unknown[]; rest: Buffer } {
  let rest = Buffer.isBuffer(input) ? input : Buffer.from(input)
  const messages: unknown[] = []
  while (rest.length) {
    const headerEnd = rest.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const match = /Content-Length: (\d+)/i.exec(rest.subarray(0, headerEnd).toString('utf8'))
    if (!match) break
    const length = Number(match[1])
    const start = headerEnd + 4
    if (rest.length < start + length) break
    messages.push(JSON.parse(rest.subarray(start, start + length).toString('utf8')))
    rest = rest.subarray(start + length)
  }
  return { messages, rest }
}

export type TextEdit = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  newText: string
}

export function workspaceFile(projectRoot: string, file: string): { host: string; guest: string; uri: string } {
  const host = isAbsolute(file) ? file : resolve(projectRoot, file)
  const rel = relative(projectRoot, host)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('File is outside the workspace')
  const guestRel = rel.split(sep).join('/')
  return { host, guest: `/workspace/${guestRel}`, uri: `file:///workspace/${guestRel}` }
}

export function workspaceUri(projectRoot: string, file: string): string {
  return workspaceFile(projectRoot, file).uri
}

export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const lines = source.split('\n')
  const offset = (line: number, character: number) => {
    let pos = 0
    for (let index = 0; index < line; index++) pos += (lines[index]?.length ?? 0) + 1
    return pos + character
  }
  const ranked = edits
    .map(edit => ({
      edit,
      start: offset(edit.range.start.line, edit.range.start.character),
      end: offset(edit.range.end.line, edit.range.end.character),
    }))
    .sort((a, b) => b.start - a.start)
  let text = source
  for (const item of ranked) text = text.slice(0, item.start) + item.edit.newText + text.slice(item.end)
  return text
}

export function editsFromResult(result: unknown): { uri: string; edits: TextEdit[] }[] {
  if (!result || typeof result !== 'object') return []
  const body = result as {
    changes?: Record<string, TextEdit[]>
    documentChanges?: { textDocument?: { uri?: string }; edits?: TextEdit[] }[]
  }
  if (body.changes) return Object.entries(body.changes).map(([uri, edits]) => ({ uri, edits }))
  if (!Array.isArray(body.documentChanges)) return []
  return body.documentChanges.flatMap(change =>
    change.textDocument?.uri && Array.isArray(change.edits)
      ? [{ uri: change.textDocument.uri, edits: change.edits }]
      : [],
  )
}

export function hostPathFromUri(projectRoot: string, uri: string): string | null {
  const prefix = 'file:///workspace/'
  if (!uri.startsWith(prefix)) return null
  return workspaceFile(projectRoot, decodeURIComponent(uri.slice(prefix.length))).host
}

const BINS: Record<string, string> = {
  ts: 'typescript-language-server --stdio',
  js: 'typescript-language-server --stdio',
  py: 'pyright-langserver --stdio',
  go: 'gopls serve',
  rust: 'rust-analyzer',
}

const LSP_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  go: 'go',
  rust: 'rust',
}

export function languageId(file: string): string | null {
  if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'ts'
  if (file.endsWith('.js') || file.endsWith('.jsx')) return 'js'
  if (file.endsWith('.py')) return 'py'
  if (file.endsWith('.go')) return 'go'
  if (file.endsWith('.rs')) return 'rust'
  return null
}

export function lspCommand(language: string): string[] | null {
  const command = BINS[language]
  return command ? command.split(' ') : null
}

type Session = {
  language: string
  child: ChildProcessWithoutNullStreams
  pending: Map<number, (value: unknown) => void>
  nextId: number
  opened: Set<string>
  ready: Promise<void>
}

let session: Session | null = null

export function closeLsp(): void {
  session?.child.kill()
  session = null
}

function send(child: ChildProcessWithoutNullStreams, id: number | null, methodName: string, value: unknown): void {
  const payload = id === null
    ? { jsonrpc: '2.0', method: methodName, params: value }
    : { jsonrpc: '2.0', id, method: methodName, params: value }
  child.stdin.write(encodeRpc(payload))
}

async function openSession(language: string): Promise<Session> {
  if (session && session.language === language && session.child.exitCode === null && !session.child.killed) {
    await session.ready
    return session
  }
  closeLsp()
  const command = lspCommand(language)
  if (!command) throw new Error('Unsupported language')
  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`
  const child = spawn('docker', [
    'exec', '-i', '-u', user, '-w', '/workspace', 'openagent-session-lsp', ...command,
  ])
  const pending = new Map<number, (value: unknown) => void>()
  let buffer: Buffer = Buffer.alloc(0)
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)])
    const decoded = decodeRpc(buffer)
    buffer = decoded.rest
    for (const message of decoded.messages) {
      const body = message as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof body.id !== 'number') continue
      pending.get(body.id)?.(body.error ?? body.result)
      pending.delete(body.id)
    }
  })
  const created: Session = {
    language,
    child,
    pending,
    nextId: 1,
    opened: new Set(),
    ready: Promise.resolve(),
  }
  const wait = (id: number) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('LSP timed out'))
    }, 20_000)
    pending.set(id, value => {
      clearTimeout(timer)
      resolve(value)
    })
  })
  created.ready = (async () => {
    const id = created.nextId++
    send(child, id, 'initialize', {
      processId: process.pid,
      rootUri: 'file:///workspace',
      capabilities: {
        textDocument: { synchronization: { didOpen: true } },
        workspace: { workspaceEdit: { documentChanges: true } },
      },
    })
    await wait(id)
    send(child, null, 'initialized', {})
  })()
  session = created
  await created.ready
  return created
}

export async function askLsp(
  language: string,
  method: string,
  params: unknown,
  document?: { uri: string; text: string },
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  try {
    const current = await openSession(language)
    if (document && !current.opened.has(document.uri)) {
      send(current.child, null, 'textDocument/didOpen', {
        textDocument: {
          uri: document.uri,
          languageId: LSP_LANGUAGE[language] ?? language,
          version: 1,
          text: document.text,
        },
      })
      current.opened.add(document.uri)
    }
    const id = current.nextId++
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id)
        reject(new Error('LSP timed out'))
      }, 20_000)
      current.pending.set(id, value => {
        clearTimeout(timer)
        resolve(value)
      })
      send(current.child, id, method, params)
    })
    if (result && typeof result === 'object' && 'message' in result && !('changes' in result) && !('documentChanges' in result)) {
      return { ok: false, error: String((result as { message?: unknown }).message ?? 'LSP request failed') }
    }
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function readWorkspaceText(host: string): string {
  return readFileSync(host, 'utf8')
}
