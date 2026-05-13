import {
  getAllEvents,
  getPendingEventCount,
  markEventsSynced,
  markEventsSyncError,
  upsertRemoteEvents,
} from './db'
import { isSupabaseConfigured, supabase } from './supabase'
import type { BabyEvent, BabyEventType } from './types'

const lastSyncKey = 'dangdang-last-sync-at'

interface RemoteBabyEvent {
  id: string
  user_id: string
  client_id: string
  type: BabyEventType
  timestamp: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface SyncResult {
  pushed: number
  pulled: number
  pending: number
  syncedAt: string | null
}

export function getLastSyncAt() {
  return window.localStorage.getItem(lastSyncKey)
}

function setLastSyncAt(value: string) {
  window.localStorage.setItem(lastSyncKey, value)
}

function toRemoteEvent(event: BabyEvent, userId: string) {
  return {
    id: event.remoteId || undefined,
    user_id: userId,
    client_id: event.clientId,
    type: event.type,
    timestamp: event.timestamp,
    created_at: event.createdAt,
    updated_at: event.updatedAt,
    deleted_at: event.deletedAt ?? null,
  }
}

function fromRemoteEvent(event: RemoteBabyEvent): BabyEvent {
  return {
    clientId: event.client_id,
    remoteId: event.id,
    type: event.type,
    timestamp: event.timestamp,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    deletedAt: event.deleted_at,
    syncStatus: 'synced',
  }
}

export async function syncEvents(userId: string): Promise<SyncResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      pushed: 0,
      pulled: 0,
      pending: await getPendingEventCount(),
      syncedAt: getLastSyncAt(),
    }
  }

  const allEvents = await getAllEvents()
  const pendingEvents = allEvents.filter(
    (event) => event.syncStatus === 'pending' || event.syncStatus === 'error',
  )
  let pushed = 0

  if (pendingEvents.length > 0) {
    const { data, error } = await supabase
      .from('baby_events')
      .upsert(
        pendingEvents.map((event) => toRemoteEvent(event, userId)),
        { onConflict: 'user_id,client_id' },
      )
      .select('id, client_id, updated_at')

    if (error) {
      await markEventsSyncError(pendingEvents.map((event) => event.clientId))
      throw error
    }

    pushed = data?.length ?? 0
    await markEventsSynced(
      (data ?? []).map((event) => ({
        clientId: event.client_id,
        remoteId: event.id,
        updatedAt: event.updated_at,
      })),
    )
  }

  const previousSyncAt = getLastSyncAt()
  let pullQuery = supabase
    .from('baby_events')
    .select(
      'id, user_id, client_id, type, timestamp, created_at, updated_at, deleted_at',
    )
    .order('updated_at', { ascending: true })

  if (previousSyncAt) {
    pullQuery = pullQuery.gte('updated_at', previousSyncAt)
  }

  const { data: remoteEvents, error: pullError } =
    await pullQuery.returns<RemoteBabyEvent[]>()

  if (pullError) {
    throw pullError
  }

  await upsertRemoteEvents((remoteEvents ?? []).map(fromRemoteEvent))

  const syncedAt =
    remoteEvents?.at(-1)?.updated_at ?? new Date().toISOString()
  setLastSyncAt(syncedAt)

  return {
    pushed,
    pulled: remoteEvents?.length ?? 0,
    pending: await getPendingEventCount(),
    syncedAt,
  }
}
