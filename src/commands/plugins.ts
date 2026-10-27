import { homedir } from 'os'
import { join } from 'path'
import type { Command } from '../commands.js'
import { readManifests } from '../services/plugins.js'
import { getCwd } from '../utils/state.js'

const plugins = {
  type: 'local',
  name: 'plugins',
  aliases: ['plugin'],
  description: 'List plugin manifests from ~/.OpenAgent/plugins and .openagent/tools',
  isEnabled: true,
  isHidden: false,
  async call() {
    const dirs = [join(homedir(), '.OpenAgent', 'plugins'), join(getCwd(), '.openagent', 'tools')]
    const seen = new Set<string>()
    const lines: string[] = []
    for (const dir of dirs) {
      for (const manifest of readManifests(dir)) {
        if (seen.has(manifest.name)) continue
        seen.add(manifest.name)
        lines.push(`${manifest.name} — ${manifest.description}`)
      }
    }
    if (!lines.length) return 'No plugins installed.'
    return lines.join('\n')
  },
  userFacingName() {
    return 'plugins'
  },
} satisfies Command

export default plugins
