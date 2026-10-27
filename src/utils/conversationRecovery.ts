import { readFile } from 'fs/promises'
import type { Tool } from '../Tool.js'
import type { Message } from '../query.js'

export function deserializeMessages(
  messages: unknown,
  _tools: Tool[],
): Message[] {
  if (!Array.isArray(messages)) return []
  return (messages as Message[]).filter(
    message => message && (message.type === 'user' || message.type === 'assistant'),
  )
}

export async function loadMessagesFromLog(
  path: string,
  _tools: Tool[],
): Promise<Message[]> {
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as Message[]
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    message => message && (message.type === 'user' || message.type === 'assistant'),
  )
}
