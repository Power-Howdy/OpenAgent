import { existsSync, readdirSync } from 'fs'
import type { Command } from '../commands.js'
import { MEMORY_DIR } from '../utils/env.js'

const memory = {
  type: 'local',
  name: 'memory',
  description: 'List saved memory files',
  isEnabled: true,
  isHidden: false,
  async call() {
    if (!existsSync(MEMORY_DIR)) return `No memory files in ${MEMORY_DIR}.`
    const names = readdirSync(MEMORY_DIR).filter(name => !name.startsWith('.'))
    if (!names.length) return `No memory files in ${MEMORY_DIR}.`
    return [`Memory files in ${MEMORY_DIR}:`, ...names.map(name => `- ${name}`)].join('\n')
  },
  userFacingName() {
    return 'memory'
  },
} satisfies Command

export default memory
