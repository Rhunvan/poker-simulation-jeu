import {
  isSameOriginMutation,
  serializeExpiredSiteSessionCookie,
} from '../../../../lib/siteAuth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: 'Origine refusée.' }, { status: 403 })
  }

  const response = Response.json({ ok: true })
  response.headers.append('set-cookie', serializeExpiredSiteSessionCookie(request))
  return response
}
