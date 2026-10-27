import { Command } from '../commands.js'
import { undoLastEdit } from '../services/checkpoints.js'

const undo = {
  type: 'local',
  name: 'undo',
  description: 'Restore the file contents from before the latest edit',
  isEnabled: true,
  isHidden: false,
  async call() {
    return undoLastEdit()
  },
  userFacingName() {
    return 'undo'
  },
} satisfies Command

export default undo
