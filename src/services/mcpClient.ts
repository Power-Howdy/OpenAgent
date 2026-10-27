import { zipObject } from 'lodash-es'
import {
  getCurrentProjectConfig,
  McpServerConfig,
  saveCurrentProjectConfig,
  getGlobalConfig,
  saveGlobalConfig,
  getMcprcConfig,
  addMcprcServerForTesting,
  removeMcprcServerForTesting,
} from '../utils/config.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getCwd } from '../utils/state.js'
import { safeParseJSON } from '../utils/json.js'
import {
  ImageBlockParam,
  MessageParam,
  ToolResultBlockParam,
} from '../types/api.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  PROJECT_MCP_FILES,
  USER_MCP_FILES,
  normalizeServerEntry,
  readMcpFiles,
  toMcpServerConfig,
} from './mcpConfig.js'
import {
  CallToolResultSchema,
  ClientRequest,
  ListPromptsResult,
  ListPromptsResultSchema,
  ListToolsResult,
  ListToolsResultSchema,
  Result,
  ResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { memoize } from 'lodash-es'
import { homedir } from 'os'
import type { Tool } from '../Tool.js'
import { MCPTool } from '../tools/MCPTool/MCPTool.js'
import { logMCPError } from '../utils/log.js'
import { Command } from '../commands.js'
import { logEvent } from '../services/statsig.js'

type McpName = string

export function parseEnvVars(
  rawEnvArgs: string[] | undefined,
): Record<string, string> {
  const parsedEnv: Record<string, string> = {}

  // Parse individual env vars
  if (rawEnvArgs) {
    for (const envStr of rawEnvArgs) {
      const [key, ...valueParts] = envStr.split('=')
      if (!key || valueParts.length === 0) {
        throw new Error(
          `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
        )
      }
      parsedEnv[key] = valueParts.join('=')
    }
  }
  return parsedEnv
}

const VALID_SCOPES = ['project', 'global', 'mcprc'] as const
type ConfigScope = (typeof VALID_SCOPES)[number]
const EXTERNAL_SCOPES = ['project', 'global'] as ConfigScope[]

export function ensureConfigScope(scope?: string): ConfigScope {
  if (!scope) return 'project'

  const scopesToCheck =
    process.env.USER_TYPE === 'external' ? EXTERNAL_SCOPES : VALID_SCOPES

  if (!scopesToCheck.includes(scope as ConfigScope)) {
    throw new Error(
      `Invalid scope: ${scope}. Must be one of: ${scopesToCheck.join(', ')}`,
    )
  }

  return scope as ConfigScope
}

export function addMcpServer(
  name: McpName,
  server: McpServerConfig,
  scope: ConfigScope = 'project',
): void {
  if (scope === 'mcprc') {
    if (process.env.NODE_ENV === 'test') {
      addMcprcServerForTesting(name, server)
    } else {
      const mcprcPath = join(getCwd(), '.mcprc')
      let mcprcConfig: Record<string, McpServerConfig> = {}

      // Read existing config if present
      if (existsSync(mcprcPath)) {
        try {
          const mcprcContent = readFileSync(mcprcPath, 'utf-8')
          const existingConfig = safeParseJSON(mcprcContent)
          if (existingConfig && typeof existingConfig === 'object') {
            mcprcConfig = existingConfig as Record<string, McpServerConfig>
          }
        } catch {
          // If we can't read/parse, start with empty config
        }
      }

      // Add the server
      mcprcConfig[name] = server

      // Write back to .mcprc
      try {
        writeFileSync(mcprcPath, JSON.stringify(mcprcConfig, null, 2), 'utf-8')
      } catch (error) {
        throw new Error(`Failed to write to .mcprc: ${error}`)
      }
    }
  } else if (scope === 'global') {
    const config = getGlobalConfig()
    if (!config.mcpServers) {
      config.mcpServers = {}
    }
    config.mcpServers[name] = server
    saveGlobalConfig(config)
  } else {
    const config = getCurrentProjectConfig()
    if (!config.mcpServers) {
      config.mcpServers = {}
    }
    config.mcpServers[name] = server
    saveCurrentProjectConfig(config)
  }
}

export function removeMcpServer(
  name: McpName,
  scope: ConfigScope = 'project',
): void {
  if (scope === 'mcprc') {
    if (process.env.NODE_ENV === 'test') {
      removeMcprcServerForTesting(name)
    } else {
      const mcprcPath = join(getCwd(), '.mcprc')
      if (!existsSync(mcprcPath)) {
        throw new Error('No .mcprc file found in this directory')
      }

      try {
        const mcprcContent = readFileSync(mcprcPath, 'utf-8')
        const mcprcConfig = safeParseJSON(mcprcContent) as Record<
          string,
          McpServerConfig
        > | null

        if (
          !mcprcConfig ||
          typeof mcprcConfig !== 'object' ||
          !mcprcConfig[name]
        ) {
          throw new Error(`No MCP server found with name: ${name} in .mcprc`)
        }

        delete mcprcConfig[name]
        writeFileSync(mcprcPath, JSON.stringify(mcprcConfig, null, 2), 'utf-8')
      } catch (error) {
        if (error instanceof Error) {
          throw error
        }
        throw new Error(`Failed to remove from .mcprc: ${error}`)
      }
    }
  } else if (scope === 'global') {
    const config = getGlobalConfig()
    if (!config.mcpServers?.[name]) {
      throw new Error(`No global MCP server found with name: ${name}`)
    }
    delete config.mcpServers[name]
    saveGlobalConfig(config)
  } else {
    const config = getCurrentProjectConfig()
    if (!config.mcpServers?.[name]) {
      throw new Error(`No local MCP server found with name: ${name}`)
    }
    delete config.mcpServers[name]
    saveCurrentProjectConfig(config)
  }
}

export function listMCPServers(): Record<string, McpServerConfig> {
  return Object.fromEntries(gatherMcpServers().map(server => [server.name, server.config]))
}

export type ScopedMcpServerConfig = McpServerConfig & {
  scope: ConfigScope
  source?: string
}

export type ListedMcpServer = {
  name: string
  config: McpServerConfig
  where: string
  trusted: boolean
}

let mcpApprovalBypass = false

export function setMcpApprovalBypass(enabled: boolean): void {
  mcpApprovalBypass = enabled
}

export function gatherMcpServers(): ListedMcpServer[] {
  const map = new Map<string, ListedMcpServer>()
  const put = (item: ListedMcpServer) => map.set(item.name, item)
  if (process.env.NODE_ENV !== 'test') {
    for (const server of readMcpFiles(homedir(), USER_MCP_FILES)) {
      put({
        name: server.name,
        config: toMcpServerConfig(server),
        where: server.source,
        trusted: true,
      })
    }
  }
  for (const [name, config] of Object.entries(getGlobalConfig().mcpServers ?? {})) {
    put({ name, config, where: 'global', trusted: true })
  }
  const projectFiles: ListedMcpServer[] =
    process.env.NODE_ENV === 'test'
      ? Object.entries(getMcprcConfig()).map(([name, config]) => ({
          name,
          config: config as McpServerConfig,
          where: '.mcprc',
          trusted: false,
        }))
      : readMcpFiles(getCwd(), PROJECT_MCP_FILES).map(server => ({
          name: server.name,
          config: toMcpServerConfig(server),
          where: server.source,
          trusted: false,
        }))
  for (const item of projectFiles) put(item)
  for (const [name, config] of Object.entries(getCurrentProjectConfig().mcpServers ?? {})) {
    put({ name, config, where: 'project', trusted: true })
  }
  return [...map.values()]
}

export function shouldConnectMcpServer(server: ListedMcpServer): boolean {
  if (server.trusted) return true
  const status = getMcprcServerStatus(server.name)
  if (status === 'approved') return true
  return status === 'pending' && mcpApprovalBypass
}

export function pendingProjectMcpNames(): string[] {
  return gatherMcpServers()
    .filter(server => !server.trusted && getMcprcServerStatus(server.name) === 'pending')
    .map(server => server.name)
}

export function describeMcpServer(server: ListedMcpServer): string {
  const config = server.config
  const detail = 'url' in config ? config.url : `${config.command} ${(config.args ?? []).join(' ')}`.trim()
  const kind = 'url' in config ? config.type : 'stdio'
  const status = server.trusted ? 'enabled' : getMcprcServerStatus(server.name)
  return `${server.name}: ${detail} (${kind}, ${server.where}, ${status})`
}

export function getMcpServer(name: McpName): ScopedMcpServerConfig | undefined {
  const found = gatherMcpServers().find(server => server.name === name)
  if (!found) return undefined
  const scope: ConfigScope =
    found.where === 'global' ? 'global' : found.where === 'project' ? 'project' : 'mcprc'
  return { ...found.config, scope, source: found.where }
}

async function connectToServer(
  name: string,
  serverRef: McpServerConfig,
): Promise<Client> {
  const normalized = normalizeServerEntry(serverRef)
  if (!normalized) {
    throw new Error(`Invalid MCP server config for "${name}"`)
  }
  const headers = normalized.headers
  const requestInit = headers ? { headers } : undefined
  const transport =
    normalized.transport === 'sse'
      ? new SSEClientTransport(new URL(normalized.url ?? ''), { requestInit })
      : normalized.transport === 'http'
        ? new StreamableHTTPClientTransport(new URL(normalized.url ?? ''), { requestInit })
        : new StdioClientTransport({
            command: normalized.command ?? '',
            args: normalized.args,
            env: {
              ...process.env,
              ...normalized.env,
            } as Record<string, string>,
            stderr: 'pipe',
          })

  const client = new Client(
    {
      name: 'OpenAgent',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  )

  // Add a timeout to connection attempts to prevent tests from hanging indefinitely
  const CONNECTION_TIMEOUT_MS = 20000
  const connectPromise = client.connect(transport)
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Connection to MCP server "${name}" timed out after ${CONNECTION_TIMEOUT_MS}ms`,
        ),
      )
    }, CONNECTION_TIMEOUT_MS)

    // Clean up timeout if connect resolves or rejects
    connectPromise.then(
      () => clearTimeout(timeoutId),
      () => clearTimeout(timeoutId),
    )
  })

  await Promise.race([connectPromise, timeoutPromise])

  if (serverRef.type === 'stdio') {
    ;(transport as StdioClientTransport).stderr?.on('data', (data: Buffer) => {
      const errorText = data.toString().trim()
      if (errorText) {
        logMCPError(name, `Server stderr: ${errorText}`)
      }
    })
  }
  return client
}

type ConnectedClient = {
  client: Client
  name: string
  type: 'connected'
}
type FailedClient = {
  name: string
  type: 'failed'
}
export type WrappedClient = ConnectedClient | FailedClient

export function getMcprcServerStatus(
  serverName: string,
): 'approved' | 'rejected' | 'pending' {
  const config = getCurrentProjectConfig()
  if (config.approvedMcprcServers?.includes(serverName)) {
    return 'approved'
  }
  if (config.rejectedMcprcServers?.includes(serverName)) {
    return 'rejected'
  }
  return 'pending'
}

export const getClients = memoize(async (): Promise<WrappedClient[]> => {
  // TODO: This is a temporary fix for a hang during npm run verify in CI.
  // We need to investigate why MCP client connections hang in CI verify but not in CI tests.
  if (process.env.CI && process.env.NODE_ENV !== 'test') {
    return []
  }

  const allServers = Object.fromEntries(
    gatherMcpServers()
      .filter(shouldConnectMcpServer)
      .map(server => [server.name, server.config]),
  )

  return await Promise.all(
    Object.entries(allServers).map(async ([name, serverRef]) => {
      try {
        const client = await connectToServer(name, serverRef as never)
        logEvent('tengu_mcp_server_connection_succeeded', {})
        return { name, client, type: 'connected' as const }
      } catch (error) {
        logEvent('tengu_mcp_server_connection_failed', {})
        logMCPError(
          name,
          `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        return { name, type: 'failed' as const }
      }
    }),
  )
})

async function requestAll<
  ResultT extends Result,
  ResultSchemaT extends typeof ResultSchema,
>(
  req: ClientRequest,
  resultSchema: ResultSchemaT,
  requiredCapability: string,
): Promise<{ client: ConnectedClient; result: ResultT }[]> {
  const clients = await getClients()
  const results = await Promise.allSettled(
    clients.map(async client => {
      if (client.type === 'failed') return null

      try {
        const capabilities = await client.client.getServerCapabilities()
        if (!capabilities?.[requiredCapability]) {
          return null
        }
        return {
          client,
          result: (await client.client.request(req, resultSchema)) as ResultT,
        }
      } catch (error) {
        if (client.type === 'connected') {
          logMCPError(
            client.name,
            `Failed to request '${req.method}': ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        return null
      }
    }),
  )
  return results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<{
        client: ConnectedClient
        result: ResultT
      } | null> => result.status === 'fulfilled',
    )
    .map(result => result.value)
    .filter(
      (result): result is { client: ConnectedClient; result: ResultT } =>
        result !== null,
    )
}

export async function getMCPTools(): Promise<Tool[]> {
  const toolsList = await requestAll<
    ListToolsResult,
    typeof ListToolsResultSchema
  >(
    {
      method: 'tools/list',
    },
    ListToolsResultSchema,
    'tools',
  )

  // TODO: Add zod schema validation
  return toolsList.flatMap(({ client, result: { tools } }) =>
    tools.map(
      (tool): Tool => ({
        ...MCPTool,
        name: 'mcp__' + client.name + '__' + tool.name,
        async description() {
          return tool.description ?? ''
        },
        async prompt() {
          return tool.description ?? ''
        },
        inputJSONSchema: (tool.inputSchema as Tool['inputJSONSchema']) ?? {
          type: 'object',
          properties: {},
        },
        isReadOnly() {
          return tool.annotations?.readOnlyHint === true
        },
        async *call(args: Record<string, unknown>) {
          const data = await callMCPTool({ client, tool: tool.name, args })
          yield {
            type: 'result' as const,
            data,
            resultForAssistant: data,
          }
        },
        userFacingName() {
          return `${client.name}:${tool.name} (MCP)`
        },
      }),
    ),
  )
}

async function callMCPTool({
  client: { client, name },
  tool,
  args,
}: {
  client: ConnectedClient
  tool: string
  args: Record<string, unknown>
}): Promise<ToolResultBlockParam['content']> {
  const result = await client.callTool(
    {
      name: tool,
      arguments: args,
    },
    CallToolResultSchema,
  )

  if ('isError' in result && result.isError) {
    const errorMessage = `Error calling tool ${tool}: ${result.error}`
    logMCPError(name, errorMessage)
    throw Error(errorMessage)
  }

  // Handle toolResult-type response
  if ('toolResult' in result) {
    return String(result.toolResult)
  }

  // Handle content array response
  if ('content' in result && Array.isArray(result.content)) {
    return (result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>).map(item => {
      if (item.type === 'image') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            data: String(item.data),
            media_type: item.mimeType as ImageBlockParam.Source['media_type'],
          },
        }
      }
      return {
        type: 'text' as const,
        text: item.text ?? '',
      }
    })
  }

  throw Error(`Unexpected response format from tool ${tool}`)
}

export const getMCPCommands = memoize(async (): Promise<Command[]> => {
  const results = await requestAll<
    ListPromptsResult,
    typeof ListPromptsResultSchema
  >(
    {
      method: 'prompts/list',
    },
    ListPromptsResultSchema,
    'prompts',
  )

  return results.flatMap(({ client, result }) =>
    result.prompts?.map(_ => {
      const argNames = Object.values(_.arguments ?? {}).map(k => k.name)
      return {
        type: 'prompt',
        name: 'mcp__' + client.name + '__' + _.name,
        description: _.description ?? '',
        isEnabled: true,
        isHidden: false,
        progressMessage: 'running',
        userFacingName() {
          return `${client.name}:${_.name} (MCP)`
        },
        argNames,
        async getPromptForCommand(args: string) {
          const argsArray = args.split(' ')
          return await runCommand(
            { name: _.name, client },
            zipObject(argNames, argsArray),
          )
        },
      }
    }),
  )
})

export async function runCommand(
  { name, client }: { name: string; client: ConnectedClient },
  args: Record<string, string>,
): Promise<MessageParam[]> {
  try {
    const result = await client.client.getPrompt({ name, arguments: args })
    // TODO: Support type == resource
    return result.messages.map(
      (message): MessageParam => ({
        role: message.role,
        content: [
          message.content.type === 'text'
            ? {
                type: 'text',
                text: message.content.text,
              }
            : {
                type: 'image',
                source: {
                  data: String(
                    (message.content as { data?: string }).data ?? '',
                  ),
                  media_type: (message.content as { mimeType?: string })
                    .mimeType as ImageBlockParam.Source['media_type'],
                  type: 'base64',
                },
              },
        ],
      }),
    )
  } catch (error) {
    logMCPError(
      client.name,
      `Error running command '${name}': ${error instanceof Error ? error.message : String(error)}`,
    )
    throw error
  }
}
