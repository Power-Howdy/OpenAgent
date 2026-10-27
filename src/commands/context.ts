import type { Command } from '../commands.js'
import { readThreadContext } from '../services/threadContext.js'

const context = {
  type: 'local',
  name: 'context',
  description: 'Show context saved for this thread',
  isEnabled: true,
  isHidden: false,
  async call() {
    const saved = readThreadContext()
    const entries = Object.entries(saved).filter(([, value]) => value.trim())
    if (!entries.length) return 'No thread context.'
    return entries
      .map(([key, value]) => {
        const preview = value.length > 120 ? `${value.slice(0, 117)}...` : value
        return `${key}: ${preview.replace(/\s+/g, ' ')}`
      })
      .join('\n')
  },
  userFacingName() {
    return 'context'
  },
} satisfies Command

export default context
