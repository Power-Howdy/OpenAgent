#!/usr/bin/env tsx
/**
 * Free Mode Routing Experiment
 * 
 * Evaluates the free-mode request routing across NIM models.
 * Run with: npm run experiment:free-mode
 */

import { chooseNimModel, setStickyModel, getStickyModel } from '../../src/services/freeRouter.js'
import { NIM_CATALOG, isCapable, nimCatalog } from '../../src/models/nim-catalog.js'
import { type UsageLedger, RPM_LIMIT, WINDOW_MS, reserveCall } from '../../src/services/budget.js'

interface RoutingResult {
  modelId: string
  requests: number
  remainingRequests: number
  cooldownUntil: number
}

async function runFreeModeExperiment() {
  console.log('OpenAgent Free Mode Routing Experiment')
  console.log('======================================\n')

  if (!process.env.NVIDIA_API_KEY) {
    console.log('NVIDIA_API_KEY not set. Free mode requires a NIM API key.')
    console.log('Get one at: https://build.nvidia.com/')
    process.exit(1)
  }

  const catalog = NIM_CATALOG.filter(isCapable)

  console.log('Available NIM Models:')
  for (const model of catalog) {
    console.log(`  ${model.id} (${model.context}ctx, priority ${model.priority}, limit ${RPM_LIMIT}/min)`)
  }
  console.log()

  const numRequests = 20
  console.log(`Simulating ${numRequests} requests...\n`)

  const usage: UsageLedger = {}
  const results: RoutingResult[] = []

  for (let i = 1; i <= numRequests; i++) {
    const now = Date.now()
    const selection = chooseNimModel({
      now,
      usage,
      sticky: getStickyModel(),
      limit: RPM_LIMIT,
      windowMs: WINDOW_MS,
    })

    if (selection.kind === 'blocked') {
      console.log(`Request ${i}: NO MODEL AVAILABLE (all blocked)`)
      results.push({ modelId: 'none', requests: 0, remainingRequests: 0, cooldownUntil: 0 })
      continue
    }

    if (selection.kind === 'wait') {
      console.log(`Request ${i}: WAIT ${selection.waitMs}ms`)
      results.push({ modelId: 'wait', requests: 0, remainingRequests: 0, cooldownUntil: now + selection.waitMs })
      continue
    }

    const { model, remaining } = selection
    setStickyModel(model.id)
    
    console.log(`Request ${i}: ${model.id} (budget: ${remaining}, cooldown: no)`)
    
    results.push({
      modelId: model.id,
      requests: 1,
      remainingRequests: remaining,
      cooldownUntil: 0,
    })

    usage = reserveCall(usage, model.id, now)
  }

  console.log('\n\nRouting Distribution')
  console.log('====================')

  const distribution = new Map<string, number>()
  for (const r of results) {
    if (r.modelId !== 'wait') {
      distribution.set(r.modelId, (distribution.get(r.modelId) || 0) + 1)
    }
  }

  for (const [modelId, count] of distribution.entries()) {
    const percentage = ((count / numRequests) * 100).toFixed(1)
    const bar = '█'.repeat(Math.round(count / numRequests * 30))
    console.log(`  ${modelId.padEnd(40)} ${count.toString().padStart(2)} (${percentage}%) ${bar}`)
  }

  console.log('\n\nBudget Utilization')
  console.log('==================')

  for (const model of catalog) {
    const modelResults = results.filter(r => r.modelId === model.id)
    const used = modelResults.length
    const total = RPM_LIMIT
    const percentage = total > 0 ? ((used / total) * 100).toFixed(1) : '0'
    console.log(`  ${model.id.padEnd(40)} ${used}/${total} (${percentage}%)`)
  }

  console.log('\n\nCooldown Analysis')
  console.log('=================')

  const cooldowns = results.filter(r => r.cooldownUntil > Date.now())
  if (cooldowns.length > 0) {
    for (const c of cooldowns) {
      const remaining = Math.ceil((c.cooldownUntil - Date.now()) / 1000)
      console.log(`  ${c.modelId}: cooling for ${remaining}s more`)
    }
  } else {
    console.log('  No models in cooldown')
  }

  console.log('\n\nSticky Model Behavior')
  console.log('=====================')
  console.log('(Run again immediately to see if same model is preferred)')

  const secondRun = chooseNimModel({
    now: Date.now(),
    usage,
    sticky: getStickyModel(),
    limit: RPM_LIMIT,
    windowMs: WINDOW_MS,
  })

  if (secondRun.kind === 'model') {
    console.log(`Next selection: ${secondRun.model.id} (budget: ${secondRun.remaining})`)
    const firstModel = results.find(r => r.requests > 0)?.modelId
    if (firstModel === secondRun.model.id) {
      console.log('✓ Sticky model retained')
    } else {
      console.log('→ Different model selected (budget exhausted or cooldown)')
    }
  } else if (secondRun.kind === 'wait') {
    console.log(`Next selection: WAIT ${secondRun.waitMs}ms`)
  } else {
    console.log('Next selection: BLOCKED')
  }
}

runFreeModeExperiment().catch(console.error)