import * as React from 'react'
import type { Command } from '../commands.js'
import { Box, Text } from 'ink'
import { useExitOnCtrlCD } from '../hooks/useExitOnCtrlCD.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: 'Show how to set a provider, model, and API key',
    isEnabled: true,
    isHidden: false,
    async call(onDone) {
      return <Login onDone={onDone} />
    },
    userFacingName() {
      return 'login'
    },
  }) satisfies Command

function Login(props: { onDone: () => void }) {
  const exitState = useExitOnCtrlCD(props.onDone)
  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        Free mode is the default. NIM uses NVIDIA_API_KEY, --nvidia-api-key, or
        `openagent config set -g nvidiaApiKey ...`. Without that key, the local
        model only answers new bookkeeping chats.
      </Text>
      <Text>Paid providers, first match wins:</Text>
      <Text>ANTHROPIC_API_KEY or `openagent config set -g primaryApiKey ...`</Text>
      <Text>OPENAI_API_KEY</Text>
      <Text>OPENAI_COMPATIBLE_API_KEY and OPENAGENT_BASE_URL</Text>
      <Text>
        Local model: --local-base-url, OPENAGENT_LOCAL_BASE_URL, or `openagent
        config set -g localBaseURL http://127.0.0.1:8080/v1`
      </Text>
      <Text>
        Flags: --provider, --model, --base-url, --local-base-url, --nvidia-api-key
      </Text>
      <Text dimColor>
        {exitState.pending ? `Press ${exitState.keyName} again to exit` : 'Press Ctrl+C to close'}
      </Text>
    </Box>
  )
}
