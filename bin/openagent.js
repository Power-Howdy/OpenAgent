#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/entrypoints/cli.js', import.meta.url))
if (!existsSync(cli)) {
  console.error('OpenAgent has not been built. From the repo, run `npm run build`.')
  process.exit(1)
}

const child = spawn(
  process.execPath,
  ['--enable-source-maps', '--no-warnings=ExperimentalWarning', cli, ...process.argv.slice(2)],
  { stdio: 'inherit' },
)
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
