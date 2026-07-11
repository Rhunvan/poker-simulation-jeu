import {
  createSiteSessionToken,
  isSameOriginMutation,
  serializeSiteSessionCookie,
  verifySitePassword,
} from '../../../../lib/siteAuth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: 'Origine refusée.' }, { status: 403 })
  }

  try {
    const payload = (await request.json()) as { password?: unknown }
    if (typeof payload.password !== 'string' || payload.password.length > 256) {
      return Response.json({ error: 'Mot de passe invalide.' }, { status: 400 })
    }
    if (!(await verifySitePassword(payload.password))) {
      return Response.json({ error: 'Mot de passe incorrect.' }, { status: 401 })
    }

    const token = await createSiteSessionToken()
    const response = Response.json({ ok: true })
    response.headers.append('set-cookie', serializeSiteSessionCookie(request, token))
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inattendue.'
    return Response.json({ error: message }, { status: 500 })
  }
}
