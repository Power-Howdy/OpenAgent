import type { Command } from '../commands.js'
import { formatTodos, listTodos } from '../services/todos.js'

const todos = {
  type: 'local',
  name: 'todos',
  description: 'Show the todos for this session',
  isEnabled: true,
  isHidden: false,
  async call() {
    if (!listTodos().length) return 'No todos.'
    return formatTodos()
  },
  userFacingName() {
    return 'todos'
  },
} satisfies Command

export default todos
