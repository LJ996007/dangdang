export type BabyEventType =
  | 'sleep_start'
  | 'sleep_end'
  | 'feed'
  | 'feed_start'
  | 'feed_end'
  | 'poop'
  | 'pee'

export interface BabyEvent {
  id?: number
  type: BabyEventType
  timestamp: string
  createdAt: string
}

export interface ImportPayload {
  version: 1
  exportedAt: string
  events: BabyEvent[]
}
