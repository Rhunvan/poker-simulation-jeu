import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { HeroAdviceAction } from '../src/engine/advisor/heroAdvisor'
import type { RealTableSpotInput } from '../src/engine/advisor/realTableAdvisor'
import type {
  GtoAdviceSnapshot,
  GtoProfileSnapshot,
  GtoTableContextSnapshot,
} from '../src/data/gtoHandRecords'

export const gtoHands = sqliteTable(
  'gto_hands',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    advisorVersion: text('advisor_version').notNull(),
    street: text('street').notNull(),
    position: text('position').notNull(),
    spot: text('spot_json', { mode: 'json' }).$type<RealTableSpotInput>().notNull(),
    theoretical: text('theoretical_json', { mode: 'json' }).$type<GtoAdviceSnapshot>().notNull(),
    adapted: text('adapted_json', { mode: 'json' }).$type<GtoAdviceSnapshot>().notNull(),
    tableContext: text('table_context_json', { mode: 'json' }).$type<GtoTableContextSnapshot>().notNull(),
    profiles: text('profiles_json', { mode: 'json' }).$type<GtoProfileSnapshot[]>().notNull(),
    actualAction: text('actual_action').$type<HeroAdviceAction>(),
    actualAmount: integer('actual_amount'),
    heroNet: integer('hero_net'),
    note: text('note').notNull().default(''),
  },
  (table) => [
    index('gto_hands_created_at_idx').on(table.createdAt),
    index('gto_hands_street_idx').on(table.street),
  ],
)
