import { memoize } from 'lodash-es'
import { collectAgentInstructions } from '../services/agentInstructions.js'
import { getCwd } from './state.js'

const STYLE_PROMPT =
  'The codebase follows strict style guidelines shown below. All code changes must strictly adhere to these guidelines to maintain consistency and quality.'

export const getCodeStyle = memoize((): string => {
  const instructions = collectAgentInstructions(getCwd())
  if (!instructions) return ''
  return `${STYLE_PROMPT}\n\n${instructions}`
})
