import type { Command } from '../commands.js'
import { getCurrentProjectConfig } from '../utils/config.js'

const allowed = {
  type: 'local',
  name: 'allowed',
  aliases: ['approved-tools'],
  description: 'List tools pre-approved for this project',
  isEnabled: true,
  isHidden: false,
  async call() {
    const names = getCurrentProjectConfig().allowedTools ?? []
    if (!names.length) return 'No tools are pre-approved for this project. /permissions changes the level for this session.'
    return [`Pre-approved tools:`, ...names.map(name => `- ${name}`)].join('\n')
  },
  userFacingName() {
    return 'allowed'
  },
} satisfies Command

export default allowed
