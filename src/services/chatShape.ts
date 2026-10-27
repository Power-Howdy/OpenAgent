import type { ContentBlockParam, MessageParam } from '../types/api.js'
import type { AssistantMessage, UserMessage } from '../query.js'
import type { ProviderKind } from './resolveProvider.js'

export function requestThinking(
  kind: ProviderKind,
  maxThinkingTokens: number,
): false | { budget: number } {
  if (kind === 'free' || maxThinkingTokens <= 0) return false
  return { budget: maxThinkingTokens }
}

export type ChatTurn = {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

const LOCAL_SYSTEM =
  'You are a local helper. Answer only the current request. Do not assume earlier conversation.'

export function lastUserText(messages: (UserMessage | AssistantMessage)[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.type !== 'user') continue
    const content = message.message.content
    if (typeof content === 'string') return content
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
  }
  return ''
}

export function threadTurns(
  messages: (UserMessage | AssistantMessage)[],
): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const message of messages) {
    if (message.type === 'user') {
      turns.push({
        role: 'user',
        content: stripThinking(message.message.content),
      })
    } else if (message.type === 'assistant') {
      turns.push({
        role: 'assistant',
        content: stripThinking(message.message.content),
      })
    }
  }
  return turns
}

function stripThinking(
  content: MessageParam['content'],
): string | ContentBlockParam[] {
  if (typeof content === 'string') return content
  return content.filter(
    block => block.type !== 'thinking' && block.type !== 'redacted_thinking',
  )
}

export function localChat(userText: string): {
  system: string
  turns: ChatTurn[]
} {
  return {
    system: LOCAL_SYSTEM,
    turns: [{ role: 'user', content: userText }],
  }
}

export function threadChat(
  system: string,
  messages: (UserMessage | AssistantMessage)[],
): { system: string; turns: ChatTurn[] } {
  return { system, turns: threadTurns(messages) }
}
