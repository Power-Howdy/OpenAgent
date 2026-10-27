import type { Command } from '../commands.js'
import { loadSkillIndex } from '../services/skillStore.js'

const skills = {
  type: 'local',
  name: 'skills',
  description: 'List indexed skills',
  isEnabled: true,
  isHidden: false,
  async call() {
    const records = loadSkillIndex()
    if (!records.length) return 'No skills are indexed.'
    return records
      .map(record => {
        const group = record.group ? ` (${record.group})` : ''
        const description = record.description ? ` — ${record.description}` : ''
        return `${record.name}${group}${description}`
      })
      .join('\n')
  },
  userFacingName() {
    return 'skills'
  },
} satisfies Command

export default skills
