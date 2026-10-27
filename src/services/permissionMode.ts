export type PermissionLevel = 'manual' | 'acceptEdits' | 'auto' | 'bypass'

const ORDER: PermissionLevel[] = ['manual', 'acceptEdits', 'auto', 'bypass']

let level: PermissionLevel = 'manual'
const listeners = new Set<() => void>()

export function getPermissionMode(): PermissionLevel {
  return level
}

export function setPermissionMode(next: PermissionLevel): void {
  if (level === next) return
  level = next
  for (const listener of listeners) listener()
}

export function cyclePermissionMode(): PermissionLevel {
  const next = ORDER[(ORDER.indexOf(level) + 1) % ORDER.length]!
  setPermissionMode(next)
  return next
}

export function subscribePermissionMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function permissionModeLabel(mode: PermissionLevel = level): string {
  switch (mode) {
    case 'manual':
      return 'manual'
    case 'acceptEdits':
      return 'accept edits'
    case 'auto':
      return 'auto'
    case 'bypass':
      return 'bypass permissions'
  }
}

const ALIASES: Record<string, PermissionLevel> = {
  manual: 'manual',
  auto: 'auto',
  'accept-edits': 'acceptEdits',
  acceptedits: 'acceptEdits',
  'accept edits': 'acceptEdits',
  bypass: 'bypass',
  'bypass-permissions': 'bypass',
  'bypass permissions': 'bypass',
}

export function parsePermissionMode(value: string): PermissionLevel | null {
  return ALIASES[value.trim().toLowerCase()] ?? null
}

export type PermissionSubject =
  | 'plan'
  | 'workspaceEdit'
  | 'readOnly'
  | 'safeBash'
  | 'other'

export function shouldAutoAllow(
  mode: PermissionLevel,
  subject: PermissionSubject,
): boolean {
  if (subject === 'plan') return false
  if (mode === 'bypass') return true
  if (mode === 'manual') return false
  if (subject === 'workspaceEdit') return mode === 'acceptEdits' || mode === 'auto'
  if (subject === 'readOnly' || subject === 'safeBash') return mode === 'auto'
  return false
}

export function permissionModePrompt(mode: PermissionLevel = level): string | null {
  switch (mode) {
    case 'manual':
      return null
    case 'acceptEdits':
      return 'Permission level is accept edits. Edits inside the project are already approved. Shell commands and other tools still wait for approval.'
    case 'auto':
      return 'Permission level is auto. Project edits, reads, and inspection commands are already approved. Commands that change the system still wait for approval.'
    case 'bypass':
      return 'Permission level is bypass permissions. Tool calls are already approved. Presenting a plan still waits for the user.'
  }
}
