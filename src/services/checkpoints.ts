import { readFileSync, writeFileSync } from 'fs'

type Snapshot = { path: string; content: Buffer }

const MAX_SNAPSHOTS = 30
const stack: Snapshot[] = []

export function recordFileCheckpoint(filePath: string): void {
  stack.push({ path: filePath, content: readFileSync(filePath) })
  if (stack.length > MAX_SNAPSHOTS) stack.shift()
}

export function undoLastEdit(): string {
  const snapshot = stack.pop()
  if (!snapshot) return 'Nothing to undo.'
  writeFileSync(snapshot.path, snapshot.content)
  return `Restored ${snapshot.path}`
}

export function resetCheckpoints(): void {
  stack.length = 0
}
