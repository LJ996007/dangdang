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

export interface SleepSegment {
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

export interface DayStats {
  date: Date
  feedEvents: BabyEvent[]
  poopEvents: BabyEvent[]
  peeEvents: BabyEvent[]
  feedMarkers: FeedMarker[]
  poopMarkers: FeedMarker[]
  peeMarkers: FeedMarker[]
  feedIntervals: IntervalPoint[]
  sleepSegments: SleepSegment[]
  sleepCount: number
  totalSleepMinutes: number
  averageFeedIntervalMinutes: number | null
}

const dayMs = 24 * 60 * 60 * 1000

export function sortEvents(events: BabyEvent[]) {
  return [...events].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
}

export function getCurrentSleepStart(events: BabyEvent[]) {
  const lastSleep = sortEvents(events)
    .filter((event) => event.type === 'sleep_start' || event.type === 'sleep_end')
    .at(-1)

  return lastSleep?.type === 'sleep_start' ? new Date(lastSleep.timestamp) : null
}

export function buildSleepSessions(events: BabyEvent[], now = new Date()) {
  const sessions: SleepSession[] = []
  let openStart: Date | null = null

  for (const event of sortEvents(events)) {
    if (event.type === 'sleep_start') {
      openStart = new Date(event.timestamp)
    }

    if (event.type === 'sleep_end' && openStart) {
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
  const feedEvents = dayEvents.filter((event) => event.type === 'feed')
  const poopEvents = dayEvents.filter((event) => event.type === 'poop')
  const peeEvents = dayEvents.filter((event) => event.type === 'pee')

  const feedMarkers = feedEvents.map(toMarker)
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

  const sleepSegments = buildSleepSessions(events, now)
    .map((session) => {
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
    })
    .filter((segment): segment is SleepSegment => Boolean(segment))

  const totalSleepMinutes = sleepSegments.reduce(
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
    feedMarkers,
    poopMarkers,
    peeMarkers,
    feedIntervals,
    sleepSegments,
    sleepCount,
    totalSleepMinutes,
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
    .filter((event) => event.type === 'feed')
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
    poop: '便便',
    pee: '尿泡',
  }

  return sortEvents(events).map((event) => {
    const timestamp = new Date(event.timestamp)
    return {
      类型: labelMap[event.type],
      ISO时间: event.timestamp,
      日期: format(timestamp, 'yyyy-MM-dd'),
      时间: format(timestamp, 'HH:mm:ss'),
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
