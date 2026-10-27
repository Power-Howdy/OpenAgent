import { Command } from '../commands.js'
import { isOffline, setOffline } from '../services/offline.js'

const offline = {
  type: 'local',
  name: 'offline',
  description: 'Use the local model and skip SearXNG and public HTTP',
  isEnabled: true,
  isHidden: false,
  async call() {
    const next = !isOffline()
    setOffline(next)
    return next
      ? 'Offline mode on. Search and public HTTP are off. The local model is used.'
      : 'Offline mode off.'
  },
  userFacingName() {
    return 'offline'
  },
} satisfies Command

export default offline
