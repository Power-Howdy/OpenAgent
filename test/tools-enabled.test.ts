import '../src/constants/macro-global.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { getTools } from '../src/tools.js'
import { PersistentShell } from '../src/utils/PersistentShell.js'

after(() => {
  PersistentShell.closeAll()
})

test('every registered tool can be asked if it is enabled', async () => {
  process.env.NODE_ENV = 'test'
  const tools = await getTools()
  assert.ok(tools.some(tool => tool.name === 'WebSearch'))
  assert.ok(tools.some(tool => tool.name === 'Check'))
  for (const tool of tools) {
    assert.equal(typeof tool.isEnabled, 'function', tool.name)
    assert.equal(await tool.isEnabled!(), true, tool.name)
  }
})
