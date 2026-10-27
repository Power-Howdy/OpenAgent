import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  cyclePermissionMode,
  getPermissionMode,
  parsePermissionMode,
  permissionModeLabel,
  permissionModePrompt,
  setPermissionMode,
  shouldAutoAllow,
  subscribePermissionMode,
} from '../src/services/permissionMode.js'

afterEach(() => setPermissionMode('manual'))

test('shift-tab order gets more permissive and wraps', () => {
  assert.equal(getPermissionMode(), 'manual')
  assert.equal(cyclePermissionMode(), 'acceptEdits')
  assert.equal(cyclePermissionMode(), 'auto')
  assert.equal(cyclePermissionMode(), 'bypass')
  assert.equal(cyclePermissionMode(), 'manual')
})

test('permission names parse', () => {
  assert.equal(parsePermissionMode('accept edits'), 'acceptEdits')
  assert.equal(parsePermissionMode('bypass permissions'), 'bypass')
  assert.equal(parsePermissionMode('AUTO'), 'auto')
  assert.equal(parsePermissionMode('yolo'), null)
})

test('permission labels, prompts, and subscribers follow the level', () => {
  const seen: string[] = []
  const stop = subscribePermissionMode(() => seen.push(permissionModeLabel()))
  setPermissionMode('manual')
  assert.equal(seen.length, 0)
  setPermissionMode('acceptEdits')
  setPermissionMode('auto')
  setPermissionMode('bypass')
  stop()
  setPermissionMode('manual')
  assert.deepEqual(seen, ['accept edits', 'auto', 'bypass permissions'])
  assert.equal(permissionModeLabel('manual'), 'manual')
  assert.equal(permissionModePrompt(), null)
  assert.equal(permissionModePrompt('manual'), null)
  assert.match(permissionModePrompt('acceptEdits') ?? '', /accept edits/)
  assert.match(permissionModePrompt('auto') ?? '', /inspection/)
  assert.match(permissionModePrompt('bypass') ?? '', /bypass permissions/)
  assert.equal(parsePermissionMode(' accept-edits '), 'acceptEdits')
  assert.equal(parsePermissionMode('acceptedits'), 'acceptEdits')
  assert.equal(parsePermissionMode('bypass-permissions'), 'bypass')
  assert.equal(shouldAutoAllow('acceptEdits', 'readOnly'), false)
  assert.equal(shouldAutoAllow('acceptEdits', 'other'), false)
  assert.equal(shouldAutoAllow('manual', 'safeBash'), false)
  assert.equal(shouldAutoAllow('manual', 'workspaceEdit'), false)
  assert.equal(shouldAutoAllow('acceptEdits', 'workspaceEdit'), true)
  assert.equal(shouldAutoAllow('acceptEdits', 'safeBash'), false)
  assert.equal(shouldAutoAllow('auto', 'workspaceEdit'), true)
  assert.equal(shouldAutoAllow('auto', 'safeBash'), true)
  assert.equal(shouldAutoAllow('auto', 'readOnly'), true)
  assert.equal(shouldAutoAllow('auto', 'other'), false)
  assert.equal(shouldAutoAllow('bypass', 'other'), true)
  assert.equal(shouldAutoAllow('bypass', 'plan'), false)
  assert.equal(shouldAutoAllow('auto', 'plan'), false)
})
