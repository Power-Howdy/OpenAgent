import { getGlobalConfig } from '../utils/config.js'

export const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1'

export type ProviderKind = 'anthropic' | 'openai' | 'compatible' | 'free'

export type ResolvedProvider = {
  kind: ProviderKind
  model: string
  fastModel: string
  baseURL?: string
  apiKey?: string
  nvidiaApiKey?: string
  localBaseURL: string
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveNimApiKey(
  envValue = process.env.NVIDIA_API_KEY,
  configValue?: string,
): string | undefined {
  return clean(envValue) ?? clean(configValue)
}

export function resolveProvider(): ResolvedProvider {
  const config = getGlobalConfig()
  const requested = clean(process.env.OPENAGENT_PROVIDER) ?? clean(config.provider)
  const nvidiaApiKey = resolveNimApiKey(process.env.NVIDIA_API_KEY, config.nvidiaApiKey)
  const anthropicKey =
    clean(process.env.ANTHROPIC_API_KEY) ?? clean(config.primaryApiKey)
  const openaiKey = clean(process.env.OPENAI_API_KEY)
  const compatibleKey =
    clean(process.env.OPENAI_COMPATIBLE_API_KEY) ?? clean(config.compatibleApiKey)
  const model = clean(process.env.OPENAGENT_MODEL) ?? clean(config.model)
  const baseURL =
    clean(process.env.OPENAGENT_BASE_URL) ??
    clean(process.env.OPENAI_COMPATIBLE_BASE_URL) ??
    clean(config.baseURL)
  const localBaseURL =
    clean(process.env.OPENAGENT_LOCAL_BASE_URL) ??
    clean(config.localBaseURL) ??
    DEFAULT_LOCAL_BASE_URL

  let kind: ProviderKind = 'free'
  if (
    requested === 'anthropic' ||
    requested === 'openai' ||
    requested === 'compatible' ||
    requested === 'free'
  ) {
    kind = requested
  } else if (anthropicKey) kind = 'anthropic'
  else if (openaiKey) kind = 'openai'
  else if (compatibleKey) kind = 'compatible'

  const defaults: Record<ProviderKind, { model: string; fastModel: string }> = {
    anthropic: {
      model: 'claude-sonnet-4-5',
      fastModel: 'claude-haiku-4-5',
    },
    openai: { model: 'gpt-4.1', fastModel: 'gpt-4.1-mini' },
    compatible: { model: model ?? 'openai/gpt-4.1', fastModel: model ?? 'openai/gpt-4.1-mini' },
    free: { model: 'free-mode', fastModel: 'qwen3-0.6b' },
  }

  return {
    kind,
    model: model ?? defaults[kind].model,
    fastModel: clean(config.fastModel) ?? defaults[kind].fastModel,
    baseURL,
    apiKey:
      kind === 'anthropic'
        ? anthropicKey
        : kind === 'openai'
          ? openaiKey
          : kind === 'compatible'
            ? compatibleKey
            : undefined,
    nvidiaApiKey,
    localBaseURL,
  }
}

export function isFreeMode(): boolean {
  return resolveProvider().kind === 'free'
}

const LOCAL_BIND_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

export function localEndpointBind(
  baseURL: string,
): { host: string; port: string } | null {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return null
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!LOCAL_BIND_HOSTS.has(hostname)) return null
  const host = hostname === 'localhost' || hostname === '::1' ? '127.0.0.1' : hostname
  return { host, port: url.port || '8080' }
}
