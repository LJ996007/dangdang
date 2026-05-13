export type BabyEventType =
  | 'sleep_start'
  | 'sleep_end'
  | 'feed'
  | 'feed_start'
  | 'feed_end'
  | 'poop'
  | 'pee'

export type SyncStatus = 'synced' | 'pending' | 'error'

export interface BabyEvent {
  id?: number
  clientId: string
  remoteId?: string | null
  type: BabyEventType
  timestamp: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  syncStatus: SyncStatus
}

export interface ImportPayload {
  version: 1
  exportedAt: string
  events: BabyEvent[]
}
