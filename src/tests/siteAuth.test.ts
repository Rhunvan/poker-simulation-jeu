import { beforeEach, describe, expect, it } from 'vitest'
import { env } from 'cloudflare:workers'

import {
  createSiteSessionToken,
  sanitizeReturnTo,
  verifySitePassword,
  verifySiteSessionToken,
} from '../../lib/siteAuth'

describe('protection du site', () => {
  beforeEach(() => {
    env.SITE_ACCESS_PASSWORD = 'mot-de-passe-de-test'
    env.SITE_SESSION_SECRET = 'secret-de-session-de-test-avec-plus-de-trente-deux-caracteres'
  })

  it('compare le mot de passe sans l’exposer dans le jeton', async () => {
    expect(await verifySitePassword('mot-de-passe-de-test')).toBe(true)
    expect(await verifySitePassword('mauvais')).toBe(false)
  })

  it('signe, expire et rejette un jeton altéré', async () => {
    const now = Date.UTC(2026, 6, 11, 12)
    const token = await createSiteSessionToken(now)

    expect(await verifySiteSessionToken(token, now + 1_000)).toBe(true)
    expect(await verifySiteSessionToken(`${token.slice(0, -1)}x`, now + 1_000)).toBe(false)
    expect(await verifySiteSessionToken(token, now + 8 * 24 * 60 * 60 * 1_000)).toBe(false)
    expect(token).not.toContain('mot-de-passe-de-test')
  })

  it('n’accepte qu’un retour interne au site', () => {
    expect(sanitizeReturnTo('/')).toBe('/')
    expect(sanitizeReturnTo('/gto?tab=mains')).toBe('/gto?tab=mains')
    expect(sanitizeReturnTo('//exemple.test')).toBe('/')
    expect(sanitizeReturnTo('https://exemple.test')).toBe('/')
  })
})
