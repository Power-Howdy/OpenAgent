import assert from 'node:assert/strict'
import test from 'node:test'
import { NIM_CATALOG, findNimModel, isCapable, isFastOnly, type NimModel } from '../src/models/nim-catalog.js'
import { RPM_LIMIT } from '../src/services/budget.js'
import { chooseNimModel, getStickyModel, modelForId, setStickyModel } from '../src/services/freeRouter.js'
import { lastUserText, localChat, requestThinking, threadChat, threadTurns } from '../src/services/chatShape.js'
import { localEndpointBind, resolveNimApiKey } from '../src/services/resolveProvider.js'

const now = 1_000_000

test('free mode picks the capable model with the most remaining requests', () => {
  const usage = {
    'nemotron-3-ultra-550b-a55b': Array(RPM_LIMIT).fill(now - 1_000),
  }
  const choice = chooseNimModel({ now, usage, sticky: null })
  assert.equal(choice.kind, 'model')
  if (choice.kind !== 'model') return
  assert.equal(choice.model.id, 'nemotron-3.5-super-vl-120b-a12b')
})

test('a model stays sticky while it still has budget', () => {
  const choice = chooseNimModel({
    now,
    usage: {},
    sticky: 'gpt-oss-20b',
  })
  assert.equal(choice.kind, 'model')
  if (choice.kind !== 'model') return
  assert.equal(choice.model.id, 'gpt-oss-20b')
})

test('a full window waits instead of moving the thread to the local model', () => {
  const usage = Object.fromEntries(
    NIM_CATALOG.filter(isCapable).map(model => [
      model.id,
      Array(RPM_LIMIT).fill(now - 1_000),
    ]),
  )
  const choice = chooseNimModel({ now, usage, sticky: null })
  assert.equal(choice.kind, 'wait')
  if (choice.kind === 'wait') assert.ok(choice.waitMs > 0)
})

test('free-mode requests do not enable thinking', () => {
  assert.equal(requestThinking('free', 4_000), false)
  assert.equal(requestThinking('anthropic', 0), false)
  assert.deepEqual(requestThinking('anthropic', 4_000), { budget: 4_000 })
})

test('a local chat contains only the current prompt', () => {
  const chat = localChat('describe git status')
  assert.equal(chat.turns.length, 1)
  assert.equal(chat.turns[0]?.content, 'describe git status')
  assert.equal(chat.turns.some(turn => turn.role === 'assistant'), false)
})

test('a configured NIM key is used when the environment has none', () => {
  const previous = process.env.NVIDIA_API_KEY
  delete process.env.NVIDIA_API_KEY
  try {
    assert.equal(resolveNimApiKey(undefined, 'nvapi-saved'), 'nvapi-saved')
    assert.equal(resolveNimApiKey('nvapi-env', 'nvapi-saved'), 'nvapi-env')
    assert.equal(resolveNimApiKey('  ', 'nvapi-saved'), 'nvapi-saved')
  } finally {
    if (previous === undefined) delete process.env.NVIDIA_API_KEY
    else process.env.NVIDIA_API_KEY = previous
  }
})

test('a configured local endpoint chooses the bind address', () => {
  assert.deepEqual(localEndpointBind('http://127.0.0.1:9090/v1'), {
    host: '127.0.0.1',
    port: '9090',
  })
  assert.equal(localEndpointBind('http://192.168.1.20:8080/v1'), null)
})

test('switching NIM models keeps the same thread transcript', () => {
  const thread = [
    { type: 'user', message: { role: 'user', content: 'first' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
    },
    { type: 'user', message: { role: 'user', content: 'second' } },
  ] as Parameters<typeof threadTurns>[0]
  const turns = threadTurns(thread)
  assert.deepEqual(
    turns.map(turn => turn.role),
    ['user', 'assistant', 'user'],
  )
  const blocks = [
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'thinking', thinking: 'hidden' },
          { type: 'redacted_thinking', data: 'hidden' },
        ],
      },
    },
  ] as Parameters<typeof threadTurns>[0]
  const withThinking = threadTurns(blocks)
  assert.equal(Array.isArray(withThinking[0]?.content), true)
  assert.equal(lastUserText([] as Parameters<typeof lastUserText>[0]), '')
  assert.equal(
    lastUserText(thread as Parameters<typeof lastUserText>[0]),
    'second',
  )
  assert.equal(lastUserText(blocks), 'look')
  const assistantLast = [
    { type: 'user', message: { role: 'user', content: 'earlier' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    },
  ] as unknown as Parameters<typeof lastUserText>[0]
  assert.equal(lastUserText(assistantLast), 'earlier')
  const hole = [] as Parameters<typeof lastUserText>[0]
  hole[1] = assistantLast[0]!
  assert.equal(lastUserText(hole), 'earlier')
  assert.equal(
    lastUserText([
      {
        type: 'assistant',
        message: { role: 'assistant', content: 'only assistant' },
      },
    ] as unknown as Parameters<typeof lastUserText>[0]),
    '',
  )
  assert.equal(threadChat('system', thread).system, 'system')
})

const coding: NimModel = {
  id: 'coding-a',
  apiModel: 'org/coding-a',
  priority: 2,
  tags: ['coding', 'tools'],
  context: 8_000,
}
const long: NimModel = {
  id: 'coding-long',
  apiModel: 'org/coding-long',
  priority: 1,
  tags: ['coding', 'tools', 'long-context'],
  context: 100_000,
}

test('free mode blocks a pool that cannot see images', () => {
  const choice = chooseNimModel({
    now,
    usage: {},
    catalog: [coding],
    requireVision: true,
  })
  assert.equal(choice.kind, 'blocked')
})

test('free mode prefers a long-context model only when one has budget', () => {
  const choice = chooseNimModel({
    now,
    usage: {},
    catalog: [coding, long],
    preferLongContext: true,
  })
  assert.equal(choice.kind, 'model')
  if (choice.kind === 'model') assert.equal(choice.model.id, 'coding-long')
  const noLong = chooseNimModel({
    now,
    usage: { 'coding-long': Array(1).fill(now) },
    catalog: [coding, long],
    preferLongContext: true,
    limit: 1,
  })
  assert.equal(noLong.kind, 'model')
  if (noLong.kind === 'model') assert.equal(noLong.model.id, 'coding-a')
})

test('a zero request limit blocks instead of waiting', () => {
  const choice = chooseNimModel({
    now,
    usage: {},
    catalog: [coding],
    limit: 0,
  })
  assert.equal(choice.kind, 'blocked')
})

test('a model with more remaining requests sorts ahead of the others', () => {
  const choice = chooseNimModel({
    now,
    usage: { 'coding-a': [now - 1] },
    catalog: [coding, long],
    sticky: null,
  })
  assert.equal(choice.kind, 'model')
  if (choice.kind === 'model') assert.equal(choice.model.id, 'coding-long')
})

test('equal budgets break the tie with priority', () => {
  const choice = chooseNimModel({
    now,
    usage: {},
    catalog: [coding, long],
    sticky: null,
  })
  assert.equal(choice.kind, 'model')
  if (choice.kind === 'model') assert.equal(choice.model.id, 'coding-long')
})

test('the sticky model is remembered for the next choice', () => {
  setStickyModel('coding-a')
  const choice = chooseNimModel({ now, usage: {}, catalog: [coding, long] })
  assert.equal(choice.kind, 'model')
  if (choice.kind === 'model') assert.equal(choice.model.id, 'coding-a')
  setStickyModel(null)
  assert.equal(getStickyModel(), null)
  assert.equal(modelForId('gpt-oss-20b')?.apiModel, 'openai/gpt-oss-20b')
  assert.equal(modelForId('missing'), undefined)
  assert.equal(findNimModel('openai/gpt-oss-20b')?.id, 'gpt-oss-20b')
  assert.equal(isFastOnly(NIM_CATALOG.find(model => model.id === 'glm-5-3-flash')!), true)
  assert.equal(isCapable(NIM_CATALOG.find(model => model.id === 'glm-5-3-flash')!), false)
})
