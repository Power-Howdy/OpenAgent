import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, test } from 'node:test'
import { resetCheckpoints, undoLastEdit } from '../src/services/checkpoints.js'
import { canClassifyCommands } from '../src/utils/commands.js'
import { writeTextContent } from '../src/utils/file.js'
import { isPathInside } from '../src/utils/permissions/filesystem.js'
import { shouldUseSandbox } from '../src/services/projectCommands.js'

const root = mkdtempSync(join(tmpdir(), 'openagent-guards-'))
after(() => {
  resetCheckpoints()
  rmSync(root, { recursive: true, force: true })
})

test('path grants stop at the directory boundary and follow symlinks', () => {
  const project = join(root, 'proj')
  const sibling = join(root, 'proj-evil')
  mkdirSync(project)
  mkdirSync(sibling)
  writeFileSync(join(sibling, 'secret'), 'no')
  symlinkSync(sibling, join(project, 'link'))
  assert.equal(isPathInside(project, join(project, 'src', 'a.ts')), true)
  assert.equal(isPathInside(project, sibling), false)
  assert.equal(isPathInside(project, join(project, 'link', 'secret')), false)
})

test('untrusted commands use the sandbox and free mode does not classify prefixes', () => {
  assert.equal(shouldUseSandbox('ls src', undefined, true), false)
  assert.equal(shouldUseSandbox('npm test', undefined, true), false)
  assert.equal(shouldUseSandbox('npm test', true, true), true)
  assert.equal(shouldUseSandbox('rm -rf build', undefined, true), true)
  assert.equal(shouldUseSandbox('rm -rf build', undefined, false), false)
  assert.equal(canClassifyCommands('free'), false)
  assert.equal(canClassifyCommands('anthropic'), true)
  assert.equal(canClassifyCommands('openai'), true)
  assert.equal(canClassifyCommands('compatible'), true)
})

test('a file write is atomic and undo restores the previous contents', () => {
  const file = join(root, 'note.txt')
  writeFileSync(file, 'one')
  writeTextContent(file, 'two', 'utf8', 'LF')
  assert.equal(readFileSync(file, 'utf8'), 'two')
  assert.equal(undoLastEdit(), `Restored ${file}`)
  assert.equal(readFileSync(file, 'utf8'), 'one')
  resetCheckpoints()
  assert.equal(undoLastEdit(), 'Nothing to undo.')
})
