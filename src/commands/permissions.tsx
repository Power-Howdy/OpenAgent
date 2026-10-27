import { Box, Text, useInput } from 'ink'
import React from 'react'
import { Command } from '../commands.js'
import { Select } from '../components/CustomSelect/index.js'
import {
  getPermissionMode,
  parsePermissionMode,
  permissionModeLabel,
  setPermissionMode,
  type PermissionLevel,
} from '../services/permissionMode.js'

const LEVELS: { id: PermissionLevel; detail: string }[] = [
  { id: 'manual', detail: 'Ask before every tool' },
  { id: 'acceptEdits', detail: 'Approve project edits. Ask for shell and other tools' },
  { id: 'auto', detail: 'Approve edits, reads, and inspection commands' },
  { id: 'bypass', detail: 'Approve every tool. A plan still waits for you' },
]

function applyMode(requested: string): string {
  const mode = parsePermissionMode(requested)
  if (!mode) {
    return `Unknown permission level "${requested}". Choose manual, accept edits, auto, or bypass.`
  }
  setPermissionMode(mode)
  return `Permission level is ${permissionModeLabel(mode)}.`
}

function PermissionPicker({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const current = getPermissionMode()
  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
      onDone('Permission level unchanged.')
    }
  })
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select a permission level</Text>
      <Text dimColor>Current: {permissionModeLabel(current)}. Esc keeps it. Shift+Tab still cycles.</Text>
      <Select
        visibleOptionCount={LEVELS.length}
        focusValue={permissionModeLabel(current)}
        options={LEVELS.map(level => ({
          value: permissionModeLabel(level.id),
          label: `${permissionModeLabel(level.id)} — ${level.detail}${level.id === current ? ' (current)' : ''}`,
        }))}
        onChange={value => onDone(applyMode(value))}
      />
    </Box>
  )
}

const permissions = {
  type: 'local-jsx',
  name: 'permissions',
  aliases: ['permission'],
  description: 'Choose a permission level: manual, accept edits, auto, or bypass',
  isEnabled: true,
  isHidden: false,
  async call(onDone, _context, args = '') {
    const requested = args.trim()
    if (requested) {
      onDone(applyMode(requested))
      return null
    }
    return <PermissionPicker onDone={onDone} />
  },
  userFacingName() {
    return 'permissions'
  },
} satisfies Command

export default permissions
