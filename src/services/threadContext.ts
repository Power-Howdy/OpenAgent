import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dataDir } from './budget.js'
import { SESSION_ID } from '../utils/log.js'

export type ThreadContext = Record<string, string>

function pathFor(id: string = SESSION_ID): string {
  return join(dataDir(), 'threads', `${id}.json`)
}

export function readThreadContext(id?: string): ThreadContext {
  try {
    return JSON.parse(readFileSync(pathFor(id), 'utf8')) as ThreadContext
  } catch {
    return {}
  }
}

export function writeThreadContext(context: ThreadContext, id?: string): void {
  const path = pathFor(id)
  mkdirSync(join(dataDir(), 'threads'), { recursive: true })
  writeFileSync(path, JSON.stringify(context, null, 2))
}

export function setThreadValue(key: string, value: string): void {
  const context = readThreadContext()
  context[key] = value
  writeThreadContext(context)
}

export function removeThreadValue(key: string): void {
  const context = readThreadContext()
  delete context[key]
  writeThreadContext(context)
}
