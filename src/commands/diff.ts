import type { Command } from '../commands.js'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { getIsGit } from '../utils/git.js'

const diff = {
  type: 'local',
  name: 'diff',
  aliases: ['git'],
  description: 'Show the branch and a short git status',
  isEnabled: true,
  isHidden: false,
  async call() {
    if (!(await getIsGit())) return 'This directory is not a git repository.'
    const branch = await execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    const status = await execFileNoThrow('git', ['status', '--short'])
    const name = branch.stdout.trim() || 'unknown'
    const changes = status.stdout.trim()
    if (!changes) return `${name}\nWorking tree clean.`
    const lines = changes.split('\n').slice(0, 40)
    const hidden = changes.split('\n').length - lines.length
    return [`${name}`, ...lines, hidden > 0 ? `… ${hidden} more` : ''].filter(Boolean).join('\n')
  },
  userFacingName() {
    return 'diff'
  },
} satisfies Command

export default diff
