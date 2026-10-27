import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type ProjectMarkers = {
  packageTest?: string
  packageTypecheck?: string
  tsconfig?: boolean
  pytest?: boolean
  cargo?: boolean
  go?: boolean
  pnpm?: boolean
  yarn?: boolean
  npm?: boolean
  pip?: boolean
}

export type PackageAction = 'install' | 'add' | 'remove'

export function readProjectMarkers(dir: string): ProjectMarkers {
  const exists = (name: string) => existsSync(join(dir, name))
  let packageTest: string | undefined
  let packageTypecheck: string | undefined
  if (exists('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        scripts?: { test?: unknown; typecheck?: unknown }
      }
      if (typeof pkg.scripts?.test === 'string') packageTest = pkg.scripts.test
      if (typeof pkg.scripts?.typecheck === 'string') packageTypecheck = pkg.scripts.typecheck
    } catch {
      packageTest = undefined
    }
  }
  const pyproject = exists('pyproject.toml')
    ? readFileSync(join(dir, 'pyproject.toml'), 'utf8')
    : ''
  return {
    packageTest,
    packageTypecheck,
    tsconfig: exists('tsconfig.json'),
    pytest: exists('pytest.ini') || pyproject.includes('pytest'),
    cargo: exists('Cargo.toml'),
    go: exists('go.mod'),
    pnpm: exists('pnpm-lock.yaml'),
    yarn: exists('yarn.lock'),
    npm: exists('package.json'),
    pip: exists('requirements.txt') || pyproject.length > 0,
  }
}

export function detectTestArgv(project: ProjectMarkers, filter?: string): string[] | null {
  if (project.packageTest) {
    const script = project.packageTest
    if (filter && (script.includes('vitest') || script.includes('jest'))) {
      return ['npm', 'test', '--', '-t', filter]
    }
    if (filter && (script.includes('node --test') || script.includes('node:test'))) {
      return ['npm', 'test', '--', '--test-name-pattern', filter]
    }
    return ['npm', 'test']
  }
  if (project.pytest) return filter ? ['pytest', '-k', filter] : ['pytest']
  if (project.cargo) return filter ? ['cargo', 'test', '--', filter] : ['cargo', 'test']
  if (project.go) return filter ? ['go', 'test', './...', '-run', filter] : ['go', 'test', './...']
  return null
}

export function packageArgv(project: ProjectMarkers, action: PackageAction, name?: string): string[] {
  if ((action === 'add' || action === 'remove') && !name) {
    throw new Error('name is required')
  }
  if (name && (name.startsWith('-') || !/^[@a-zA-Z0-9._/-]+$/.test(name))) {
    throw new Error('package name contains unsupported characters')
  }
  if (project.pnpm) {
    if (action === 'install') return ['pnpm', 'install']
    if (action === 'add') return ['pnpm', 'add', name!]
    return ['pnpm', 'remove', name!]
  }
  if (project.yarn) {
    if (action === 'install') return ['yarn', 'install']
    if (action === 'add') return ['yarn', 'add', name!]
    return ['yarn', 'remove', name!]
  }
  if (project.npm) {
    if (action === 'install') return ['npm', 'install']
    if (action === 'add') return ['npm', 'install', name!]
    return ['npm', 'uninstall', name!]
  }
  if (project.pip) {
    if (action === 'install') return ['pip', 'install', '-r', 'requirements.txt']
    if (action === 'add') return ['pip', 'install', name!]
    return ['pip', 'uninstall', '-y', name!]
  }
  if (project.cargo) {
    if (action === 'install') return ['cargo', 'fetch']
    if (action === 'add') return ['cargo', 'add', name!]
    return ['cargo', 'remove', name!]
  }
  if (project.go) {
    if (action === 'install') return ['go', 'mod', 'download']
    if (action === 'add') return ['go', 'get', name!]
    return ['go', 'get', `${name!}@none`]
  }
  throw new Error('No package manager found')
}

export function checkArgv(project: ProjectMarkers): string[] | null {
  if (project.packageTypecheck) return ['npm', 'run', 'typecheck']
  if (project.tsconfig) return ['npx', 'tsc', '--noEmit', '--pretty', 'false']
  return null
}

export function failureLines(output: string): string[] {
  const found: string[] = []
  for (const match of output.matchAll(/([\w./\\-]+\.(?:ts|tsx|js|jsx|py|go|rs)):(\d+)/g)) {
    const line = `${match[1]}:${match[2]}`
    if (!found.includes(line)) found.push(line)
    if (found.length >= 20) break
  }
  return found
}

export function tailLines(text: string, count: number): string {
  return text.split('\n').slice(-count).join('\n')
}

export function topCpuProf(profile: {
  nodes?: { callFrame?: { functionName?: string }; hitCount?: number }[]
}): string[] {
  const nodes = profile.nodes ?? []
  return nodes
    .map(node => ({
      name: node.callFrame?.functionName || '(anonymous)',
      hits: node.hitCount ?? 0,
    }))
    .sort((left, right) => right.hits - left.hits)
    .slice(0, 20)
    .map(node => `${node.hits} ${node.name}`)
}

const MERMAID = ['flowchart', 'sequenceDiagram', 'classDiagram', 'erDiagram']

export function mermaidSource(source: string): string | null {
  if (MERMAID.some(kind => source.includes(kind))) return source
  return null
}
