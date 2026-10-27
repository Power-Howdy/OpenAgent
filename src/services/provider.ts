import { randomUUID, type UUID } from 'crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { jsonSchema, streamText, tool as aiTool, type ModelMessage } from 'ai'
import type { Tool } from '../Tool.js'
import type { AssistantMessage, UserMessage } from '../query.js'
import type { ContentBlock, ContentBlockParam } from '../types/api.js'
import { isCapable } from '../models/nim-catalog.js'
import { loadLedger, recordCall } from './budget.js'
import { setAuthoring } from './capabilities.js'
import {
  lastUserText,
  localChat,
  requestThinking,
  threadChat,
  type ChatTurn,
} from './chatShape.js'
import { chooseNimModel, setStickyModel } from './freeRouter.js'
import { ensureLocalServer } from './localServer.js'
import {
  DEFAULT_LOCAL_BASE_URL,
  resolveProvider,
  type ProviderKind,
} from './resolveProvider.js'
import { selectSkill, skillExcerpt } from './skillStore.js'

export const API_ERROR_MESSAGE_PREFIX = 'API Error'
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE = 'Invalid API key'
export const NO_CONTENT_MESSAGE = '(no content)'
export const MAIN_QUERY_TEMPERATURE = 1

export function verifyApiKey(apiKey: string): Promise<boolean> {
  return Promise.resolve(Boolean(apiKey))
}

export function resetAnthropicClient(): void {}

export function formatSystemPromptWithContext(
  systemPrompt: string[],
  context: { [k: string]: string },
): string[] {
  const contextBlocks =
    Object.entries(context).length === 0
      ? []
      : [
          `\nAs you answer the user's questions, you can use the following context:\n`,
          ...Object.entries(context).map(
            ([key, value]) => `<context name="${key}">${value}</context>`,
          ),
        ]
  return [...systemPrompt, ...contextBlocks]
}

function assistantFrom(
  model: string,
  blocks: ContentBlock[],
  extra: { error?: boolean; durationMs?: number } = {},
): AssistantMessage {
  const content = blocks.length
    ? blocks
    : [{ type: 'text' as const, text: NO_CONTENT_MESSAGE, citations: [] }]
  return {
    type: 'assistant',
    costUSD: 0,
    durationMs: extra.durationMs ?? 0,
    uuid: randomUUID() as UUID,
    isApiErrorMessage: extra.error,
    message: {
      id: randomUUID(),
      type: 'message',
      role: 'assistant',
      model,
      stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      content,
    },
  }
}

function textMessage(model: string, text: string, error = false): AssistantMessage {
  return assistantFrom(model, [{ type: 'text', text, citations: [] }], { error })
}

function toModelMessages(turns: ChatTurn[]): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const turn of turns) {
    if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: assistantParts(turn.content),
      } as ModelMessage)
      continue
    }
    const toolResults = toolResultMessages(turn.content)
    if (toolResults.length) {
      messages.push(...toolResults)
      continue
    }
    messages.push({ role: 'user', content: userParts(turn.content) } as ModelMessage)
  }
  return messages
}

function assistantParts(content: string | ContentBlockParam[]): ModelMessage['content'] {
  if (typeof content === 'string') return content
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  > = []
  for (const block of content) {
    if (block.type === 'text') parts.push({ type: 'text', text: block.text })
    if (block.type === 'tool_use') {
      parts.push({
        type: 'tool-call',
        toolCallId: block.id,
        toolName: block.name,
        input: block.input,
      })
    }
  }
  return parts.length ? parts : NO_CONTENT_MESSAGE
}

function userParts(content: string | ContentBlockParam[]) {
  if (typeof content === 'string') return content
  const parts: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string; mediaType: string }
  > = []
  for (const block of content) {
    if (block.type === 'text') parts.push({ type: 'text', text: block.text })
    if (block.type === 'image') {
      parts.push({
        type: 'image',
        image: block.source.data,
        mediaType: block.source.media_type,
      })
    }
  }
  return parts.length ? parts : NO_CONTENT_MESSAGE
}

function toolResultMessages(content: string | ContentBlockParam[]): ModelMessage[] {
  if (typeof content === 'string') return []
  if (!content.some(block => block.type === 'tool_result')) return []
  return content
    .filter(block => block.type === 'tool_result')
    .map(block => ({
      role: 'tool' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: block.tool_use_id,
          toolName: 'tool',
          output: {
            type: 'text' as const,
            value:
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content ?? ''),
          },
        },
      ],
    }))
}

function lastText(turns: ChatTurn[]): string {
  return turns
    .slice(-4)
    .map(turn => {
      if (typeof turn.content === 'string') return turn.content
      return turn.content
        .filter(block => block.type === 'text' || block.type === 'tool_result')
        .map(block => (block.type === 'text' ? block.text : JSON.stringify(block.content ?? '')))
        .join('\n')
    })
    .join('\n')
    .slice(0, 4000)
}

function hasImage(messages: (UserMessage | AssistantMessage)[]): boolean {
  return messages.some(message => {
    const content = message.type === 'user' ? message.message.content : message.message.content
    return Array.isArray(content) && content.some(block => block.type === 'image')
  })
}

async function toolsFor(tools: Tool[]) {
  const entries = await Promise.all(
    tools.map(async item => {
      let description = item.name
      try {
        description = await item.description()
      } catch {
        description = item.name
      }
      return [
        item.name,
        aiTool({
          description,
          inputSchema: item.inputJSONSchema
            ? jsonSchema(item.inputJSONSchema as never)
            : item.inputSchema,
        }),
      ] as const
    }),
  )
  return Object.fromEntries(entries)
}

function modelFor(kind: ProviderKind, modelId: string, baseURL: string | undefined, apiKey: string | undefined) {
  if (kind === 'anthropic') {
    return createAnthropic({ apiKey })(modelId)
  }
  if (kind === 'openai') {
    return createOpenAI({ apiKey })(modelId)
  }
  const compatible = createOpenAICompatible({
    name: kind === 'free' ? 'nim' : 'compatible',
    baseURL: baseURL ?? DEFAULT_LOCAL_BASE_URL,
    apiKey: apiKey || 'local',
  })
  return compatible.chatModel(modelId)
}

async function complete(args: {
  kind: ProviderKind
  modelId: string
  baseURL?: string
  apiKey?: string
  system: string
  turns: ChatTurn[]
  tools: Tool[]
  thinking: false | { budget: number }
  signal: AbortSignal
}): Promise<ContentBlock[]> {
  const toolMap = args.tools.length ? await toolsFor(args.tools) : undefined
  const call = (turns: ChatTurn[]) =>
    streamText({
      model: modelFor(args.kind, args.modelId, args.baseURL, args.apiKey),
      system: args.system,
      messages: toModelMessages(turns),
      tools: toolMap,
      abortSignal: args.signal,
      ...(args.thinking
        ? {
            providerOptions: {
              anthropic: {
                thinking: { type: 'enabled', budgetTokens: args.thinking.budget },
              },
            },
          }
        : {}),
    })

  let result = call(args.turns)
  try {
    await result.text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/tool|message|unsupported|invalid/i.test(message)) throw error
    const summary = lastText(args.turns)
    result = call([
      {
        role: 'user',
        content: `Continue the same thread from this summary of the latest tool results.\n${summary}`,
      },
    ])
  }

  const text = await result.text
  const toolCalls = await result.toolCalls
  let reasoning = ''
  try {
    reasoning = (await result.reasoningText) || ''
  } catch {
    reasoning = ''
  }
  const blocks: ContentBlock[] = []
  if (args.thinking && reasoning) {
    blocks.push({ type: 'thinking', thinking: reasoning })
  }
  if (text) blocks.push({ type: 'text', text, citations: [] })
  for (const call of toolCalls) {
    blocks.push({
      type: 'tool_use',
      id: call.toolCallId,
      name: call.toolName,
      input: (call.input ?? {}) as { [key: string]: unknown },
    })
  }
  return blocks
}

export async function queryModel(
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: string[],
  maxThinkingTokens: number,
  tools: Tool[],
  signal: AbortSignal,
  options: {
    dangerouslySkipPermissions: boolean
    model: string
    prependCLISysprompt: boolean
  },
): Promise<AssistantMessage> {
  const started = Date.now()
  const provider = resolveProvider()
  const thinking = requestThinking(provider.kind, maxThinkingTokens)
  let system = systemPrompt.join('\n\n')
  const task = lastUserText(messages)

  try {
    if (provider.kind !== 'free') {
      setAuthoring(true)
      const skill = selectSkill(task)
      if (skill) {
        const excerpt = skillExcerpt(skill)
        if (excerpt) system += `\n\nFollow this skill when it applies:\n${excerpt}`
      }
      const blocks = await complete({
        kind: provider.kind,
        modelId: options.model || provider.model,
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        system,
        turns: threadChat(system, messages).turns,
        tools,
        thinking,
        signal,
      })
      const message = assistantFrom(options.model || provider.model, blocks, {
        durationMs: Date.now() - started,
      })
      return message
    }

    if (!provider.nvidiaApiKey) {
      return textMessage(
        'free-mode',
        `${API_ERROR_MESSAGE_PREFIX}: Set NVIDIA_API_KEY or \`openagent config set -g nvidiaApiKey <key>\` to run this conversation. The local model is only used for new bookkeeping chats.`,
        true,
      )
    }

    const choice = await pickNim({ requireVision: hasImage(messages), preferLongContext: false })
    if (!choice) {
      return textMessage(
        'free-mode',
        `${API_ERROR_MESSAGE_PREFIX}: Every free-mode model is out of requests. The thread stays here and was not sent to the local model.`,
        true,
      )
    }
    const skill = selectSkill(task)
    if (skill) {
      const excerpt = skillExcerpt(skill)
      if (excerpt) system += `\n\nFollow this skill when it applies:\n${excerpt}`
    }
    const blocks = await complete({
      kind: 'free',
      modelId: choice.apiModel,
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: provider.nvidiaApiKey,
      system,
      turns: threadChat(system, messages).turns,
      tools,
      thinking: false,
      signal,
    })
    return assistantFrom(choice.id, blocks, { durationMs: Date.now() - started })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return textMessage(provider.model, `${API_ERROR_MESSAGE_PREFIX}: ${message}`, true)
  }
}

async function pickNim(flags: { requireVision: boolean; preferLongContext: boolean }) {
  const now = Date.now()
  let choice = chooseNimModel({
    now,
    usage: loadLedger(),
    requireVision: flags.requireVision,
    preferLongContext: flags.preferLongContext,
  })
  if (choice.kind === 'wait') {
    const seconds = Math.max(1, Math.ceil(choice.waitMs / 1000))
    console.error(`Free-mode models are cooling. Waiting ${seconds}s for the next request window.`)
    await new Promise(resolve => setTimeout(resolve, choice.kind === 'wait' ? choice.waitMs : 0))
    choice = chooseNimModel({
      now: Date.now(),
      usage: loadLedger(),
      requireVision: flags.requireVision,
      preferLongContext: flags.preferLongContext,
    })
  }
  if (choice.kind !== 'model') return null
  recordCall(choice.model.id)
  setStickyModel(choice.model.id)
  setAuthoring(isCapable(choice.model))
  return choice.model
}

export async function queryFast({
  systemPrompt = [],
  userPrompt,
  signal,
}: {
  systemPrompt: string[]
  userPrompt: string
  assistantPrompt?: string
  enablePromptCaching?: boolean
  signal?: AbortSignal
}): Promise<AssistantMessage> {
  const provider = resolveProvider()
  const started = Date.now()
  try {
    if (provider.kind === 'free') {
      await ensureLocalServer()
      const chat = localChat(userPrompt)
      const blocks = await complete({
        kind: 'free',
        modelId: 'qwen3-0.6b',
        baseURL: provider.localBaseURL,
        apiKey: 'local',
        system: systemPrompt[0] || chat.system,
        turns: chat.turns,
        tools: [],
        thinking: false,
        signal: signal ?? new AbortController().signal,
      })
      return assistantFrom('qwen3-0.6b', blocks, { durationMs: Date.now() - started })
    }
    const blocks = await complete({
      kind: provider.kind,
      modelId: provider.fastModel,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      system: systemPrompt.join('\n\n'),
      turns: [{ role: 'user', content: userPrompt }],
      tools: [],
      thinking: false,
      signal: signal ?? new AbortController().signal,
    })
    return assistantFrom(provider.fastModel, blocks, { durationMs: Date.now() - started })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return textMessage(provider.fastModel, `${API_ERROR_MESSAGE_PREFIX}: ${message}`, true)
  }
}

export const querySonnet = queryModel
export const queryHaiku = queryFast
export { requestThinking }
