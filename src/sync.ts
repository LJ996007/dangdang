import {
  getAllEvents,
  getPendingEventCount,
  markEventsSynced,
  markEventsSyncError,
  upsertRemoteEvents,
} from './db'
import { isSupabaseConfigured, supabase } from './supabase'
import type { BabyEvent, BabyEventType, WeightOwner } from './types'

const lastSyncKey = 'dangdang-last-sync-at'

interface RemoteBabyEvent {
  id: string
  user_id: string
  client_id: string
  type: BabyEventType
  weight_kg?: number | string | null
  weight_owner?: WeightOwner | null
  timestamp: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type RemoteWritePayload = Omit<
  RemoteBabyEvent,
  'id' | 'weight_kg' | 'weight_owner'
> & {
  weight_kg?: number | null
  weight_owner?: WeightOwner | null
}
type RemoteWriteResult = Pick<RemoteBabyEvent, 'id' | 'client_id' | 'updated_at'>
type SupabaseClient = NonNullable<typeof supabase>

export interface SyncResult {
  pushed: number
  pulled: number
  pending: number
  syncedAt: string | null
  warning?: string
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
  const payload: RemoteWritePayload = {
    user_id: userId,
    client_id: event.clientId,
    type: event.type,
    timestamp: event.timestamp,
    created_at: event.createdAt,
    updated_at: syncedAt,
    deleted_at: event.deletedAt ?? null,
  }

  if (event.type === 'weight') {
    payload.weight_kg = event.weightKg ?? null
    payload.weight_owner = event.weightOwner ?? null
  }

  return payload
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

function hasErrorText(error: unknown, pattern: RegExp) {
  return pattern.test(getErrorMessage(error))
}

function isMissingWeightColumnError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as Record<string, unknown>
  return (
    record.code === 'PGRST204' ||
    hasErrorText(error, /weight_kg/i) ||
    hasErrorText(error, /weight_owner/i) ||
    hasErrorText(error, /schema cache/i)
  )
}

function isMissingWeightTypeError(error: unknown) {
  return (
    hasErrorText(error, /baby_events_type_check/i) ||
    hasErrorText(error, /check constraint/i)
  )
}

function getEventSyncErrorMessage(event: BabyEvent, error: unknown) {
  if (
    event.type === 'weight' &&
    (isMissingWeightColumnError(error) || isMissingWeightTypeError(error))
  ) {
    return [
      '体重记录需要先升级 Supabase 表结构',
      '请在 Supabase SQL Editor 重新执行 supabase-schema.sql',
      getErrorMessage(error),
    ].join(' / ')
  }

  return getErrorMessage(error)
}

async function checkRemoteWeightColumnSupport(client: SupabaseClient) {
  const { error } = await client
    .from('baby_events')
    .select('weight_kg, weight_owner')
    .limit(1)

  if (!error) {
    return true
  }

  if (isMissingWeightColumnError(error)) {
    return false
  }

  throw error
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
        `${event.type} ${event.timestamp}: ${getEventSyncErrorMessage(
          event,
          error,
        )}`,
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
    weightKg: event.weight_kg == null ? null : Number(event.weight_kg),
    weightOwner: event.weight_owner ?? null,
    timestamp: event.timestamp,
    createdAt: event.created_at,
    updatedAt: event.updated_at,
    deletedAt: event.deleted_at,
    syncStatus: 'synced',
  }
}

async function pullRemoteEvents(
  client: SupabaseClient,
  hasWeightColumn: boolean,
) {
  const columns = hasWeightColumn
    ? 'id, user_id, client_id, type, weight_kg, weight_owner, timestamp, created_at, updated_at, deleted_at'
    : 'id, user_id, client_id, type, timestamp, created_at, updated_at, deleted_at'

  let query = client
    .from('baby_events')
    .select(columns)
    .order('updated_at', { ascending: true })

  if (!hasWeightColumn) {
    query = query.neq('type', 'weight')
  }

  const { data, error } = await query
    .returns<RemoteBabyEvent[]>()

  if (error) {
    throw error
  }

  return data ?? []
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
  const hasWeightColumn = await checkRemoteWeightColumnSupport(supabase)
  const weightEventsWaitingForMigration = hasWeightColumn
    ? []
    : pendingEvents.filter((event) => event.type === 'weight')
  const pushablePendingEvents = hasWeightColumn
    ? pendingEvents
    : pendingEvents.filter((event) => event.type !== 'weight')

  if (weightEventsWaitingForMigration.length > 0) {
    await markEventsSyncError(
      weightEventsWaitingForMigration.map((event) => event.clientId),
    )
  }

  if (pushablePendingEvents.length > 0) {
    const { syncedEvents, failedMessages } = await pushLocalEvents(
      supabase,
      pushablePendingEvents,
      userId,
    )

    pushed += syncedEvents.length
    if (failedMessages.length > 0) {
      throw new Error(
        `有 ${failedMessages.length} 条记录上传失败：${failedMessages[0]}`,
      )
    }
  }

  const remoteEvents = await pullRemoteEvents(supabase, hasWeightColumn)

  await upsertRemoteEvents(remoteEvents.map(fromRemoteEvent))

  const remoteClientIds = new Set(
    remoteEvents.map((event) => event.client_id),
  )
  const currentLocalEvents = await getAllEvents()
  const missingRemoteEvents = currentLocalEvents.filter(
    (event) =>
      event.syncStatus === 'synced' && !remoteClientIds.has(event.clientId),
  )
  const pushableMissingRemoteEvents = hasWeightColumn
    ? missingRemoteEvents
    : missingRemoteEvents.filter((event) => event.type !== 'weight')

  if (pushableMissingRemoteEvents.length > 0) {
    const { syncedEvents, failedMessages } = await pushLocalEvents(
      supabase,
      pushableMissingRemoteEvents,
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

  const pending = await getPendingEventCount()
  const warning =
    weightEventsWaitingForMigration.length > 0
      ? `有 ${weightEventsWaitingForMigration.length} 条体重记录尚未同步：请先在 Supabase SQL Editor 重新执行 supabase-schema.sql`
      : undefined

  return {
    pushed,
    pulled: remoteEvents.length,
    pending,
    syncedAt,
    warning,
  }
}
