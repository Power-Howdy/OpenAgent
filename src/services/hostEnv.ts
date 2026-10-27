export type HostPlatform = 'linux' | 'darwin' | 'win32' | 'other'

export type DockerFailure = 'none' | 'down' | 'denied' | 'other'

export interface DockerProbe {
  platform: HostPlatform
  cli: boolean
  infoOk: boolean
  failure: DockerFailure
  compose: boolean
  curl: boolean
  sudo: boolean
  root: boolean
  elevated: boolean
  brew: boolean
  winget: boolean
}

export type DockerAction =
  | { kind: 'ready' }
  | { kind: 'install-curl' }
  | { kind: 'install-engine' }
  | { kind: 'install-compose' }
  | { kind: 'install-mac' }
  | { kind: 'install-windows' }
  | { kind: 'start' }
  | { kind: 'use-sudo' }
  | { kind: 'unsupported'; reason: string }

export function hostPlatform(platform: string): HostPlatform {
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') return platform
  return 'other'
}

export function commandMissing(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('enoent') || lower.includes('not found') || lower.includes('not recognized')
}

export function classifyDockerFailure(text: string): DockerFailure {
  const lower = text.toLowerCase()
  if (lower.includes('permission denied') || lower.includes('access denied')) return 'denied'
  if (
    lower.includes('is the docker daemon running') ||
    lower.includes('cannot connect to the docker daemon') ||
    lower.includes('error during connect') ||
    lower.includes('connection refused') ||
    (lower.includes('no such file or directory') && lower.includes('docker.sock'))
  ) {
    return 'down'
  }
  return 'other'
}

export function composeAsset(platform: HostPlatform, arch: string): string | null {
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null
  if (!cpu) return null
  if (platform === 'linux') return `docker-compose-linux-${cpu}`
  if (platform === 'darwin') return `docker-compose-darwin-${cpu}`
  if (platform === 'win32') return `docker-compose-windows-${cpu}.exe`
  return null
}

export function acceptAnswer(answer: string): boolean {
  const text = answer.trim().toLowerCase()
  return text === '' || text === 'y' || text === 'yes'
}

export function dockerActionPrompt(action: DockerAction): string {
  switch (action.kind) {
    case 'ready':
      return ''
    case 'install-curl':
      return 'curl is missing. Install curl and CA certificates?'
    case 'install-engine':
      return 'Docker is not installed. Download and run https://get.docker.com?'
    case 'install-compose':
      return 'Docker Compose is missing. Install the Compose plugin?'
    case 'install-mac':
      return 'Docker Desktop is not installed. Install it with Homebrew?'
    case 'install-windows':
      return 'Docker Desktop is not installed. Install it with winget?'
    case 'start':
      return 'Docker is installed but not running. Start it and continue?'
    case 'use-sudo':
      return 'Docker is installed, but this user cannot use the socket. Use sudo and add this user to the docker group?'
    case 'unsupported':
      return action.reason
  }
}

export function nextDockerAction(probe: DockerProbe, tried: ReadonlySet<string>): DockerAction {
  if (probe.infoOk && probe.compose) return { kind: 'ready' }
  if (probe.infoOk && !tried.has('install-compose')) return { kind: 'install-compose' }
  if (probe.infoOk) return { kind: 'unsupported', reason: 'Docker Compose is still missing.' }

  if (!probe.cli) {
    if (probe.platform === 'linux') {
      if (!probe.root && !probe.sudo) {
        return { kind: 'unsupported', reason: 'Docker is not installed and this user cannot run sudo.' }
      }
      if (!probe.curl && !tried.has('install-curl')) return { kind: 'install-curl' }
      if (!tried.has('install-engine')) return { kind: 'install-engine' }
      return { kind: 'unsupported', reason: 'Docker is still not on PATH.' }
    }
    if (probe.platform === 'darwin') {
      if (probe.brew && !tried.has('install-mac')) return { kind: 'install-mac' }
      if (!tried.has('start')) return { kind: 'start' }
      return { kind: 'unsupported', reason: 'Install Docker Desktop for Mac, then rerun setup.' }
    }
    if (probe.platform === 'win32') {
      if (probe.winget && !tried.has('install-windows')) return { kind: 'install-windows' }
      if (!tried.has('start')) return { kind: 'start' }
      return { kind: 'unsupported', reason: 'Install Docker Desktop for Windows, then rerun setup.' }
    }
    return { kind: 'unsupported', reason: 'Automatic Docker setup is not supported on this OS.' }
  }

  if (probe.failure === 'denied' && probe.sudo && !probe.elevated && !tried.has('use-sudo')) {
    return { kind: 'use-sudo' }
  }
  if (!tried.has('start') && (probe.failure === 'down' || probe.failure === 'other' || probe.failure === 'denied')) {
    return { kind: 'start' }
  }
  if (probe.failure === 'denied') {
    return {
      kind: 'unsupported',
      reason: 'This user cannot access the Docker socket. Add them to the docker group and open a new shell.',
    }
  }
  return { kind: 'unsupported', reason: 'Docker did not become ready.' }
}
