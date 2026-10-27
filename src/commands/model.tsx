import { Box, Text, useInput } from 'ink'
import React from 'react'
import { Command } from '../commands.js'
import { Select } from '../components/CustomSelect/index.js'
import { NIM_CATALOG, findNimModel, isCapable } from '../models/nim-catalog.js'
import { loadLedger, remainingRequests } from '../services/budget.js'
import { getStickyModel, setStickyModel } from '../services/freeRouter.js'
import { resolveProvider } from '../services/resolveProvider.js'

function describeModel(): string {
  const provider = resolveProvider()
  const lines = [`Provider: ${provider.kind}`, `Model: ${provider.model}`]
  if (provider.kind === 'free') {
    lines.push(`Sticky free-mode model: ${getStickyModel() ?? 'automatic'}`)
  } else {
    lines.push(`Fast model: ${provider.fastModel}`)
    lines.push('Change it with `openagent config set -g model <id>`.')
  }
  return lines.join('\n')
}

function pinModel(requested: string): string {
  const name = requested.trim()
  if (!name || name === 'auto' || name === 'automatic') {
    setStickyModel(null)
    return 'Free-mode model is automatic. The next turn uses whichever capable model has the most requests left.'
  }
  const model = findNimModel(name)
  if (!model || !isCapable(model)) {
    const ids = NIM_CATALOG.filter(isCapable).map(item => item.id).join(', ')
    return `Unknown free-mode model "${name}". Capable models: ${ids}.`
  }
  setStickyModel(model.id)
  return `Sticky free-mode model is ${model.id}.`
}

function ModelPicker({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const ledger = loadLedger()
  const now = Date.now()
  const sticky = getStickyModel()
  const options = NIM_CATALOG.filter(isCapable).map(model => ({
    value: model.id,
    label: `${model.id} — ${remainingRequests(ledger[model.id], now)} requests left${model.id === sticky ? ' (current)' : ''}`,
  }))
  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === 'c' || input === 'd'))) {
      onDone('Model unchanged.')
    }
  })
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select a free-mode model</Text>
      <Text dimColor>Esc keeps the current choice. /model auto returns to automatic.</Text>
      <Select
        visibleOptionCount={Math.min(options.length, 8)}
        focusValue={sticky ?? undefined}
        options={[
          { value: 'auto', label: `automatic — most requests left${sticky ? '' : ' (current)'}` },
          ...options,
        ]}
        onChange={value => onDone(pinModel(value))}
      />
    </Box>
  )
}

const model = {
  type: 'local-jsx',
  name: 'model',
  description: 'Show the active model, or pick the free-mode model',
  isEnabled: true,
  isHidden: false,
  async call(onDone, _context, args = '') {
    const requested = args.trim()
    if (resolveProvider().kind !== 'free') {
      onDone(requested ? `${describeModel()}\nA pinned model only applies in free mode.` : describeModel())
      return null
    }
    if (requested) {
      onDone(`${pinModel(requested)}\n${describeModel()}`)
      return null
    }
    return <ModelPicker onDone={onDone} />
  },
  userFacingName() {
    return 'model'
  },
} satisfies Command

export default model
