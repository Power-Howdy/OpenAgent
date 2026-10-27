import React, { useState, useEffect } from 'react'
import { Box, Text, useInput, Newline } from 'ink'
import { Command } from '../commands.js'
import {
  getPermissionMode,
  permissionModeLabel,
  setPermissionMode,
  parsePermissionMode,
  type PermissionLevel,
} from '../services/permissionMode.js'
import { getTheme } from '../utils/theme.js'

const PERMISSION_LEVELS: PermissionLevel[] = ['manual', 'acceptEdits', 'auto', 'bypass']

function PermissionSelector({
  onDone,
}: {
  onDone: (result: string) => void
}) {
  const [selected, setSelected] = useState(0)
  const theme = getTheme()
  const currentMode = getPermissionMode()

  useEffect(() => {
    const idx = PERMISSION_LEVELS.indexOf(currentMode)
    if (idx >= 0) setSelected(idx)
  }, [currentMode])

  useInput((_, key) => {
    if (key.upArrow) {
      setSelected((prev) => (prev <= 0 ? PERMISSION_LEVELS.length - 1 : prev - 1))
      return true
    }
    if (key.downArrow) {
      setSelected((prev) => (prev >= PERMISSION_LEVELS.length - 1 ? 0 : prev + 1))
      return true
    }
    if (key.return || key.tab) {
      setPermissionMode(PERMISSION_LEVELS[selected])
      onDone(`Permission level is ${permissionModeLabel(PERMISSION_LEVELS[selected])}.`)
      return true
    }
    if (key.escape) {
      onDone(`Permission level is ${permissionModeLabel(currentMode)}.`)
      return true
    }
    const num = Number((key as { key?: string }).key)
    if (num >= 1 && num <= 4) {
      setSelected(num - 1)
      setPermissionMode(PERMISSION_LEVELS[num - 1])
      onDone(`Permission level is ${permissionModeLabel(PERMISSION_LEVELS[num - 1])}.`)
      return true
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color={theme.permission}>Select permission level:</Text>
      <Newline />
      {PERMISSION_LEVELS.map((level, idx) => (
        <Box key={level} flexDirection="row" alignItems="center">
          <Text color={idx === selected ? theme.suggestion : undefined}>
            {idx + 1}. {permissionModeLabel(level)}
          </Text>
          {level === currentMode && (
            <Text color={theme.success} dimColor> (current)</Text>
          )}
        </Box>
      ))}
      <Newline />
      <Text dimColor>Use ↑/↓ arrows, 1-4 keys, or Enter/Tab to select. Esc to cancel.</Text>
    </Box>
  )
}

const permissions = {
  type: 'local-jsx',
  name: 'permissions',
  description:
    'Set the permission level: manual, auto, accept edits, or bypass permissions',
  isEnabled: true,
  isHidden: false,
  async call(onDone) {
    return <PermissionSelector onDone={onDone} />
  },
  userFacingName() {
    return 'permissions'
  },
} satisfies Command

export default permissions
