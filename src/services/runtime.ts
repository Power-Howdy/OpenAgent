import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { OpenAgent_BASE_DIR } from '../utils/env.js'
import { ensureDocker } from './dockerSetup.js'
import { redactSecrets, scrubbedEnv } from './redact.js'

export const SANDBOX_IMAGE = 'openagent-sandbox:local'
export const SEARXNG_URL = 'http://127.0.0.1:18088'
export const SETUP_HINT = 'Run openagent setup.'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export type CommandResult = { code: number; stdout: string; stderr: string }

export type SpawnFn = (
  file: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) => Promise<CommandResult>

export type SandboxMount = { host: string; guest: string; readonly: boolean }

export type SandboxSpec = {
  argv: string[]
  network: 'none' | 'bridge'
  timeoutMs: number
  readonly: boolean
  session?: string
  ptrace?: boolean
  project?: string
  uid?: number
  gid?: number
  image?: string
  mounts?: SandboxMount[]
  signal?: AbortSignal
}

export async function runHost(argv: string[], timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  const [file, ...args] = argv
  if (!file) return { code: 1, stdout: '', stderr: 'empty command' }
  const result = await execFileNoThrow(file, args, signal, timeoutMs)
  return {
    code: signal?.aborted ? 130 : result.code,
    stdout: redactSecrets(result.stdout.slice(-100_000)),
    stderr: redactSecrets(result.stderr.slice(-100_000)),
  }
}

export const defaultSpawn: SpawnFn = (file, args, timeoutMs, env, signal) =>
  new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timeout = AbortSignal.timeout(timeoutMs)
    const abort = signal ? AbortSignal.any([timeout, signal]) : timeout
    const child = spawn(file, args, {
      env: env ?? scrubbedEnv(),
      signal: abort,
    })
    child.stdout?.on('data', chunk => {
      stdout = (stdout + chunk.toString()).slice(-100_000)
    })
    child.stderr?.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-100_000)
    })
    child.on('error', error => {
      finish({ code: signal?.aborted ? 130 : 1, stdout, stderr: stderr || error.message })
    })
    child.on('close', code => {
      finish({ code: signal?.aborted ? 130 : (code ?? 124), stdout, stderr })
    })
  })

let spawnImpl: SpawnFn = defaultSpawn

export function setSpawnForTests(next: SpawnFn | null): void {
  spawnImpl = next ?? defaultSpawn
}

export function safeSessionName(name: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(name)
}

export function renderSearxngSettings(template: string, secret: string): string {
  return template.replaceAll('__SECRET__', secret)
}

export function dockerRunArgs(spec: SandboxSpec): string[] {
  const image = spec.image ?? SANDBOX_IMAGE
  const project = spec.project ?? process.cwd()
  const uid = spec.uid ?? process.getuid?.() ?? 0
  const gid = spec.gid ?? process.getgid?.() ?? 0
  const user = `${uid}:${gid}`
  if (spec.session) {
    if (!safeSessionName(spec.session)) throw new Error('Invalid session name')
    return ['exec', '-i', '-u', user, '-w', '/workspace', `openagent-session-${spec.session}`, ...spec.argv]
  }
  const args = [
    'run',
    '--rm',
    '--user',
    user,
    '-e',
    'HOME=/tmp',
    '--network',
    spec.network,
    '-v',
    `${project}:/workspace${spec.readonly ? ':ro' : ''}`,
    '-w',
    '/workspace',
  ]
  for (const mount of spec.mounts ?? []) {
    args.push('-v', `${mount.host}:${mount.guest}${mount.readonly ? ':ro' : ''}`)
  }
  if (spec.readonly) {
    args.push(
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,size=64m',
      '--memory',
      '512m',
      '--pids-limit',
      '128',
    )
  } else {
    args.push('--memory', '1g', '--cpus', '1', '--cap-drop', 'SYS_ADMIN', '--cap-drop', 'NET_RAW')
    if (spec.ptrace) args.push('--cap-add', 'SYS_PTRACE')
  }
  args.push(image, ...spec.argv)
  return args
}

export function sessionStartArgs(
  name: string,
  spec: Partial<Pick<SandboxSpec, 'project' | 'uid' | 'gid' | 'image' | 'network' | 'ptrace'>> = {},
): string[] {
  if (!safeSessionName(name)) throw new Error('Invalid session name')
  const uid = spec.uid ?? process.getuid?.() ?? 0
  const gid = spec.gid ?? process.getgid?.() ?? 0
  const project = spec.project ?? process.cwd()
  const args = [
    'run',
    '-d',
    '--name',
    `openagent-session-${name}`,
    '--user',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp',
    '--network',
    spec.network ?? 'none',
    '--memory',
    '1g',
    '--cpus',
    '1',
    '--cap-drop',
    'SYS_ADMIN',
    '--cap-drop',
    'NET_RAW',
    '-v',
    `${project}:/workspace`,
    '-w',
    '/workspace',
  ]
  if (spec.ptrace) args.push('--cap-add', 'SYS_PTRACE')
  args.push(spec.image ?? SANDBOX_IMAGE, 'sleep', 'infinity')
  return args
}

export async function ensureSession(name: string, spec: Partial<SandboxSpec> = {}): Promise<void> {
  if (!safeSessionName(name)) throw new Error('Invalid session name')
  const container = `openagent-session-${name}`
  const inspect = await spawnImpl(
    'docker',
    ['inspect', '-f', '{{.State.Running}}', container],
    10_000,
    undefined,
    spec.signal,
  )
  if (inspect.code === 0 && inspect.stdout.trim() === 'true') return
  if (inspect.code === 0) {
    await spawnImpl('docker', ['rm', '-f', container], 20_000, undefined, spec.signal)
  }
  const started = await spawnImpl('docker', sessionStartArgs(name, spec), 30_000, undefined, spec.signal)
  if (started.code !== 0) throw new Error(started.stderr || 'Sandbox session failed to start')
}

export async function runInSandbox(spec: SandboxSpec): Promise<CommandResult> {
  if (spec.session) await ensureSession(spec.session, spec)
  return spawnImpl('docker', dockerRunArgs(spec), spec.timeoutMs, undefined, spec.signal)
}

export function installedLangs(text: string): Set<string> {
  return new Set(text.split(',').map(item => item.trim()).filter(Boolean))
}

export function langsPath(): string {
  return join(OpenAgent_BASE_DIR, 'sandbox-langs')
}

export function readInstalledLangs(): Set<string> {
  try {
    return installedLangs(readFileSync(langsPath(), 'utf8'))
  } catch {
    return new Set()
  }
}

function searxngDir(): string {
  return join(OpenAgent_BASE_DIR, 'searxng')
}

export async function searxngReady(): Promise<boolean> {
  try {
    const response = await fetch(`${SEARXNG_URL}/healthz`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

export async function sandboxReady(): Promise<boolean> {
  const result = await spawnImpl('docker', ['image', 'inspect', SANDBOX_IMAGE], 10_000)
  return result.code === 0
}

export async function runSetup(langs: string[], options: { yes?: boolean } = {}): Promise<void> {
  const lock = join(OpenAgent_BASE_DIR, 'setup.lock')
  mkdirSync(OpenAgent_BASE_DIR, { recursive: true })
  if (!acquireLock(lock)) throw new Error('openagent setup is already running')
  try {
    const runDocker = await ensureDocker({ yes: options.yes })
    const selected = langs.length ? langs : ['ts', 'py']
    console.error(`Building the sandbox image (${selected.join(', ')})…`)
    const build = await runDocker(
      [
        'build',
        '-t',
        SANDBOX_IMAGE,
        '--build-arg',
        `LANGS=${selected.join(',')}`,
        '-f',
        join(repoRoot, 'docker/sandbox/Dockerfile'),
        join(repoRoot, 'docker/sandbox'),
      ],
      30 * 60_000,
    )
    if (build.code !== 0) throw new Error(build.stderr || 'Sandbox image build failed')
    writeFileSync(langsPath(), selected.join(','))
    const dir = searxngDir()
    mkdirSync(dir, { recursive: true })
    const secretFile = join(dir, 'secret')
    const secret = existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : randomBytes(32).toString('hex')
    if (!existsSync(secretFile)) writeFileSync(secretFile, secret)
    const template = readFileSync(join(repoRoot, 'docker/searxng/settings.yml.template'), 'utf8')
    const settings = join(dir, 'settings.yml')
    writeFileSync(settings, renderSearxngSettings(template, secret))
    const version = readFileSync(join(repoRoot, 'docker/searxng/VERSION'), 'utf8').trim()
    console.error('Starting SearXNG…')
    const up = await runDocker(
      ['compose', '-p', 'openagent', '-f', join(repoRoot, 'docker/compose.yaml'), 'up', '-d', 'searxng'],
      180_000,
      { SEARXNG_VERSION: version, SEARXNG_SETTINGS: settings },
    )
    if (up.code !== 0) throw new Error(up.stderr || 'SearXNG failed to start')
    console.error('Waiting for SearXNG…')
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (await searxngReady()) return
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('SearXNG did not become ready')
  } finally {
    rmSync(lock, { force: true })
  }
}

export async function sandboxDown(all: boolean): Promise<string> {
  const ids: string[] = []
  for (const name of ['openagent-session-', 'openagent-debug']) {
    const listed = await spawnImpl('docker', ['ps', '-aq', '--filter', `name=${name}`], 20_000)
    ids.push(...listed.stdout.split('\n').map(item => item.trim()).filter(Boolean))
  }
  if (ids.length) await spawnImpl('docker', ['rm', '-f', ...ids], 20_000)
  if (all) await spawnImpl('docker', ['rm', '-f', 'openagent-searxng'], 20_000)
  return all ? 'Stopped sandbox sessions and SearXNG.' : 'Stopped sandbox sessions.'
}

function acquireLock(lock: string): boolean {
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    try {
      const pid = Number(readFileSync(lock, 'utf8'))
      process.kill(pid, 0)
      return false
    } catch {
      rmSync(lock, { force: true })
      try {
        writeFileSync(lock, String(process.pid), { flag: 'wx' })
        return true
      } catch {
        return false
      }
    }
  }
}
