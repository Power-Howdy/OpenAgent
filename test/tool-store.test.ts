import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import test from 'node:test'

test('running a stored tool appends a usage line', async () => {
  process.env.NODE_ENV = 'test'
  process.env.OPENAGENT_SEED_TOOLS = '1'
  process.env.OpenAgent_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'openagent-tools-'))
  const store = await import('../src/tool-store/store.js')
  store.appendToolUsage('git-status', true)
  const line = readFileSync(
    join(store.toolItemDir('git-status'), 'usage.jsonl'),
    'utf8',
  )
  const parsed = JSON.parse(line.trim()) as { id: string; ok: boolean }
  assert.equal(parsed.id, 'git-status')
  assert.equal(parsed.ok, true)
})
