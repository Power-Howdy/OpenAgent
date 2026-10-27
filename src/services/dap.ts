import { connect, type Socket } from 'net'
import { decodeRpc, encodeRpc } from './lsp.js'

export const DEBUG_PORT = 19222

let socket: Socket | null = null
let buffer: Buffer = Buffer.alloc(0) as Buffer
let seq = 1
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

export function dapRequest(seqNumber: number, command: string, args?: unknown): unknown {
  return { seq: seqNumber, type: 'request', command, arguments: args }
}

export function debugRunArgs(
  language: 'node' | 'python',
  guestFile: string,
  project: string,
  uid: number,
  gid: number,
): string[] {
  const argv = language === 'node'
    ? ['node', '--inspect-brk=0.0.0.0:9229', guestFile]
    : ['python3', '-m', 'debugpy', '--listen', '0.0.0.0:9229', '--wait-for-client', guestFile]
  return [
    'run',
    '-d',
    '--name',
    'openagent-debug',
    '--user',
    `${uid}:${gid}`,
    '-p',
    '127.0.0.1:19222:9229',
    '-v',
    `${project}:/workspace`,
    '-w',
    '/workspace',
    '--cap-drop',
    'SYS_ADMIN',
    '--cap-drop',
    'NET_RAW',
    '--cap-add',
    'SYS_PTRACE',
    'openagent-sandbox:local',
    ...argv,
  ]
}

export async function openDap(port = DEBUG_PORT): Promise<void> {
  closeDap()
  socket = await new Promise((resolve, reject) => {
    const next = connect(port, '127.0.0.1')
    next.once('connect', () => resolve(next))
    next.once('error', reject)
  })
  buffer = Buffer.alloc(0)
  seq = 1
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk] as (Buffer | Uint8Array)[])
    const decoded = decodeRpc(buffer)
    buffer = decoded.rest
    for (const message of decoded.messages) {
      const body = message as { type?: string; request_seq?: number; success?: boolean; message?: string; body?: unknown }
      if (body.type !== 'response' || body.request_seq === undefined) continue
      const waiter = pending.get(body.request_seq)
      if (!waiter) continue
      pending.delete(body.request_seq)
      if (body.success === false) waiter.reject(new Error(body.message || 'DAP request failed'))
      else waiter.resolve(body.body)
    }
  })
  await dapCommand('initialize', { clientID: 'openagent', adapterID: 'debugpy' })
  await dapCommand('attach', { justMyCode: false })
  await dapCommand('configurationDone')
}

export function dapCommand(command: string, args?: unknown): Promise<unknown> {
  if (!socket) return Promise.reject(new Error('Debug session is not started'))
  const id = seq++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket?.write(encodeRpc(dapRequest(id, command, args)))
  })
}

export function closeDap(): void {
  socket?.end()
  socket = null
  buffer = Buffer.alloc(0)
  pending.clear()
}

export function waitForDebugPort(port = DEBUG_PORT, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const next = connect(port, '127.0.0.1')
      const fail = () => {
        next.destroy()
        if (Date.now() >= deadline) reject(new Error('Debugger did not open a port'))
        else setTimeout(attempt, 200)
      }
      next.once('connect', () => {
        next.end()
        resolve()
      })
      next.once('error', fail)
    }
    attempt()
  })
}
