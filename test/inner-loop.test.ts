import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, describe, test } from 'node:test'
import { dapRequest, debugRunArgs } from '../src/services/dap.js'
import { applyTextEdits, decodeRpc, encodeRpc, languageId, lspCommand, workspaceUri } from '../src/services/lsp.js'
import { isOffline, OFFLINE_MESSAGE, setOffline } from '../src/services/offline.js'
import { parseManifest, readManifests } from '../src/services/plugins.js'
import {
  checkArgv,
  detectTestArgv,
  failureLines,
  mermaidSource,
  packageArgv,
  readProjectMarkers,
  tailLines,
  topCpuProf,
} from '../src/services/projectCommands.js'
import { redactSecrets, shareBody } from '../src/services/redact.js'
import { dockerRunArgs, ensureSession, installedLangs, renderSearxngSettings, safeSessionName, sessionStartArgs, setSpawnForTests } from '../src/services/runtime.js'
import { detachTodos, formatTodos, loadTodos, resetTodos, writeTodos } from '../src/services/todos.js'
import {
  assertFetchUrl,
  assertHttpUrl,
  isBlockedFetchAddress,
  isBlockedHttpAddress,
  isPrivateAddress,
  parseSearxng,
  stripHtml,
} from '../src/services/webGuard.js'
import { modelHasVision } from '../src/services/vision.js'
import { inspectorUrl } from '../src/services/nodeInspector.js'
import { githubArgv } from '../src/tools/GitHubTool/GitHubTool.js'
import { search } from '../src/tools/WebSearch/WebSearch.js'

const root = mkdtempSync(join(tmpdir(), 'openagent-inner-'))
after(() => {
  rmSync(root, { recursive: true, force: true })
  resetTodos()
  setOffline(false)
})

describe('inner loop helpers', { concurrency: false }, () => {
  test('project commands, search parsing, and sandbox argv', async () => {
    assert.deepEqual(detectTestArgv({ packageTest: 'vitest' }, 'add'), ['npm', 'test', '--', '-t', 'add'])
    assert.deepEqual(detectTestArgv({ packageTest: 'node --test' }, 'add'), ['npm', 'test', '--', '--test-name-pattern', 'add'])
    assert.deepEqual(detectTestArgv({ packageTest: 'npm test' }, 'add'), ['npm', 'test'])
    assert.deepEqual(detectTestArgv({ pytest: true }, 'name'), ['pytest', '-k', 'name'])
    assert.deepEqual(detectTestArgv({ cargo: true }), ['cargo', 'test'])
    assert.deepEqual(detectTestArgv({ go: true }, 'TestA'), ['go', 'test', './...', '-run', 'TestA'])
    assert.equal(detectTestArgv({}), null)
    assert.deepEqual(packageArgv({ pnpm: true }, 'add', '@scope/name'), ['pnpm', 'add', '@scope/name'])
    assert.deepEqual(packageArgv({ yarn: true }, 'remove', 'left'), ['yarn', 'remove', 'left'])
    assert.deepEqual(packageArgv({ npm: true }, 'install'), ['npm', 'install'])
    assert.deepEqual(packageArgv({ pip: true }, 'install'), ['pip', 'install', '-r', 'requirements.txt'])
    assert.deepEqual(packageArgv({ cargo: true }, 'add', 'serde'), ['cargo', 'add', 'serde'])
    assert.deepEqual(packageArgv({ go: true }, 'remove', 'example.com/mod'), ['go', 'get', 'example.com/mod@none'])
    assert.throws(() => packageArgv({ npm: true }, 'add'), /name is required/)
    assert.throws(() => packageArgv({ npm: true }, 'add', '-rf'), /unsupported/)
    assert.throws(() => packageArgv({}, 'install'), /No package manager/)

    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', typecheck: 'tsc --noEmit' } }))
    writeFileSync(join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\n')
    const markers = readProjectMarkers(root)
    assert.equal(markers.packageTest, 'node --test')
    assert.equal(markers.pytest, true)
    assert.equal(markers.npm, true)
    assert.deepEqual(checkArgv(markers), ['npm', 'run', 'typecheck'])
    writeFileSync(join(root, 'package.json'), '{')
    assert.equal(readProjectMarkers(root).packageTest, undefined)

    assert.equal(stripHtml('<style>a{}</style><script>bad</script><p>Hello&nbsp;&amp;</p>'), 'Hello &')
    assert.deepEqual(parseSearxng('not-json', 5), [])
    assert.deepEqual(parseSearxng('{"results":[]}', 5), [])
    assert.deepEqual(parseSearxng('{"results":[{"url":"https://example.test","content":"c"},{"title":1}]}', 1), [
      { title: 'https://example.test', url: 'https://example.test', content: 'c' },
    ])
    assert.equal(parseSearxng('[]', 1).length, 0)
    assert.equal(isBlockedHttpAddress('169.254.169.254'), true)
    assert.equal(isBlockedFetchAddress('127.0.0.1'), true)
    assert.equal(isBlockedFetchAddress('10.0.0.1'), true)
    assert.equal(isBlockedHttpAddress('127.0.0.1'), false)
    await assert.rejects(assertFetchUrl('http://127.0.0.1/secret'), /blocked/)
    await assert.rejects(assertFetchUrl('ftp://example.test'), /http/)
    const local = await assertHttpUrl('http://127.0.0.1:3000/health')
    assert.equal(local.hostname, '127.0.0.1')
    assert.equal(isBlockedFetchAddress('facebook.com'), false)
    assert.equal(isPrivateAddress('facebook.com'), false)
    assert.equal(isBlockedFetchAddress('::ffff:127.0.0.1'), true)
    assert.equal(isBlockedFetchAddress('0.0.0.0'), true)
    await assert.rejects(assertHttpUrl('http://0.0.0.0/'), /blocked/)
    await assert.rejects(assertHttpUrl('http://169.254.169.254/'), /blocked/)

    const args = dockerRunArgs({
      argv: ['node', '/snippet'],
      network: 'none',
      timeoutMs: 1000,
      readonly: true,
      project: '/work',
      uid: 1000,
      gid: 1000,
      mounts: [{ host: '/tmp/snippet', guest: '/snippet', readonly: true }],
    })
    assert.ok(args.includes('--network'))
    assert.ok(args.includes('none'))
    assert.ok(args.includes('--cap-drop'))
    assert.ok(args.includes('1000:1000'))
    assert.equal(safeSessionName('ok_name'), true)
    assert.equal(safeSessionName('../x'), false)
    assert.equal(renderSearxngSettings('secret_key: "__SECRET__"', 'abc'), 'secret_key: "abc"')
    assert.deepEqual([...installedLangs('ts, py,')], ['ts', 'py'])
    const started = sessionStartArgs('bash', { network: 'bridge', project: '/work', uid: 1, gid: 1 })
    assert.ok(started.includes('bridge'))
    assert.ok(started.includes('SYS_ADMIN'))
    const calls: string[][] = []
    setSpawnForTests(async (_file, args) => {
      calls.push(args)
      if (args[0] === 'inspect') return { code: 0, stdout: 'false\n', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    })
    await ensureSession('lsp', { project: '/work', uid: 1, gid: 1, network: 'none' })
    assert.ok(calls.some(args => args[0] === 'rm' && args.includes('openagent-session-lsp')))
    setSpawnForTests(null)

    resetTodos()
    assert.equal(formatTodos(), '')
    const long = 'x'.repeat(250)
    writeTodos(Array.from({ length: 25 }, (_, index) => ({ id: String(index), text: long, status: 'pending' as const })), false)
    assert.equal(formatTodos().split('\n').length, 21)
    assert.ok(formatTodos().includes('x'.repeat(200)))
    assert.equal(writeTodos([{ id: '0', text: 'short', status: 'done' }], true)[0]?.text, 'short')
    assert.equal(tailLines('a\nb\nc', 2), 'b\nc')
    assert.deepEqual(topCpuProf({ nodes: [
      { callFrame: { functionName: 'b' }, hitCount: 1 },
      { callFrame: {}, hitCount: 3 },
    ] }), ['3 (anonymous)', '1 b'])
    assert.equal(mermaidSource('flowchart LR'), 'flowchart LR')
    assert.equal(mermaidSource('hello'), null)

    const manifestDir = join(root, 'plugins')
    mkdirSync(manifestDir)
    writeFileSync(join(manifestDir, 'echo.json'), JSON.stringify({
      name: 'echo',
      description: 'Echo args',
      argv: ['node', 'tool.js'],
      readonly: false,
    }))
    writeFileSync(join(manifestDir, 'bad.json'), '{')
    writeFileSync(join(manifestDir, 'note.txt'), 'skip')
    assert.equal(readManifests(manifestDir)[0]?.readonly, false)
    assert.equal(parseManifest('{"name":"a"}'), null)
    assert.equal(parseManifest('[]'), null)
    assert.equal(readManifests(join(root, 'missing')).length, 0)

    assert.match(redactSecrets('token sk-abc ghp_abc API_KEY=1'), /\[redacted\]/)
    assert.match(shareBody([{ content: 'x'.repeat(2001), secret: 'nvapi-secret' }]), /\[redacted\]/)
    assert.equal(shareBody([{ ok: true }]).includes('true'), true)

    const encoded = encodeRpc({ id: 1, ok: true })
    const decoded = decodeRpc(encoded + encoded.slice(0, 8))
    assert.equal((decoded.messages[0] as { id: number }).id, 1)
    assert.equal(decodeRpc('nope').messages.length, 0)
    assert.equal(languageId('src/a.tsx'), 'ts')
    assert.equal(languageId('src/a.py'), 'py')
    assert.equal(languageId('src/a.go'), 'go')
    assert.equal(languageId('src/a.rs'), 'rust')
    assert.equal(languageId('src/a.txt'), null)
    assert.deepEqual(lspCommand('go'), ['gopls', 'serve'])
    assert.equal(lspCommand('nope'), null)
    assert.equal(workspaceUri('/work', '/work/src/a.ts'), 'file:///workspace/src/a.ts')
    assert.equal((dapRequest(1, 'continue') as { command: string }).command, 'continue')
    assert.ok(debugRunArgs('python', '/workspace/a.py', '/work', 1, 1).includes('debugpy'))
    assert.ok(debugRunArgs('python', '/workspace/a.py', '/work', 1, 1).includes('SYS_ADMIN'))
    assert.equal(applyTextEdits('hello world', [{
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
      newText: 'there',
    }]), 'hello there')
    assert.deepEqual(failureLines('error at src/a.ts:12 and again src/a.ts:12'), ['src/a.ts:12'])
    assert.equal(modelHasVision('free', 'deepseek-ai/deepseek-v4.1-flash', true), true)
    assert.equal(modelHasVision('free', 'openai/gpt-oss-20b', true), false)
    assert.equal(modelHasVision('free', 'free-mode', true), false)
    process.env.OpenAgent_CONFIG_DIR = root
    loadTodos('thread-a')
    writeTodos([{ id: '1', text: 'keep', status: 'pending' }], false)
    loadTodos('thread-a')
    assert.equal(formatTodos().includes('keep'), true)
    detachTodos()
    delete process.env.OpenAgent_CONFIG_DIR
    assert.equal(inspectorUrl([{ webSocketDebuggerUrl: 'ws://0.0.0.0:9229/devtools' }]), 'ws://127.0.0.1:19222/devtools')
    assert.equal(inspectorUrl([{}]), null)
    assert.deepEqual(githubArgv({ action: 'issue_list' })?.slice(0, 3), ['gh', 'issue', 'list'])
    assert.equal(githubArgv({ action: 'issue_view' }), null)
    assert.equal(githubArgv({ action: 'pr_comment', number: 4, body: 'hi' })?.[3], '4')

    setOffline(true)
    assert.equal(isOffline(), true)
    assert.equal(await search('docs', 5), OFFLINE_MESSAGE)
    setOffline(false)
  })
})
