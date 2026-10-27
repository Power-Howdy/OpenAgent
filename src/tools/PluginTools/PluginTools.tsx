import { mkdtempSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { readManifests, type PluginManifest } from '../../services/plugins.js'
import { runInSandbox, sandboxReady, SETUP_HINT } from '../../services/runtime.js'
import { getCwd } from '../../utils/state.js'

export function pluginTools(): Tool[] {
  const dirs = [join(homedir(), '.OpenAgent', 'plugins'), join(getCwd(), '.openagent', 'tools')]
  const seen = new Set<string>()
  const tools: Tool[] = []
  for (const dir of dirs) {
    for (const manifest of readManifests(dir)) {
      if (seen.has(manifest.name)) continue
      seen.add(manifest.name)
      tools.push(pluginTool(manifest))
    }
  }
  return tools
}

function pluginTool(manifest: PluginManifest): Tool {
  const schema = z.object({}).passthrough()
  return {
    name: manifest.name,
    userFacingName: () => manifest.name,
    description: async () => manifest.description,
    prompt: async () => manifest.description,
    inputSchema: schema,
    isReadOnly: () => manifest.readonly,
    isEnabled() {
      return true
    },
    needsPermissions: () => !manifest.readonly,
    async *call(input: Record<string, unknown>) {
      if (!(await sandboxReady())) {
        yield { type: 'result' as const, data: SETUP_HINT, resultForAssistant: SETUP_HINT }
        return
      }
      const dir = mkdtempSync(join(tmpdir(), 'openagent-plugin-'))
      const file = join(dir, 'args.json')
      writeFileSync(file, JSON.stringify(input))
      const result = await runInSandbox({
        argv: [...manifest.argv, '/args.json'],
        network: 'none',
        timeoutMs: 30_000,
        readonly: manifest.readonly,
        mounts: [{ host: file, guest: '/args.json', readonly: true }],
      })
      const text = `${result.stdout}${result.stderr}`.trim() || `exit ${result.code}`
      yield { type: 'result' as const, data: text, resultForAssistant: text }
    },
    renderToolUseMessage() {
      return manifest.name
    },
    renderToolResultMessage(output: string) {
      return <Text>{String(output)}</Text>
    },
  }
}
