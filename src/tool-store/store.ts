import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'fs'
import { dirname, join, sep } from 'path'
import { fileURLToPath } from 'url'
import { dataDir } from '../services/budget.js'
import { topK } from '../services/match.js'

export type StoredToolMeta = {
  id: string
  description: string
  language: string
  updatedAt: string
}

const SEEDS: StoredToolMeta[] = [
  {
    id: 'git-status',
    description: 'Show a short git status summary for the current project',
    language: 'shell',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'project-test',
    description: 'Print the test or lint command recorded in AGENTS.md',
    language: 'shell',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'todo-scan',
    description: 'List TODO and FIXME comments in the project',
    language: 'shell',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

export function toolStoreDir(): string {
  return join(dataDir(), 'tool-store')
}

export function toolIndexPath(): string {
  return join(toolStoreDir(), 'index.json')
}

export function toolItemDir(id: string): string {
  return join(toolStoreDir(), 'items', id)
}

function seedRoot(): string {
  return fileURLToPath(new URL('../tool-store/seed/', import.meta.url))
}

export function validToolId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,64}$/.test(id)
}

export function loadToolIndex(): StoredToolMeta[] {
  ensureSeeded()
  try {
    return JSON.parse(readFileSync(toolIndexPath(), 'utf8')) as StoredToolMeta[]
  } catch {
    return []
  }
}

export function ensureSeeded(): void {
  if (process.env.NODE_ENV === 'test' && !process.env.OPENAGENT_SEED_TOOLS) return
  for (const seed of SEEDS) {
    const dir = toolItemDir(seed.id)
    const codePath = join(dir, 'code')
    if (existsSync(codePath)) continue
    mkdirSync(dir, { recursive: true })
    const source = join(seedRoot(), `${seed.id}.sh`)
    const code = existsSync(source)
      ? readFileSync(source, 'utf8')
      : '#!/bin/sh\nexit 0\n'
    writeFileSync(codePath, code)
    chmodSync(codePath, 0o755)
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(seed, null, 2))
  }
  if (!existsSync(toolIndexPath())) {
    mkdirSync(toolStoreDir(), { recursive: true })
    writeFileSync(toolIndexPath(), JSON.stringify(SEEDS, null, 2))
  }
}

export function searchStoredTools(query: string, k = 5): StoredToolMeta[] {
  const index = loadToolIndex()
  if (!query.trim()) return index.slice(0, k)
  return topK(query, index, item => `${item.id} ${item.description}`, k)
}

export function toolExists(id: string): boolean {
  return existsSync(join(toolItemDir(id), 'meta.json'))
}

export function saveStoredTool(meta: StoredToolMeta, code: string): void {
  if (!validToolId(meta.id)) throw new Error('Invalid tool id')
  const dir = toolItemDir(meta.id)
  const root = join(toolStoreDir(), 'items')
  if (!dir.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new Error('Tool path escaped the store')
  }
  mkdirSync(dir, { recursive: true })
  const codePath = join(dir, 'code')
  writeFileSync(codePath, code)
  chmodSync(codePath, 0o755)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  const index = loadToolIndex().filter(item => item.id !== meta.id)
  index.push(meta)
  mkdirSync(dirname(toolIndexPath()), { recursive: true })
  writeFileSync(toolIndexPath(), JSON.stringify(index, null, 2))
}

export function appendToolUsage(id: string, ok: boolean): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), id, ok }) + '\n'
  const path = join(toolItemDir(id), 'usage.jsonl')
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, line)
}

export function readToolCode(id: string): string {
  return readFileSync(join(toolItemDir(id), 'code'), 'utf8')
}
