import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, extname, join, parse } from 'path'
import { homedir } from 'os'

const TOTAL_BUDGET = 32_000
const PER_FILE = 6_000
const MAX_FILES = 40
const MAX_DEPTH = 5

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'build',
  '.next',
  'out',
  'vendor',
  '__pycache__',
])

const SKIP_AGENT_SUB = new Set([
  'projects',
  'sessions',
  'session',
  'history',
  'debug',
  'cache',
  'logs',
  'file-history',
  'todos',
  'statsig',
  'ide',
  'plugins',
  'node_modules',
])

const NAMED = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.local.md',
  'AGENT.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'Claude.md',
  'GEMINI.md',
  'QWEN.md',
  'CONTEXT.md',
  '.goosehints',
  '.cursorrules',
  '.windsurfrules',
]

const AGENT_DIRS = [
  '.cursor',
  '.claude',
  '.opencode',
  '.github',
  '.devin',
  '.windsurf',
  '.clinerules',
  '.roo',
  '.continue',
  '.junie',
  '.kiro',
  '.agents',
  '.qwen',
  '.gemini',
  '.goose',
  '.codex',
  '.aider',
  '.pi',
]

const TEXT_EXT = new Set(['.md', '.mdc', '.markdown', '.mdx', '.txt'])

const USER_FILES = [
  '.claude/CLAUDE.md',
  '.config/opencode/AGENTS.md',
  '.codex/AGENTS.md',
  '.agents/AGENTS.md',
  '.gemini/GEMINI.md',
]

export type InstructionHit = { path: string; text: string }

export function collectInstructionFiles(
  start: string,
  options: { user?: boolean } = {},
): InstructionHit[] {
  const projectRoot = findProjectRoot(start)
  const seen = new Set<string>()
  const hits: InstructionHit[] = []

  const add = (file: string) => {
    if (hits.length >= MAX_FILES || seen.has(file) || !existsSync(file)) return
    let info
    try {
      info = statSync(file)
    } catch {
      return
    }
    if (!info.isFile() || info.size > 512_000 || !isInstructionFile(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8').slice(0, PER_FILE)
    if (!text.trim()) return
    hits.push({ path: file, text })
  }

  if (options.user !== false) {
    for (const file of USER_FILES) add(join(homedir(), file))
  }

  for (const dir of ancestorChain(start, projectRoot)) {
    for (const name of NAMED) add(join(dir, name))
    for (const agentDir of AGENT_DIRS) {
      const full = join(dir, agentDir)
      if (existsSync(full)) collectDir(full, 0, add)
    }
  }
  walkNamed(projectRoot, 0, add)
  return hits
}

export function formatInstructionHits(hits: InstructionHit[]): string {
  if (!hits.length) return ''
  let used = 0
  const blocks: string[] = []
  for (const hit of hits) {
    if (used >= TOTAL_BUDGET) break
    const text = hit.text.slice(0, TOTAL_BUDGET - used)
    used += text.length
    blocks.push(`<file path="${hit.path}">\n${text}\n</file>`)
  }
  return [
    'Instructions from this project and from other coding agents are below. Later files are more specific. Follow them when they apply.',
    ...blocks,
  ].join('\n\n')
}

export function collectAgentInstructions(
  start: string,
  options: { user?: boolean } = {},
): string {
  return formatInstructionHits(collectInstructionFiles(start, options))
}

function findProjectRoot(start: string): string {
  let dir = start
  while (dir !== parse(dir).root) {
    if (existsSync(join(dir, '.git'))) return dir
    dir = dirname(dir)
  }
  return start
}

function ancestorChain(start: string, projectRoot: string): string[] {
  const chain: string[] = []
  let dir = start
  while (true) {
    chain.push(dir)
    if (dir === projectRoot || dir === parse(dir).root) break
    dir = dirname(dir)
  }
  return chain.reverse()
}

function walkNamed(dir: string, depth: number, add: (file: string) => void): void {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (AGENT_DIRS.includes(entry.name)) {
        collectDir(full, 0, add)
        continue
      }
      walkNamed(full, depth + 1, add)
      continue
    }
    if (NAMED.includes(entry.name)) add(full)
  }
}

function collectDir(dir: string, depth: number, add: (file: string) => void): void {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || SKIP_AGENT_SUB.has(entry.name) || SKIP_DIRS.has(entry.name)) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (basename(dir) === '.github' && entry.name !== 'instructions' && entry.name !== 'agents') {
        continue
      }
      collectDir(full, depth + 1, add)
      continue
    }
    if (basename(dir) === '.github' && entry.name !== 'copilot-instructions.md') continue
    add(full)
  }
}

function isInstructionFile(file: string): boolean {
  const name = basename(file)
  if (NAMED.includes(name)) return true
  if (/(secret|credential|password|token|\.env)/i.test(name)) return false
  return TEXT_EXT.has(extname(name).toLowerCase())
}
