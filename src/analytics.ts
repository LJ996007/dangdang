import {
  addDays,
  differenceInMinutes,
  format,
  isBefore,
  startOfDay,
  subDays,
} from 'date-fns'
import type { BabyEvent } from './types'

export interface SleepSession {
  start: Date
  end: Date
  complete: boolean
}

export interface ActivitySession {
  start: Date
  end: Date
  complete: boolean
}

export interface TimelineSegment {
  left: number
  width: number
  startLabel: string
  endLabel: string
  minutes: number
  active: boolean
}

export interface FeedMarker {
  left: number
  label: string
}

export interface IntervalPoint {
  label: string
  minutes: number
}

export interface WeightPoint {
  label: string
  weightKg: number
}

export interface DayStats {
  date: Date
  feedEvents: BabyEvent[]
  poopEvents: BabyEvent[]
  peeEvents: BabyEvent[]
  weightEvents: BabyEvent[]
  feedMarkers: FeedMarker[]
  poopMarkers: FeedMarker[]
  peeMarkers: FeedMarker[]
  feedIntervals: IntervalPoint[]
  sleepSegments: SleepSegment[]
  feedSegments: TimelineSegment[]
  sleepCount: number
  totalSleepMinutes: number
  totalFeedMinutes: number
  averageFeedIntervalMinutes: number | null
}

export type SleepSegment = TimelineSegment

const dayMs = 24 * 60 * 60 * 1000

export function sortEvents(events: BabyEvent[]) {
  return [...events].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
}

export function isValidWeightKg(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function formatWeightKg(value: number | null | undefined) {
  if (!isValidWeightKg(value)) {
    return '--'
  }

  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })
}

export function getWeightEvents(events: BabyEvent[]) {
  return sortEvents(events).filter(
    (event) => event.type === 'weight' && isValidWeightKg(event.weightKg),
  )
}

export function getLatestWeight(events: BabyEvent[]) {
  return getWeightEvents(events).at(-1)
}

export function getWeightTrend(events: BabyEvent[]): WeightPoint[] {
  return getWeightEvents(events).map((event) => {
    const timestamp = new Date(event.timestamp)
    return {
      label: format(timestamp, 'MM/dd HH:mm'),
      weightKg: event.weightKg!,
    }
  })
}

export function getCurrentPairStart(
  events: BabyEvent[],
  startType: BabyEvent['type'],
  endType: BabyEvent['type'],
) {
  const lastPairEvent = sortEvents(events)
    .filter((event) => event.type === startType || event.type === endType)
    .at(-1)

  return lastPairEvent?.type === startType
    ? new Date(lastPairEvent.timestamp)
    : null
}

export function getCurrentSleepStart(events: BabyEvent[]) {
  return getCurrentPairStart(events, 'sleep_start', 'sleep_end')
}

export function getCurrentFeedStart(events: BabyEvent[]) {
  return getCurrentPairStart(events, 'feed_start', 'feed_end')
}

export function buildPairSessions(
  events: BabyEvent[],
  startType: BabyEvent['type'],
  endType: BabyEvent['type'],
  now = new Date(),
) {
  const sessions: ActivitySession[] = []
  let openStart: Date | null = null

  for (const event of sortEvents(events)) {
    if (event.type === startType) {
      openStart = new Date(event.timestamp)
    }

    if (event.type === endType && openStart) {
      const end = new Date(event.timestamp)
      if (end > openStart) {
        sessions.push({ start: openStart, end, complete: true })
      }
      openStart = null
    }
  }

  if (openStart) {
    sessions.push({ start: openStart, end: now, complete: false })
  }

  return sessions
}

export function buildSleepSessions(events: BabyEvent[], now = new Date()) {
  return buildPairSessions(events, 'sleep_start', 'sleep_end', now) as SleepSession[]
}

export function buildFeedSessions(events: BabyEvent[], now = new Date()) {
  return buildPairSessions(events, 'feed_start', 'feed_end', now)
}

export function getDayStats(
  events: BabyEvent[],
  selectedDate: Date,
  now = new Date(),
): DayStats {
  const date = startOfDay(selectedDate)
  const nextDate = addDays(date, 1)
  const startMs = date.getTime()
  const endMs = nextDate.getTime()
  const minutesInDay = 24 * 60

  const isInDay = (event: BabyEvent) => {
    const timestamp = new Date(event.timestamp).getTime()
    return timestamp >= startMs && timestamp < endMs
  }

  const toMarker = (event: BabyEvent) => {
    const timestamp = new Date(event.timestamp)
    const minutes = (timestamp.getTime() - startMs) / 60000
    return {
      left: (minutes / minutesInDay) * 100,
      label: format(timestamp, 'HH:mm'),
    }
  }

  const dayEvents = sortEvents(events).filter(isInDay)
  const feedEvents = dayEvents.filter(
    (event) => event.type === 'feed' || event.type === 'feed_start',
  )
  const legacyFeedEvents = dayEvents.filter((event) => event.type === 'feed')
  const poopEvents = dayEvents.filter((event) => event.type === 'poop')
  const peeEvents = dayEvents.filter((event) => event.type === 'pee')
  const weightEvents = dayEvents.filter(
    (event) => event.type === 'weight' && isValidWeightKg(event.weightKg),
  )

  const feedMarkers = legacyFeedEvents.map(toMarker)
  const poopMarkers = poopEvents.map(toMarker)
  const peeMarkers = peeEvents.map(toMarker)

  const feedIntervals = feedEvents.slice(1).map((event, index) => {
    const timestamp = new Date(event.timestamp)
    const previous = new Date(feedEvents[index].timestamp)
    return {
      label: format(timestamp, 'HH:mm'),
      minutes: differenceInMinutes(timestamp, previous),
    }
  })

  const averageFeedIntervalMinutes =
    feedIntervals.length > 0
      ? Math.round(
          feedIntervals.reduce((sum, point) => sum + point.minutes, 0) /
            feedIntervals.length,
        )
      : null

  const toTimelineSegment = (session: ActivitySession) => {
    const clippedStart = new Date(Math.max(session.start.getTime(), startMs))
    const clippedEnd = new Date(Math.min(session.end.getTime(), endMs))

    if (!isBefore(clippedStart, clippedEnd)) {
      return null
    }

    const startMinutes = (clippedStart.getTime() - startMs) / 60000
    const durationMinutes = (clippedEnd.getTime() - clippedStart.getTime()) / 60000

    return {
      left: (startMinutes / minutesInDay) * 100,
      width: Math.max((durationMinutes / minutesInDay) * 100, 0.8),
      startLabel: format(clippedStart, 'HH:mm'),
      endLabel: format(clippedEnd, 'HH:mm'),
      minutes: Math.round(durationMinutes),
      active: !session.complete,
    }
  }

  const sleepSegments = buildSleepSessions(events, now)
    .map(toTimelineSegment)
    .filter((segment): segment is SleepSegment => Boolean(segment))

  const feedSegments = buildFeedSessions(events, now)
    .map((session) => {
      const segment = toTimelineSegment(session)
      return segment ? { ...segment, width: Math.max(segment.width, 1) } : null
    })
    .filter((segment): segment is TimelineSegment => Boolean(segment))

  const totalSleepMinutes = sleepSegments.reduce(
    (sum, segment) => sum + segment.minutes,
    0,
  )
  const totalFeedMinutes = feedSegments.reduce(
    (sum, segment) => sum + segment.minutes,
    0,
  )

  const sleepCount = buildSleepSessions(events, now).filter((session) => {
    const timestamp = session.start.getTime()
    return timestamp >= startMs && timestamp < endMs
  }).length

  return {
    date,
    feedEvents,
    poopEvents,
    peeEvents,
    weightEvents,
    feedMarkers,
    poopMarkers,
    peeMarkers,
    feedIntervals,
    sleepSegments,
    feedSegments,
    sleepCount,
    totalSleepMinutes,
    totalFeedMinutes,
    averageFeedIntervalMinutes,
  }
}

export function getSevenDaySleep(events: BabyEvent[], now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = startOfDay(subDays(now, 6 - index))
    const stats = getDayStats(events, date, now)
    return {
      label: format(date, 'MM/dd'),
      hours: Number((stats.totalSleepMinutes / 60).toFixed(1)),
    }
  })
}

export function getLastFeed(events: BabyEvent[]) {
  return sortEvents(events)
    .filter((event) => event.type === 'feed' || event.type === 'feed_start')
    .at(-1)
}

export function getLastCompletedSleep(events: BabyEvent[], now = new Date()) {
  return buildSleepSessions(events, now)
    .filter((session) => session.complete)
    .at(-1)
}

export function parseDateInput(value: string) {
  return new Date(`${value}T00:00:00`)
}

export function formatDuration(totalMinutes: number | null | undefined) {
  if (totalMinutes == null) {
    return '--'
  }

  if (totalMinutes < 1) {
    return '<1分钟'
  }

  const minutes = Math.round(totalMinutes)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (hours === 0) {
    return `${rest}分钟`
  }

  if (rest === 0) {
    return `${hours}小时`
  }

  return `${hours}小时${rest}分`
}

export function formatSince(date: Date | null | undefined, now = new Date()) {
  if (!date) {
    return '--'
  }

  const minutes = Math.max(0, differenceInMinutes(now, date))

  if (minutes < 1) {
    return '刚刚'
  }

  return `${formatDuration(minutes)}前`
}

export function getCsvRows(events: BabyEvent[]) {
  const labelMap: Record<BabyEvent['type'], string> = {
    sleep_start: '睡觉',
    sleep_end: '醒了',
    feed: '吃奶',
    feed_start: '吃奶开始',
    feed_end: '吃奶结束',
    poop: '便便',
    pee: '尿泡',
    weight: '体重',
  }

  return sortEvents(events).map((event) => {
    const timestamp = new Date(event.timestamp)
    return {
      类型: labelMap[event.type],
      ISO时间: event.timestamp,
      日期: format(timestamp, 'yyyy-MM-dd'),
      时间: format(timestamp, 'HH:mm:ss'),
      体重kg:
        event.type === 'weight' && isValidWeightKg(event.weightKg)
          ? formatWeightKg(event.weightKg)
          : '',
    }
  })
}

export function getExportFileStamp(now = new Date()) {
  return format(now, 'yyyyMMdd-HHmm')
}

export function getDayBounds(date: Date) {
  const start = startOfDay(date)
  return {
    start,
    end: new Date(start.getTime() + dayMs),
  }
}
