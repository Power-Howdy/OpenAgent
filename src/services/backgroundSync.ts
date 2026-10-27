import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { BLUEPRINT_CATALOG, loadBlueprintIndex, saveBlueprintIndex } from './blueprintStore.js'
import { indexSkillTree, saveSkillIndex, skillStoreDir } from './skillStore.js'

let started = false

function run(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill()
      resolve()
    }, 120_000)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function syncSkills(): Promise<void> {
  const root = skillStoreDir()
  const repo = join(root, 'skills')
  if (!existsSync(join(repo, '.git'))) {
    await run('git', ['clone', '--depth', '1', 'https://github.com/NVIDIA/skills.git', repo])
  } else {
    await run('git', ['pull', '--ff-only'], repo)
  }
  if (existsSync(repo)) saveSkillIndex(indexSkillTree(repo))
}

async function syncBlueprints(): Promise<void> {
  const current = loadBlueprintIndex()
  if (!current.length) saveBlueprintIndex(BLUEPRINT_CATALOG)
}

export function startBackgroundSync(): void {
  if (started || process.env.NODE_ENV === 'test') return
  started = true
  void syncSkills()
  void syncBlueprints()
}
