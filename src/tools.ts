import { Tool } from './Tool.js'
import { AgentTool } from './tools/AgentTool/AgentTool.js'
import { ArchitectTool } from './tools/ArchitectTool/ArchitectTool.js'
import { BashTool } from './tools/BashTool/BashTool.js'
import { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
import { GrepTool } from './tools/GrepTool/GrepTool.js'
import { LSTool } from './tools/lsTool/lsTool.js'
import { MemoryReadTool } from './tools/MemoryReadTool/MemoryReadTool.js'
import { MemoryWriteTool } from './tools/MemoryWriteTool/MemoryWriteTool.js'
import { NotebookEditTool } from './tools/NotebookEditTool/NotebookEditTool.js'
import { NotebookReadTool } from './tools/NotebookReadTool/NotebookReadTool.js'
import { ThinkTool } from './tools/ThinkTool/ThinkTool.js'
import {
  ListStoredToolsTool,
  RunStoredToolTool,
  SaveStoredToolTool,
} from './tools/StoredTools/StoredTools.js'
import {
  ListBlueprintsTool,
  ReadBlueprintTool,
  SaveBlueprintTool,
} from './tools/BlueprintTools/BlueprintTools.js'
import { CheckTool } from './tools/CheckTool/CheckTool.js'
import { DepsTool } from './tools/DepsTool/DepsTool.js'
import { DiagramTool } from './tools/DiagramTool/DiagramTool.js'
import { DebugTool } from './tools/DebugTool/DebugTool.js'
import { GitHubTool } from './tools/GitHubTool/GitHubTool.js'
import { HttpTool } from './tools/HttpTool/HttpTool.js'
import { LspTool } from './tools/LspTool/LspTool.js'
import { PackageTool } from './tools/PackageTool/PackageTool.js'
import { pluginTools } from './tools/PluginTools/PluginTools.js'
import { ProfileTool } from './tools/ProfileTool/ProfileTool.js'
import { RunCodeTool } from './tools/RunCode/RunCode.js'
import { SqlTool } from './tools/SqlTool/SqlTool.js'
import { TestTool } from './tools/TestTool/TestTool.js'
import { TodoReadTool, TodoWriteTool } from './tools/TodoWrite/TodoWrite.js'
import { DocsTool, WebFetchTool } from './tools/WebFetch/WebFetch.js'
import { WebSearchTool } from './tools/WebSearch/WebSearch.js'
import { getMCPTools } from './services/mcpClient.js'
import { memoize } from 'lodash-es'

export const getAllTools = (): Tool[] => {
  return [
    AgentTool,
    BashTool,
    GlobTool,
    GrepTool,
    LSTool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookReadTool,
    NotebookEditTool,
    ThinkTool,
    MemoryReadTool,
    MemoryWriteTool,
    ListStoredToolsTool,
    RunStoredToolTool,
    SaveStoredToolTool,
    ListBlueprintsTool,
    ReadBlueprintTool,
    SaveBlueprintTool,
    TodoWriteTool,
    TodoReadTool,
    WebSearchTool,
    WebFetchTool,
    DocsTool,
    RunCodeTool,
    TestTool,
    CheckTool,
    PackageTool,
    HttpTool,
    GitHubTool,
    DepsTool,
    LspTool,
    DebugTool,
    SqlTool,
    ProfileTool,
    DiagramTool,
  ]
}

export const getTools = memoize(
  async (enableArchitect?: boolean): Promise<Tool[]> => {
    const tools = [...getAllTools(), ...pluginTools(), ...(await getMCPTools())]

    // Only include Architect tool if enabled via config or CLI flag
    if (enableArchitect) {
      tools.push(ArchitectTool)
    }

    const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled?.() ?? true))
    return tools.filter((_, i) => isEnabled[i])
  },
)

export const getReadOnlyTools = memoize(async (): Promise<Tool[]> => {
  const tools = getAllTools().filter(tool => tool.isReadOnly())
  const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled?.() ?? true))
  return tools.filter((_, index) => isEnabled[index])
})
