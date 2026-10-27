#!/usr/bin/env tsx
/**
 * Provider Benchmark Experiment
 * 
 * Compares latency, cost, and quality across different providers.
 * Run with: npm run experiment:benchmark
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')

interface BenchmarkResult {
  provider: string
  model: string
  latencyMs: number
  tokens: number
  success: boolean
  error?: string
}

const providers = [
  { name: 'anthropic', model: 'claude-3-7-sonnet-20250219', env: 'ANTHROPIC_API_KEY' },
  { name: 'anthropic', model: 'claude-3-5-haiku-20241022', env: 'ANTHROPIC_API_KEY' },
  { name: 'openai', model: 'gpt-4o', env: 'OPENAI_API_KEY' },
  { name: 'openai', model: 'gpt-4o-mini', env: 'OPENAI_API_KEY' },
  { name: 'openai', model: 'o1', env: 'OPENAI_API_KEY' },
  { name: 'nim', model: 'nvidia/nemotron-3-ultra-550b-a55b', env: 'NVIDIA_API_KEY' },
  { name: 'nim', model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', env: 'NVIDIA_API_KEY' },
  { name: 'nim', model: 'deepseek-ai/deepseek-v4.1-flash', env: 'NVIDIA_API_KEY' },
  { name: 'local', model: 'qwen3-0.6b-q4', env: 'OPENAGENT_LOCAL_BASE_URL' },
  { name: 'local', model: 'qwen2.5-0.5b-instruct', env: 'OPENAGENT_LOCAL_BASE_URL' },
]

const prompts = [
  'Write a TypeScript function that reverses a string',
  'Explain the difference between map and flatMap in 50 words',
  'Create a simple React component for a button with onClick handler',
]

async function runBenchmark(provider: typeof providers[0], prompt: string): Promise<BenchmarkResult> {
  const start = Date.now()
  
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (provider.env && !env[provider.env]) {
      resolve({
        provider: provider.name,
        model: provider.model,
        latencyMs: 0,
        tokens: 0,
        success: false,
        error: `${provider.env} not set`,
      })
      return
    }

    const args = [
      '--provider', provider.name,
      '--model', provider.model,
      '-p', prompt,
    ]

    const child = spawn('./bin/openagent.js', args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout.on('data', (data) => { output += data.toString() })
    child.stderr.on('data', (data) => { output += data.toString() })

    child.on('exit', (code) => {
      const latencyMs = Date.now() - start
      const tokens = estimateTokens(output)
      
      resolve({
        provider: provider.name,
        model: provider.model,
        latencyMs,
        tokens,
        success: code === 0,
        error: code !== 0 ? output.slice(0, 200) : undefined,
      })
    })
  })
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function main() {
  console.log('OpenAgent Provider Benchmark')
  console.log('============================\n')

  const availableProviders = providers.filter(p => {
    if (p.name === 'local') return true
    return !!process.env[p.env]
  })

  if (availableProviders.length === 0) {
    console.log('No providers configured. Set at least one API key:')
    console.log('  ANTHROPIC_API_KEY, OPENAI_API_KEY, NVIDIA_API_KEY')
    process.exit(1)
  }

  console.log(`Testing ${availableProviders.length} provider(s) with ${prompts.length} prompt(s)\n`)

  const results: BenchmarkResult[] = []

  for (const provider of availableProviders) {
    console.log(`\n--- ${provider.name} (${provider.model}) ---`)
    
    for (const prompt of prompts) {
      process.stdout.write(`  "${prompt.slice(0, 50)}..." `)
      const result = await runBenchmark(provider, prompt)
      results.push(result)
      
      if (result.success) {
        console.log(`${result.latencyMs}ms, ~${result.tokens} tokens`)
      } else {
        console.log(`FAILED: ${result.error}`)
      }
    }
  }

  console.log('\n\nSummary')
  console.log('=======')
  console.log('Provider         | Model                    | Avg Latency | Avg Tokens | Success Rate')
  console.log('-----------------|--------------------------|-------------|------------|-------------')

  for (const provider of availableProviders) {
    const providerResults = results.filter(r => r.provider === provider.name)
    const successful = providerResults.filter(r => r.success)
    const avgLatency = successful.length > 0
      ? Math.round(successful.reduce((a, b) => a + b.latencyMs, 0) / successful.length)
      : 0
    const avgTokens = successful.length > 0
      ? Math.round(successful.reduce((a, b) => a + b.tokens, 0) / successful.length)
      : 0
    const successRate = `${successful.length}/${providerResults.length}`

    console.log(
      `${provider.name.padEnd(16)} | ${provider.model.padEnd(24)} | ${String(avgLatency).padStart(11)}ms | ${String(avgTokens).padStart(10)} | ${successRate}`
    )
  }

  console.log('\nNote: Results vary by network, load, and prompt. Run multiple times for accuracy.')
}

main().catch(console.error)