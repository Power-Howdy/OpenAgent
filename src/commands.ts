import allowed from './commands/allowed.js'
import blueprints from './commands/blueprints.js'
import budget from './commands/budget.js'
import bug from './commands/bug.js'
import clear from './commands/clear.js'
import compact from './commands/compact.js'
import config from './commands/config.js'
import context from './commands/context.js'
import cost from './commands/cost.js'
import ctx_viz from './commands/ctx_viz.js'
import diff from './commands/diff.js'
import doctor from './commands/doctor.js'
import help from './commands/help.js'
import init from './commands/init.js'
import listen from './commands/listen.js'
import login from './commands/login.js'
import logout from './commands/logout.js'
import mcp from './commands/mcp.js'
import memory from './commands/memory.js'
import model from './commands/model.js'
import onboarding from './commands/onboarding.js'
import plan from './commands/plan.js'
import permissions from './commands/permissions.js'
import plugins from './commands/plugins.js'
import offline from './commands/offline.js'
import share from './commands/share.js'
import skills from './commands/skills.js'
import status from './commands/status.js'
import todos from './commands/todos.js'
import tools from './commands/tools.js'
import pr_comments from './commands/pr_comments.js'
import releaseNotes from './commands/release-notes.js'
import review from './commands/review.js'
import terminalSetup from './commands/terminalSetup.js'
import undo from './commands/undo.js'
import { Tool, ToolUseContext } from './Tool.js'
import resume from './commands/resume.js'
import { getMCPCommands } from './services/mcpClient.js'
import type { MessageParam } from './types/api.js'
import { memoize } from 'lodash-es'
import type { Message } from './query.js'
type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  argNames?: string[]
  getPromptForCommand(args: string): Promise<MessageParam[]>
}

type LocalCommand = {
  type: 'local'
  call(args: string, context: ToolUseContext): Promise<string>
}

type LocalJSXCommand = {
  type: 'local-jsx'
  call(
    onDone: (result?: string) => void,
    context: ToolUseContext & {
      setForkConvoWithMessagesOnTheNextRender: (
        forkConvoWithMessages: Message[],
      ) => void
    },
    args?: string,
  ): Promise<React.ReactNode>
}

export type Command = {
  description: string
  isEnabled: boolean
  isHidden: boolean
  name: string
  aliases?: string[]
  userFacingName(): string
} & (PromptCommand | LocalCommand | LocalJSXCommand)

const INTERNAL_ONLY_COMMANDS = [ctx_viz, resume, listen]

// Declared as a function so that we don't run this until getCommands is called,
// since underlying functions read from config, which can't be read at module initialization time
const COMMANDS = memoize((): Command[] => [
  status,
  model,
  clear,
  compact,
  config,
  cost,
  budget,
  doctor,
  help,
  init,
  onboarding,
  plan,
  permissions,
  offline,
  todos,
  diff,
  context,
  memory,
  skills,
  blueprints,
  tools,
  allowed,
  mcp,
  plugins,
  share,
  pr_comments,
  releaseNotes,
  bug,
  review,
  terminalSetup,
  undo,
  login(),
  logout,
  ...(process.env.USER_TYPE === 'ant' ? INTERNAL_ONLY_COMMANDS : []),
])

export const getCommands = memoize(async (): Promise<Command[]> => {
  return [...(await getMCPCommands()), ...COMMANDS()].filter(_ => _.isEnabled)
})

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return commands.some(
    _ => _.userFacingName() === commandName || _.aliases?.includes(commandName),
  )
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = commands.find(
    _ => _.userFacingName() === commandName || _.aliases?.includes(commandName),
  ) as Command | undefined
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = _.userFacingName()
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .join(', ')}`,
    )
  }

  return command
}
