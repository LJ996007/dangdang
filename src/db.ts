import Dexie, { type Table } from 'dexie'
import type { BabyEvent, BabyEventType } from './types'

class DangdangDb extends Dexie {
  events!: Table<BabyEvent, number>

  constructor() {
    super('dangdang-baby-tracker')
    this.version(1).stores({
      events: '++id,timestamp,type,createdAt',
    })
  }
}

export const db = new DangdangDb()

const normalizeEvent = (event: BabyEvent): BabyEvent => ({
  type: event.type,
  timestamp: new Date(event.timestamp).toISOString(),
  createdAt: event.createdAt
    ? new Date(event.createdAt).toISOString()
    : new Date().toISOString(),
})

export async function addEvent(type: BabyEventType, at = new Date()) {
  const now = new Date().toISOString()
  await db.events.add({
    type,
    timestamp: at.toISOString(),
    createdAt: now,
  })
}

export async function getEvents() {
  return db.events.orderBy('timestamp').toArray()
}

export async function replaceEvents(events: BabyEvent[]) {
  const normalized = events.map(normalizeEvent)
  await db.transaction('rw', db.events, async () => {
    await db.events.clear()
    await db.events.bulkAdd(normalized)
  })
}

export async function deleteEvent(id: number) {
  await db.events.delete(id)
}

export async function updateEventTimestamp(id: number, timestamp: Date) {
  await db.events.update(id, { timestamp: timestamp.toISOString() })
}

export async function clearEvents() {
  await db.events.clear()
}
