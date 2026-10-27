export type TextCitation = { type?: string; [key: string]: unknown }

export interface TextBlockParam {
  type: 'text'
  text: string
  citations?: TextCitation[]
  cache_control?: { type: 'ephemeral' }
}

export interface TextBlock extends TextBlockParam {}

export interface ToolUseBlockParam {
  type: 'tool_use'
  id: string
  name: string
  input: { [key: string]: unknown }
  cache_control?: { type: 'ephemeral' }
}

export interface ToolUseBlock extends ToolUseBlockParam {}

export interface ToolResultBlockParam {
  type: 'tool_result'
  tool_use_id: string
  content?: string | ContentBlockParam[]
  is_error?: boolean
  cache_control?: { type: 'ephemeral' }
}

export interface ImageBlockParam {
  type: 'image'
  source: ImageBlockParam.Source
  cache_control?: { type: 'ephemeral' }
}

export namespace ImageBlockParam {
  export interface Source {
    type: 'base64'
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
  }
}

export interface ThinkingBlockParam {
  type: 'thinking'
  thinking: string
  signature?: string
}

export interface ThinkingBlock extends ThinkingBlockParam {}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking'
  data: string
}

export interface DocumentBlockParam {
  type: 'document'
  source?: { type?: string; media_type?: string; data?: string }
}

export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ThinkingBlockParam
  | RedactedThinkingBlock
  | DocumentBlockParam

export type ContentBlock = ContentBlockParam

export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export interface Message {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null
  stop_sequence: string | null
  usage: Usage
  content: ContentBlock[]
}
