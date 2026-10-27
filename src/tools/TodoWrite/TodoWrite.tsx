import { Text } from 'ink'
import React from 'react'
import { z } from 'zod'
import type { Tool } from '../../Tool.js'
import { formatTodos, writeTodos, type Todo } from '../../services/todos.js'

const status = z.enum(['pending', 'in_progress', 'done'])

const writeSchema = z.object({
  merge: z.boolean().describe('Replace the list when false. Update matching ids when true.'),
  todos: z.array(z.object({
    id: z.string(),
    text: z.string(),
    status,
  })).describe('At most 20 todos. Text is capped at 200 characters.'),
})

function show(text: string) {
  return <Text>{text}</Text>
}

export const TodoWriteTool = {
  name: 'TodoWrite',
  userFacingName: () => 'Todos',
  description: async () => 'Replace or update the thread todo list.',
  prompt: async () => 'Keep a short todo list for the current thread. Use merge to update one item.',
  inputSchema: writeSchema,
  isReadOnly: () => false,
  isEnabled() {
    return true
  },
  needsPermissions: () => false,
  async *call(input: z.infer<typeof writeSchema>) {
    writeTodos(input.todos as Todo[], input.merge)
    const text = formatTodos() || 'Todo list cleared.'
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage(input: z.infer<typeof writeSchema>) {
    return `${input.merge ? 'update' : 'replace'} ${input.todos.length} todos`
  },
  renderToolResultMessage: show,
} satisfies Tool<typeof writeSchema, string>

const readSchema = z.object({})

export const TodoReadTool = {
  name: 'TodoRead',
  userFacingName: () => 'Todo list',
  description: async () => 'Read the current thread todo list.',
  prompt: async () => 'Read the todos before changing them.',
  inputSchema: readSchema,
  isReadOnly: () => true,
  isEnabled() {
    return true
  },
  needsPermissions: () => false,
  async *call() {
    const text = formatTodos() || 'No todos.'
    yield { type: 'result' as const, data: text, resultForAssistant: text }
  },
  renderToolUseMessage() {
    return 'read todos'
  },
  renderToolResultMessage: show,
} satisfies Tool<typeof readSchema, string>
