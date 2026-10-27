const SECRET = /sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|nvapi-[A-Za-z0-9_-]+/g
const SECRET_ENV = /(API_KEY|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)/i

export function scrubbedEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value == null || SECRET_ENV.test(key)) continue
    env[key] = value
  }
  return env
}

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET, '[redacted]')
    .replace(/^.*(API_KEY|TOKEN|SECRET).*$/gim, '[redacted]')
}

export function truncateShare(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) : value
  if (Array.isArray(value)) return value.map(item => truncateShare(item))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = truncateShare(item)
    return out
  }
  return value
}

export function shareBody(messages: unknown): string {
  return redactSecrets(JSON.stringify(truncateShare(messages), null, 2))
}
