import { count, desc, eq } from 'drizzle-orm'

import type { GtoHandRecord } from '../src/data/gtoHandRecords'
import { getDb } from './index'
import { gtoHands } from './schema'

export async function listGtoHandRecords(limit: number): Promise<GtoHandRecord[]> {
  const rows = await getDb()
    .select()
    .from(gtoHands)
    .orderBy(desc(gtoHands.createdAt), desc(gtoHands.id))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    schemaVersion: row.schemaVersion,
    advisorVersion: row.advisorVersion,
    spot: row.spot,
    theoretical: row.theoretical,
    adapted: row.adapted,
    tableContext: row.tableContext,
    profiles: row.profiles,
    ...(row.actualAction ? { actualAction: row.actualAction } : {}),
    ...(row.actualAmount === null ? {} : { actualAmount: row.actualAmount }),
    ...(row.heroNet === null ? {} : { heroNet: row.heroNet }),
    note: row.note,
  }))
}

export async function countGtoHandRecords(): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(gtoHands)
  return row?.value ?? 0
}

export async function insertGtoHandRecord(record: GtoHandRecord): Promise<void> {
  await getDb().insert(gtoHands).values({
    id: record.id,
    createdAt: record.createdAt,
    schemaVersion: record.schemaVersion,
    advisorVersion: record.advisorVersion,
    street: record.spot.street,
    position: record.spot.position,
    spot: record.spot,
    theoretical: record.theoretical,
    adapted: record.adapted,
    tableContext: record.tableContext,
    profiles: record.profiles,
    actualAction: record.actualAction ?? null,
    actualAmount: record.actualAmount ?? null,
    heroNet: record.heroNet ?? null,
    note: record.note,
  })
}

export async function deleteGtoHandRecord(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(gtoHands)
    .where(eq(gtoHands.id, id))
    .returning({ id: gtoHands.id })
  return deleted.length > 0
}
