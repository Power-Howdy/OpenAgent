import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { after, test } from 'node:test'
import { ensureDocker, type HostExec, type HostResult } from '../src/services/dockerSetup.js'

const root = mkdtempSync(join(tmpdir(), 'openagent-docker-'))
after(() => rmSync(root, { recursive: true, force: true }))

const ok: HostResult = { code: 0, stdout: 'ok', stderr: '' }
const missing: HostResult = { code: 1, stdout: '', stderr: 'spawn ENOENT' }

function harness(start: 'missing' | 'down' | 'denied') {
  let phase: 'missing' | 'down' | 'denied' | 'up' = start
  let composeReady = false
  const questions: string[] = []
  const attachedCalls: string[] = []
  const exec: HostExec = async (file, args) => {
    const line = [file, ...args].join(' ')
    if (args[0] === '--version') {
      if (file === 'curl' || file === 'sudo' || file === 'apt-get') return ok
      return missing
    }
    if (file === 'sudo' && args[0] === '-n' && args[1] === 'true') return ok
    if (line === 'sudo -n docker info' || line === 'docker info') {
      if (phase === 'missing') return missing
      if (phase === 'down') {
        return { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon. Is the docker daemon running?' }
      }
      if (phase === 'denied' && file === 'docker') {
        return { code: 1, stdout: '', stderr: 'permission denied while trying to connect to the Docker daemon socket' }
      }
      return ok
    }
    if (line.includes('compose') && line.includes('version')) {
      return composeReady ? ok : { code: 1, stdout: '', stderr: 'unknown command: docker compose' }
    }
    if (file === 'docker-compose') return missing
    return ok
  }
  const attached: HostExec = async (file, args) => {
    const line = [file, ...args].join(' ')
    attachedCalls.push(line)
    if (line.includes('get.docker.com')) phase = 'down'
    if (phase !== 'missing' && (args.includes('start') || file === 'open' || file === 'powershell.exe')) phase = 'up'
    if (args.some(arg => arg.includes('docker-compose-'))) composeReady = true
    if (line.includes('usermod')) phase = 'up'
    return ok
  }
  return { exec, attached, questions, attachedCalls }
}

test('setup installs docker, starts the daemon, and installs compose', async () => {
  const fake = harness('missing')
  const run = await ensureDocker({
    platform: 'linux',
    arch: 'x64',
    root: false,
    pluginDir: root,
    user: 'tester',
    log() {},
    confirm: async question => {
      fake.questions.push(question)
      return true
    },
    exec: fake.exec,
    attached: fake.attached,
  })
  assert.ok(fake.questions.some(question => question.includes('get.docker.com')))
  assert.ok(fake.questions.some(question => question.includes('not running')))
  assert.ok(fake.questions.some(question => question.includes('Compose')))
  assert.ok(fake.attachedCalls.some(call => call.includes('get.docker.com')))
  assert.ok(fake.attachedCalls.some(call => call.includes('systemctl')))
  assert.ok(fake.attachedCalls.some(call => call.includes('docker-compose-linux-x86_64')))
  const version = await run(['version'], 1000)
  assert.equal(version.code, 0)
})

test('a stopped socket that denies the user is used through sudo', async () => {
  const fake = harness('denied')
  const questions: string[] = []
  const run = await ensureDocker({
    platform: 'linux',
    arch: 'x64',
    root: false,
    pluginDir: root,
    user: 'tester',
    log() {},
    confirm: async question => {
      questions.push(question)
      return true
    },
    exec: fake.exec,
    attached: fake.attached,
  })
  assert.ok(questions.some(question => question.includes('sudo')))
  const result = await run(['info'], 1000, { SEARXNG_VERSION: '1' })
  assert.equal(result.code, 0)
  assert.ok(fake.attachedCalls.some(call => call.startsWith('sudo env SEARXNG_VERSION=1 docker info')))
})

test('declining a setup question stops before anything is installed', async () => {
  const fake = harness('down')
  await assert.rejects(
    ensureDocker({
      platform: 'linux',
      arch: 'x64',
      root: false,
      log() {},
      confirm: async () => false,
      exec: fake.exec,
      attached: fake.attached,
    }),
    /Setup cancelled/,
  )
  assert.equal(fake.attachedCalls.length, 0)
})
