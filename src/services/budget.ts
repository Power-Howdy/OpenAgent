import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

export const RPM_LIMIT = 40
export const WINDOW_MS = 60_000

export type UsageLedger = Record<string, number[]>

export function dataDir(): string {
  return process.env.OpenAgent_CONFIG_DIR ?? join(homedir(), '.OpenAgent')
}

export function ledgerPath(): string {
  return join(dataDir(), 'usage-ledger.json')
}

export function loadLedger(): UsageLedger {
  try {
    return JSON.parse(readFileSync(ledgerPath(), 'utf8')) as UsageLedger
  } catch {
    return {}
  }
}

export function saveLedger(ledger: UsageLedger): void {
  const path = ledgerPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(ledger))
}

export function pruneUsage(
  stamps: number[] | undefined,
  now: number,
  windowMs = WINDOW_MS,
): number[] {
  return (stamps ?? []).filter(stamp => now - stamp < windowMs)
}

export function remainingRequests(
  stamps: number[] | undefined,
  now: number,
  limit = RPM_LIMIT,
  windowMs = WINDOW_MS,
): number {
  return Math.max(0, limit - pruneUsage(stamps, now, windowMs).length)
}

export function reserveCall(
  ledger: UsageLedger,
  modelId: string,
  now: number,
): UsageLedger {
  const next = {
    ...ledger,
    [modelId]: [...pruneUsage(ledger[modelId], now), now],
  }
  return next
}

export function earliestFreeIn(
  stamps: number[] | undefined,
  now: number,
  windowMs = WINDOW_MS,
): number {
  const active = pruneUsage(stamps, now, windowMs).sort((a, b) => a - b)
  if (!active.length) return 0
  return Math.max(0, active[0] + windowMs - now)
}

export function recordCall(modelId: string, now = Date.now()): void {
  if (process.env.NODE_ENV === 'test') return
  const ledger = loadLedger()
  saveLedger(reserveCall(ledger, modelId, now))
}
