import { botProfilesById } from '../../../src/config/botProfiles'
import { tableConfig } from '../../../src/config/tableConfig'
import {
  GTO_ADVISOR_VERSION,
  GTO_HAND_RECORD_SCHEMA_VERSION,
  parseCreateGtoHandRequest,
  toGtoAdviceSnapshot,
  toGtoProfileSnapshot,
  toGtoTableContextSnapshot,
  type GtoHandListResponse,
  type GtoHandRecord,
  type GtoHandResponse,
} from '../../../src/data/gtoHandRecords'
import { analyzeRealTableSpot } from '../../../src/engine/advisor/realTableAdvisor'
import {
  countGtoHandRecords,
  insertGtoHandRecord,
  listGtoHandRecords,
} from '../../../db/gtoHands'
import {
  isSameOriginMutation,
  isSiteApiRequestAuthorized,
} from '../../../lib/siteAuth'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 100_000

function routeError(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Erreur inattendue.'
  const isMissingTable = message.includes('no such table') || message.includes('gto_hands')
  return Response.json(
    {
      error: isMissingTable
        ? 'Le stockage des mains n’est pas encore initialisé.'
        : 'Le stockage des mains est momentanément indisponible.',
    },
    { status: 500 },
  )
}

function noStoreJson<T>(payload: T, init?: ResponseInit): Response {
  const response = Response.json(payload, init)
  response.headers.set('cache-control', 'private, no-store')
  return response
}

export async function GET(request: Request) {
  if (!(await isSiteApiRequestAuthorized(request))) {
    return noStoreJson({ error: 'Accès refusé.' }, { status: 401 })
  }

  const requestedLimit = Number(new URL(request.url).searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 50

  try {
    const [hands, count] = await Promise.all([
      listGtoHandRecords(limit),
      countGtoHandRecords(),
    ])
    return noStoreJson({ hands, count } satisfies GtoHandListResponse)
  } catch (error) {
    return routeError(error)
  }
}

export async function POST(request: Request) {
  if (!(await isSiteApiRequestAuthorized(request))) {
    return noStoreJson({ error: 'Accès refusé.' }, { status: 401 })
  }
  if (!isSameOriginMutation(request)) {
    return noStoreJson({ error: 'Origine refusée.' }, { status: 403 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_REQUEST_BYTES) {
    return noStoreJson({ error: 'La main envoyée est trop volumineuse.' }, { status: 413 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return noStoreJson({ error: 'Le contenu envoyé n’est pas du JSON valide.' }, { status: 400 })
  }

  const parsed = parseCreateGtoHandRequest(payload)
  if (!parsed.ok) {
    return noStoreJson({ error: parsed.error }, { status: 400 })
  }

  const result = analyzeRealTableSpot(parsed.value.spot, tableConfig, botProfilesById)
  if (!result.analysis) {
    return noStoreJson(
      { error: result.errors[0] ?? 'Le spot ne peut pas être analysé.' },
      { status: 422 },
    )
  }

  const record: GtoHandRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    schemaVersion: GTO_HAND_RECORD_SCHEMA_VERSION,
    advisorVersion: GTO_ADVISOR_VERSION,
    spot: structuredClone(result.analysis.input),
    theoretical: toGtoAdviceSnapshot(result.analysis.theoretical),
    adapted: toGtoAdviceSnapshot(result.analysis.adapted),
    tableContext: toGtoTableContextSnapshot(tableConfig),
    profiles: result.analysis.input.opponentIds.flatMap((id) => {
      const profile = botProfilesById[id]
      return profile ? [toGtoProfileSnapshot(profile)] : []
    }),
    ...(parsed.value.actualAction ? { actualAction: parsed.value.actualAction } : {}),
    ...(parsed.value.actualAmount === undefined ? {} : { actualAmount: parsed.value.actualAmount }),
    ...(parsed.value.heroNet === undefined ? {} : { heroNet: parsed.value.heroNet }),
    note: parsed.value.note ?? '',
  }

  try {
    await insertGtoHandRecord(record)
    return noStoreJson({ hand: record } satisfies GtoHandResponse, { status: 201 })
  } catch (error) {
    return routeError(error)
  }
}
