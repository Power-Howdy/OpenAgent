import { cpSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')

rmSync(join(root, 'dist'), { recursive: true, force: true })

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)

cpSync(join(root, 'src', 'tool-store', 'seed'), join(root, 'dist', 'tool-store', 'seed'), {
  recursive: true,
})

console.log('Built dist/entrypoints/cli.js')
