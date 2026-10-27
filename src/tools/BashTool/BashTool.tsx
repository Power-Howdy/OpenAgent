import { statSync } from 'fs'
import { EOL } from 'os'
import { isAbsolute, relative, resolve } from 'path'
import * as React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js'
import { PRODUCT_NAME } from '../../constants/product.js'
import { queryHaiku } from '../../services/OpenAgent.js'
import { Tool, ValidationResult } from '../../Tool.js'
import { splitCommand } from '../../utils/commands.js'
import { isInDirectory } from '../../utils/file.js'
import { logError } from '../../utils/log.js'
import { PersistentShell } from '../../utils/PersistentShell.js'
import { runInSandbox, safeSessionName, sandboxReady, SETUP_HINT } from '../../services/runtime.js'
import { getCwd, getOriginalCwd } from '../../utils/state.js'
import BashToolResultMessage from './BashToolResultMessage.js'
import { BANNED_COMMANDS, PROMPT } from './prompt.js'
import { formatOutput, getCommandFilePaths } from './utils.js'
import { logEvent } from '../../services/statsig.js'
import {
  isPlanMode,
  isPlanModeReadOnlyCommand,
} from '../../services/planMode.js'

export const inputSchema = z.strictObject({
  command: z.string().describe('The command to execute'),
  timeout: z
    .number()
    .optional()
    .describe('Optional timeout in milliseconds (max 600000)'),
  session: z.string().optional().describe('Named host shell. Empty uses the default shell.'),
  isolated: z.boolean().optional().describe('Run in a sandbox session instead of the host shell.'),
})

type In = typeof inputSchema
export type Out = {
  stdout: string
  stdoutLines: number // Total number of lines in original stdout, even if `stdout` is now truncated
  stderr: string
  stderrLines: number // Total number of lines in original stderr, even if `stderr` is now truncated
  interrupted: boolean
}

export const BashTool = {
  name: 'Bash',
  async description({ command }) {
    try {
      const result = await queryHaiku({
        systemPrompt: [
          `You are a command description generator. Write a clear, concise description of what this command does in 5-10 words. Examples:

          Input: ls
          Output: Lists files in current directory

          Input: git status
          Output: Shows working tree status

          Input: npm install
          Output: Installs package dependencies

          Input: mkdir foo
          Output: Creates directory 'foo'`,
        ],
        userPrompt: `Describe this command: ${command}`,
      })
      const description =
        result.message.content[0]?.type === 'text'
          ? result.message.content[0].text
          : null
      return description || 'Executes a bash command'
    } catch (error) {
      logError(error)
      return 'Executes a bash command'
    }
  },
  async prompt() {
    return PROMPT
  },
  isReadOnly() {
    return false
  },
  inputSchema,
  userFacingName() {
    return 'Bash'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    // Always check per-project permissions for BashTool
    return true
  },
  async validateInput({ command }): Promise<ValidationResult> {
    if (isPlanMode() && !isPlanModeReadOnlyCommand(command)) {
      return {
        result: false,
        message:
          'Plan mode only allows inspection commands such as ls, rg, and git status. Call ExitPlanMode and wait for approval before changing anything.',
      }
    }
    const commands = splitCommand(command)
    for (const cmd of commands) {
      const parts = cmd.split(' ')
      const baseCmd = parts[0]

      // Check if command is banned
      if (baseCmd && BANNED_COMMANDS.includes(baseCmd.toLowerCase())) {
        return {
          result: false,
          message: `Command '${baseCmd}' is not allowed for security reasons`,
        }
      }

      // Special handling for cd command
      if (baseCmd === 'cd' && parts[1]) {
        const targetDir = parts[1]!.replace(/^['"]|['"]$/g, '') // Remove quotes if present
        const fullTargetDir = isAbsolute(targetDir)
          ? targetDir
          : resolve(getCwd(), targetDir)
        if (
          !isInDirectory(
            relative(getOriginalCwd(), fullTargetDir),
            relative(getCwd(), getOriginalCwd()),
          )
        ) {
          return {
            result: false,
            message: `ERROR: cd to '${fullTargetDir}' was blocked. For security, ${PRODUCT_NAME} may only change directories to child directories of the original working directory (${getOriginalCwd()}) for this session.`,
          }
        }
      }
    }

    return { result: true }
  },
  renderToolUseMessage({ command }) {
    // Clean up any command that uses the quoted HEREDOC pattern
    if (command.includes("\"$(cat <<'EOF'")) {
      const match = command.match(
        /^(.*?)"?\$\(cat <<'EOF'\n([\s\S]*?)\n\s*EOF\n\s*\)"(.*)$/,
      )
      if (match && match[1] && match[2]) {
        const prefix = match[1]
        const content = match[2]
        const suffix = match[3] || ''
        return `${prefix.trim()} "${content.trim()}"${suffix.trim()}`
      }
    }
    return command
  },
  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },

  renderToolResultMessage(content, { verbose }) {
    return <BashToolResultMessage content={content} verbose={verbose} />
  },
  renderResultForAssistant({ interrupted, stdout, stderr }) {
    let errorMessage = stderr.trim()
    if (interrupted) {
      if (stderr) errorMessage += EOL
      errorMessage += '<error>Command was aborted before completion</error>'
    }
    const hasBoth = stdout.trim() && errorMessage
    return `${stdout.trim()}${hasBoth ? '\n' : ''}${errorMessage.trim()}`
  },
  async *call(
    { command, timeout = 120000, session, isolated },
    { abortController, readFileTimestamps },
  ) {
    let stdout = ''
    let stderr = ''

    let interrupted = false
    if (isolated) {
      if (!(await sandboxReady())) {
        stderr = SETUP_HINT
      } else {
        const name = session && safeSessionName(session) ? session : 'bash'
        const result = await runInSandbox({
          argv: ['bash', '-lc', command],
          network: 'bridge',
          timeoutMs: timeout,
          readonly: false,
          session: name,
          signal: abortController.signal,
        })
        stdout = (result.stdout || '').trim()
        stderr = (result.stderr || '').trim()
        if (result.code !== 0) stderr = `${stderr}\nExit code ${result.code}`.trim()
      }
    } else {
      const shell = session && safeSessionName(session)
        ? PersistentShell.getSession(session)
        : PersistentShell.getInstance()
      const result = await shell.exec(
        command,
        abortController.signal,
        timeout,
      )
      stdout += (result.stdout || '').trim() + EOL
      stderr += (result.stderr || '').trim() + EOL
      interrupted = result.interrupted
      if (result.code !== 0) {
        stderr += `Exit code ${result.code}`
      }

      if (!isInDirectory(getCwd(), getOriginalCwd())) {
        await shell.setCwd(getOriginalCwd())
        stderr = `${stderr.trim()}${EOL}Shell cwd was reset to ${getOriginalCwd()}`
        logEvent('bash_tool_reset_to_original_dir', {})
      }
    }

    if (!isolated && process.env.NODE_ENV !== 'test') {
      getCommandFilePaths(command, stdout).then(filePaths => {
        for (const filePath of filePaths) {
          const fullFilePath = isAbsolute(filePath)
            ? filePath
            : resolve(getCwd(), filePath)

          // Try/catch in case the file doesn't exist (because Haiku didn't properly extract it)
          try {
            readFileTimestamps[fullFilePath] = statSync(fullFilePath).mtimeMs
          } catch (e) {
            logError(e)
          }
        }
      })
    }

    const { totalLines: stdoutLines, truncatedContent: stdoutContent } =
      formatOutput(stdout.trim())
    const { totalLines: stderrLines, truncatedContent: stderrContent } =
      formatOutput(stderr.trim())

    const data: Out = {
      stdout: stdoutContent,
      stdoutLines,
      stderr: stderrContent,
      stderrLines,
      interrupted,
    }

    yield {
      type: 'result',
      resultForAssistant: this.renderResultForAssistant(data),
      data,
      isError: stderr.trim() === SETUP_HINT || interrupted,
    }
  },
} satisfies Tool<In, Out>
