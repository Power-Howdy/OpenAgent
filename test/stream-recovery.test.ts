import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAbortError,
  isPermanentFailure,
  recoverGeneration,
  textLooksComplete,
} from '../src/services/streamRecovery.js'

test('aborts and permanent provider failures are not retried', () => {
  assert.equal(isAbortError(null), false)
  assert.equal(isAbortError('nope'), false)
  assert.equal(isAbortError({ name: 'TypeError' }), false)
  assert.equal(isAbortError({ name: 'AbortError' }), true)
  const wrapped = { name: 'Error', cause: { name: 'AbortError' } }
  assert.equal(isAbortError(wrapped), true)
  let deep: unknown = { name: 'AbortError' }
  for (let i = 0; i < 6; i++) deep = { name: 'Error', cause: deep }
  assert.equal(isAbortError(deep), false)

  assert.equal(isPermanentFailure('nope', 401), true)
  assert.equal(isPermanentFailure('nope', 500), false)
  assert.equal(isPermanentFailure('Prompt is too long'), true)
  assert.equal(isPermanentFailure('Credit balance is too low'), true)
  assert.equal(isPermanentFailure('Invalid API key'), true)
  assert.equal(isPermanentFailure('overloaded'), false)
})

test('a dropped stream keeps finished text, continues a cutoff, and retries an empty body', () => {
  assert.equal(textLooksComplete(''), false)
  assert.equal(textLooksComplete('   '), false)
  assert.equal(textLooksComplete('Done.'), true)
  assert.equal(textLooksComplete('Done!"'), true)
  assert.equal(textLooksComplete('Still working'), false)
  assert.equal(textLooksComplete('```js\nconst x = 1'), false)
  assert.equal(textLooksComplete('```js\nconst x = 1\n```'), true)

  assert.equal(
    recoverGeneration({
      text: 'partial',
      toolCallCount: 1,
      unfinishedTool: true,
      finishReason: 'error',
      failed: true,
    }),
    'use',
  )
  assert.equal(
    recoverGeneration({
      text: '',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'stop',
      failed: false,
    }),
    'use',
  )
  assert.equal(
    recoverGeneration({
      text: '',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'error',
      failed: true,
    }),
    'retry',
  )
  assert.equal(
    recoverGeneration({
      text: '',
      toolCallCount: 0,
      unfinishedTool: true,
      finishReason: 'stop',
      failed: false,
    }),
    'retry',
  )
  assert.equal(
    recoverGeneration({
      text: '',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'length',
      failed: false,
    }),
    'retry',
  )
  assert.equal(
    recoverGeneration({
      text: 'Working through the file',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'length',
      failed: false,
    }),
    'continue',
  )
  assert.equal(
    recoverGeneration({
      text: 'Done.',
      toolCallCount: 0,
      unfinishedTool: true,
      finishReason: 'stop',
      failed: false,
    }),
    'continue',
  )
  assert.equal(
    recoverGeneration({
      text: 'Done.',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'error',
      failed: true,
    }),
    'use',
  )
  assert.equal(
    recoverGeneration({
      text: 'I will read the file',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: '',
      failed: true,
    }),
    'continue',
  )
  assert.equal(
    recoverGeneration({
      text: 'On it',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'stop',
      failed: false,
    }),
    'use',
  )
  assert.equal(
    recoverGeneration({
      text: 'Done.',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'error',
      failed: false,
    }),
    'use',
  )
  assert.equal(
    recoverGeneration({
      text: 'I will read the file',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'error',
      failed: false,
    }),
    'continue',
  )
  assert.equal(
    recoverGeneration({
      text: '',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'stop',
      failed: true,
    }),
    'retry',
  )
  assert.equal(
    recoverGeneration({
      text: '',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: 'error',
      failed: false,
    }),
    'retry',
  )
  assert.equal(
    recoverGeneration({
      text: 'Still going',
      toolCallCount: 0,
      unfinishedTool: false,
      finishReason: '',
      failed: false,
    }),
    'continue',
  )
})
