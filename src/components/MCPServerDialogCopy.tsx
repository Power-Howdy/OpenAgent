import React from 'react'
import { Text } from 'ink'
import Link from 'ink-link'

export function MCPServerDialogCopy(): React.ReactNode {
  return (
    <>
      <Text>
        MCP servers provide additional functionality to OpenAgent. They may execute
        code, make network requests, or access system resources via tool calls.
        All tool calls will require your explicit approval before execution. For
        more information, see{' '}
        <Link url="https://docs.anthropic.com/s/OpenAgent-code-mcp">
          MCP documentation
        </Link>
      </Text>

      <Text dimColor>
        You can change these choices later with `openagent mcp reset-mcprc-choices`.
      </Text>
    </>
  )
}
