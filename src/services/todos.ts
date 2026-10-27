import { readThreadContext, writeThreadContext } from './threadContext.js'

export type TodoStatus = 'pending' | 'in_progress' | 'done'

export type Todo = {
  id: string
  text: string
  status: TodoStatus
}

const MAX_TODOS = 20
const MAX_TEXT = 200

let todos: Todo[] = []
let threadId: string | null = null

function persist(): void {
  if (!threadId) return
  const context = readThreadContext(threadId)
  context.todos = JSON.stringify(todos)
  writeThreadContext(context, threadId)
}

export function loadTodos(id: string): void {
  threadId = id
  try {
    const parsed = JSON.parse(readThreadContext(id).todos ?? '[]') as Todo[]
    todos = Array.isArray(parsed) ? parsed : []
  } catch {
    todos = []
  }
}

export function detachTodos(): void {
  threadId = null
}

export function resetTodos(): void {
  todos = []
  persist()
}

export function listTodos(): Todo[] {
  return todos.map(item => ({ ...item }))
}

export function writeTodos(next: Todo[], merge: boolean): Todo[] {
  const cleaned = next
    .map(item => ({
      id: item.id.slice(0, 80),
      text: item.text.slice(0, MAX_TEXT),
      status: item.status,
    }))
    .slice(0, MAX_TODOS)
  if (!merge) {
    todos = cleaned
    persist()
    return listTodos()
  }
  const map = new Map(todos.map(item => [item.id, item]))
  for (const item of cleaned) map.set(item.id, item)
  todos = [...map.values()].slice(0, MAX_TODOS)
  persist()
  return listTodos()
}

export function formatTodos(): string {
  if (!todos.length) return ''
  return [
    'Current todos:',
    ...todos.map(item => `- [${item.status}] ${item.id}: ${item.text}`),
  ].join('\n')
}
