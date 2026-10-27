import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  isPlanMode,
  isPlanModeReadOnlyCommand,
  setPlanMode,
  subscribePlanMode,
  toolsForPlanMode,
  withPlanModePrompt,
} from '../src/services/planMode.js'

afterEach(() => setPlanMode(false))

test('plan mode bash allowlist keeps inspection and blocks writes', () => {
  assert.equal(isPlanModeReadOnlyCommand('git status'), true)
  assert.equal(isPlanModeReadOnlyCommand('git diff -- src/query.ts'), true)
  assert.equal(isPlanModeReadOnlyCommand('ls -la src'), true)
  assert.equal(isPlanModeReadOnlyCommand('rg plan src'), true)
  assert.equal(isPlanModeReadOnlyCommand('git commit -m update'), false)
  assert.equal(isPlanModeReadOnlyCommand('rm file'), false)
  assert.equal(isPlanModeReadOnlyCommand('sed -i s/a/b/ file'), false)
  assert.equal(isPlanModeReadOnlyCommand('find . -delete'), false)
  assert.equal(isPlanModeReadOnlyCommand('echo hi > file'), false)
  assert.equal(isPlanModeReadOnlyCommand('ls && npm install'), false)
})

test('plan mode keeps read-only tools and bash, and drops workers', () => {
  const read = { name: 'Read', isReadOnly: () => true }
  const bash = { name: 'Bash', isReadOnly: () => false }
  const edit = { name: 'Edit', isReadOnly: () => false }
  const agent = { name: 'dispatch_agent', isReadOnly: () => true }
  const exitPlan = { name: 'ExitPlanMode', isReadOnly: () => false }
  const tools = toolsForPlanMode([read, bash, edit, agent], exitPlan)
  assert.deepEqual(
    tools.map(tool => tool.name),
    ['Read', 'Bash', 'ExitPlanMode'],
  )
})

test('plan mode notifies subscribers and rejects writes hidden in a command', () => {
  const seen: boolean[] = []
  const stop = subscribePlanMode(() => seen.push(isPlanMode()))
  setPlanMode(false)
  setPlanMode(true)
  setPlanMode(true)
  stop()
  setPlanMode(false)
  assert.deepEqual(seen, [true])
  assert.equal(isPlanModeReadOnlyCommand(''), false)
  assert.equal(isPlanModeReadOnlyCommand('#'), false)
  assert.equal(isPlanModeReadOnlyCommand('echo $(id)'), false)
  assert.equal(isPlanModeReadOnlyCommand('cat `secret`'), false)
  assert.equal(isPlanModeReadOnlyCommand('git'), false)
  assert.equal(isPlanModeReadOnlyCommand('/usr/bin/ls src'), true)
  assert.equal(isPlanModeReadOnlyCommand('sed s/a/b/ file'), true)
  assert.equal(isPlanModeReadOnlyCommand('find . -exec ls {} +'), false)
  assert.equal(isPlanModeReadOnlyCommand('find . -execdir ls {} +'), false)
  assert.equal(isPlanModeReadOnlyCommand('find . -ok rm {} \\;'), false)
  const exitPlan = { name: 'ExitPlanMode', isReadOnly: () => false }
  const tools = toolsForPlanMode(
    [
      { name: 'Architect', isReadOnly: () => true },
      { name: 'Edit', isReadOnly: () => false },
    ],
    exitPlan,
  )
  assert.deepEqual(
    tools.map(tool => tool.name),
    ['ExitPlanMode'],
  )
})

test('plan mode prompt is added only while plan mode is on', () => {
  assert.deepEqual(withPlanModePrompt(['base']), ['base'])
  setPlanMode(true)
  assert.equal(isPlanMode(), true)
  assert.equal(withPlanModePrompt(['base']).length, 2)
  setPlanMode(false)
  assert.equal(isPlanMode(), false)
})
