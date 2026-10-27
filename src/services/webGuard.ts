import { isIP } from 'net'
import { lookup } from 'dns/promises'

export type SearchHit = { title: string; url: string; content: string }

const TEXT_CAP = 20_000

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_CAP)
}

export function parseSearxng(body: string, limit: number): SearchHit[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const results = (parsed as { results?: unknown }).results
  if (!Array.isArray(results)) return []
  const hits: SearchHit[] = []
  for (const row of results) {
    if (!row || typeof row !== 'object') continue
    const item = row as { title?: unknown; url?: unknown; content?: unknown }
    if (typeof item.url !== 'string') continue
    hits.push({
      title: typeof item.title === 'string' ? item.title : item.url,
      url: item.url,
      content: typeof item.content === 'string' ? item.content : '',
    })
    if (hits.length >= limit) break
  }
  return hits
}

function unwrap(address: string): string {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)
  return mapped?.[1] ?? host
}

export function isLoopback(address: string): boolean {
  const host = unwrap(address)
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '::' || host === '0.0.0.0' || host.startsWith('127.')
}

export function isBlockedHttpAddress(address: string): boolean {
  const host = unwrap(address)
  return host === '169.254.169.254' || host.startsWith('169.254.') || host.startsWith('fe80:') || host === '0.0.0.0' || host === '::'
}

export function isPrivateAddress(address: string): boolean {
  const host = unwrap(address)
  if (!isIP(host)) return false
  return (
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  )
}

export function isBlockedFetchAddress(address: string): boolean {
  return isBlockedHttpAddress(address) || isLoopback(address) || isPrivateAddress(address)
}

export async function assertFetchUrl(raw: string): Promise<URL> {
  return assertUrl(raw, isBlockedFetchAddress)
}

export async function assertHttpUrl(raw: string): Promise<URL> {
  return assertUrl(raw, isBlockedHttpAddress)
}

async function assertUrl(raw: string, blocked: (address: string) => boolean): Promise<URL> {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (blocked(host)) throw new Error('That address is blocked')
  if (isIP(host)) return url
  const records = await lookup(host, { all: true })
  for (const record of records) {
    if (blocked(record.address)) throw new Error('That address is blocked')
  }
  return url
}

export async function guardedFetch(
  raw: string,
  init: RequestInit,
  mode: 'public' | 'http',
  allow?: (url: URL) => boolean,
): Promise<Response> {
  const blocked = mode === 'public' ? isBlockedFetchAddress : isBlockedHttpAddress
  let current = await assertUrl(raw, blocked)
  for (let hop = 0; hop < 4; hop++) {
    if (allow && !allow(current)) throw new Error('Offline mode is on')
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) throw new Error('Redirect was blocked')
    current = await assertUrl(new URL(location, current).toString(), blocked)
  }
  throw new Error('Redirect was blocked')
}
