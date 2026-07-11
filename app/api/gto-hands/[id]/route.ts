import { deleteGtoHandRecord } from '../../../../db/gtoHands'
import {
  isSameOriginMutation,
  isSiteApiRequestAuthorized,
} from '../../../../lib/siteAuth'

export const dynamic = 'force-dynamic'

interface DeleteRouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(request: Request, context: DeleteRouteContext) {
  if (!(await isSiteApiRequestAuthorized(request))) {
    return Response.json({ error: 'Accès refusé.' }, { status: 401 })
  }
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: 'Origine refusée.' }, { status: 403 })
  }

  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    return Response.json({ error: 'Identifiant de main invalide.' }, { status: 400 })
  }

  try {
    const deleted = await deleteGtoHandRecord(id)
    if (!deleted) {
      return Response.json({ error: 'Main introuvable.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch {
    return Response.json(
      { error: 'La suppression est momentanément indisponible.' },
      { status: 500 },
    )
  }
}
