import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

export type PluginManifest = {
  name: string
  description: string
  argv: string[]
  readonly: boolean
}

export function parseManifest(text: string): PluginManifest | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const item = value as { name?: unknown; description?: unknown; argv?: unknown; readonly?: unknown }
  if (typeof item.name !== 'string' || typeof item.description !== 'string' || !Array.isArray(item.argv)) {
    return null
  }
  if (!item.argv.every(part => typeof part === 'string') || item.argv.length === 0) return null
  return {
    name: item.name,
    description: item.description,
    argv: item.argv as string[],
    readonly: item.readonly !== false,
  }
}

export function readManifests(dir: string): PluginManifest[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const manifests: PluginManifest[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const parsed = parseManifest(readFileSync(join(dir, name), 'utf8'))
      if (parsed) manifests.push(parsed)
    } catch {
      continue
    }
  }
  return manifests
}
