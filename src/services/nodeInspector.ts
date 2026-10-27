export function inspectorUrl(payload: { webSocketDebuggerUrl?: string }[]): string | null {
  const url = payload.find(item => item.webSocketDebuggerUrl)?.webSocketDebuggerUrl
  if (!url) return null
  const parsed = new URL(url)
  parsed.hostname = '127.0.0.1'
  parsed.port = '19222'
  return parsed.toString()
}

export async function inspectorCall(wsUrl: string, method: string, params: unknown): Promise<unknown> {
  const socket = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('Inspector connection failed')))
  })
  const id = 1
  const result = new Promise((resolve, reject) => {
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } }
      if (message.id !== id) return
      if (message.error) reject(new Error(message.error.message || 'Inspector call failed'))
      else resolve(message.result)
    })
  })
  socket.send(JSON.stringify({ id, method, params }))
  try {
    return await result
  } finally {
    socket.close()
  }
}
