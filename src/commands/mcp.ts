import type { Command } from '../commands.js'
import { describeMcpServer, gatherMcpServers } from '../services/mcpClient.js'

const mcp = {
  type: 'local',
  name: 'mcp',
  description: 'List MCP servers from this project and your user config',
  isEnabled: true,
  isHidden: false,
  async call() {
    const servers = gatherMcpServers()
    if (!servers.length) return 'No MCP servers configured.'
    return servers.map(describeMcpServer).join('\n')
  },
  userFacingName() {
    return 'mcp'
  },
} satisfies Command

export default mcp
