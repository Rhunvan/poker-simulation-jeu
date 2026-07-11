import { env } from 'cloudflare:workers'

export const SITE_SESSION_COOKIE = 'pokernaud_session'

const SESSION_VERSION = 'v1'
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7
const encoder = new TextEncoder()

interface SiteRuntimeEnv {
  SITE_ACCESS_PASSWORD?: string
  SITE_SESSION_SECRET?: string
}

function getRuntimeEnv(): SiteRuntimeEnv {
  return env as unknown as SiteRuntimeEnv
}

function requireRuntimeValue(name: keyof SiteRuntimeEnv): string {
  const value = getRuntimeEnv()[name]
  if (!value) {
    throw new Error(`Le secret runtime ${name} est absent.`)
  }
  return value
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

async function importSessionKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(requireRuntimeValue('SITE_SESSION_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function digest(value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

export async function verifySitePassword(candidate: string): Promise<boolean> {
  const expected = requireRuntimeValue('SITE_ACCESS_PASSWORD')
  const [candidateDigest, expectedDigest] = await Promise.all([digest(candidate), digest(expected)])
  return constantTimeEqual(candidateDigest, expectedDigest)
}

export async function createSiteSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1_000) + SESSION_DURATION_SECONDS
  const payload = `${SESSION_VERSION}.${expiresAt}`
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await importSessionKey(), encoder.encode(payload)),
  )
  return `${payload}.${bytesToBase64Url(signature)}`
}

export async function verifySiteSessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) {
    return false
  }

  const [version, expirationValue, encodedSignature, extra] = token.split('.')
  if (version !== SESSION_VERSION || !expirationValue || !encodedSignature || extra !== undefined) {
    return false
  }

  const expiresAt = Number(expirationValue)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1_000)) {
    return false
  }

  const signature = base64UrlToBytes(encodedSignature)
  if (!signature) {
    return false
  }

  return crypto.subtle.verify(
    'HMAC',
    await importSessionKey(),
    signature,
    encoder.encode(`${version}.${expirationValue}`),
  )
}

export function getCookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue
    }
    return part.slice(separator + 1).trim()
  }
  return undefined
}

export async function isSiteApiRequestAuthorized(request: Request): Promise<boolean> {
  const token = getCookieValue(request.headers.get('cookie'), SITE_SESSION_COOKIE)
  return verifySiteSessionToken(token)
}

export function serializeSiteSessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SITE_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}${secure}`
}

export function serializeExpiredSiteSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SITE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

export function sanitizeReturnTo(value: string | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}
