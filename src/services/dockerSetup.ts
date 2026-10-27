import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import {
  acceptAnswer,
  classifyDockerFailure,
  commandMissing,
  composeAsset,
  dockerActionPrompt,
  hostPlatform,
  nextDockerAction,
  type DockerProbe,
  type HostPlatform,
} from './hostEnv.js'

const COMPOSE_VERSION = 'v2.32.4'

export type HostResult = { code: number; stdout: string; stderr: string }

export type HostExec = (
  file: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
) => Promise<HostResult>

export type EnsureDockerOptions = {
  yes?: boolean
  log?: (line: string) => void
  confirm?: (question: string) => Promise<boolean>
  exec?: HostExec
  attached?: HostExec
  platform?: HostPlatform
  arch?: string
  root?: boolean
  pluginDir?: string
  user?: string
  waitMs?: number
  pollMs?: number
}

type LiveProbe = DockerProbe & { detail: string }

function capture(
  file: string,
  args: string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv | undefined,
  inheritInput: boolean,
): Promise<HostResult> {
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: HostResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn(file, args, {
      env: env ?? process.env,
      signal: AbortSignal.timeout(timeoutMs),
      stdio: [inheritInput ? 'inherit' : 'ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', chunk => {
      const text = chunk.toString()
      if (inheritInput) process.stderr.write(text)
      stdout = (stdout + text).slice(-20_000)
    })
    child.stderr?.on('data', chunk => {
      const text = chunk.toString()
      if (inheritInput) process.stderr.write(text)
      stderr = (stderr + text).slice(-20_000)
    })
    child.on('error', error => {
      finish({
        code: error.name === 'AbortError' ? 124 : 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      })
    })
    child.on('close', code => {
      finish({ code: code ?? 1, stdout, stderr })
    })
  })
}

function realExec(file: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<HostResult> {
  return capture(file, args, timeoutMs, env, false)
}

function realAttached(file: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<HostResult> {
  return capture(file, args, timeoutMs, env, true)
}

async function binaryExists(exec: HostExec, file: string): Promise<boolean> {
  const result = await exec(file, ['--version'], 12_000)
  if (result.code === 0) return true
  return !commandMissing(`${result.stderr}\n${result.stdout}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export type DockerRunner = (args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<HostResult>

export async function ensureDocker(options: EnsureDockerOptions = {}): Promise<DockerRunner> {
  const exec = options.exec ?? realExec
  const attached = options.attached ?? realAttached
  const platform = options.platform ?? hostPlatform(process.platform)
  const arch = options.arch ?? process.arch
  const root = options.root ?? (typeof process.getuid === 'function' && process.getuid() === 0)
  const log = options.log ?? (line => console.error(line))
  const user = options.user ?? process.env.USER ?? process.env.USERNAME ?? ''
  const waitMs = options.waitMs ?? (platform === 'linux' ? 60_000 : 150_000)
  const pollMs = options.pollMs ?? 1_500
  const tried = new Set<string>()
  let elevated = false

  async function ask(question: string): Promise<boolean> {
    if (options.confirm) return options.confirm(question)
    if (options.yes) return true
    if (!process.stdin.isTTY) {
      throw new Error(`${question}\nRe-run with --yes to allow this automatically.`)
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      const answer = await new Promise<string>(resolve => {
        rl.question(`${question} [Y/n] `, resolve)
      })
      return acceptAnswer(answer)
    } finally {
      rl.close()
    }
  }

  async function ensureSudo(): Promise<void> {
    if (root) return
    const check = await exec('sudo', ['-n', 'true'], 8_000)
    if (check.code === 0) return
    const auth = await attached('sudo', ['-v'], 180_000)
    if (auth.code !== 0) throw new Error(auth.stderr || 'sudo authentication failed')
  }

  async function asRoot(args: string[], timeoutMs = 120_000): Promise<HostResult> {
    if (root) {
      const [file, ...rest] = args
      if (!file) return { code: 1, stdout: '', stderr: 'empty command' }
      return attached(file, rest, timeoutMs)
    }
    await ensureSudo()
    return attached('sudo', args, timeoutMs)
  }

  async function info(useSudo: boolean): Promise<HostResult> {
    if (useSudo) return exec('sudo', ['-n', 'docker', 'info'], 20_000)
    return exec('docker', ['info'], 20_000)
  }

  async function collect(useSudo: boolean): Promise<LiveProbe> {
    const result = await info(useSudo)
    const detail = `${result.stderr}\n${result.stdout}`.trim().slice(0, 500)
    const cli = !commandMissing(detail)
    const infoOk = result.code === 0
    let compose = false
    if (infoOk) {
      const plugin = useSudo
        ? await exec('sudo', ['-n', 'docker', 'compose', 'version'], 15_000)
        : await exec('docker', ['compose', 'version'], 15_000)
      if (plugin.code === 0) compose = true
      else {
        const legacy = await exec('docker-compose', ['version'], 15_000)
        compose = legacy.code === 0 && !commandMissing(`${legacy.stderr}\n${legacy.stdout}`)
      }
    }
    return {
      platform,
      cli,
      infoOk,
      failure: infoOk ? 'none' : cli ? classifyDockerFailure(detail) : 'other',
      compose,
      curl: await binaryExists(exec, 'curl'),
      sudo: root || await binaryExists(exec, 'sudo'),
      root,
      elevated: useSudo,
      brew: platform === 'darwin' ? await binaryExists(exec, 'brew') : false,
      winget: platform === 'win32' ? await binaryExists(exec, 'winget') : false,
      detail,
    }
  }

  async function installCurl(): Promise<void> {
    const managers: Array<[string, string[]]> = [
      ['apt-get', ['apt-get', 'update']],
      ['dnf', ['dnf', 'install', '-y', 'ca-certificates', 'curl']],
      ['pacman', ['pacman', '-Sy', '--noconfirm', 'ca-certificates', 'curl']],
      ['zypper', ['zypper', '--non-interactive', 'install', 'ca-certificates', 'curl']],
    ]
    for (const [file, args] of managers) {
      if (!(await binaryExists(exec, file))) continue
      if (file === 'apt-get') {
        const update = await asRoot(args, 10 * 60_000)
        if (update.code !== 0) throw new Error(update.stderr || 'apt-get update failed')
        const install = await asRoot(['apt-get', 'install', '-y', 'ca-certificates', 'curl'], 10 * 60_000)
        if (install.code !== 0) throw new Error(install.stderr || 'curl install failed')
        return
      }
      const install = await asRoot(args, 10 * 60_000)
      if (install.code !== 0) throw new Error(install.stderr || 'curl install failed')
      return
    }
    throw new Error('Install curl, then rerun setup.')
  }

  async function readyNow(): Promise<boolean> {
    return (await info(elevated)).code === 0
  }

  async function waitUntilReady(budget: number): Promise<boolean> {
    const deadline = Date.now() + budget
    while (Date.now() < deadline) {
      if (await readyNow()) return true
      if (pollMs <= 0) return false
      await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    }
    return readyNow()
  }

  async function startDocker(): Promise<void> {
    log('Starting Docker…')
    const attempts: Array<[string, string[], number]> = platform === 'darwin'
      ? [['open', ['-a', 'Docker'], 30_000]]
      : platform === 'win32'
        ? [['powershell.exe', ['-NoProfile', '-Command', 'Start-Process', 'Docker Desktop'], 30_000]]
        : [
            ['docker', ['desktop', 'start'], 90_000],
            ['systemctl', ['--user', 'start', 'docker-desktop'], 30_000],
            ['systemctl', ['start', 'docker'], 30_000],
          ]
    const results: HostResult[] = []
    for (const [file, args, timeout] of attempts) results.push(await attached(file, args, timeout))
    const accepted = results.some(result => result.code === 0)
    if (accepted && await waitUntilReady(waitMs)) return
    if (platform === 'linux' && (root || await binaryExists(exec, 'sudo'))) {
      await ensureSudo()
      await attached('sudo', ['systemctl', 'start', 'docker'], 40_000)
      await attached('sudo', ['service', 'docker', 'start'], 40_000)
    }
    await waitUntilReady(waitMs)
  }

  async function installCompose(): Promise<void> {
    const asset = composeAsset(platform, arch)
    if (!asset) throw new Error('No Docker Compose build exists for this machine.')
    const dir = options.pluginDir
      ?? (elevated || root ? '/usr/local/lib/docker/cli-plugins' : join(homedir(), '.docker', 'cli-plugins'))
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      const made = await asRoot(['mkdir', '-p', dir])
      if (made.code !== 0) throw new Error(made.stderr || 'Could not create the Compose plugin directory')
    }
    const filename = asset.endsWith('.exe') ? 'docker-compose.exe' : 'docker-compose'
    const dest = join(dir, filename)
    const url = `https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/${asset}`
    const homeInstall = dest.startsWith(homedir())
    const download = homeInstall && !elevated
      ? await attached('curl', ['-fsSL', url, '-o', dest], 180_000)
      : await asRoot(['curl', '-fsSL', url, '-o', dest], 180_000)
    if (download.code !== 0) throw new Error(download.stderr || 'Compose download failed')
    if (!filename.endsWith('.exe')) {
      const mode = homeInstall && !elevated
        ? await attached('chmod', ['+x', dest], 10_000)
        : await asRoot(['chmod', '+x', dest], 10_000)
      if (mode.code !== 0) throw new Error(mode.stderr || 'Could not mark Compose as executable')
    }
  }

  async function perform(kind: string): Promise<void> {
    if (kind === 'install-curl') {
      await installCurl()
      return
    }
    if (kind === 'install-engine') {
      const script = 'curl -fsSL https://get.docker.com | sh'
      const result = root
        ? await attached('sh', ['-c', script], 20 * 60_000)
        : await asRoot(['sh', '-c', script], 20 * 60_000)
      if (result.code !== 0) throw new Error(result.stderr || 'Docker install failed')
      return
    }
    if (kind === 'install-mac') {
      const result = await attached('brew', ['install', '--cask', 'docker'], 30 * 60_000)
      if (result.code !== 0) throw new Error(result.stderr || 'Docker Desktop install failed')
      return
    }
    if (kind === 'install-windows') {
      const result = await attached(
        'winget',
        ['install', '-e', '--id', 'Docker.DockerDesktop', '--accept-package-agreements', '--accept-source-agreements'],
        30 * 60_000,
      )
      if (result.code !== 0) throw new Error(result.stderr || 'Docker Desktop install failed')
      return
    }
    if (kind === 'start') {
      await startDocker()
      return
    }
    if (kind === 'use-sudo') {
      await ensureSudo()
      if (user && user !== 'root') {
        await attached('sudo', ['groupadd', 'docker'], 20_000)
        const added = await attached('sudo', ['usermod', '-aG', 'docker', user], 20_000)
        log(added.code === 0
          ? 'Added this user to the docker group. New shells can use Docker without sudo. This session uses sudo.'
          : 'Could not add this user to the docker group. This session uses sudo.')
      }
      elevated = true
      return
    }
    if (kind === 'install-compose') {
      await installCompose()
      return
    }
    throw new Error(`Unknown setup step: ${kind}`)
  }

  log('Checking Docker and Compose.')
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await collect(elevated)
    const action = nextDockerAction(current, tried)
    if (action.kind === 'ready') {
      log('Docker is ready.')
      return (args, timeoutMs, env) => {
        const merged = { ...process.env, ...env }
        if (!elevated) return attached('docker', args, timeoutMs, merged)
        const forwarded = Object.entries(env ?? {})
          .filter((entry): entry is [string, string] => entry[0].startsWith('SEARXNG_') && entry[1] !== undefined)
        return attached('sudo', ['env', ...forwarded.map(([key, value]) => `${key}=${value}`), 'docker', ...args], timeoutMs, merged)
      }
    }
    if (action.kind === 'unsupported') {
      throw new Error(current.detail ? `${action.reason}\n${current.detail}` : action.reason)
    }
    const question = dockerActionPrompt(action)
    log(question)
    if (!(await ask(question))) throw new Error('Setup cancelled.')
    tried.add(action.kind)
    await perform(action.kind)
  }
  throw new Error('Docker did not become ready.')
}
