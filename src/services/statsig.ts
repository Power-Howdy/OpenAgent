export async function initializeStatsig(): Promise<null> {
  return null
}

export function logEvent(
  _eventName: string,
  _metadata: { [key: string]: string | undefined },
): void {}

export async function checkGate(_gateName: string): Promise<boolean> {
  return false
}

export function useStatsigGate(_gateName: string, defaultValue = false): boolean {
  return defaultValue
}

export function getGateValues(): Record<string, boolean> {
  return {}
}

export async function getExperimentValue<T>(_experimentName: string, defaultValue: T): Promise<T> {
  return defaultValue
}

export async function getDynamicConfig<T>(_configName: string, defaultValue: T): Promise<T> {
  return defaultValue
}
