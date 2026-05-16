import { describe, expect, it } from 'vitest'
import { getCsvRows, getDayStats, getLastPump } from './analytics'
import type { BabyEvent, BabyEventType } from './types'

const at = (time: string) => new Date(`2026-05-16T${time}:00`).toISOString()

const event = (type: BabyEventType, timestamp: string): BabyEvent => ({
  clientId: `${type}-${timestamp}`,
  remoteId: null,
  type,
  weightKg: null,
  weightOwner: null,
  timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
  syncStatus: 'synced',
})

describe('pumping records', () => {
  it('tracks pumping without changing feeding stats', () => {
    const events = [event('pump', at('08:00')), event('feed_start', at('09:00'))]

    const stats = getDayStats(
      events,
      new Date('2026-05-16T00:00:00'),
      new Date('2026-05-16T10:00:00'),
    )

    expect(stats.pumpEvents).toHaveLength(1)
    expect(stats.feedEvents).toHaveLength(1)
    expect(stats.averageFeedIntervalMinutes).toBeNull()
  })

  it('returns the latest pumping record for elapsed displays', () => {
    const firstPump = event('pump', at('08:00'))
    const latestPump = event('pump', at('10:15'))

    expect(getLastPump([latestPump, firstPump])).toEqual(latestPump)
  })

  it('exports pumping records with the 吸奶 label', () => {
    expect(getCsvRows([event('pump', at('08:00'))])).toMatchObject([
      { 类型: '吸奶' },
    ])
  })
})
