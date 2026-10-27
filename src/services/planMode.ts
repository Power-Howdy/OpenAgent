import { splitCommand } from '../utils/commands.js'

let planMode = false
const listeners = new Set<() => void>()

export function isPlanMode(): boolean {
  return planMode
}

export function setPlanMode(next: boolean): void {
  if (planMode === next) return
  planMode = next
  for (const listener of listeners) listener()
}

export function subscribePlanMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const PLAN_BLOCKED = new Set(['Agent', 'Architect', 'ExitPlanMode'])

const READONLY_BINARIES = new Set([
  'basename',
  'cat',
  'cut',
  'dirname',
  'du',
  'echo',
  'false',
  'fd',
  'file',
  'find',
  'grep',
  'head',
  'ls',
  'nl',
  'printf',
  'pwd',
  'realpath',
  'rg',
  'sort',
  'stat',
  'tail',
  'tree',
  'tr',
  'true',
  'uniq',
  'wc',
  'which',
  'whoami',
])

const PLAN_SELF_GUARDED = new Set(['Sql', 'Lsp', 'GitHub'])

const GIT_READONLY = new Set([
  'blame',
  'branch',
  'describe',
  'diff',
  'log',
  'ls-files',
  'remote',
  'rev-parse',
  'shortlog',
  'show',
  'status',
])

export function isPlanModeReadOnlyCommand(command: string): boolean {
  if (/[<>]|`|\$\(/.test(command)) return false
  const segments = splitCommand(command)
  if (segments.length === 0) return false
  return segments.every(segment => {
    const tokens = segment.trim().split(/\s+/).filter(Boolean)
    const bin = tokens[0]!.split('/').pop()!
    if (bin === 'git') return !!tokens[1] && GIT_READONLY.has(tokens[1])
    if (
      bin === 'find' &&
      tokens.some(token =>
        ['-delete', '-exec', '-execdir', '-ok'].includes(token),
      )
    ) {
      return false
    }
    return READONLY_BINARIES.has(bin)
  })
}

type PlanTool = { name: string; isReadOnly: () => boolean }

export function toolsForPlanMode<T extends PlanTool>(all: T[], exitPlanTool: T): T[] {
  const allowed = all.filter(tool => {
    if (PLAN_BLOCKED.has(tool.name)) return false
    if (tool.name === 'Bash') return true
    if (PLAN_SELF_GUARDED.has(tool.name)) return true
    return tool.isReadOnly()
  })
  return [...allowed, exitPlanTool]
}

export const PLAN_MODE_PROMPT = `Plan mode is active. This overrides any instruction to edit or run the project. Do not edit files, write memory, save tools or blueprints, or run commands that change the system. Read, search, and run inspection commands only. If the request is ambiguous, ask one or two questions instead of guessing. When the approach is specific enough to implement, call ExitPlanMode with a short plan: the files to change, the approach, and how to verify. Wait for approval before any change.`

export function withPlanModePrompt(systemPrompt: string[]): string[] {
  if (!planMode) return systemPrompt
  return [...systemPrompt, PLAN_MODE_PROMPT]
}
