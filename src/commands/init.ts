import type { Command } from '../commands.js'
import { markProjectOnboardingComplete } from '../ProjectOnboarding.js'

const command = {
  type: 'prompt',
  name: 'init',
  description: 'Initialize an AGENTS.md file with instructions for coding agents',
  isEnabled: true,
  isHidden: false,
  progressMessage: 'analyzing your codebase',
  userFacingName() {
    return 'init'
  },
  async getPromptForCommand(_args: string) {
    // Mark onboarding as complete when init command is run
    markProjectOnboardingComplete()
    return [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Please analyze this codebase and create AGENTS.md at the repository root. The filename is exactly AGENTS.md. It is plain Markdown with no required frontmatter or schema, and other coding agents read it.

Use these sections when they apply:
## Setup commands
## Code style
## Testing
## Project structure

Include build, lint, and test commands, including how to run a single test. Keep it short, about 20 lines, and only include instructions that change how an agent works. If AGENTS.md already exists, improve it. If OpenAgent.md, CLAUDE.md, Cursor rules (in .cursor/rules/ or .cursorrules), Claude files (in .claude/), OpenCode files (in .opencode/), or Copilot rules (in .github/copilot-instructions.md) exist, fold the useful instructions into AGENTS.md. Leave those other agent files in place. In a monorepo, a nested AGENTS.md inside a package overrides the root file for files in that package. The closest instruction file wins.`,
          },
        ],
      },
    ]
  },
} satisfies Command

export default command
