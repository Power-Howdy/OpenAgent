import type { Command } from '../commands.js'
import { NIM_CATALOG, isCapable } from '../models/nim-catalog.js'
import { loadLedger, remainingRequests, RPM_LIMIT } from '../services/budget.js'
import { getStickyModel } from '../services/freeRouter.js'
import { resolveProvider } from '../services/resolveProvider.js'

const budget = {
  type: 'local',
  name: 'budget',
  description: 'Show remaining free-mode requests for each capable model',
  isEnabled: true,
  isHidden: false,
  async call() {
    const provider = resolveProvider()
    if (provider.kind !== 'free') {
      return `Budget limits apply to free mode. This session is using ${provider.kind} (${provider.model}).`
    }
    const ledger = loadLedger()
    const now = Date.now()
    const sticky = getStickyModel()
    const lines = NIM_CATALOG.filter(isCapable).map(model => {
      const left = remainingRequests(ledger[model.id], now)
      const mark = model.id === sticky ? ' (sticky)' : ''
      return `${model.id}: ${left}/${RPM_LIMIT}${mark}`
    })
    return [`Free-mode requests left this minute:`, ...lines].join('\n')
  },
  userFacingName() {
    return 'budget'
  },
} satisfies Command

export default budget
