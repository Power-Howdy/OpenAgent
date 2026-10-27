export type NimTag =
  | 'tools'
  | 'coding'
  | 'planning'
  | 'long-context'
  | 'fast'
  | 'vision'
  | 'reasoning'
  | 'exclude'

export type NimModel = {
  id: string
  apiModel: string
  priority: number
  tags: NimTag[]
  context: number
}

// Priority breaks ties. Free mode otherwise spreads calls to the model
// with the most remaining requests. apiModel is the NIM request id.
export const NIM_CATALOG: NimModel[] = [
  {
    id: 'nemotron-3-ultra-550b-a55b',
    apiModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    priority: 1,
    tags: ['coding', 'planning', 'tools', 'long-context'],
    context: 1_000_000,
  },
  {
    id: 'nemotron-3.5-super-vl-120b-a12b',
    apiModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    priority: 2,
    tags: ['coding', 'tools', 'vision'],
    context: 128_000,
  },
  {
    id: 'deepseek-v4.1-flash',
    apiModel: 'deepseek-ai/deepseek-v4.1-flash',
    priority: 3,
    tags: ['coding', 'tools', 'fast', 'vision'],
    context: 128_000,
  },
  {
    id: 'nemotron-4-ultra-1t',
    apiModel: 'nvidia/nemotron-4-ultra-1t',
    priority: 4,
    tags: ['coding', 'planning', 'tools', 'long-context', 'reasoning'],
    context: 1_000_000,
  },
  {
    id: 'llama-4-maverick-17b-128e',
    apiModel: 'meta/llama-4-maverick-17b-128e',
    priority: 5,
    tags: ['coding', 'tools', 'long-context', 'reasoning'],
    context: 1_000_000,
  },
  {
    id: 'llama-4-scout-17b-16e',
    apiModel: 'meta/llama-4-scout-17b-16e',
    priority: 6,
    tags: ['coding', 'tools', 'fast'],
    context: 128_000,
  },
  {
    id: 'gemma-4-31b-it',
    apiModel: 'google/gemma-4-31b-it',
    priority: 7,
    tags: ['coding', 'tools'],
    context: 128_000,
  },
  {
    id: 'nemotron-3.5-lightning-30b-a3b',
    apiModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    priority: 8,
    tags: ['tools', 'fast'],
    context: 128_000,
  },
  {
    id: 'nemotron-3.5-bolt-e4b',
    apiModel: 'nvidia/nemotron-3.5-bolt-e4b',
    priority: 9,
    tags: ['tools', 'fast'],
    context: 128_000,
  },
  {
    id: 'gpt-oss-20b',
    apiModel: 'openai/gpt-oss-20b',
    priority: 10,
    tags: ['coding', 'tools', 'reasoning'],
    context: 128_000,
  },
]

export const NIM_EXCLUDED = [
  'speech',
  'image-gen',
  'ocr',
  'embeddings',
  'biology',
  'safety',
]

export function hasTag(model: NimModel, tag: NimTag): boolean {
  return model.tags.includes(tag)
}

export function isCapable(model: NimModel): boolean {
  return hasTag(model, 'coding') && hasTag(model, 'tools') && !hasTag(model, 'exclude')
}

export function isFastOnly(model: NimModel): boolean {
  return hasTag(model, 'fast') && hasTag(model, 'tools') && !hasTag(model, 'coding')
}

export function findNimModel(id: string): NimModel | undefined {
  return NIM_CATALOG.find(model => model.id === id || model.apiModel === id)
}
