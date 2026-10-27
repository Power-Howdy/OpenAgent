import type { Message } from '../query.js'

export type SerializedMessage = {
  type?: string
  timestamp?: string
  cwd?: string
  userType?: string
  sessionId?: string
  version?: string
  message?: {
    content?: string | unknown
    role?: string
  }
}

export type LogOption = {
  date: string
  forkNumber: number | undefined
  fullPath: string
  messages: SerializedMessage[]
  value: number
  created: Date
  modified: Date
  firstPrompt: string
  messageCount: number
  sidechainNumber: number | undefined
}

export type LogListProps = {
  context: {
    unmount?: () => void
  }
}

export type RecoveredMessage = Message
