import Dexie, { type Table } from 'dexie'
import type { BabyEvent, BabyEventType, WeightOwner } from './types'
import { normalizeWeightKg, normalizeWeightOwner } from './weights'

class DangdangDb extends Dexie {
  events!: Table<BabyEvent, number>

  constructor() {
    super('dangdang-baby-tracker')
    this.version(1).stores({
      events: '++id,timestamp,type,createdAt',
    })
    this.version(2)
      .stores({
        events:
          '++id,clientId,remoteId,timestamp,type,createdAt,updatedAt,deletedAt,syncStatus',
      })
      .upgrade((transaction) =>
        transaction
          .table<BabyEvent, number>('events')
          .toCollection()
          .modify((event) => {
            const now = new Date().toISOString()
            const createdAt = event.createdAt
              ? new Date(event.createdAt).toISOString()
              : now
            event.clientId = event.clientId || createClientId()
            event.remoteId = event.remoteId ?? null
            event.timestamp = new Date(event.timestamp).toISOString()
            event.createdAt = createdAt
            event.updatedAt = event.updatedAt
              ? new Date(event.updatedAt).toISOString()
              : createdAt
            event.deletedAt = event.deletedAt
              ? new Date(event.deletedAt).toISOString()
              : null
            event.syncStatus = event.syncStatus || 'pending'
          }),
      )
    this.version(3)
      .stores({
        events:
          '++id,clientId,remoteId,timestamp,type,createdAt,updatedAt,deletedAt,syncStatus',
      })
      .upgrade((transaction) =>
        transaction
          .table<BabyEvent, number>('events')
          .toCollection()
          .modify((event) => {
            event.weightKg =
              event.type === 'weight' ? normalizeWeightKg(event.weightKg) : null
          }),
      )
    this.version(4)
      .stores({
        events:
          '++id,clientId,remoteId,timestamp,type,createdAt,updatedAt,deletedAt,syncStatus',
      })
      .upgrade((transaction) =>
        transaction
          .table<BabyEvent, number>('events')
          .toCollection()
          .modify((event) => {
            const weightKg =
              event.type === 'weight' ? normalizeWeightKg(event.weightKg) : null
            event.weightKg = weightKg
            event.weightOwner =
              event.type === 'weight'
                ? normalizeWeightOwner(event.weightOwner, weightKg)
                : null
          }),
      )
  }
}

export const db = new DangdangDb()

export function createClientId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const toIsoOrNull = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null

const normalizeEvent = (
  event: Partial<BabyEvent> & Pick<BabyEvent, 'type' | 'timestamp'>,
  options: { forcePending?: boolean } = {},
): BabyEvent => {
  const now = new Date().toISOString()
  const createdAt = event.createdAt
    ? new Date(event.createdAt).toISOString()
    : now
  const updatedAt = event.updatedAt
    ? new Date(event.updatedAt).toISOString()
    : createdAt

  return {
    clientId: event.clientId || createClientId(),
    remoteId: event.remoteId ?? null,
    type: event.type,
    weightKg:
      event.type === 'weight' ? normalizeWeightKg(event.weightKg) : null,
    weightOwner:
      event.type === 'weight'
        ? normalizeWeightOwner(
            event.weightOwner,
            normalizeWeightKg(event.weightKg),
          )
        : null,
    timestamp: new Date(event.timestamp).toISOString(),
    createdAt,
    updatedAt: options.forcePending ? now : updatedAt,
    deletedAt: toIsoOrNull(event.deletedAt),
    syncStatus: options.forcePending ? 'pending' : event.syncStatus ?? 'pending',
  }
}

export async function addEvent(type: BabyEventType, at = new Date()) {
  const now = new Date().toISOString()
  const event = normalizeEvent({
    type,
    timestamp: at.toISOString(),
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
  })
  const id = await db.events.add(event)
  return { ...event, id }
}

export async function addWeightEvent(
  weightKg: number,
  weightOwner: WeightOwner,
  at = new Date(),
) {
  const normalizedWeightKg = normalizeWeightKg(weightKg)
  if (normalizedWeightKg == null) {
    throw new Error('invalid weight')
  }

  const now = new Date().toISOString()
  const event = normalizeEvent({
    type: 'weight',
    weightKg: normalizedWeightKg,
    weightOwner,
    timestamp: at.toISOString(),
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending',
  })
  const id = await db.events.add(event)
  return { ...event, id }
}

export async function getEvents() {
  const events = await db.events.orderBy('timestamp').toArray()
  return events.filter((event) => !event.deletedAt)
}

export async function getAllEvents() {
  return db.events.orderBy('timestamp').toArray()
}

export async function getPendingEventCount() {
  return db.events
    .where('syncStatus')
    .anyOf(['pending', 'error'])
    .count()
}

export async function replaceEvents(events: BabyEvent[]) {
  const normalized = events.map((event) =>
    normalizeEvent(event, { forcePending: true }),
  )
  await db.transaction('rw', db.events, async () => {
    await db.events.clear()
    await db.events.bulkAdd(normalized)
  })
}

export async function deleteEvent(id: number) {
  const deletedAt = new Date().toISOString()
  await db.events.update(id, {
    deletedAt,
    updatedAt: deletedAt,
    syncStatus: 'pending',
  })
}

export async function updateEventTimestamp(id: number, timestamp: Date) {
  const updatedAt = new Date().toISOString()
  await db.events.update(id, {
    timestamp: timestamp.toISOString(),
    updatedAt,
    syncStatus: 'pending',
  })
}

export async function updateEventDetails(
  id: number,
  updates: { timestamp: Date; weightKg?: number; weightOwner?: WeightOwner },
) {
  const updatedAt = new Date().toISOString()
  const nextUpdates: Partial<BabyEvent> = {
    timestamp: updates.timestamp.toISOString(),
    updatedAt,
    syncStatus: 'pending',
  }

  if (updates.weightKg != null) {
    const normalizedWeightKg = normalizeWeightKg(updates.weightKg)
    if (normalizedWeightKg == null) {
      throw new Error('invalid weight')
    }
    nextUpdates.weightKg = normalizedWeightKg
    nextUpdates.weightOwner = normalizeWeightOwner(
      updates.weightOwner,
      normalizedWeightKg,
    )
  }

  await db.events.update(id, nextUpdates)
}

export async function clearEvents() {
  const deletedAt = new Date().toISOString()
  const liveEvents = await getEvents()
  await db.transaction('rw', db.events, async () => {
    await Promise.all(
      liveEvents
        .filter((event) => event.id != null)
        .map((event) =>
          db.events.update(event.id!, {
            deletedAt,
            updatedAt: deletedAt,
            syncStatus: 'pending',
          }),
        ),
    )
  })
}

export async function upsertRemoteEvents(events: BabyEvent[]) {
  await db.transaction('rw', db.events, async () => {
    for (const event of events) {
      const normalized = normalizeEvent(event)
      const existing = await db.events
        .where('clientId')
        .equals(normalized.clientId)
        .first()

      if (!existing?.id) {
        await db.events.add(normalized)
        continue
      }

      const localUpdatedAt = new Date(existing.updatedAt).getTime()
      const remoteUpdatedAt = new Date(normalized.updatedAt).getTime()
      const localPending =
        existing.syncStatus === 'pending' || existing.syncStatus === 'error'

      if (localPending && localUpdatedAt > remoteUpdatedAt) {
        continue
      }

      await db.events.update(existing.id, normalized)
    }
  })
}

export async function markEventsSynced(
  syncedEvents: Array<{
    clientId: string
    remoteId: string
    updatedAt: string
  }>,
) {
  await db.transaction('rw', db.events, async () => {
    await Promise.all(
      syncedEvents.map((event) =>
        db.events
          .where('clientId')
          .equals(event.clientId)
          .modify({
            remoteId: event.remoteId,
            updatedAt: event.updatedAt,
            syncStatus: 'synced',
          }),
      ),
    )
  })
}

export async function markEventsSyncError(clientIds: string[]) {
  await db.transaction('rw', db.events, async () => {
    await Promise.all(
      clientIds.map((clientId) =>
        db.events.where('clientId').equals(clientId).modify({
          syncStatus: 'error',
        }),
      ),
    )
  })
}
