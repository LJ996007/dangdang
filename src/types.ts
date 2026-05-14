export type BabyEventType =
  | 'sleep_start'
  | 'sleep_end'
  | 'feed'
  | 'feed_start'
  | 'feed_end'
  | 'poop'
  | 'pee'
  | 'weight'

export type SyncStatus = 'synced' | 'pending' | 'error'

export type WeightOwner = 'baby' | 'mother'

export interface BabyEvent {
  id?: number
  clientId: string
  remoteId?: string | null
  type: BabyEventType
  weightKg?: number | null
  weightOwner?: WeightOwner | null
  timestamp: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  syncStatus: SyncStatus
}

export interface ImportPayload {
  version: 1 | 2
  exportedAt: string
  events: BabyEvent[]
}
