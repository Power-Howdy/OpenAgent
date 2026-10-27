import { Command } from '../commands.js'
import { isPlanMode, setPlanMode } from '../services/planMode.js'

const plan = {
  type: 'local',
  name: 'plan',
  description:
    'Toggle plan mode. The agent reads and proposes a plan, then waits for approval before editing.',
  isEnabled: true,
  isHidden: false,
  async call() {
    const next = !isPlanMode()
    setPlanMode(next)
    return next
      ? 'Plan mode on. The agent can read and inspect, then it must present a plan before editing. Shift+Tab or /plan turns this off.'
      : 'Plan mode off. The agent can edit and run commands again.'
  },
  userFacingName() {
    return 'plan'
  },
} satisfies Command

export default plan
