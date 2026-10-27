import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import test from 'node:test'
import { loadEnvFiles } from '../src/utils/loadEnv.js'

test('a local env file supplies the NIM key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openagent-env-'))
  const previous = process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_API_KEY
  try {
    writeFileSync(join(dir, '.env.local'), 'NVIDIA_API_KEY=nvapi-from-file\n')
    loadEnvFiles(dir)
    assert.equal(process.env.NVIDIA_API_KEY, 'nvapi-from-file')
  } finally {
    if (previous === undefined) delete process.env.NVIDIA_API_KEY
    else process.env.NVIDIA_API_KEY = previous
  }
})
