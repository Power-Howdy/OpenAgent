#!/usr/bin/env -S node --no-warnings=ExperimentalWarning --enable-source-maps
import '../utils/loadEnv.js'
import '../constants/macro-global.js'
import { initSentry } from '../services/sentry.js'
import { startBackgroundSync } from '../services/backgroundSync.js'
import { PRODUCT_NAME } from '../constants/product.js'
initSentry()

import React from 'react'
import { ReadStream } from 'tty'
import { openSync, existsSync } from 'fs'
import { render, RenderOptions } from 'ink'
import { REPL } from '../screens/REPL.js'
import { addToHistory } from '../history.js'
import { getContext, setContext, removeContext } from '../context.js'
import { Command } from '@commander-js/extra-typings'
import { ask } from '../utils/ask.js'
import { hasPermissionsToUseTool } from '../permissions.js'
import { getTools } from '../tools.js'
import {
  getGlobalConfig,
  getCurrentProjectConfig,
  saveGlobalConfig,
  saveCurrentProjectConfig,
  getCustomApiKeyStatus,
  normalizeApiKeyForConfig,
  setConfigForCLI,
  deleteConfigForCLI,
  getConfigForCLI,
  listConfigForCLI,
  enableConfigs,
} from '../utils/config.js'
import { cwd } from 'process'
import { dateToFilename, logError, parseLogFilename } from '../utils/log.js'
import { Onboarding } from '../components/Onboarding.js'
import { Doctor } from '../screens/Doctor.js'
import { ApproveApiKey } from '../components/ApproveApiKey.js'
import { TrustDialog } from '../components/TrustDialog.js'
import { checkHasTrustDialogAccepted } from '../utils/config.js'
import { isDefaultSlowAndCapableModel } from '../utils/model.js'
import { LogList } from '../screens/LogList.js'
import { ResumeConversation } from '../screens/ResumeConversation.js'
import { startMCPServer } from './mcp.js'
import { env } from '../utils/env.js'
import { getCwd, setCwd } from '../utils/state.js'
import { omit } from 'lodash-es'
import { getCommands } from '../commands.js'
import { getNextAvailableLogForkNumber, loadLogList } from '../utils/log.js'
import { loadMessagesFromLog } from '../utils/conversationRecovery.js'
import { cleanupOldMessageFilesInBackground } from '../utils/cleanup.js'
import {
  handleListApprovedTools,
  handleRemoveApprovedTool,
} from '../commands/approvedTools.js'
import {
  addMcpServer,
  getMcpServer,
  parseEnvVars,
  removeMcpServer,
  getClients,
  ensureConfigScope,
  describeMcpServer,
  gatherMcpServers,
  setMcpApprovalBypass,
} from '../services/mcpClient.js'
import { handleMcprcServerApprovals } from '../services/mcpServerApproval.js'
import { sandboxDownCommand, setupCommand } from '../commands/setup.js'
import { checkGate, initializeStatsig, logEvent } from '../services/statsig.js'
import { getExampleCommands } from '../utils/exampleCommands.js'
import { cursorShow } from 'ansi-escapes'
import {
  getLatestVersion,
  installGlobalPackage,
  assertMinVersion,
} from '../utils/autoUpdater.js'
import { CACHE_PATHS } from '../utils/log.js'
import { PersistentShell } from '../utils/PersistentShell.js'
import { GATE_USE_EXTERNAL_UPDATER } from '../constants/betas.js'
import { clearTerminal } from '../utils/terminal.js'
import { showInvalidConfigDialog } from '../components/InvalidConfigDialog.js'
import { ConfigParseError } from '../utils/errors.js'
import { grantReadPermissionForOriginalDir } from '../utils/permissions/filesystem.js'

export function completeOnboarding(): void {
  const config = getGlobalConfig()
  saveGlobalConfig({
    ...config,
    hasCompletedOnboarding: true,
    lastOnboardingVersion: MACRO.VERSION,
  })
}

async function showSetupScreens(
  dangerouslySkipPermissions?: boolean,
  print?: boolean,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  const config = getGlobalConfig()
  if (
    !config.theme ||
    !config.hasCompletedOnboarding // always show onboarding at least once
  ) {
    await clearTerminal()
    await new Promise<void>(resolve => {
      render(
        <Onboarding
          onDone={async () => {
            completeOnboarding()
            await clearTerminal()
            resolve()
          }}
        />,
        {
          exitOnCtrlC: false,
        },
      )
    })
  }

  // Check for custom API key (only allowed for ants)
  if (process.env.ANTHROPIC_API_KEY && process.env.USER_TYPE === 'ant') {
    const customApiKeyTruncated = normalizeApiKeyForConfig(
      process.env.ANTHROPIC_API_KEY!,
    )
    const keyStatus = getCustomApiKeyStatus(customApiKeyTruncated)
    if (keyStatus === 'new') {
      await new Promise<void>(resolve => {
        render(
          <ApproveApiKey
            customApiKeyTruncated={customApiKeyTruncated}
            onDone={async () => {
              await clearTerminal()
              resolve()
            }}
          />,
          {
            exitOnCtrlC: false,
          },
        )
      })
    }
  }

  // In non-interactive or dangerously-skip-permissions mode, skip the trust dialog
  if (!print && !dangerouslySkipPermissions) {
    if (!checkHasTrustDialogAccepted()) {
      await new Promise<void>(resolve => {
        const onDone = () => {
          // Grant read permission to the current working directory
          grantReadPermissionForOriginalDir()
          resolve()
        }
        render(<TrustDialog onDone={onDone} />, {
          exitOnCtrlC: false,
        })
      })
    }

    await handleMcprcServerApprovals()
  }
}

function logStartup(): void {
  const config = getGlobalConfig()
  saveGlobalConfig({
    ...config,
    numStartups: (config.numStartups ?? 0) + 1,
  })
}

async function setup(
  cwd: string,
  dangerouslySkipPermissions?: boolean,
): Promise<void> {
  // Don't await so we don't block startup
  setCwd(cwd)

  // Always grant read permissions for original working dir
  grantReadPermissionForOriginalDir()
  setMcpApprovalBypass(Boolean(dangerouslySkipPermissions))

  // If --dangerously-skip-permissions is set, verify we're in a safe environment
  if (dangerouslySkipPermissions) {
    // Check if running as root/sudo on Unix-like systems
    if (
      process.platform !== 'win32' &&
      typeof process.getuid === 'function' &&
      process.getuid() === 0
    ) {
      console.error(
        `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`,
      )
      process.exit(1)
    }

    // Only await if --dangerously-skip-permissions is set
    const [isDocker, hasInternet] = await Promise.all([
      env.getIsDocker(),
      env.hasInternetAccess(),
    ])

    if (!isDocker || hasInternet) {
      console.error(
        `--dangerously-skip-permissions can only be used in Docker containers with no internet access but got Docker: ${isDocker} and hasInternet: ${hasInternet}`,
      )
      process.exit(1)
    }
  }

  if (process.env.NODE_ENV === 'test') {
    return
  }

  cleanupOldMessageFilesInBackground()
  getExampleCommands() // Pre-fetch example commands
  getContext() // Pre-fetch all context data at once
  initializeStatsig() // Kick off statsig initialization

  // Migrate old iterm2KeyBindingInstalled config to new shiftEnterKeyBindingInstalled
  const globalConfig = getGlobalConfig()
  if (
    globalConfig.iterm2KeyBindingInstalled === true &&
    globalConfig.shiftEnterKeyBindingInstalled !== true
  ) {
    const updatedConfig = {
      ...globalConfig,
      shiftEnterKeyBindingInstalled: true,
    }
    // Remove the old config property
    delete updatedConfig.iterm2KeyBindingInstalled
    saveGlobalConfig(updatedConfig)
  }

  // Check for last session's cost and duration
  const projectConfig = getCurrentProjectConfig()
  if (
    projectConfig.lastCost !== undefined &&
    projectConfig.lastDuration !== undefined
  ) {
    logEvent('tengu_exit', {
      last_session_cost: String(projectConfig.lastCost),
      last_session_api_duration: String(projectConfig.lastAPIDuration),
      last_session_duration: String(projectConfig.lastDuration),
      last_session_id: projectConfig.lastSessionId,
    })
    // Clear the values after logging
    saveCurrentProjectConfig({
      ...projectConfig,
      lastCost: undefined,
      lastAPIDuration: undefined,
      lastDuration: undefined,
      lastSessionId: undefined,
    })
  }

  // Check auto-updater permissions
  if ((globalConfig.autoUpdaterStatus ?? 'disabled') === 'not_configured') {
    saveGlobalConfig({ ...getGlobalConfig(), autoUpdaterStatus: 'disabled' })
  }
}

async function main() {
  void startBackgroundSync()
  // Validate configs are valid and enable configuration system
  try {
    enableConfigs()
  } catch (error: unknown) {
    if (error instanceof ConfigParseError) {
      // Show the invalid config dialog with the error object
      await showInvalidConfigDialog({ error })
      return // Exit after handling the config error
    }
  }

  let inputPrompt = ''
  let renderContext: RenderOptions | undefined = {
    exitOnCtrlC: false,
  }

  if (
    !process.stdin.isTTY &&
    !process.env.CI &&
    // Input hijacking breaks MCP.
    !process.argv.includes('mcp')
  ) {
    inputPrompt = await stdin()
    if (process.platform !== 'win32') {
      try {
        const ttyFd = openSync('/dev/tty', 'r')
        renderContext = { ...renderContext, stdin: new ReadStream(ttyFd) }
      } catch (err) {
        logError(`Could not open /dev/tty: ${err}`)
      }
    }
  }
  await parseArgs(inputPrompt, renderContext)
}

async function parseArgs(
  stdinContent: string,
  renderContext: RenderOptions | undefined,
): Promise<Command> {
  const program = new Command()

  const renderContextWithExitOnCtrlC = {
    ...renderContext,
    exitOnCtrlC: true,
  }

  // Get the initial list of commands filtering based on user type
  const commands = await getCommands()

  // Format command list for help text (using same filter as in help.ts)
  const commandList = commands
    .filter(cmd => !cmd.isHidden)
    .map(cmd => `/${cmd.name} - ${cmd.description}`)
    .join('\n')

  program
    .name('OpenAgent')
    .description(
      `${PRODUCT_NAME} - starts an interactive session by default, use -p/--print for non-interactive output

Slash commands available during an interactive session:
${commandList}`,
    )
    .argument('[prompt]', 'Your prompt', String)
    .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
    .option('-d, --debug', 'Enable debug mode', () => true)
    .option(
      '--verbose',
      'Override verbose mode setting from config',
      () => true,
    )
    .option('--enable-architect', 'Enable the Architect tool', () => true)
    .option(
      '-p, --print',
      'Print response and exit (useful for pipes)',
      () => true,
    )
    .option(
      '--dangerously-skip-permissions',
      'Skip all permission checks. Only works in Docker containers with no internet access. Will crash otherwise.',
      () => true,
    )
    .option('--provider <provider>', 'anthropic, openai, compatible, or free')
    .option('--model <model>', 'Model id for this process')
    .option('--base-url <url>', 'OpenAI-compatible base URL')
    .option(
      '--local-base-url <url>',
      'OpenAI-compatible URL for the local model (default http://127.0.0.1:8080/v1)',
    )
    .option('--nvidia-api-key <key>', 'NVIDIA NIM API key for this process')
    .action(
      async (
        prompt,
        {
          cwd,
          debug,
          verbose,
          enableArchitect,
          print,
          dangerouslySkipPermissions,
          provider,
          model,
          baseUrl,
          localBaseUrl,
          nvidiaApiKey,
        },
      ) => {
        if (provider) process.env.OPENAGENT_PROVIDER = provider
        if (model) process.env.OPENAGENT_MODEL = model
        if (baseUrl) process.env.OPENAGENT_BASE_URL = baseUrl
        if (localBaseUrl) process.env.OPENAGENT_LOCAL_BASE_URL = localBaseUrl
        if (nvidiaApiKey) process.env.NVIDIA_API_KEY = nvidiaApiKey
        await showSetupScreens(dangerouslySkipPermissions, print)
        logEvent('tengu_init', {
          entrypoint: 'OpenAgent',
          hasInitialPrompt: Boolean(prompt).toString(),
          hasStdin: Boolean(stdinContent).toString(),
          enableArchitect: enableArchitect?.toString() ?? 'false',
          verbose: verbose?.toString() ?? 'false',
          debug: debug?.toString() ?? 'false',
          print: print?.toString() ?? 'false',
        })
        await setup(cwd, dangerouslySkipPermissions)

        assertMinVersion()

        const [tools, mcpClients] = await Promise.all([
          getTools(
            enableArchitect ?? getCurrentProjectConfig().enableArchitectTool,
          ),
          getClients(),
        ])
        logStartup()
        const inputPrompt = [prompt, stdinContent].filter(Boolean).join('\n')
        if (print) {
          if (!inputPrompt) {
            console.error(
              'Error: Input must be provided either through stdin or as a prompt argument when using --print',
            )
            process.exit(1)
          }

          addToHistory(inputPrompt)
          const { resultText: response } = await ask({
            commands,
            hasPermissionsToUseTool,
            messageLogName: dateToFilename(new Date()),
            prompt: inputPrompt,
            cwd,
            tools,
            dangerouslySkipPermissions,
          })
          console.log(response)
          process.exit(0)
        } else {
          const isDefaultModel = await isDefaultSlowAndCapableModel()

          render(
            <REPL
              commands={commands}
              debug={debug}
              initialPrompt={inputPrompt}
              messageLogName={dateToFilename(new Date())}
              shouldShowPromptInput={true}
              verbose={verbose}
              tools={tools}
              dangerouslySkipPermissions={dangerouslySkipPermissions}
              mcpClients={mcpClients}
              isDefaultModel={isDefaultModel}
            />,
            renderContext,
          )
        }
      },
    )
    .version(MACRO.VERSION, '-v, --version')

  // OpenAgent config
  const config = program
    .command('config')
    .description('Manage configuration (eg. OpenAgent config set -g theme dark)')

  config
    .command('get <key>')
    .description('Get a config value')
    .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
    .option('-g, --global', 'Use global config')
    .action(async (key, { cwd, global }) => {
      await setup(cwd, false)
      console.log(getConfigForCLI(key, global ?? false))
      process.exit(0)
    })

  config
    .command('set <key> <value>')
    .description('Set a config value')
    .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
    .option('-g, --global', 'Use global config')
    .action(async (key, value, { cwd, global }) => {
      await setup(cwd, false)
      setConfigForCLI(key, value, global ?? false)
      console.log(`Set ${key} to ${value}`)
      process.exit(0)
    })

  config
    .command('remove <key>')
    .description('Remove a config value')
    .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
    .option('-g, --global', 'Use global config')
    .action(async (key, { cwd, global }) => {
      await setup(cwd, false)
      deleteConfigForCLI(key, global ?? false)
      console.log(`Removed ${key}`)
      process.exit(0)
    })

  config
    .command('list')
    .description('List all config values')
    .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
    .option('-g, --global', 'Use global config', false)
    .action(async ({ cwd, global }) => {
      await setup(cwd, false)
      console.log(
        JSON.stringify(
          global ? listConfigForCLI(true) : listConfigForCLI(false),
          null,
          2,
        ),
      )
      process.exit(0)
    })

  // OpenAgent approved-tools

  const allowedTools = program
    .command('approved-tools')
    .description('Manage approved tools')

  allowedTools
    .command('list')
    .description('List all approved tools')
    .action(async () => {
      const result = handleListApprovedTools(getCwd())
      console.log(result)
      process.exit(0)
    })

  allowedTools
    .command('remove <tool>')
    .description('Remove a tool from the list of approved tools')
    .action(async (tool: string) => {
      const result = handleRemoveApprovedTool(tool)
      logEvent('tengu_approved_tool_remove', {
        tool,
        success: String(result.success),
      })
      console.log(result.message)
      process.exit(result.success ? 0 : 1)
    })

  // OpenAgent mcp

  const mcp = program
    .command('mcp')
    .description('Configure and manage MCP servers')

  mcp
    .command('serve')
    .description(`Start the ${PRODUCT_NAME} MCP server`)
    .action(async () => {
      const providedCwd = (program.opts() as { cwd?: string }).cwd ?? cwd()
      logEvent('tengu_mcp_start', { providedCwd })

      // Verify the directory exists
      if (!existsSync(providedCwd)) {
        console.error(`Error: Directory ${providedCwd} does not exist`)
        process.exit(1)
      }

      try {
        await setup(providedCwd, false)
        await startMCPServer(providedCwd)
      } catch (error) {
        console.error('Error: Failed to start MCP server:', error)
        process.exit(1)
      }
    })

  mcp
    .command('add-sse <name> <url>')
    .description('Add an SSE MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (project or global)',
      'project',
    )
    .action(async (name, url, options) => {
      try {
        const scope = ensureConfigScope(options.scope)
        logEvent('tengu_mcp_add', { name, type: 'sse', scope })

        addMcpServer(name, { type: 'sse', url }, scope)
        console.log(
          `Added SSE MCP server ${name} with URL ${url} to ${scope} config`,
        )
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('add-http <name> <url>')
    .description('Add a remote MCP server over streamable HTTP')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (project or global)',
      'project',
    )
    .option('-H, --header <header...>', 'HTTP header as Key=value')
    .action(async (name, url, options: { scope?: string; header?: string[] }) => {
      try {
        const scope = ensureConfigScope(options.scope)
        logEvent('tengu_mcp_add', { name, type: 'http', scope })
        addMcpServer(
          name,
          { type: 'http', url, headers: parseEnvVars(options.header) },
          scope,
        )
        console.log(`Added HTTP MCP server ${name} with URL ${url} to ${scope} config`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('add <name> <command> [args...]')
    .description('Add a stdio server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (project or global)',
      'project',
    )
    .option(
      '-e, --env <env...>',
      'Set environment variables (e.g. -e KEY=value)',
    )
    .action(async (name, command, args, options) => {
      try {
        const scope = ensureConfigScope(options.scope)
        logEvent('tengu_mcp_add', { name, type: 'stdio', scope })

        const env = parseEnvVars(options.env)
        addMcpServer(
          name,
          { type: 'stdio', command, args: args || [], env },
          scope,
        )

        console.log(
          `Added stdio MCP server ${name} with command: ${command} ${(args || []).join(' ')} to ${scope} config`,
        )
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })
  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (project, global, or mcprc)',
      'project',
    )
    .action(async (name: string, options: { scope?: string }) => {
      try {
        const scope = ensureConfigScope(options.scope)
        logEvent('tengu_mcp_delete', { name, scope })

        removeMcpServer(name, scope)
        console.log(`Removed MCP server ${name} from ${scope} config`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('list')
    .description('List configured MCP servers')
    .action(() => {
      logEvent('tengu_mcp_list', {})
      const servers = gatherMcpServers()
      if (servers.length === 0) {
        console.log(
          'No MCP servers configured. Use `openagent mcp add` to add a server, or add one to .mcp.json or .cursor/mcp.json.',
        )
      } else {
        for (const server of servers) {
          console.log(describeMcpServer(server))
        }
      }
      process.exit(0)
    })

  mcp
    .command('get <name>')
    .description('Get details about an MCP server')
    .action((name: string) => {
      logEvent('tengu_mcp_get', { name })
      const server = getMcpServer(name)
      if (!server) {
        console.error(`No MCP server found with name: ${name}`)
        process.exit(1)
      }
      console.log(`${name}:`)
      console.log(`  Scope: ${server.scope}`)
      if (server.source) {
        console.log(`  Source: ${server.source}`)
      }
      if ('url' in server) {
        console.log(`  Type: ${server.type}`)
        console.log(`  URL: ${server.url}`)
      } else {
        console.log(`  Type: stdio`)
        console.log(`  Command: ${server.command}`)
        console.log(`  Args: ${(server.args ?? []).join(' ')}`)
        if (server.env) {
          console.log('  Environment:')
          for (const [key, value] of Object.entries(server.env)) {
            console.log(`    ${key}=${value}`)
          }
        }
      }
      process.exit(0)
    })

  mcp
    .command('reset-mcprc-choices')
    .description('Reset approved and rejected project MCP servers')
    .action(() => {
      logEvent('tengu_mcp_reset_mcprc_choices', {})
      const config = getCurrentProjectConfig()
      saveCurrentProjectConfig({
        ...config,
        approvedMcprcServers: [],
        rejectedMcprcServers: [],
      })
      console.log('Project MCP server approvals have been reset.')
      console.log('You will be prompted for approval next time you start OpenAgent.')
      process.exit(0)
    })

  program
    .command('setup')
    .description('Build the sandbox image and start SearXNG')
    .option('--lang <langs>', 'Languages to install: ts,py,go,rust', 'ts,py')
    .action(async (options: { lang?: string }) => {
      try {
        await setupCommand(['--lang', options.lang ?? 'ts,py'])
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
      process.exit(0)
    })

  const sandbox = program.command('sandbox').description('Manage the sandbox containers')
  sandbox
    .command('down')
    .description('Stop sandbox sessions')
    .option('--all', 'Also stop SearXNG')
    .action(async (options: { all?: boolean }) => {
      await sandboxDownCommand(Boolean(options.all))
      process.exit(0)
    })

  // Doctor command - check installation health
  program
    .command('doctor')
    .description('Check the health of your OpenAgent Code auto-updater')
    .action(async () => {
      logEvent('tengu_doctor_command', {})

      await new Promise<void>(resolve => {
        render(<Doctor onDone={() => resolve()} doctorMode={true} />)
      })
      process.exit(0)
    })

  // ant-only commands
  if (process.env.USER_TYPE === 'ant') {
    // OpenAgent update
    program
      .command('update')
      .description('Check for updates and install if available')
      .action(async () => {
        const useExternalUpdater = await checkGate(GATE_USE_EXTERNAL_UPDATER)
        if (useExternalUpdater) {
          // The external updater intercepts calls to "OpenAgent update", which means if we have received
          // this command at all, the extenral updater isn't installed on this machine.
          console.log('This version of OpenAgent Code is no longer supported.')
          process.exit(0)
        }

        logEvent('tengu_update_check', {})
        console.log(`Current version: ${MACRO.VERSION}`)
        console.log('Checking for updates...')

        const latestVersion = await getLatestVersion()

        if (!latestVersion) {
          console.error('Failed to check for updates')
          process.exit(1)
        }

        if (latestVersion === MACRO.VERSION) {
          console.log(`${PRODUCT_NAME} is up to date`)
          process.exit(0)
        }

        console.log(`New version available: ${latestVersion}`)
        console.log('Installing update...')

        const status = await installGlobalPackage()

        switch (status) {
          case 'success':
            console.log(`Successfully updated to version ${latestVersion}`)
            break
          case 'no_permissions':
            console.error('Error: Insufficient permissions to install update')
            console.error('Try running with sudo or fix npm permissions')
            process.exit(1)
            break
          case 'install_failed':
            console.error('Error: Failed to install update')
            process.exit(1)
            break
          case 'in_progress':
            console.error(
              'Error: Another instance is currently performing an update',
            )
            console.error('Please wait and try again later')
            process.exit(1)
            break
        }
        process.exit(0)
      })

    // OpenAgent log
    program
      .command('log')
      .description('Manage conversation logs.')
      .argument(
        '[number]',
        'A number (0, 1, 2, etc.) to display a specific log',
        parseInt,
      )
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .action(async (number, { cwd }) => {
        await setup(cwd, false)
        logEvent('tengu_view_logs', { number: number?.toString() ?? '' })
        const context: { unmount?: () => void } = {}
        const { unmount } = render(
          <LogList context={context} type="messages" logNumber={number} />,
          renderContextWithExitOnCtrlC,
        )
        context.unmount = unmount
      })

    // OpenAgent resume
    program
      .command('resume')
      .description(
        'Resume a previous conversation. Optionally provide a number (0, 1, 2, etc.) or file path to resume a specific conversation.',
      )
      .argument(
        '[identifier]',
        'A number (0, 1, 2, etc.) or file path to resume a specific conversation',
      )
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .option(
        '--enable-architect',
        'Enable the Architect tool',
        () => true,
      )
      .option('-v, --verbose', 'Do not truncate message output', () => true)
      .option(
        '--dangerously-skip-permissions',
        'Skip all permission checks. Only works in Docker containers with no internet access. Will crash otherwise.',
        () => true,
      )
      .action(
        async (
          identifier,
          { cwd, enableArchitect, dangerouslySkipPermissions, verbose },
        ) => {
          await setup(cwd, dangerouslySkipPermissions)
          assertMinVersion()

          const [tools, commands, logs, mcpClients] = await Promise.all([
            getTools(
              enableArchitect ?? getCurrentProjectConfig().enableArchitectTool,
            ),
            getCommands(),
            loadLogList(CACHE_PATHS.messages()),
            getClients(),
          ])
          logStartup()

          // If a specific conversation is requested, load and resume it directly
          if (identifier !== undefined) {
            // Check if identifier is a number or a file path
            const number = Math.abs(parseInt(identifier))
            const isNumber = !isNaN(number)
            let messages, date, forkNumber
            try {
              if (isNumber) {
                logEvent('tengu_resume', { number: number.toString() })
                const log = logs[number]
                if (!log) {
                  console.error('No conversation found at index', number)
                  process.exit(1)
                }
                messages = await loadMessagesFromLog(log.fullPath, tools)
                ;({ date, forkNumber } = log)
              } else {
                // Handle file path case
                logEvent('tengu_resume', { filePath: identifier })
                if (!existsSync(identifier)) {
                  console.error('File does not exist:', identifier)
                  process.exit(1)
                }
                messages = await loadMessagesFromLog(identifier, tools)
                const pathSegments = identifier.split('/')
                const filename =
                  pathSegments[pathSegments.length - 1] ?? 'unknown'
                ;({ date, forkNumber } = parseLogFilename(filename))
              }
              const fork = getNextAvailableLogForkNumber(
                date,
                forkNumber ?? 1,
                0,
              )
              const isDefaultModel = await isDefaultSlowAndCapableModel()
              render(
                <REPL
                  initialPrompt=""
                  messageLogName={date}
                  initialForkNumber={fork}
                  shouldShowPromptInput={true}
                  verbose={verbose}
                  commands={commands}
                  tools={tools}
                  initialMessages={messages}
                  mcpClients={mcpClients}
                  isDefaultModel={isDefaultModel}
                />,
                { exitOnCtrlC: false },
              )
            } catch (error) {
              logError(`Failed to load conversation: ${error}`)
              process.exit(1)
            }
          } else {
            // Show the conversation selector UI
            const context: { unmount?: () => void } = {}
            const { unmount } = render(
              <ResumeConversation
                context={context}
                commands={commands}
                logs={logs}
                tools={tools}
                verbose={verbose}
              />,
              renderContextWithExitOnCtrlC,
            )
            context.unmount = unmount
          }
        },
      )

    // OpenAgent error
    program
      .command('error')
      .description(
        'View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.',
      )
      .argument(
        '[number]',
        'A number (0, 1, 2, etc.) to display a specific log',
        parseInt,
      )
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .action(async (number, { cwd }) => {
        await setup(cwd, false)
        logEvent('tengu_view_errors', { number: number?.toString() ?? '' })
        const context: { unmount?: () => void } = {}
        const { unmount } = render(
          <LogList context={context} type="errors" logNumber={number} />,
          renderContextWithExitOnCtrlC,
        )
        context.unmount = unmount
      })

    // OpenAgent context (TODO: deprecate)
    const context = program
      .command('context')
      .description(
        'Set static context (eg. OpenAgent context add-file ./src/*.py)',
      )

    context
      .command('get <key>')
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .description('Get a value from context')
      .action(async (key, { cwd }) => {
        await setup(cwd, false)
        logEvent('tengu_context_get', { key })
        const context = omit(
          await getContext(),
          'codeStyle',
          'directoryStructure',
        )
        console.log(context[key])
        process.exit(0)
      })

    context
      .command('set <key> <value>')
      .description('Set a value in context')
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .action(async (key, value, { cwd }) => {
        await setup(cwd, false)
        logEvent('tengu_context_set', { key })
        setContext(key, value)
        console.log(`Set context.${key} to "${value}"`)
        process.exit(0)
      })

    context
      .command('list')
      .description('List all context values')
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .action(async ({ cwd }) => {
        await setup(cwd, false)
        logEvent('tengu_context_list', {})
        const context = omit(
          await getContext(),
          'codeStyle',
          'directoryStructure',
          'gitStatus',
        )
        console.log(JSON.stringify(context, null, 2))
        process.exit(0)
      })

    context
      .command('remove <key>')
      .description('Remove a value from context')
      .option('-c, --cwd <cwd>', 'The current working directory', String, cwd())
      .action(async (key, { cwd }) => {
        await setup(cwd, false)
        logEvent('tengu_context_delete', { key })
        removeContext(key)
        console.log(`Removed context.${key}`)
        process.exit(0)
      })
  }

  await program.parseAsync(process.argv)
  return program
}

// TODO: stream?
async function stdin() {
  if (process.stdin.isTTY) {
    return ''
  }

  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

process.on('exit', () => {
  resetCursor()
  PersistentShell.closeAll()
})

process.on('SIGINT', () => {
  process.exit(0)
})

function resetCursor() {
  const terminal = process.stderr.isTTY
    ? process.stderr
    : process.stdout.isTTY
      ? process.stdout
      : undefined
  terminal?.write(`\u001B[?25h${cursorShow}`)
}

main()
