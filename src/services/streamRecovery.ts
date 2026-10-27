export type RecoveryAction = 'use' | 'continue' | 'retry'

export interface GenerationSnapshot {
  text: string
  toolCallCount: number
  unfinishedTool: boolean
  finishReason: string
  failed: boolean
}

const PERMANENT_STATUS = new Set([400, 401, 402, 403, 404])

export function isAbortError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false
  if ('name' in error && error.name === 'AbortError') return true
  return isAbortError('cause' in error ? error.cause : undefined, depth + 1)
}

export function isPermanentFailure(message: string, statusCode?: number): boolean {
  if (statusCode !== undefined && PERMANENT_STATUS.has(statusCode)) return true
  return (
    message.includes('Prompt is too long') ||
    message.includes('Credit balance is too low') ||
    message.includes('Invalid API key')
  )
}

export function textLooksComplete(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  const fences = trimmed.match(/```/g)
  if (fences && fences.length % 2 === 1) return false
  return /[.!?](?:["')\]]+)?$/.test(trimmed) || trimmed.endsWith('```')
}

// A missing finish reason is how some compatible providers close a stream.
// Keep finished work, continue a cutoff, and retry only when nothing arrived.
export function recoverGeneration(snapshot: GenerationSnapshot): RecoveryAction {
  if (snapshot.toolCallCount > 0) return 'use'
  const text = snapshot.text.trim()
  if (!text) {
    if (
      !snapshot.failed &&
      snapshot.finishReason !== 'error' &&
      snapshot.finishReason !== 'length' &&
      !snapshot.unfinishedTool
    ) {
      return 'use'
    }
    return 'retry'
  }
  if (snapshot.finishReason === 'length' || snapshot.unfinishedTool) return 'continue'
  if (snapshot.failed || snapshot.finishReason === 'error' || snapshot.finishReason === '') {
    return textLooksComplete(text) ? 'use' : 'continue'
  }
  return 'use'
}
