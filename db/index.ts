import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema'

export function getDb() {
  const database = env.DB as Parameters<typeof drizzle>[0] | undefined
  if (!database) {
    throw new Error(
      'Le binding Cloudflare D1 `DB` est indisponible. Vérifie le champ `d1` dans .openai/hosting.json.',
    )
  }

  return drizzle(database, { schema })
}
