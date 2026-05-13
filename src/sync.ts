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
  weight_kg: number | null
  timestamp: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type RemoteWritePayload = Omit<RemoteBabyEvent, 'id'>
type RemoteWriteResult = Pick<RemoteBabyEvent, 'id' | 'client_id' | 'updated_at'>
type SupabaseClient = NonNullable<typeof supabase>

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

function toRemoteEvent(
  event: BabyEvent,
  userId: string,
  syncedAt: string,
): RemoteWritePayload {
  return {
    user_id: userId,
    client_id: event.clientId,
    type: event.type,
    weight_kg: event.type === 'weight' ? event.weightKg ?? null : null,
    timestamp: event.timestamp,
    created_at: event.createdAt,
    updated_at: syncedAt,
    deleted_at: event.deletedAt ?? null,
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return ['message', 'details', 'hint', 'code']
      .map((key) => record[key])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
      .join(' / ')
  }

  return '未知错误'
}

async function updateRemoteEvent(
  client: SupabaseClient,
  remoteId: string,
  payload: RemoteWritePayload,
) {
  const { data, error } = await client
    .from('baby_events')
    .update(payload)
    .eq('id', remoteId)
    .select('id, client_id, updated_at')
    .maybeSingle<RemoteWriteResult>()

  if (error) {
    throw error
  }

  return data
}

async function findRemoteEvent(client: SupabaseClient, clientId: string) {
  const { data, error } = await client
    .from('baby_events')
    .select('id')
    .eq('client_id', clientId)
    .limit(1)
    .maybeSingle<Pick<RemoteBabyEvent, 'id'>>()

  if (error) {
    throw error
  }

  return data
}

async function insertRemoteEvent(
  client: SupabaseClient,
  payload: RemoteWritePayload,
) {
  const { data, error } = await client
    .from('baby_events')
    .insert(payload)
    .select('id, client_id, updated_at')
    .single<RemoteWriteResult>()

  if (error) {
    throw error
  }

  return data
}

async function pushRemoteEvent(
  client: SupabaseClient,
  event: BabyEvent,
  userId: string,
) {
  const payload = toRemoteEvent(event, userId, new Date().toISOString())

  if (event.remoteId) {
    const updatedEvent = await updateRemoteEvent(client, event.remoteId, payload)
    if (updatedEvent) {
      return updatedEvent
    }
  }

  const existingEvent = await findRemoteEvent(client, event.clientId)
  if (existingEvent) {
    const updatedEvent = await updateRemoteEvent(
      client,
      existingEvent.id,
      payload,
    )
    if (updatedEvent) {
      return updatedEvent
    }
  }

  return insertRemoteEvent(client, payload)
}

async function pushLocalEvents(
  client: SupabaseClient,
  events: BabyEvent[],
  userId: string,
) {
  const syncedEvents: Array<{
    clientId: string
    remoteId: string
    updatedAt: string
  }> = []
  const failedMessages: string[] = []

  for (const event of events) {
    try {
      const remoteEvent = await pushRemoteEvent(client, event, userId)
      syncedEvents.push({
        clientId: remoteEvent.client_id,
        remoteId: remoteEvent.id,
        updatedAt: remoteEvent.updated_at,
      })
    } catch (error) {
      await markEventsSyncError([event.clientId])
      failedMessages.push(
        `${event.type} ${event.timestamp}: ${getErrorMessage(error)}`,
      )
    }
  }

  await markEventsSynced(syncedEvents)

  return { syncedEvents, failedMessages }
}

function fromRemoteEvent(event: RemoteBabyEvent): BabyEvent {
  return {
    clientId: event.client_id,
    remoteId: event.id,
    type: event.type,
    weightKg: event.weight_kg,
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
    const { syncedEvents, failedMessages } = await pushLocalEvents(
      supabase,
      pendingEvents,
      userId,
    )

    pushed += syncedEvents.length
    if (failedMessages.length > 0) {
      throw new Error(
        `有 ${failedMessages.length} 条记录上传失败：${failedMessages[0]}`,
      )
    }
  }

  const pullQuery = supabase
    .from('baby_events')
    .select(
      'id, user_id, client_id, type, weight_kg, timestamp, created_at, updated_at, deleted_at',
    )
    .order('updated_at', { ascending: true })

  const { data: remoteEvents, error: pullError } =
    await pullQuery.returns<RemoteBabyEvent[]>()

  if (pullError) {
    throw pullError
  }

  await upsertRemoteEvents((remoteEvents ?? []).map(fromRemoteEvent))

  const remoteClientIds = new Set(
    (remoteEvents ?? []).map((event) => event.client_id),
  )
  const currentLocalEvents = await getAllEvents()
  const missingRemoteEvents = currentLocalEvents.filter(
    (event) =>
      event.syncStatus === 'synced' && !remoteClientIds.has(event.clientId),
  )

  if (missingRemoteEvents.length > 0) {
    const { syncedEvents, failedMessages } = await pushLocalEvents(
      supabase,
      missingRemoteEvents,
      userId,
    )

    pushed += syncedEvents.length
    if (failedMessages.length > 0) {
      throw new Error(
        `有 ${failedMessages.length} 条记录补传失败：${failedMessages[0]}`,
      )
    }
  }

  const syncedAt = new Date().toISOString()
  setLastSyncAt(syncedAt)

  return {
    pushed,
    pulled: remoteEvents?.length ?? 0,
    pending: await getPendingEventCount(),
    syncedAt,
  }
}
