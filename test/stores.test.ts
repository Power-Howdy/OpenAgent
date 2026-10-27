import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, before, describe, test } from 'node:test'
import {
  earliestFreeIn,
  loadLedger,
  pruneUsage,
  recordCall,
  remainingRequests,
  reserveCall,
} from '../src/services/budget.js'
import {
  canAuthorBlueprint,
  loadBlueprintIndex,
  saveAuthoredBlueprint,
  saveBlueprintIndex,
  selectBlueprint,
  topBlueprints,
  blueprintIsCloned,
  blueprintCloneDir,
} from '../src/services/blueprintStore.js'
import {
  authoringAllowed,
  enterWorker,
  leaveWorker,
  setAuthoring,
} from '../src/services/capabilities.js'
import { isFreeMode, localEndpointBind, resolveProvider } from '../src/services/resolveProvider.js'
import { captureException, initSentry } from '../src/services/sentry.js'
import {
  indexSkillTree,
  loadSkillIndex,
  saveSkillIndex,
  selectSkill,
  skillExcerpt,
  topSkills,
} from '../src/services/skillStore.js'
import {
  checkGate,
  getDynamicConfig,
  getExperimentValue,
  getGateValues,
  initializeStatsig,
  logEvent,
  useStatsigGate,
} from '../src/services/statsig.js'
import {
  readThreadContext,
  removeThreadValue,
  setThreadValue,
  writeThreadContext,
} from '../src/services/threadContext.js'
import { getGlobalConfig, saveGlobalConfig } from '../src/utils/config.js'

const dir = mkdtempSync(join(tmpdir(), 'openagent-cov-'))
const previousConfigDir = process.env.OpenAgent_CONFIG_DIR
const previousNodeEnv = process.env.NODE_ENV

describe('stored agent state', { concurrency: 1 }, () => {
  before(() => {
    process.env.OpenAgent_CONFIG_DIR = dir
    process.env.NODE_ENV = 'test'
  })

  after(() => {
    if (previousConfigDir === undefined) delete process.env.OpenAgent_CONFIG_DIR
    else process.env.OpenAgent_CONFIG_DIR = previousConfigDir
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    rmSync(dir, { recursive: true, force: true })
  })

  test('a missing ledger is empty and a saved call can be read back', () => {
    assert.deepEqual(loadLedger(), {})
    assert.deepEqual(pruneUsage(undefined, 1_000), [])
    assert.equal(remainingRequests([1], 1_000, 2, 10), 2)
    assert.equal(earliestFreeIn(undefined, 1_000), 0)
    assert.equal(earliestFreeIn([900], 1_000, 200), 100)
    const reserved = reserveCall({}, 'gpt-oss-20b', 1_000)
    assert.deepEqual(reserved['gpt-oss-20b'], [1_000])
    recordCall('gpt-oss-20b', 1_000)
    assert.deepEqual(loadLedger(), {})
    delete process.env.NODE_ENV
    try {
      recordCall('deepseek-v4.1-flash', 2_000)
      const saved = JSON.parse(readFileSync(join(dir, 'usage-ledger.json'), 'utf8'))
      assert.deepEqual(saved['deepseek-v4.1-flash'], [2_000])
    } finally {
      process.env.NODE_ENV = 'test'
    }
  })

  test('skills are indexed from frontmatter and a missing file is empty', () => {
    const root = join(dir, 'skills')
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'notes.txt'), 'ignore')
    writeFileSync(join(root, 'SKILL.md'), 'no frontmatter here\n')
    symlinkSync('/no/such/openagent-target', join(root, 'broken'))
    writeFileSync(
      join(root, 'docs', 'SKILL.md'),
      '---\nname: pdf\ndescription: extract pdf tables\ngroup: docs\norphan\n---\nbody text\n',
    )
    const records = indexSkillTree(root)
    assert.equal(records.length, 2)
    assert.equal(records.find(item => item.name === 'pdf')?.description, 'extract pdf tables')
    assert.equal(indexSkillTree(join(root, 'missing')).length, 0)
    assert.deepEqual(loadSkillIndex(), [])
    saveSkillIndex(records)
    assert.equal(loadSkillIndex().find(item => item.name === 'pdf')?.description, 'extract pdf tables')
    assert.equal(selectSkill('extract pdf tables')?.name, 'pdf')
    const pdf = records.find(item => item.name === 'pdf')!
    assert.match(skillExcerpt(pdf), /body text/)
    assert.equal(skillExcerpt({ ...pdf, path: join(root, 'nope.md') }), '')
    assert.equal(topSkills('extract pdf tables', 1)[0]?.name, 'pdf')
  })

  test('blueprints fall back to the catalog and an authored plan is saved', () => {
    mkdirSync(join(dir, 'blueprint-store'), { recursive: true })
    writeFileSync(join(dir, 'blueprint-store', 'index.json'), '[]')
    assert.equal(loadBlueprintIndex().some(item => item.id === 'rag'), true)
    saveBlueprintIndex(loadBlueprintIndex())
    assert.equal(loadBlueprintIndex().some(item => item.id === 'rag'), true)
    assert.equal(selectBlueprint('retrieval augmented generation enterprise documents')?.id, 'rag')
    assert.ok(topBlueprints('video search summarization libraries').length > 0)
    assert.equal(blueprintIsCloned('rag'), false)
    assert.match(blueprintCloneDir('rag'), /nvidia\/rag$/)
    assert.throws(
      () =>
        saveAuthoredBlueprint({
          id: 'one',
          title: 'One',
          description: 'only one worker',
          workers: [{ role: 'a', task: 'do the thing' }],
        }),
      /2 or 3 workers/,
    )
    assert.throws(
      () =>
        saveAuthoredBlueprint({
          id: 'many',
          title: 'Many',
          description: 'too many workers',
          workers: [
            { role: 'a', task: 'one' },
            { role: 'b', task: 'two' },
            { role: 'c', task: 'three' },
            { role: 'd', task: 'four' },
          ],
        }),
      /2 or 3 workers/,
    )
    const saved = saveAuthoredBlueprint({
      id: 'pair',
      title: 'Pair',
      description: 'two independent jobs',
      workers: [
        { role: 'reader', task: 'read the files', files: ['a.ts'] },
        { role: 'writer', task: 'write the notes' },
      ],
    })
    assert.match(readFileSync(join(saved, 'README.md'), 'utf8'), /Worker 1: reader/)
    assert.equal(canAuthorBlueprint('fix the typo'), false)
  })

  test('thread context is written and removed by key', () => {
    assert.deepEqual(readThreadContext('missing-thread'), {})
    writeThreadContext({ topic: 'plan' }, 'thread-a')
    assert.equal(readThreadContext('thread-a').topic, 'plan')
    setThreadValue('topic', 'edit')
    removeThreadValue('topic')
  })

  test('workers stop at three and authoring is only for the orchestrator', () => {
    setAuthoring(true)
    assert.equal(authoringAllowed(), true)
    assert.equal(enterWorker(), true)
    assert.equal(enterWorker(), true)
    assert.equal(enterWorker(), true)
    assert.equal(enterWorker(), false)
    assert.equal(authoringAllowed(), false)
    leaveWorker()
    leaveWorker()
    leaveWorker()
    leaveWorker()
    setAuthoring(false)
    assert.equal(authoringAllowed(), false)
  })

  test('provider resolution follows the key that is actually set', () => {
    const env = [
      'NVIDIA_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENAGENT_PROVIDER',
      'OPENAGENT_MODEL',
      'OPENAGENT_BASE_URL',
      'OPENAI_COMPATIBLE_BASE_URL',
      'OPENAGENT_LOCAL_BASE_URL',
    ]
    const saved = Object.fromEntries(env.map(key => [key, process.env[key]]))
    for (const key of env) delete process.env[key]
    const config = getGlobalConfig()
    try {
      saveGlobalConfig({
        ...config,
        provider: undefined,
        model: undefined,
        fastModel: 'custom-fast',
        baseURL: undefined,
        localBaseURL: undefined,
        nvidiaApiKey: undefined,
        compatibleApiKey: undefined,
        primaryApiKey: undefined,
      })
      assert.equal(resolveProvider().kind, 'free')
      assert.equal(resolveProvider().model, 'free-mode')
      saveGlobalConfig({ ...getGlobalConfig(), fastModel: undefined })
      assert.equal(resolveProvider().fastModel, 'qwen3-0.6b')
      saveGlobalConfig({ ...getGlobalConfig(), fastModel: 'custom-fast' })
      assert.equal(resolveProvider().localBaseURL, 'http://127.0.0.1:8080/v1')
      assert.equal(isFreeMode(), true)

      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAGENT_PROVIDER
      process.env.OPENAI_API_KEY = 'sk-openai'
      assert.equal(resolveProvider().kind, 'openai')
      delete process.env.OPENAI_API_KEY

      process.env.OPENAGENT_PROVIDER = 'openai'
      process.env.OPENAI_API_KEY = 'sk-openai'
      process.env.OPENAGENT_MODEL = 'gpt-custom'
      assert.equal(resolveProvider().kind, 'openai')
      assert.equal(resolveProvider().model, 'gpt-custom')
      assert.equal(resolveProvider().apiKey, 'sk-openai')

      process.env.OPENAGENT_PROVIDER = 'anthropic'
      process.env.ANTHROPIC_API_KEY = 'sk-ant'
      assert.equal(resolveProvider().kind, 'anthropic')
      assert.equal(resolveProvider().apiKey, 'sk-ant')

      delete process.env.OPENAGENT_PROVIDER
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.OPENAI_API_KEY
      process.env.OPENAI_COMPATIBLE_API_KEY = 'sk-compat'
      process.env.OPENAGENT_BASE_URL = 'https://example.test/v1'
      assert.equal(resolveProvider().kind, 'compatible')
      assert.equal(resolveProvider().baseURL, 'https://example.test/v1')

      delete process.env.OPENAI_COMPATIBLE_API_KEY
      delete process.env.OPENAGENT_BASE_URL
      process.env.ANTHROPIC_API_KEY = 'sk-ant'
      assert.equal(resolveProvider().kind, 'anthropic')
      delete process.env.ANTHROPIC_API_KEY
      saveGlobalConfig({ ...getGlobalConfig(), primaryApiKey: 'sk-saved' })
      assert.equal(resolveProvider().apiKey, 'sk-saved')

      process.env.OPENAGENT_LOCAL_BASE_URL = 'http://localhost:9091/v1'
      assert.deepEqual(localEndpointBind(resolveProvider().localBaseURL), {
        host: '127.0.0.1',
        port: '9091',
      })
      assert.deepEqual(localEndpointBind('http://[::1]:9092/v1'), {
        host: '127.0.0.1',
        port: '9092',
      })
      assert.deepEqual(localEndpointBind('http://0.0.0.0/v1'), {
        host: '0.0.0.0',
        port: '8080',
      })
      assert.equal(localEndpointBind('not a url'), null)
      saveGlobalConfig({ ...getGlobalConfig(), localBaseURL: 'http://127.0.0.1:1/v1' })
      delete process.env.OPENAGENT_LOCAL_BASE_URL
      assert.equal(resolveProvider().localBaseURL, 'http://127.0.0.1:1/v1')
    } finally {
      for (const key of env) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
      saveGlobalConfig(config)
    }
  })

  test('telemetry shims do nothing', async () => {
    initSentry()
    await captureException(new Error('ignored'))
    assert.equal(await initializeStatsig(), null)
    logEvent('test', {})
    assert.equal(await checkGate('gate'), false)
    assert.equal(useStatsigGate('gate'), false)
    assert.equal(useStatsigGate('gate', true), true)
    assert.deepEqual(getGateValues(), {})
    assert.equal(await getExperimentValue('exp', 3), 3)
    assert.equal(await getDynamicConfig('cfg', 'default'), 'default')
  })
})
