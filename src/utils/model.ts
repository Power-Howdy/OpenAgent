import { memoize } from 'lodash-es'
import { isFreeMode, resolveProvider } from '../services/resolveProvider.js'

export const USE_BEDROCK = false
export const USE_VERTEX = false

export interface ModelConfig {
  bedrock: string
  vertex: string
  firstParty: string
}

export function getVertexRegionForModel(
  _model: string | undefined,
): string | undefined {
  return undefined
}

export const getSlowAndCapableModel = memoize(async (): Promise<string> => {
  const provider = resolveProvider()
  if (process.env.OPENAGENT_MODEL) return process.env.OPENAGENT_MODEL
  if (provider.kind === 'free') return 'free-mode'
  return provider.model
})

export async function isDefaultSlowAndCapableModel(): Promise<boolean> {
  return !process.env.OPENAGENT_MODEL && !process.env.ANTHROPIC_MODEL
}

export const SMALL_FAST_MODEL = 'qwen3-0.6b'

export function modelIsFree(): boolean {
  return isFreeMode()
}
