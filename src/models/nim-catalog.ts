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
    id: 'gemma-4-31b-it',
    apiModel: 'google/gemma-4-31b-it',
    priority: 3,
    tags: ['coding', 'tools'],
    context: 128_000,
  },
  {
    id: 'deepseek-v4.1-flash',
    apiModel: 'deepseek-ai/deepseek-v4.1-flash',
    priority: 4,
    tags: ['coding', 'tools', 'fast', 'vision'],
    context: 128_000,
  },
  {
    id: 'minimax-m3.1-flash',
    apiModel: 'minimaxai/minimax-m3.1-flash',
    priority: 5,
    tags: ['coding', 'tools'],
    context: 128_000,
  },
  {
    id: 'glm-5-3',
    apiModel: 'z-ai/glm-5-3',
    priority: 6,
    tags: ['coding', 'planning', 'tools', 'reasoning'],
    context: 128_000,
  },
  {
    id: 'gpt-oss-20b',
    apiModel: 'openai/gpt-oss-20b',
    priority: 7,
    tags: ['coding', 'tools', 'reasoning'],
    context: 128_000,
  },
  {
    id: 'glm-5-3-flash',
    apiModel: 'z-ai/glm-5-3-flash',
    priority: 8,
    tags: ['tools', 'fast', 'vision'],
    context: 128_000,
  },
  {
    id: 'nemotron-3.5-lightning-30b-a3b',
    apiModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    priority: 9,
    tags: ['tools', 'fast'],
    context: 128_000,
  },
  {
    id: 'nemotron-3.5-bolt-e4b',
    apiModel: 'nvidia/nemotron-3.5-bolt-e4b',
    priority: 10,
    tags: ['tools', 'fast'],
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
