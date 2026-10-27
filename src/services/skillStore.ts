import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { dataDir } from './budget.js'
import { selectMatch, topK } from './match.js'

export type SkillRecord = {
  name: string
  description: string
  group: string
  path: string
}

const SKILL_CHAR_BUDGET = 4000

export function skillStoreDir(): string {
  return join(dataDir(), 'skill-store')
}

export function skillIndexPath(): string {
  return join(skillStoreDir(), 'index.json')
}

export function loadSkillIndex(): SkillRecord[] {
  try {
    return JSON.parse(readFileSync(skillIndexPath(), 'utf8')) as SkillRecord[]
  } catch {
    return []
  }
}

export function saveSkillIndex(records: SkillRecord[]): void {
  mkdirSync(skillStoreDir(), { recursive: true })
  writeFileSync(skillIndexPath(), JSON.stringify(records, null, 2))
}

function frontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const split = line.indexOf(':')
    if (split === -1) continue
    fields[line.slice(0, split).trim()] = line.slice(split + 1).trim()
  }
  return fields
}

export function indexSkillTree(root: string): SkillRecord[] {
  const records: SkillRecord[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      let info
      try {
        info = statSync(path)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        walk(path)
        continue
      }
      if (entry !== 'SKILL.md') continue
      const text = readFileSync(path, 'utf8')
      const meta = frontmatter(text)
      records.push({
        name: meta.name || entry,
        description: meta.description || '',
        group: meta.group || '',
        path,
      })
    }
  }
  walk(root)
  return records
}

export function selectSkill(query: string, records = loadSkillIndex()): SkillRecord | null {
  return selectMatch(query, records, record => `${record.name} ${record.description} ${record.group}`)
}

export function skillExcerpt(record: SkillRecord): string {
  try {
    const text = readFileSync(record.path, 'utf8')
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
    return body.slice(0, SKILL_CHAR_BUDGET)
  } catch {
    return ''
  }
}

export function topSkills(query: string, k = 3): SkillRecord[] {
  return topK(
    query,
    loadSkillIndex(),
    record => `${record.name} ${record.description}`,
    k,
  )
}
