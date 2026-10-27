import { lookup } from 'dns/promises'
import { request as httpRequest } from 'http'
import { request as httpsRequest, type RequestOptions } from 'https'
import { isIP } from 'net'

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
  return (await resolvePinnedUrl(raw, isBlockedFetchAddress)).url
}

export async function assertHttpUrl(raw: string): Promise<URL> {
  return (await resolvePinnedUrl(raw, isBlockedHttpAddress)).url
}

export function pinnedRequestOptions(
  url: URL,
  address: string,
  init: RequestInit,
): RequestOptions {
  const headers = headerRecord(init.headers)
  headers.host = url.host
  return {
    host: address,
    servername: url.hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: init.method ?? 'GET',
    headers,
  }
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

async function resolvePinnedUrl(
  raw: string,
  blocked: (address: string) => boolean,
): Promise<{ url: URL; address: string }> {
  const url = new URL(raw)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (blocked(host)) throw new Error('That address is blocked')
  if (isIP(host)) return { url, address: unwrap(host) }
  const records = await lookup(host, { all: true })
  for (const record of records) {
    if (blocked(record.address)) throw new Error('That address is blocked')
  }
  const address = records[0]?.address
  if (!address) throw new Error('That address is blocked')
  return { url, address }
}

function pinnedFetch(url: URL, address: string, init: RequestInit): Promise<Response> {
  const options = pinnedRequestOptions(url, address, init)
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = send(options, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      response.on('end', () => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers.set(key, value)
          else if (Array.isArray(value)) headers.set(key, value.join(', '))
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 500,
          headers,
        }))
      })
    })
    const fail = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)))
    req.on('error', fail)
    if (init.signal) {
      const abort = () => req.destroy(new Error('This operation was aborted'))
      if (init.signal.aborted) abort()
      else init.signal.addEventListener('abort', abort, { once: true })
    }
    if (typeof init.body === 'string') req.write(init.body)
    else if (Buffer.isBuffer(init.body)) req.write(init.body)
    req.end()
  })
}

export async function guardedFetch(
  raw: string,
  init: RequestInit,
  mode: 'public' | 'http',
  allow?: (url: URL) => boolean,
): Promise<Response> {
  const blocked = mode === 'public' ? isBlockedFetchAddress : isBlockedHttpAddress
  let current = await resolvePinnedUrl(raw, blocked)
  for (let hop = 0; hop < 4; hop++) {
    if (allow && !allow(current.url)) throw new Error('Offline mode is on')
    const response = await pinnedFetch(current.url, current.address, init)
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) throw new Error('Redirect was blocked')
    current = await resolvePinnedUrl(new URL(location, current.url).toString(), blocked)
  }
  throw new Error('Redirect was blocked')
}
