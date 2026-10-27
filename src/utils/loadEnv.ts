import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

export function loadEnvFiles(dir = process.cwd()): void {
  const shared = resolve(dir, '.env')
  const local = resolve(dir, '.env.local')
  if (existsSync(shared)) config({ path: shared, quiet: true })
  if (existsSync(local)) config({ path: local, override: true, quiet: true })
}

loadEnvFiles()
