import { Box, Text } from 'ink'
import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { getTheme } from '../utils/theme.js'
import { sample } from 'lodash-es'

// Played forward, then reversed, so the mark fills and opens again.
const CHARACTERS = ['·', '○', '◔', '◑', '◕', '●']

const MESSAGES = [
  'Agenting',
  'Aligning',
  'Assembling',
  'Attending',
  'Branching',
  'Buffering',
  'Checking',
  'Composing',
  'Contexting',
  'Debugging',
  'Delegating',
  'Diffing',
  'Dispatching',
  'Drafting',
  'Editing',
  'Embedding',
  'Exploring',
  'Grounding',
  'Indexing',
  'Inspecting',
  'Iterating',
  'Linking',
  'Linting',
  'Mapping',
  'Navigating',
  'Observing',
  'Orchestrating',
  'Parsing',
  'Patching',
  'Planning',
  'Prompting',
  'Reading',
  'Reasoning',
  'Refactoring',
  'Resolving',
  'Retrieving',
  'Reviewing',
  'Routing',
  'Running',
  'Sampling',
  'Sandboxing',
  'Scaffolding',
  'Searching',
  'Shipping',
  'Sketching',
  'Spooling',
  'Streaming',
  'Syncing',
  'Testing',
  'Threading',
  'Tokenizing',
  'Tooling',
  'Tracing',
  'Verifying',
  'Weaving',
  'Wiring',
  'Writing',
]

export function Spinner(): React.ReactNode {
  const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()]
  const [frame, setFrame] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const message = useRef(sample(MESSAGES))
  const startTime = useRef(Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 120)

    return () => clearInterval(timer)
  }, [frames.length])

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime.current) / 1000))
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  return (
    <Box flexDirection="row" marginTop={1}>
      <Box flexWrap="nowrap" height={1} width={2}>
        <Text color={getTheme().OpenAgent}>{frames[frame]}</Text>
      </Box>
      <Text color={getTheme().OpenAgent}>{message.current}… </Text>
      <Text color={getTheme().secondaryText}>
        ({elapsedTime}s · <Text bold>esc</Text> to interrupt)
      </Text>
    </Box>
  )
}

export function SimpleSpinner(): React.ReactNode {
  const frames = [...CHARACTERS, ...[...CHARACTERS].reverse()]
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 120)

    return () => clearInterval(timer)
  }, [frames.length])

  return (
    <Box flexWrap="nowrap" height={1} width={2}>
      <Text color={getTheme().OpenAgent}>{frames[frame]}</Text>
    </Box>
  )
}
