import type { Command } from '../commands.js'
import { getTotalAPIDuration, getTotalCost, getTotalDuration } from '../cost-tracker.js'
import { getStickyModel } from '../services/freeRouter.js'
import { isOffline } from '../services/offline.js'
import { isPlanMode } from '../services/planMode.js'
import { getPermissionMode, permissionModeLabel } from '../services/permissionMode.js'
import { resolveProvider } from '../services/resolveProvider.js'
import { listTodos } from '../services/todos.js'

function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  if (!minutes) return `${seconds}s`
  return `${minutes}m ${seconds % 60}s`
}

const status = {
  type: 'local',
  name: 'status',
  aliases: ['session'],
  description: 'Show the provider, model, permission level, plan, offline mode, and cost',
  isEnabled: true,
  isHidden: false,
  async call() {
    const provider = resolveProvider()
    const todos = listTodos()
    const lines = [
      `Provider: ${provider.kind}`,
      `Model: ${provider.model}`,
      provider.kind === 'free'
        ? `Sticky model: ${getStickyModel() ?? 'automatic'}`
        : `Fast model: ${provider.fastModel}`,
      `Permission: ${permissionModeLabel(getPermissionMode())}`,
      `Plan mode: ${isPlanMode() ? 'on' : 'off'}`,
      `Offline: ${isOffline() ? 'on' : 'off'}`,
      `Todos: ${todos.length ? todos.map(item => item.status).join(', ') : 'none'}`,
      `Cost: $${getTotalCost().toFixed(4)}`,
      `API time: ${clock(getTotalAPIDuration())}`,
      `Session time: ${clock(getTotalDuration())}`,
    ]
    return lines.join('\n')
  },
  userFacingName() {
    return 'status'
  },
} satisfies Command

export default status
