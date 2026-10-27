let offline = process.env.OPENAGENT_OFFLINE === '1'

export const OFFLINE_MESSAGE = 'Offline mode is on'

export function isOffline(): boolean {
  return offline
}

export function setOffline(next: boolean): void {
  offline = next
}
