import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { localEndpointBind, resolveProvider } from './resolveProvider.js'

const DEFAULT_GGUF =
  '/home/severus/Documents/llm_playground/gguf_models/Qwen3-0.6B-Q4_K_M-imat.gguf'
const DEFAULT_SERVER =
  '/home/severus/Documents/llm_playground/llama.cpp/build/bin/llama-server'

let ready: Promise<void> | null = null

function baseURL(): string {
  return resolveProvider().localBaseURL
}

export function localModelPath(): string {
  return process.env.OPENAGENT_LOCAL_GGUF ?? DEFAULT_GGUF
}

async function isUp(): Promise<boolean> {
  try {
    const response = await fetch(`${baseURL()}/models`, {
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function ensureLocalServer(): Promise<void> {
  if (process.env.NODE_ENV === 'test') return
  if (await isUp()) return
  if (!ready) ready = startServer()
  await ready
}

async function startServer(): Promise<void> {
  const binary = process.env.OPENAGENT_LLAMA_SERVER ?? DEFAULT_SERVER
  const model = localModelPath()
  if (!existsSync(binary) || !existsSync(model)) {
    throw new Error(
      'Local model server is not running and llama-server or the Qwen3-0.6B file was not found.',
    )
  }
  const endpoint = baseURL()
  const bind = localEndpointBind(endpoint)
  if (!bind) {
    throw new Error(`Local model endpoint ${endpoint} is not responding.`)
  }
  const ctx = process.env.OPENAGENT_LOCAL_CTX ?? '4096'
  const child = spawn(
    binary,
    ['-m', model, '--ctx-size', ctx, '--port', bind.port, '--host', bind.host],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isUp()) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Local llama-server did not become ready.')
}
