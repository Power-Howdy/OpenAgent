import { Text } from 'ink'
import * as React from 'react'
import { z } from 'zod'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage.js'
import { setPlanMode } from '../../services/planMode.js'
import { Tool } from '../../Tool.js'

const inputSchema = z.strictObject({
  plan: z
    .string()
    .describe(
      'Markdown plan for the user: files to change, the approach, and how to verify. Do not implement it in this call.',
    ),
})

export const ExitPlanModeTool = {
  name: 'ExitPlanMode',
  async description() {
    return 'Show the plan and wait for the user to approve it before any edit'
  },
  async prompt() {
    return 'Call this when plan mode research is done. Put the full plan in the plan field. Do not edit files in the same turn.'
  },
  inputSchema,
  userFacingName() {
    return 'Plan'
  },
  async isEnabled() {
    return true
  },
  isReadOnly() {
    return false
  },
  needsPermissions() {
    return true
  },
  renderToolUseMessage({ plan }) {
    const line = plan.split('\n').find(part => part.trim()) ?? 'Plan'
    return line.slice(0, 120)
  },
  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },
  renderResultForAssistant({ plan }) {
    return plan
  },
  async *call(input, context) {
    setPlanMode(false)
    const allTools = context.options.allTools
    if (Array.isArray(allTools)) context.options.tools = allTools
    yield {
      type: 'result' as const,
      data: { plan: input.plan, approved: true },
      resultForAssistant: `The user approved this plan. Plan mode is off. Implement it now.\n\n${input.plan}`,
    }
  },
  renderToolResultMessage() {
    return <Text>Plan approved. Implementing.</Text>
  },
} satisfies Tool<typeof inputSchema, { plan: string; approved: boolean }>
