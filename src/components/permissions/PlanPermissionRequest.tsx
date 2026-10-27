import { Box, Text, useInput } from 'ink'
import { Select } from '@inkjs/ui'
import React from 'react'
import { getTheme } from '../../utils/theme.js'
import { type ToolUseConfirm } from './PermissionRequest.js'

type Props = {
  toolUseConfirm: ToolUseConfirm
  onDone(): void
  verbose: boolean
}

export function PlanPermissionRequest({
  toolUseConfirm,
  onDone,
}: Props): React.ReactNode {
  const theme = getTheme()
  const plan = String(toolUseConfirm.input.plan ?? '')
  const lines = plan.split('\n')
  const shown = lines.slice(0, 40).join('\n')
  const hidden = lines.length - 40

  useInput((_, key) => {
    if (key.escape) {
      toolUseConfirm.onReject()
      onDone()
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.permission}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
      paddingBottom={1}
    >
      <Text bold color={theme.permission}>
        Plan
      </Text>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{shown || 'Empty plan'}</Text>
        {hidden > 0 && (
          <Text color={theme.secondaryText}>{`… ${hidden} more lines`}</Text>
        )}
      </Box>
      <Text>Approve this plan?</Text>
      <Select
        options={[
          { label: 'Yes, implement this plan', value: 'yes' },
          { label: 'No, keep planning', value: 'no' },
        ]}
        onChange={value => {
          if (value === 'yes') toolUseConfirm.onAllow('temporary')
          else toolUseConfirm.onReject()
          onDone()
        }}
      />
    </Box>
  )
}
