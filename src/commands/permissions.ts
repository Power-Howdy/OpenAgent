import { Command } from '../commands.js'
import {
  cyclePermissionMode,
  parsePermissionMode,
  permissionModeLabel,
  setPermissionMode,
} from '../services/permissionMode.js'

const permissions = {
  type: 'local',
  name: 'permissions',
  description:
    'Set the permission level: manual, auto, accept edits, or bypass permissions',
  isEnabled: true,
  isHidden: false,
  async call(args: string) {
    const requested = args.trim()
    if (!requested) {
      const next = cyclePermissionMode()
      return `Permission level is ${permissionModeLabel(next)}. Levels: manual, accept edits, auto, bypass permissions. Shift+Tab cycles them.`
    }
    const mode = parsePermissionMode(requested)
    if (!mode) {
      return `Unknown permission level "${requested}". Use manual, accept edits, auto, or bypass.`
    }
    setPermissionMode(mode)
    return `Permission level is ${permissionModeLabel(mode)}.`
  },
  userFacingName() {
    return 'permissions'
  },
} satisfies Command

export default permissions
