import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptAnswer,
  classifyDockerFailure,
  commandMissing,
  composeAsset,
  dockerActionPrompt,
  hostPlatform,
  nextDockerAction,
  type DockerProbe,
} from '../src/services/hostEnv.js'

function probe(overrides: Partial<DockerProbe> = {}): DockerProbe {
  return {
    platform: 'linux',
    cli: true,
    infoOk: true,
    failure: 'none',
    compose: true,
    curl: true,
    sudo: true,
    root: false,
    elevated: false,
    brew: false,
    winget: false,
    ...overrides,
  }
}

test('docker setup plans install, start, and sudo before it gives up', () => {
  assert.equal(hostPlatform('linux'), 'linux')
  assert.equal(hostPlatform('darwin'), 'darwin')
  assert.equal(hostPlatform('win32'), 'win32')
  assert.equal(hostPlatform('freebsd'), 'other')
  assert.equal(commandMissing('spawn docker ENOENT'), true)
  assert.equal(commandMissing('command not found'), true)
  assert.equal(commandMissing('not recognized as a command'), true)
  assert.equal(commandMissing('daemon down'), false)

  assert.equal(classifyDockerFailure(''), 'other')
  assert.equal(classifyDockerFailure('permission denied'), 'denied')
  assert.equal(classifyDockerFailure('Access denied'), 'denied')
  assert.equal(classifyDockerFailure('Is the docker daemon running?'), 'down')
  assert.equal(classifyDockerFailure('Cannot connect to the Docker daemon'), 'down')
  assert.equal(classifyDockerFailure('error during connect'), 'down')
  assert.equal(classifyDockerFailure('connection refused'), 'down')
  assert.equal(classifyDockerFailure('no such file or directory docker.sock'), 'down')
  assert.equal(classifyDockerFailure('no such file or directory'), 'other')

  assert.equal(composeAsset('linux', 'x64'), 'docker-compose-linux-x86_64')
  assert.equal(composeAsset('linux', 'arm64'), 'docker-compose-linux-aarch64')
  assert.equal(composeAsset('darwin', 'arm64'), 'docker-compose-darwin-aarch64')
  assert.equal(composeAsset('win32', 'x64'), 'docker-compose-windows-x86_64.exe')
  assert.equal(composeAsset('win32', 'arm64'), 'docker-compose-windows-aarch64.exe')
  assert.equal(composeAsset('linux', 'ia32'), null)
  assert.equal(composeAsset('other', 'x64'), null)

  assert.equal(acceptAnswer(''), true)
  assert.equal(acceptAnswer(' Y '), true)
  assert.equal(acceptAnswer('yes'), true)
  assert.equal(acceptAnswer('n'), false)
  assert.equal(acceptAnswer('no'), false)

  const absent = { cli: false, infoOk: false, compose: false, failure: 'other' as const }
  assert.equal(nextDockerAction(probe(), new Set()).kind, 'ready')
  assert.equal(nextDockerAction(probe({ compose: false }), new Set()).kind, 'install-compose')
  assert.equal(nextDockerAction(probe({ compose: false }), new Set(['install-compose'])).kind, 'unsupported')
  assert.equal(nextDockerAction(probe({ ...absent, curl: false }), new Set()).kind, 'install-curl')
  assert.equal(nextDockerAction(probe(absent), new Set()).kind, 'install-engine')
  assert.equal(nextDockerAction(probe({ ...absent, root: true, sudo: false, curl: false }), new Set()).kind, 'install-curl')
  assert.equal(nextDockerAction(probe({ ...absent, sudo: false }), new Set()).kind, 'unsupported')
  assert.equal(nextDockerAction(probe(absent), new Set(['install-engine'])).kind, 'unsupported')
  assert.equal(nextDockerAction(probe({ ...absent, platform: 'darwin', brew: true }), new Set()).kind, 'install-mac')
  assert.equal(nextDockerAction(probe({ ...absent, platform: 'darwin', brew: false }), new Set()).kind, 'start')
  assert.equal(
    nextDockerAction(probe({ ...absent, platform: 'darwin', brew: true }), new Set(['install-mac'])).kind,
    'start',
  )
  assert.equal(
    nextDockerAction(probe({ ...absent, platform: 'darwin', brew: false }), new Set(['start'])).kind,
    'unsupported',
  )
  assert.equal(
    nextDockerAction(probe({ ...absent, platform: 'darwin', brew: true }), new Set(['install-mac', 'start'])).kind,
    'unsupported',
  )
  assert.equal(nextDockerAction(probe({ ...absent, platform: 'win32', winget: true }), new Set()).kind, 'install-windows')
  assert.equal(nextDockerAction(probe({ ...absent, platform: 'win32', winget: false }), new Set()).kind, 'start')
  assert.equal(
    nextDockerAction(probe({ ...absent, platform: 'win32', winget: true }), new Set(['install-windows'])).kind,
    'start',
  )
  assert.equal(
    nextDockerAction(probe({ ...absent, platform: 'win32', winget: false }), new Set(['start'])).kind,
    'unsupported',
  )
  assert.equal(
    nextDockerAction(probe({ ...absent, platform: 'win32', winget: true }), new Set(['install-windows', 'start'])).kind,
    'unsupported',
  )
  assert.equal(nextDockerAction(probe({ ...absent, platform: 'other' }), new Set()).kind, 'unsupported')
  assert.equal(
    nextDockerAction(probe({ infoOk: false, failure: 'down', compose: false }), new Set()).kind,
    'start',
  )
  assert.equal(
    nextDockerAction(probe({ infoOk: false, failure: 'denied', compose: false }), new Set()).kind,
    'use-sudo',
  )
  assert.equal(
    nextDockerAction(probe({ infoOk: false, failure: 'denied', compose: false, sudo: false }), new Set()).kind,
    'start',
  )
  assert.equal(
    nextDockerAction(
      probe({ infoOk: false, failure: 'denied', compose: false, elevated: true }),
      new Set(['use-sudo']),
    ).kind,
    'start',
  )
  assert.equal(
    nextDockerAction(
      probe({ infoOk: false, failure: 'denied', compose: false, sudo: false }),
      new Set(['start']),
    ).kind,
    'unsupported',
  )
  assert.equal(
    nextDockerAction(probe({ infoOk: false, failure: 'other', compose: false }), new Set(['start'])).kind,
    'unsupported',
  )
  assert.equal(
    nextDockerAction(probe({ infoOk: false, failure: 'none', compose: false }), new Set()).kind,
    'unsupported',
  )

  const kinds = [
    'ready',
    'install-curl',
    'install-engine',
    'install-compose',
    'install-mac',
    'install-windows',
    'start',
    'use-sudo',
    'unsupported',
  ] as const
  for (const kind of kinds) {
    const action = kind === 'unsupported' ? { kind, reason: 'nope' } : { kind }
    const prompt = dockerActionPrompt(action)
    if (kind === 'ready') assert.equal(prompt, '')
    else assert.ok(prompt.length > 0)
  }
})
