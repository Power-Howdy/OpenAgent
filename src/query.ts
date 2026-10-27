import {
  Message as APIAssistantMessage,
  MessageParam,
  ToolUseBlock,
} from './types/api.js'
import { UUID } from 'crypto'
import type { Tool, ToolUseContext } from './Tool.js'
import {
  messagePairValidForBinaryFeedback,
  shouldUseBinaryFeedback,
} from './components/binary-feedback/utils.js'
import { CanUseToolFn } from './hooks/useCanUseTool.js'
import {
  formatSystemPromptWithContext,
  querySonnet,
} from './services/OpenAgent.js'
import { logEvent } from './services/statsig.js'
import { all } from './utils/generators.js'
import { logError } from './utils/log.js'
import {
  createAssistantMessage,
  createProgressMessage,
  createToolResultStopMessage,
  createUserMessage,
  FullToolUseResult,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  NormalizedMessage,
  normalizeMessagesForAPI,
} from './utils/messages.js'
import { BashTool } from './tools/BashTool/BashTool.js'
import { ExitPlanModeTool } from './tools/ExitPlanMode/ExitPlanMode.js'
import { toolsForPlanMode, withPlanModePrompt, isPlanMode } from './services/planMode.js'
import { formatTodos, loadTodos } from './services/todos.js'
import { setTranscript } from './services/transcript.js'
import { getPermissionMode, permissionModePrompt } from './services/permissionMode.js'
import { redactSecrets } from './services/redact.js'
import { getCwd } from './utils/state.js'

export type Response = { costUSD: number; response: string }
export type UserMessage = {
  message: MessageParam
  type: 'user'
  uuid: UUID
  toolUseResult?: FullToolUseResult
}

export type AssistantMessage = {
  costUSD: number
  durationMs: number
  message: APIAssistantMessage
  type: 'assistant'
  uuid: UUID
  isApiErrorMessage?: boolean
}

export type BinaryFeedbackResult =
  | { message: AssistantMessage | null; shouldSkipPermissionCheck: false }
  | { message: AssistantMessage; shouldSkipPermissionCheck: true }

export type ProgressMessage = {
  content: AssistantMessage
  normalizedMessages: NormalizedMessage[]
  siblingToolUseIDs: Set<string>
  tools: Tool[]
  toolUseID: string
  type: 'progress'
  uuid: UUID
}

// Each array item is either a single message or a message-and-response pair
export type Message = UserMessage | AssistantMessage | ProgressMessage

const MAX_TOOL_USE_CONCURRENCY = 10
const MAX_AGENT_TURNS = 32
const MAX_REPEATED_TOOL_ERRORS = 3
const COMPACT_INPUT_TOKENS = 80_000

type LoopState = { turns: number; repeatedError: string; repeats: number }

function loopStateOf(options: ToolUseContext['options']): LoopState {
  const existing = options.loopState as LoopState | undefined
  if (existing) return existing
  const created: LoopState = { turns: 0, repeatedError: '', repeats: 0 }
  options.loopState = created
  return created
}

function toolErrorKey(results: UserMessage[]): string | null {
  const keys: string[] = []
  for (const message of results) {
    const content = message.message.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_result' && block.is_error) {
        keys.push(String(block.content ?? '').slice(0, 200))
      }
    }
  }
  return keys.length ? keys.join('\n') : null
}

async function compactThread(
  history: Message[],
  toolUseContext: ToolUseContext,
): Promise<Message[]> {
  try {
    const summary = await querySonnet(
      normalizeMessagesForAPI(history.filter(message => message.type !== 'progress')),
      ['Summarize this coding session so work can continue. Include files, decisions, errors, and the next step. Do not call tools.'],
      0,
      [],
      toolUseContext.abortController.signal,
      {
        dangerouslySkipPermissions: false,
        model: toolUseContext.options.slowAndCapableModel ?? '',
        prependCLISysprompt: false,
      },
    )
    const content = summary.message.content
    const text = typeof content === 'string'
      ? content
      : content.find(block => block.type === 'text' && 'text' in block)?.text
    if (!text || text.startsWith('API Error')) return history
    const replacement = [
      createUserMessage(`The earlier conversation was compacted.\n\n${text}`),
      summary,
    ]
    const replace = toolUseContext.options.onReplaceMessages
    if (typeof replace === 'function') {
      ;(replace as (next: Message[]) => void)(replacement)
    }
    return replacement
  } catch {
    return history
  }
}

function withPermissionPrompt(systemPrompt: string[]): string[] {
  const note = permissionModePrompt(getPermissionMode())
  return note ? [...systemPrompt, note] : systemPrompt
}

// Returns a message if we got one, or `null` if the user cancelled
async function queryWithBinaryFeedback(
  toolUseContext: ToolUseContext,
  getAssistantResponse: () => Promise<AssistantMessage>,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): Promise<BinaryFeedbackResult> {
  if (
    process.env.USER_TYPE !== 'ant' ||
    !getBinaryFeedbackResponse ||
    !(await shouldUseBinaryFeedback())
  ) {
    const assistantMessage = await getAssistantResponse()
    if (toolUseContext.abortController.signal.aborted) {
      return { message: null, shouldSkipPermissionCheck: false }
    }
    return { message: assistantMessage, shouldSkipPermissionCheck: false }
  }
  const [m1, m2] = await Promise.all([
    getAssistantResponse(),
    getAssistantResponse(),
  ])
  if (toolUseContext.abortController.signal.aborted) {
    return { message: null, shouldSkipPermissionCheck: false }
  }
  if (m2.isApiErrorMessage) {
    // If m2 is an error, we might as well return m1, even if it's also an error --
    // the UI will display it as an error as it would in the non-feedback path.
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  if (m1.isApiErrorMessage) {
    return { message: m2, shouldSkipPermissionCheck: false }
  }
  if (!messagePairValidForBinaryFeedback(m1, m2)) {
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  return await getBinaryFeedbackResponse(m1, m2)
}

/**
 * The rules of thinking are lengthy and fortuitous. They require plenty of thinking
 * of most long duration and deep meditation for a wizard to wrap one's noggin around.
 *
 * The rules follow:
 * 1. A message that contains a thinking or redacted_thinking block must be part of a query whose max_thinking_length > 0
 * 2. A thinking block may not be the last message in a block
 * 3. Thinking blocks must be preserved for the duration of an assistant trajectory (a single turn, or if that turn includes a tool_use block then also its subsequent tool_result and the following assistant message)
 *
 * Heed these rules well, young wizard. For they are the rules of thinking, and
 * the rules of thinking are the rules of the universe. If ye does not heed these
 * rules, ye will be punished with an entire day of debugging and hair pulling.
 */
export async function* query(
  messages: Message[],
  systemPrompt: string[],
  context: { [k: string]: string },
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): AsyncGenerator<Message, void> {
  for (;;) {
  const options = toolUseContext.options
  const loop = loopStateOf(options)
  loop.turns += 1
  if (loop.turns > MAX_AGENT_TURNS) {
    yield createAssistantMessage(
      'Stopped after 32 turns. Say what is finished and what is still open, then wait for the user.',
    )
    return
  }
  if (options.messageLogName) loadTodos(String(options.messageLogName))
  setTranscript(messages)
  if (!options.allTools) options.allTools = options.tools
  options.tools = isPlanMode()
    ? toolsForPlanMode(options.allTools as Tool[], ExitPlanModeTool)
    : (options.allTools as Tool[])
  const todoPrompt = formatTodos()
  const fullSystemPrompt = formatSystemPromptWithContext(
    withPermissionPrompt(withPlanModePrompt(todoPrompt ? [...systemPrompt, todoPrompt] : systemPrompt)),
    context,
  )

  function getAssistantResponse() {
    return querySonnet(
      normalizeMessagesForAPI(messages),
      fullSystemPrompt,
      toolUseContext.options.maxThinkingTokens,
      toolUseContext.options.tools,
      toolUseContext.abortController.signal,
      {
        dangerouslySkipPermissions:
          toolUseContext.options.dangerouslySkipPermissions ?? false,
        model: toolUseContext.options.slowAndCapableModel,
        prependCLISysprompt: true,
        onPartial: toolUseContext.options.onAssistantPartial as
          | ((message: AssistantMessage) => void)
          | undefined,
      },
    )
  }

  const result = await queryWithBinaryFeedback(
    toolUseContext,
    getAssistantResponse,
    getBinaryFeedbackResponse,
  )

  if (result.message === null) {
    yield createAssistantMessage(INTERRUPT_MESSAGE)
    return
  }

  const assistantMessage = result.message
  const shouldSkipPermissionCheck = result.shouldSkipPermissionCheck

  yield assistantMessage

  // @see https://docs.anthropic.com/en/docs/build-with-OpenAgent/tool-use
  // Note: stop_reason === 'tool_use' is unreliable -- it's not always set correctly
  const toolUseMessages = assistantMessage.message.content.filter(
    _ => _.type === 'tool_use',
  )

  // If there's no more tool use, we're done
  if (!toolUseMessages.length) {
    return
  }

  const toolResults: UserMessage[] = []

  // Prefer to run tools concurrently, if we can
  // TODO: tighten up the logic -- we can run concurrently much more often than this
  if (
    toolUseMessages.every(msg =>
      toolUseContext.options.tools.find(t => t.name === msg.name)?.isReadOnly(msg.input),
    )
  ) {
    for await (const message of runToolsConcurrently(
      toolUseMessages,
      assistantMessage,
      canUseTool,
      toolUseContext,
      shouldSkipPermissionCheck,
    )) {
      yield message
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message)
      }
    }
  } else {
    for await (const message of runToolsSerially(
      toolUseMessages,
      assistantMessage,
      canUseTool,
      toolUseContext,
      shouldSkipPermissionCheck,
    )) {
      yield message
      // progress messages are not sent to the server, so don't need to be accumulated for the next turn
      if (message.type === 'user') {
        toolResults.push(message)
      }
    }
  }

  if (toolUseContext.abortController.signal.aborted) {
    yield createAssistantMessage(INTERRUPT_MESSAGE_FOR_TOOL_USE)
    return
  }

  // Sort toolResults to match the order of toolUseMessages
  const orderedToolResults = toolResults.sort((a, b) => {
    const aIndex = toolUseMessages.findIndex(
      tu => tu.id === (a.message.content[0] as ToolUseBlock).id,
    )
    const bIndex = toolUseMessages.findIndex(
      tu => tu.id === (b.message.content[0] as ToolUseBlock).id,
    )
    return aIndex - bIndex
  })

  const errorKey = toolErrorKey(orderedToolResults)
  if (errorKey && errorKey === loop.repeatedError) loop.repeats += 1
  else {
    loop.repeatedError = errorKey ?? ''
    loop.repeats = errorKey ? 1 : 0
  }
  if (loop.repeats >= MAX_REPEATED_TOOL_ERRORS) {
    yield createAssistantMessage(
      'Stopped because the same tool error repeated. Tell the user the error and the next step that needs them.',
    )
    return
  }

  let nextMessages: Message[] = [...messages, assistantMessage, ...orderedToolResults]
  if (
    assistantMessage.message.usage.input_tokens >= COMPACT_INPUT_TOKENS &&
    nextMessages.length > 6
  ) {
    nextMessages = await compactThread(nextMessages, toolUseContext)
  }

  messages = nextMessages
  }
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  yield* all(
    toolUseMessages.map(toolUse =>
      runToolUse(
        toolUse,
        new Set(toolUseMessages.map(_ => _.id)),
        assistantMessage,
        canUseTool,
        toolUseContext,
        shouldSkipPermissionCheck,
      ),
    ),
    MAX_TOOL_USE_CONCURRENCY,
  )
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  for (const toolUse of toolUseMessages) {
    yield* runToolUse(
      toolUse,
      new Set(toolUseMessages.map(_ => _.id)),
      assistantMessage,
      canUseTool,
      toolUseContext,
      shouldSkipPermissionCheck,
    )
  }
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  siblingToolUseIDs: Set<string>,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  const toolName = toolUse.name
  const tool = toolUseContext.options.tools.find(t => t.name === toolName)

  // Check if the tool exists
  if (!tool) {
    logEvent('tengu_tool_use_error', {
      error: `No such tool available: ${toolName}`,
      messageID: assistantMessage.message.id,
      toolName,
      toolUseID: toolUse.id,
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: `Error: No such tool available: ${toolName}`,
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ])
    return
  }

  const toolInput = toolUse.input as { [key: string]: string }

  try {
    if (toolUseContext.abortController.signal.aborted) {
      logEvent('tengu_tool_use_cancelled', {
        toolName: tool.name,
        toolUseID: toolUse.id,
      })
      const message = createUserMessage([
        createToolResultStopMessage(toolUse.id),
      ])
      yield message
      return
    }

    for await (const message of checkPermissionsAndCallTool(
      tool,
      toolUse.id,
      siblingToolUseIDs,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      shouldSkipPermissionCheck,
    )) {
      yield message
    }
  } catch (e) {
    logError(e)
    yield createUserMessage([
      {
        type: 'tool_result',
        content: formatError(e),
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ])
  }
}

// TODO: Generalize this to all tools
export function normalizeToolInput(
  tool: Tool,
  input: { [key: string]: boolean | string | number },
): { [key: string]: boolean | string | number } {
  switch (tool) {
    case BashTool: {
      const { command, timeout } = BashTool.inputSchema.parse(input) // already validated upstream, won't throw
      return {
        command: command.replace(`cd ${getCwd()} && `, ''),
        ...(timeout ? { timeout } : {}),
      }
    }
    default:
      return input
  }
}

async function* checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  siblingToolUseIDs: Set<string>,
  input: { [key: string]: boolean | string | number },
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<UserMessage | ProgressMessage, void> {
  // Validate input types with zod
  // (surprisingly, the model is not great at generating valid input)
  const isValidInput = tool.inputSchema.safeParse(input)
  if (!isValidInput.success) {
    logEvent('tengu_tool_use_error', {
      error: `InputValidationError: ${isValidInput.error.message}`,
      messageID: assistantMessage.message.id,
      toolName: tool.name,
      toolInput: JSON.stringify(input).slice(0, 200),
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: `InputValidationError: ${isValidInput.error.message}`,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  const normalizedInput = normalizeToolInput(tool, input)

  // Validate input values. Each tool has its own validation logic
  const isValidCall = await tool.validateInput?.(
    normalizedInput as never,
    context,
  )
  if (isValidCall?.result === false) {
    logEvent('tengu_tool_use_error', {
      error: isValidCall?.message.slice(0, 2000),
      messageID: assistantMessage.message.id,
      toolName: tool.name,
      toolInput: JSON.stringify(input).slice(0, 200),
      ...(isValidCall?.meta ?? {}),
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content: isValidCall!.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  // Check whether we have permission to use the tool,
  // and ask the user for permission if we don't
  const permissionResult = shouldSkipPermissionCheck
    ? ({ result: true } as const)
    : await canUseTool(tool, normalizedInput, context, assistantMessage)
  if (permissionResult.result === false) {
    yield createUserMessage([
      {
        type: 'tool_result',
        content: permissionResult.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  // Call the tool
  try {
    const generator = tool.call(normalizedInput as never, context, canUseTool)
    let sawResult = false
    for await (const result of generator) {
      switch (result.type) {
        case 'result':
          sawResult = true
          logEvent(result.isError ? 'tengu_tool_use_error' : 'tengu_tool_use_success', {
            messageID: assistantMessage.message.id,
            toolName: tool.name,
          })
          yield createUserMessage(
            [
              {
                type: 'tool_result',
                content: result.resultForAssistant,
                tool_use_id: toolUseID,
                ...(result.isError ? { is_error: true } : {}),
              },
            ],
            {
              data: result.data,
              resultForAssistant: result.resultForAssistant,
            },
          )
          return
        case 'progress':
          logEvent('tengu_tool_use_progress', {
            messageID: assistantMessage.message.id,
            toolName: tool.name,
          })
          yield createProgressMessage(
            toolUseID,
            siblingToolUseIDs,
            result.content,
            result.normalizedMessages,
            result.tools,
          )
      }
    }
    if (!sawResult) {
      yield createUserMessage([
        {
          type: 'tool_result',
          content: `Error: ${tool.name} finished without a result`,
          is_error: true,
          tool_use_id: toolUseID,
        },
      ])
    }
  } catch (error) {
    const content = formatError(error)
    logError(error)
    logEvent('tengu_tool_use_error', {
      error: content.slice(0, 2000),
      messageID: assistantMessage.message.id,
      toolName: tool.name,
      toolInput: JSON.stringify(input).slice(0, 1000),
    })
    yield createUserMessage([
      {
        type: 'tool_result',
        content,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
  }
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  const fullMessage = redactSecrets(parts.filter(Boolean).join('\n'))
  if (fullMessage.length <= 10000) {
    return fullMessage
  }
  const halfLength = 5000
  const start = fullMessage.slice(0, halfLength)
  const end = fullMessage.slice(-halfLength)
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`
}
