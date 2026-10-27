import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, test } from 'node:test'
import {
  normalizeServerEntry,
  readMcpFiles,
  serversFromDocument,
  toMcpServerConfig,
} from '../src/services/mcpConfig.js'

const root = mkdtempSync(join(tmpdir(), 'openagent-mcp-'))

after(() => rmSync(root, { recursive: true, force: true }))

test('MCP configs from Claude, Cursor, and OpenCode become servers', () => {
  assert.deepEqual(serversFromDocument('{', false), [])
  assert.deepEqual(serversFromDocument('[]', false), [])
  assert.deepEqual(serversFromDocument('"nope"', true), [])
  assert.deepEqual(serversFromDocument('{"theme":"dark"}', false), [])
  assert.deepEqual(serversFromDocument('{"mcpServers":[]}', false), [])

  const claude = serversFromDocument(
    JSON.stringify({
      mcpServers: {
        files: { command: 'npx', args: ['-y', 'server', 1] },
        off: { command: 'nope', disabled: true },
        paused: { command: 'nope', enabled: false },
        bad: 'nope',
        empty: {},
      },
      mcp: { hidden: { command: 'should-not-win' } },
    }),
    false,
  )
  assert.deepEqual(claude.map(item => item.name), ['files'])
  assert.equal(claude[0]?.server.transport, 'stdio')
  assert.deepEqual(claude[0]?.server.args, ['-y', 'server'])

  const cursor = serversFromDocument(
    JSON.stringify({
      mcpServers: {
        remote: { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer x', n: 1 } },
        sse: { type: 'sse', url: 'http://127.0.0.1:9/sse', headers: { n: 1 } },
        stream: { type: 'streamable-http', url: 'http://127.0.0.1:9/stream' },
        both: { type: 'stdio', command: 'local', url: 'http://127.0.0.1:9/nope' },
        onlyType: { type: 'stdio', url: 'http://127.0.0.1:9/nope' },
      },
    }),
    false,
  )
  assert.equal(cursor.find(item => item.name === 'remote')?.server.transport, 'http')
  assert.deepEqual(cursor.find(item => item.name === 'remote')?.server.headers, {
    Authorization: 'Bearer x',
  })
  assert.equal(cursor.find(item => item.name === 'sse')?.server.transport, 'sse')
  assert.equal(cursor.find(item => item.name === 'sse')?.server.headers, undefined)
  assert.equal(cursor.find(item => item.name === 'stream')?.server.transport, 'http')
  assert.equal(cursor.find(item => item.name === 'both')?.server.transport, 'stdio')
  assert.equal(cursor.find(item => item.name === 'onlyType'), undefined)

  const opencode = serversFromDocument(
    JSON.stringify({
      mcp: {
        local: { type: 'local', command: ['npx', '-y', 2], environment: { A: 'b', C: 1 } },
        remote: { type: 'remote', url: 'https://example.test/mcp' },
        old: { transport: 'http+sse', url: 'https://example.test/sse' },
        blank: { command: '' },
        nums: { command: [1] },
      },
    }),
    false,
  )
  assert.equal(opencode.find(item => item.name === 'local')?.server.command, 'npx')
  assert.deepEqual(opencode.find(item => item.name === 'local')?.server.args, ['-y'])
  assert.deepEqual(opencode.find(item => item.name === 'local')?.server.env, { A: 'b' })
  assert.equal(opencode.find(item => item.name === 'remote')?.server.transport, 'http')
  assert.equal(opencode.find(item => item.name === 'old')?.server.transport, 'sse')
  assert.equal(opencode.find(item => item.name === 'blank'), undefined)
  assert.equal(opencode.find(item => item.name === 'nums'), undefined)

  const flat = serversFromDocument(
    JSON.stringify({ notes: { command: 'rg', env: { PATH: '/bin' } } }),
    true,
  )
  assert.equal(flat[0]?.server.command, 'rg')
  assert.equal(flat[0]?.server.env?.PATH, '/bin')

  const envWins = normalizeServerEntry({
    command: 'tool',
    env: { A: '1' },
    environment: { A: '2', B: '3' },
  })
  assert.deepEqual(envWins?.env, { A: '1' })
  assert.equal(normalizeServerEntry(null), null)
  assert.equal(normalizeServerEntry({ command: 'tool', args: 'nope' })?.args.length, 0)

  const stdio = toMcpServerConfig({ transport: 'stdio', command: 'rg', args: [], env: { A: '1' } })
  assert.equal(stdio.type, 'stdio')
  const http = toMcpServerConfig({
    transport: 'http',
    args: [],
    url: 'http://127.0.0.1:9/mcp',
    headers: { A: 'b' },
  })
  assert.equal(http.type, 'http')

  mkdirSync(join(root, '.cursor'), { recursive: true })
  writeFileSync(
    join(root, '.mcp.json'),
    JSON.stringify({ mcpServers: { files: { command: 'from-mcp' } } }),
  )
  writeFileSync(
    join(root, '.cursor', 'mcp.json'),
    JSON.stringify({ mcpServers: { files: { command: 'from-cursor' }, extra: { url: 'http://127.0.0.1:9' } } }),
  )
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ editor: true }))
  const found = readMcpFiles(root, [
    { path: 'missing.json', flat: false },
    { path: '.', flat: false },
    { path: '.mcp.json', flat: false },
    { path: '.cursor/mcp.json', flat: false },
    { path: 'settings.json', flat: false },
  ])
  assert.equal(found.find(item => item.name === 'files')?.command, 'from-cursor')
  assert.equal(found.find(item => item.name === 'extra')?.transport, 'http')
  assert.equal(found.some(item => item.name === 'editor'), false)
})
