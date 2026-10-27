const SECRET = /sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|nvapi-[A-Za-z0-9_-]+/g

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
