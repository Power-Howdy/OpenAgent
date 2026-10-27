let authoring = false
let workerDepth = 0
let activeWorkers = 0

export const MAX_WORKERS = 3

export function setAuthoring(value: boolean): void {
  authoring = value
}

export function authoringAllowed(): boolean {
  return authoring && workerDepth === 0
}

export function enterWorker(): boolean {
  if (activeWorkers >= MAX_WORKERS) return false
  activeWorkers++
  workerDepth++
  return true
}

export function leaveWorker(): void {
  activeWorkers = Math.max(0, activeWorkers - 1)
  workerDepth = Math.max(0, workerDepth - 1)
}
