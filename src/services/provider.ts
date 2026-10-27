import { randomUUID, type UUID } from 'crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { jsonSchema, streamText, tool as aiTool, type LanguageModelUsage, type ModelMessage } from 'ai'
import type { Tool } from '../Tool.js'
import type { AssistantMessage, UserMessage } from '../query.js'
import type { ContentBlock, ContentBlockParam } from '../types/api.js'
import { NIM_CATALOG, isCapable } from '../models/nim-catalog.js'
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
import {
  isAbortError,
  isPermanentFailure,
  recoverGeneration,
  type RecoveryAction,
} from './streamRecovery.js'

export const API_ERROR_MESSAGE_PREFIX = 'API Error'
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE = 'Invalid API key'
export const NO_CONTENT_MESSAGE = '(no content)'
export const MAIN_QUERY_TEMPERATURE = 1
const STREAM_ATTEMPTS = 3

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

function usageFrom(usage?: LanguageModelUsage) {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_creation_input_tokens: usage?.inputTokenDetails.cacheWriteTokens ?? 0,
    cache_read_input_tokens: usage?.inputTokenDetails.cacheReadTokens ?? 0,
  }
}

function assistantFrom(
  model: string,
  blocks: ContentBlock[],
  extra: {
    error?: boolean
    durationMs?: number
    id?: string
    usage?: LanguageModelUsage
    incomplete?: boolean
  } = {},
): AssistantMessage {
  const content = blocks.length
    ? blocks
    : [{ type: 'text' as const, text: NO_CONTENT_MESSAGE, citations: [] }]
  return {
    type: 'assistant',
    costUSD: 0,
    durationMs: extra.durationMs ?? 0,
    uuid: (extra.id ?? randomUUID()) as UUID,
    isApiErrorMessage: extra.error,
    incomplete: extra.incomplete,
    message: {
      id: extra.id ?? randomUUID(),
      type: 'message',
      role: 'assistant',
      model,
      stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: usageFrom(extra.usage),
      content,
    },
  }
}

function textMessage(model: string, text: string, error = false): AssistantMessage {
  return assistantFrom(model, [{ type: 'text', text, citations: [] }], { error })
}

function toModelMessages(turns: ChatTurn[]): ModelMessage[] {
  const toolNames = new Map<string, string>()
  const messages: ModelMessage[] = []
  for (const turn of turns) {
    if (turn.role === 'assistant') {
      if (Array.isArray(turn.content)) {
        for (const block of turn.content) {
          if (block.type === 'tool_use') toolNames.set(block.id, block.name)
        }
      }
      messages.push({
        role: 'assistant',
        content: assistantParts(turn.content),
      } as ModelMessage)
      continue
    }
    const toolResults = toolResultMessages(turn.content, toolNames)
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

function toolResultMessages(
  content: string | ContentBlockParam[],
  toolNames: Map<string, string>,
): ModelMessage[] {
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
          toolName: toolNames.get(block.tool_use_id) ?? block.tool_use_id,
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

function hasImage(messages: (UserMessage | AssistantMessage)[]): boolean {
  return messages.some(message => {
    const content = message.type === 'user' ? message.message.content : message.message.content
    return Array.isArray(content) && content.some(block => block.type === 'image')
  })
}

async function toolDescription(item: Tool): Promise<string> {
  const parts: string[] = []
  try {
    const described = await item.description()
    if (described && described !== item.name) parts.push(described)
  } catch {
    // A description that needs the tool input is for the permission dialog.
  }
  try {
    const prompted = await item.prompt()
    if (prompted && !parts.includes(prompted)) parts.push(prompted)
  } catch {
    // The schema description still stands.
  }
  return parts.join('\n\n') || item.name
}

async function toolsFor(tools: Tool[]) {
  const entries = await Promise.all(
    tools.map(async item => {
      const description = await toolDescription(item)
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

class StopRetry extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StopRetry'
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return undefined
  const status = Number(error.statusCode)
  return Number.isFinite(status) ? status : undefined
}

function shouldStopRetry(error: unknown): boolean {
  if (isAbortError(error) || error instanceof StopRetry) return true
  const message = error instanceof Error ? error.message : String(error)
  return isPermanentFailure(message, statusCodeOf(error))
}

function pause(attempt: number, signal: AbortSignal): Promise<void> {
  const ms = 300 * (attempt + 1)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function silence(promises: Array<PromiseLike<unknown>>): void {
  for (const promise of promises) void Promise.resolve(promise).catch(() => undefined)
}

interface Completion {
  blocks: ContentBlock[]
  usage?: LanguageModelUsage
  id: string
  recovery: RecoveryAction
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
  onPartial?: (message: AssistantMessage) => void
}): Promise<Completion> {
  if (args.signal.aborted) throw abortError(args.signal)
  const toolMap = args.tools.length ? await toolsFor(args.tools) : undefined
  const id = randomUUID()
  const result = streamText({
    model: modelFor(args.kind, args.modelId, args.baseURL, args.apiKey),
    system: args.system,
    messages: toModelMessages(args.turns),
    tools: toolMap,
    abortSignal: args.signal,
    onError() {
      // The SDK's default handler prints the stack into the terminal.
    },
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

  let text = ''
  let reasoning = ''
  let finishReason = ''
  let failed = false
  let unfinishedTool = false
  let usage: LanguageModelUsage | undefined
  const openTools = new Set<string>()
  const toolCalls: Array<{ id: string; name: string; input: { [key: string]: unknown } }> = []
  const publish = () => {
    if (!text || !args.onPartial) return
    args.onPartial(assistantFrom(args.modelId, [{ type: 'text', text, citations: [] }], { id }))
  }

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text
          publish()
          break
        case 'reasoning-delta':
          reasoning += part.text
          break
        case 'tool-input-start':
          openTools.add(part.id)
          break
        case 'tool-call':
          openTools.delete(part.toolCallId)
          if ('invalid' in part && part.invalid) {
            unfinishedTool = true
            break
          }
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName,
            input:
              part.input && typeof part.input === 'object'
                ? (part.input as { [key: string]: unknown })
                : {},
          })
          break
        case 'error':
          failed = true
          if (shouldStopRetry(part.error)) throw part.error
          break
        case 'abort': {
          const aborted = new Error('The operation was aborted.')
          aborted.name = 'AbortError'
          throw aborted
        }
        case 'finish-step':
          finishReason = finishReason || part.finishReason
          usage = usage ?? part.usage
          break
        case 'finish':
          finishReason = part.finishReason
          usage = part.totalUsage
          break
        default:
          break
      }
    }
  } catch (error) {
    if (args.signal.aborted || isAbortError(error) || shouldStopRetry(error)) throw error
    failed = true
  } finally {
    try {
      silence([
        result.usage,
        result.finishReason,
        result.toolCalls,
        result.reasoningText,
        result.steps,
        result.response,
        result.providerMetadata,
      ])
    } catch {
      // Reading the result can reject after the stream has already failed.
    }
  }

  if (args.signal.aborted) throw abortError(args.signal)
  if (openTools.size) unfinishedTool = true
  const recovery = recoverGeneration({
    text,
    toolCallCount: toolCalls.length,
    unfinishedTool,
    finishReason,
    failed,
  })
  const blocks: ContentBlock[] = []
  if (args.thinking && reasoning) blocks.push({ type: 'thinking', thinking: reasoning })
  if (text) blocks.push({ type: 'text', text, citations: [] })
  for (const call of toolCalls) {
    blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
  }
  return { blocks, usage, id, recovery }
}

async function withStreamRetries(
  signal: AbortSignal,
  run: () => Promise<Completion>,
): Promise<Completion> {
  let lastError: unknown
  for (let attempt = 0; attempt < STREAM_ATTEMPTS; attempt++) {
    if (signal.aborted) throw abortError(signal)
    try {
      const completed = await run()
      if (completed.recovery !== 'retry') return completed
      lastError = new Error('The model stream dropped before it produced a response.')
    } catch (error) {
      if (signal.aborted || shouldStopRetry(error)) throw error
      lastError = error
    }
    if (attempt < STREAM_ATTEMPTS - 1) await pause(attempt, signal)
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('The model stream dropped before it produced a response.')
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
    onPartial?: (message: AssistantMessage) => void
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
      const completed = await withStreamRetries(signal, () =>
        complete({
          kind: provider.kind,
          modelId: options.model || provider.model,
          baseURL: provider.baseURL,
          apiKey: provider.apiKey,
          system,
          turns: threadChat(system, messages).turns,
          tools,
          thinking,
          signal,
          onPartial: options.onPartial,
        }),
      )
      return answerFrom(options.model || provider.model, completed, started)
    }

    if (!provider.nvidiaApiKey) {
      return textMessage(
        'free-mode',
        `${API_ERROR_MESSAGE_PREFIX}: Set NVIDIA_API_KEY or \`openagent config set -g nvidiaApiKey <key>\` to run this conversation. The local model is only used for new bookkeeping chats.`,
        true,
      )
    }

    const skill = selectSkill(task)
    if (skill) {
      const excerpt = skillExcerpt(skill)
      if (excerpt) system += `\n\nFollow this skill when it applies:\n${excerpt}`
    }
    const failed: string[] = []
    const flags = { requireVision: hasImage(messages), preferLongContext: false }
    let lastDrop: Error | undefined
    for (let attempt = 0; attempt < STREAM_ATTEMPTS; attempt++) {
      if (signal.aborted) throw abortError(signal)
      const choice = await pickNim(flags, failed, attempt === 0)
      if (!choice) {
        if (!failed.length) {
          return textMessage(
            'free-mode',
            `${API_ERROR_MESSAGE_PREFIX}: Every free-mode model is out of requests. The thread stays here and was not sent to the local model.`,
            true,
          )
        }
        break
      }
      try {
        const completed = await complete({
          kind: 'free',
          modelId: choice.apiModel,
          baseURL: 'https://integrate.api.nvidia.com/v1',
          apiKey: provider.nvidiaApiKey,
          system,
          turns: threadChat(system, messages).turns,
          tools,
          thinking: false,
          signal,
          onPartial: options.onPartial,
        })
        if (completed.recovery !== 'retry') return answerFrom(choice.id, completed, started)
        failed.push(choice.id)
        setStickyModel(null)
        lastDrop = new Error('The model stream dropped before it produced a response.')
      } catch (error) {
        if (signal.aborted || shouldStopRetry(error)) throw error
        failed.push(choice.id)
        setStickyModel(null)
        lastDrop = error instanceof Error ? error : new Error(String(error))
      }
      if (attempt < STREAM_ATTEMPTS - 1) await pause(attempt, signal)
    }
    throw lastDrop ?? new Error('The model stream dropped before it produced a response.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return textMessage(provider.model, `${API_ERROR_MESSAGE_PREFIX}: ${message}`, true)
  }
}

function answerFrom(model: string, completed: Completion, started: number): AssistantMessage {
  return assistantFrom(model, completed.blocks, {
    durationMs: Date.now() - started,
    id: completed.id,
    usage: completed.usage,
    incomplete: completed.recovery === 'continue',
  })
}

async function pickNim(
  flags: { requireVision: boolean; preferLongContext: boolean },
  exclude: string[] = [],
  allowWait = true,
) {
  const catalog = exclude.length
    ? NIM_CATALOG.filter(model => !exclude.includes(model.id))
    : undefined
  const choose = () =>
    chooseNimModel({
      now: Date.now(),
      usage: loadLedger(),
      requireVision: flags.requireVision,
      preferLongContext: flags.preferLongContext,
      catalog,
    })
  let choice = choose()
  if (choice.kind === 'wait') {
    if (!allowWait) return null
    const seconds = Math.max(1, Math.ceil(choice.waitMs / 1000))
    console.error(`Free-mode models are cooling. Waiting ${seconds}s for the next request window.`)
    await new Promise(resolve => setTimeout(resolve, choice.kind === 'wait' ? choice.waitMs : 0))
    choice = choose()
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
      const fastSignal = signal ?? new AbortController().signal
      const completed = await withStreamRetries(fastSignal, () =>
        complete({
          kind: 'free',
          modelId: 'qwen3-0.6b',
          baseURL: provider.localBaseURL,
          apiKey: 'local',
          system: systemPrompt[0] || chat.system,
          turns: chat.turns,
          tools: [],
          thinking: false,
          signal: fastSignal,
        }),
      )
      return assistantFrom('qwen3-0.6b', completed.blocks, {
        durationMs: Date.now() - started,
        id: completed.id,
        usage: completed.usage,
      })
    }
    const fastSignal = signal ?? new AbortController().signal
    const completed = await withStreamRetries(fastSignal, () =>
      complete({
        kind: provider.kind,
        modelId: provider.fastModel,
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        system: systemPrompt.join('\n\n'),
        turns: [{ role: 'user', content: userPrompt }],
        tools: [],
        thinking: false,
        signal: fastSignal,
      }),
    )
    return assistantFrom(provider.fastModel, completed.blocks, {
      durationMs: Date.now() - started,
      id: completed.id,
      usage: completed.usage,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return textMessage(provider.fastModel, `${API_ERROR_MESSAGE_PREFIX}: ${message}`, true)
  }
}

export const querySonnet = queryModel
export const queryHaiku = queryFast
export { requestThinking }
