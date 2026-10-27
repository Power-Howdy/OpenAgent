import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, test } from 'node:test'
import { collectAgentInstructions } from '../src/services/agentInstructions.js'

const root = mkdtempSync(join(tmpdir(), 'openagent-agents-'))

after(() => rmSync(root, { recursive: true, force: true }))

test('instruction files from other coding agents are included and secrets are not', () => {
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, '.cursor', 'rules'), { recursive: true })
  mkdirSync(join(root, '.claude'), { recursive: true })
  mkdirSync(join(root, '.opencode', 'agents'), { recursive: true })
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  mkdirSync(join(root, 'pkg'), { recursive: true })
  writeFileSync(join(root, 'AGENTS.md'), 'root agents')
  writeFileSync(join(root, 'CLAUDE.md'), 'root claude')
  writeFileSync(join(root, '.cursor', 'rules', 'style.mdc'), 'cursor rule')
  writeFileSync(join(root, '.cursor', 'mcp.json'), '{"token":"secret"}')
  writeFileSync(join(root, '.cursor', 'rules', 'api-token.md'), 'do not load')
  writeFileSync(join(root, '.claude', 'CLAUDE.md'), 'claude directory')
  writeFileSync(join(root, '.opencode', 'agents', 'review.md'), 'opencode agent')
  writeFileSync(join(root, '.github', 'copilot-instructions.md'), 'copilot rules')
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci')
  writeFileSync(join(root, 'pkg', 'AGENTS.md'), 'nested agents')
  writeFileSync(join(root, 'empty.md'), '   ')
  symlinkSync(join(root, 'AGENTS.md'), join(root, 'link.md'))

  const text = collectAgentInstructions(join(root, 'pkg'), { user: false })
  assert.match(text, /root agents/)
  assert.match(text, /root claude/)
  assert.match(text, /cursor rule/)
  assert.match(text, /claude directory/)
  assert.match(text, /opencode agent/)
  assert.match(text, /copilot rules/)
  assert.match(text, /nested agents/)
  assert.equal(text.includes('do not load'), false)
  assert.equal(text.includes('secret'), false)
  assert.equal(text.includes('name: ci'), false)
  assert.ok(text.indexOf('root agents') < text.indexOf('nested agents'))
  assert.match(collectAgentInstructions(join(root, 'missing'), { user: false }), /root agents/)
})
