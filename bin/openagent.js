#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const tsx = require.resolve('tsx/cli')
const cli = fileURLToPath(new URL('../src/entrypoints/cli.tsx', import.meta.url))
const child = spawn(process.execPath, [tsx, cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
})
child.on('exit', code => process.exit(code ?? 1))
