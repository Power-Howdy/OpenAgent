import {
  NIM_CATALOG,
  findNimModel,
  isCapable,
  type NimModel,
} from '../models/nim-catalog.js'
import {
  RPM_LIMIT,
  WINDOW_MS,
  earliestFreeIn,
  remainingRequests,
  type UsageLedger,
} from './budget.js'

export type ChooseArgs = {
  now: number
  usage: UsageLedger
  sticky?: string | null
  requireVision?: boolean
  preferLongContext?: boolean
  limit?: number
  windowMs?: number
  catalog?: NimModel[]
}

export type Choice =
  | { kind: 'model'; model: NimModel; remaining: number }
  | { kind: 'wait'; waitMs: number }
  | { kind: 'blocked' }

let stickyModel: string | null = null

export function setStickyModel(id: string | null): void {
  stickyModel = id
}

export function getStickyModel(): string | null {
  return stickyModel
}

export function chooseNimModel(args: ChooseArgs): Choice {
  const limit = args.limit ?? RPM_LIMIT
  const windowMs = args.windowMs ?? WINDOW_MS
  const catalog = (args.catalog ?? NIM_CATALOG).filter(isCapable)
  const pool = catalog.filter(model => {
    if (args.requireVision && !model.tags.includes('vision')) return false
    return true
  })
  if (!pool.length) return { kind: 'blocked' }

  const withBudget = pool
    .map(model => ({
      model,
      remaining: remainingRequests(args.usage[model.id], args.now, limit, windowMs),
    }))
    .filter(item => item.remaining > 0)

  const sticky = args.sticky ?? stickyModel
  if (sticky) {
    const held = withBudget.find(item => item.model.id === sticky)
    if (held) return { kind: 'model', model: held.model, remaining: held.remaining }
  }

  let candidates = withBudget
  if (args.preferLongContext) {
    const long = withBudget.filter(item => item.model.tags.includes('long-context'))
    if (long.length) candidates = long
  }
  if (!candidates.length) {
    const waits = pool.map(model =>
      earliestFreeIn(args.usage[model.id], args.now, windowMs),
    )
    const waitMs = Math.min(...waits)
    if (!Number.isFinite(waitMs) || waitMs <= 0) return { kind: 'blocked' }
    return { kind: 'wait', waitMs }
  }

  candidates.sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining
    return a.model.priority - b.model.priority
  })
  const best = candidates[0]!
  return { kind: 'model', model: best.model, remaining: best.remaining }
}

export function modelForId(id: string): NimModel | undefined {
  return findNimModel(id)
}
