import type React from 'react'
import type { z } from 'zod'

export type ValidationResult = {
  result: boolean
  message?: string
  meta?: Record<string, unknown>
}

export type SetToolJSXFn = (jsx: any) => void

export type ToolUseContext = {
  options: {
    commands: any[]
    tools: Tool[]
    verbose?: boolean
    slowAndCapableModel?: string
    maxThinkingTokens?: number
    dangerouslySkipPermissions?: boolean
    forkNumber?: number
    messageLogName?: string
    [key: string]: unknown
  }
  abortController: AbortController
  readFileTimestamps: Record<string, number>
  setToolJSX?: SetToolJSXFn
  messageId?: string | null
  setForkConvoWithMessagesOnTheNextRender?: any
}

export type ToolCallProgress<Output = unknown> =
  | {
      type: 'progress'
      content?: unknown
      normalizedMessages?: unknown
      tools?: Tool[]
      siblingToolUseIDs?: Set<string>
      toolUseID?: string
      data?: Output
    }
  | {
      type: 'result'
      data: Output
      resultForAssistant?: unknown
      isError?: boolean
      normalizedMessages?: unknown
      tools?: Tool[]
    }

export type Tool<Input extends z.ZodType = z.ZodType, Output = any> = {
  name: string
  inputSchema: Input
  inputJSONSchema?: Record<string, unknown>
  description: (...args: any[]) => Promise<string> | string
  prompt: (...args: any[]) => Promise<string> | string
  isReadOnly: (input?: any) => boolean
  isEnabled?: () => Promise<boolean> | boolean
  userFacingName?: (...args: any[]) => string
  needsPermissions?: (input?: any) => boolean
  renderToolUseMessage?: (...args: any[]) => any
  renderToolResultMessage?: (...args: any[]) => any
  renderToolUseRejectedMessage?: (...args: any[]) => any
  renderResultForAssistant?: (output: Output) => any
  validateInput?: (
    input: z.infer<Input>,
    context: ToolUseContext,
  ) => Promise<ValidationResult> | ValidationResult
  call: (
    input: z.infer<Input>,
    context: any,
    canUseTool?: any,
    parentMessage?: any,
  ) => AsyncGenerator<any, any, any>
}
