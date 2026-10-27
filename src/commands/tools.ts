import { homedir } from 'os'
import { join } from 'path'
import type { Command } from '../commands.js'
import { readManifests } from '../services/plugins.js'
import { loadToolIndex } from '../tool-store/store.js'
import { getAllTools } from '../tools.js'
import { getCwd } from '../utils/state.js'

const tools = {
  type: 'local',
  name: 'tools',
  description: 'List built-in tools, stored tools, and plugins',
  isEnabled: true,
  isHidden: false,
  async call() {
    const builtin = getAllTools().map(tool => tool.name).join(', ')
    const stored = loadToolIndex()
    const dirs = [join(homedir(), '.OpenAgent', 'plugins'), join(getCwd(), '.openagent', 'tools')]
    const plugins = dirs.flatMap(dir => readManifests(dir).map(item => item.name))
    const lines = [`Built-in: ${builtin}`]
    lines.push(stored.length ? `Stored: ${stored.map(item => item.id).join(', ')}` : 'Stored: none')
    lines.push(plugins.length ? `Plugins: ${plugins.join(', ')}` : 'Plugins: none')
    return lines.join('\n')
  },
  userFacingName() {
    return 'tools'
  },
} satisfies Command

export default tools
