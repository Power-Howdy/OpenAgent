import type { Command } from '../commands.js'
import { loadBlueprintIndex } from '../services/blueprintStore.js'

const blueprints = {
  type: 'local',
  name: 'blueprints',
  aliases: ['blueprint'],
  description: 'List available blueprints',
  isEnabled: true,
  isHidden: false,
  async call() {
    const records = loadBlueprintIndex()
    if (!records.length) return 'No blueprints are saved.'
    return records
      .map(record => `${record.title} — ${record.description}`)
      .join('\n')
  },
  userFacingName() {
    return 'blueprints'
  },
} satisfies Command

export default blueprints
