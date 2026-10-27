import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dataDir } from './budget.js'
import { selectMatch, topK } from './match.js'

export type BlueprintRecord = {
  id: string
  title: string
  description: string
  source: 'nvidia' | 'authored'
  pageUrl: string
  repoUrl: string
  localPath: string
}

export const BLUEPRINT_CATALOG: BlueprintRecord[] = [
  {
    id: 'rag',
    title: 'RAG',
    description: 'Retrieval augmented generation over enterprise documents',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/rag',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/rag',
    localPath: '',
  },
  {
    id: 'pdf-to-podcast',
    title: 'PDF to podcast',
    description: 'Turn a PDF into a spoken podcast with retrieval and speech',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/pdf-to-podcast',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/pdf-to-podcast',
    localPath: '',
  },
  {
    id: 'multimodal-pdf',
    title: 'Multimodal PDF extraction',
    description: 'Extract text, tables, and figures from PDFs',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/multimodal-pdf-data-extraction',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/multimodal-pdf-data-extraction',
    localPath: '',
  },
  {
    id: 'video-search',
    title: 'Video search and summarization',
    description: 'Search and summarize long video libraries',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/video-search-and-summarization',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization',
    localPath: '',
  },
  {
    id: 'ai-virtual-assistant',
    title: 'AI virtual assistant',
    description: 'Customer support assistant with retrieval and tools',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/ai-virtual-assistant',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/ai-virtual-assistant',
    localPath: '',
  },
  {
    id: 'vulnerability-analysis',
    title: 'Vulnerability analysis',
    description: 'Software vulnerability analysis agent for code and reports',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/vulnerability-analysis',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/vulnerability-analysis',
    localPath: '',
  },
  {
    id: 'data-flywheel',
    title: 'Data flywheel',
    description: 'Continuous data flywheel for evaluating and improving models',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/data-flywheel',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/data-flywheel',
    localPath: '',
  },
  {
    id: 'knowledge-graph',
    title: 'Knowledge graph',
    description: 'Build a knowledge graph from unstructured documents',
    source: 'nvidia',
    pageUrl: 'https://build.nvidia.com/nvidia/knowledge-graph',
    repoUrl: 'https://github.com/NVIDIA-AI-Blueprints/knowledge-graph',
    localPath: '',
  },
]

export function blueprintStoreDir(): string {
  return join(dataDir(), 'blueprint-store')
}

export function blueprintIndexPath(): string {
  return join(blueprintStoreDir(), 'index.json')
}

export function loadBlueprintIndex(): BlueprintRecord[] {
  try {
    const saved = JSON.parse(readFileSync(blueprintIndexPath(), 'utf8')) as BlueprintRecord[]
    if (saved.length) return saved
  } catch {
    // The shipped catalog is the cache until a refresh writes one.
  }
  return BLUEPRINT_CATALOG
}

export function saveBlueprintIndex(records: BlueprintRecord[]): void {
  mkdirSync(blueprintStoreDir(), { recursive: true })
  writeFileSync(blueprintIndexPath(), JSON.stringify(records, null, 2))
}

export function selectBlueprint(query: string): BlueprintRecord | null {
  return selectMatch(
    query,
    loadBlueprintIndex(),
    record => `${record.title} ${record.description}`,
  )
}

export function topBlueprints(query: string, k = 3): BlueprintRecord[] {
  return topK(
    query,
    loadBlueprintIndex(),
    record => `${record.title} ${record.description}`,
    k,
  )
}

export type AuthoredBlueprint = {
  id: string
  title: string
  description: string
  workers: { role: string; task: string; files?: string[] }[]
}

export function independentWorkstreams(text: string): boolean {
  const markers = text.match(/\b(and|while|meanwhile|separately|in parallel)\b/gi) ?? []
  const parts = text.split(/\n\s*\d+[.)]\s+/).filter(part => part.trim().length > 20)
  return markers.length >= 1 && parts.length >= 2
}

export function canAuthorBlueprint(query: string): boolean {
  if (!independentWorkstreams(query)) return false
  return selectBlueprint(query) === null
}

export function saveAuthoredBlueprint(blueprint: AuthoredBlueprint): string {
  if (blueprint.workers.length < 2 || blueprint.workers.length > 3) {
    throw new Error('An authored blueprint needs 2 or 3 workers')
  }
  const dir = join(blueprintStoreDir(), 'authored', blueprint.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'blueprint.json'), JSON.stringify(blueprint, null, 2))
  const markdown = [
    `# ${blueprint.title}`,
    '',
    blueprint.description,
    '',
    ...blueprint.workers.map(
      (worker, index) =>
        `## Worker ${index + 1}: ${worker.role}\n${worker.task}\nFiles: ${(worker.files ?? []).join(', ') || 'none'}`,
    ),
  ].join('\n')
  writeFileSync(join(dir, 'README.md'), markdown)
  const record: BlueprintRecord = {
    id: blueprint.id,
    title: blueprint.title,
    description: blueprint.description,
    source: 'authored',
    pageUrl: '',
    repoUrl: '',
    localPath: dir,
  }
  const index = loadBlueprintIndex().filter(item => item.id !== blueprint.id)
  index.push(record)
  saveBlueprintIndex(index)
  return dir
}

export function blueprintCloneDir(id: string): string {
  return join(blueprintStoreDir(), 'nvidia', id)
}

export function blueprintIsCloned(id: string): boolean {
  return existsSync(join(blueprintCloneDir(id), '.git'))
}
