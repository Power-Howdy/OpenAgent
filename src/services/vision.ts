import { findNimModel } from '../models/nim-catalog.js'
import { getStickyModel } from './freeRouter.js'
import { isOffline } from './offline.js'
import { resolveProvider } from './resolveProvider.js'

export function modelHasVision(kind: string, modelId: string | undefined, hasNimKey: boolean): boolean {
  if (kind === 'free') {
    if (!hasNimKey || !modelId || modelId === 'free-mode') return false
    return Boolean(findNimModel(modelId)?.tags.includes('vision'))
  }
  return kind === 'anthropic' || kind === 'openai'
}

export function providerCanSeeImages(modelId?: string): boolean {
  if (isOffline()) return false
  try {
    const provider = resolveProvider()
    const selected = modelId && modelId !== 'free-mode' ? modelId : getStickyModel() ?? undefined
    const id = provider.kind === 'free' ? selected : provider.model
    return modelHasVision(provider.kind, id, Boolean(provider.nvidiaApiKey))
  } catch {
    return false
  }
}
