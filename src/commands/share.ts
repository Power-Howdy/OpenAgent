import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Command } from '../commands.js'
import { OpenAgent_BASE_DIR } from '../utils/env.js'
import { shareBody } from '../services/redact.js'
import { getTranscript } from '../services/transcript.js'
import { SESSION_ID } from '../utils/log.js'

const share = {
  type: 'local',
  name: 'share',
  aliases: ['export'],
  description: 'Write a redacted copy of this thread to a local file',
  isEnabled: true,
  isHidden: false,
  async call() {
    const dir = join(OpenAgent_BASE_DIR, 'shares')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${SESSION_ID}.json`)
    writeFileSync(path, shareBody(getTranscript()))
    return path
  },
  userFacingName() {
    return 'share'
  },
} satisfies Command

export default share
