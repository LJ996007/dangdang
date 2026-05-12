import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  BarChart3,
  CalendarDays,
  Clock3,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Home,
  List,
  Milk,
  Moon,
  Pencil,
  ShieldCheck,
  Sunrise,
  Toilet,
  Trash2,
  Upload,
  Droplets,
  type LucideIcon,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  buildFeedSessions,
  buildSleepSessions,
  formatDuration,
  formatSince,
  getCsvRows,
  getCurrentFeedStart,
  getCurrentSleepStart,
  getDayStats,
  getExportFileStamp,
  getLastCompletedSleep,
  getLastFeed,
  getSevenDaySleep,
  parseDateInput,
  sortEvents,
} from './analytics'
import {
  addEvent,
  clearEvents,
  deleteEvent,
  getEvents,
  replaceEvents,
  updateEventTimestamp,
} from './db'
import type { BabyEvent, BabyEventType, ImportPayload } from './types'

type TabId = 'record' | 'analysis' | 'data'

const tabs: Array<{ id: TabId; label: string; Icon: LucideIcon }> = [
  { id: 'record', label: '记录', Icon: Home },
  { id: 'analysis', label: '分析', Icon: BarChart3 },
  { id: 'data', label: '数据', Icon: Database },
]

const eventLabels: Record<BabyEventType, string> = {
  sleep_start: '睡觉开始',
  sleep_end: '睡觉结束',
  feed: '吃奶',
  feed_start: '吃奶开始',
  feed_end: '吃奶结束',
  poop: '便便',
  pee: '尿泡',
}

const eventTone: Record<BabyEventType, string> = {
  sleep_start: 'sleep',
  sleep_end: 'wake',
  feed: 'feed',
  feed_start: 'feed',
  feed_end: 'feed',
  poop: 'poop',
  pee: 'pee',
}

function getEventIcon(type: BabyEventType) {
  if (type === 'feed' || type === 'feed_start' || type === 'feed_end') {
    return Milk
  }

  if (type === 'poop') {
    return Toilet
  }

  if (type === 'pee') {
    return Droplets
  }

  return type === 'sleep_start' ? Moon : Sunrise
}

function isBabyEvent(value: unknown): value is BabyEvent {
  if (!value || typeof value !== 'object') {
    return false
  }

  const event = value as Record<string, unknown>
  const type = event.type
  const timestamp = event.timestamp

  return (
    (type === 'sleep_start' ||
      type === 'sleep_end' ||
      type === 'feed' ||
      type === 'feed_start' ||
      type === 'feed_end' ||
      type === 'poop' ||
      type === 'pee') &&
    typeof timestamp === 'string' &&
    !Number.isNaN(new Date(timestamp).getTime())
  )
}

function isImportPayload(value: unknown): value is ImportPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Record<string, unknown>
  return Array.isArray(payload.events) && payload.events.every(isBabyEvent)
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function toCsv(events: BabyEvent[]) {
  const rows = getCsvRows(events)
  const header = ['类型', 'ISO时间', '日期', '时间']
  const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`
  return [
    header.join(','),
    ...rows.map((row) =>
      [row.类型, row.ISO时间, row.日期, row.时间].map(escapeCell).join(','),
    ),
  ].join('\n')
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <ShieldCheck aria-hidden="true" size={24} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  )
}

function SplitAction({
  className,
  icon: Icon,
  title,
  activeText,
  startDisabled,
  endDisabled,
  onStart,
  onEnd,
}: {
  className: string
  icon: LucideIcon
  title: string
  activeText: string
  startDisabled: boolean
  endDisabled: boolean
  onStart: () => void
  onEnd: () => void
}) {
  return (
    <div className={`quick-action split-card ${className}`}>
      <div className="split-card-header">
        <Icon aria-hidden="true" size={28} />
        <span>{title}</span>
        <small>{activeText}</small>
      </div>
      <div className="split-buttons">
        <button type="button" disabled={startDisabled} onClick={onStart}>
          开始
        </button>
        <button type="button" disabled={endDisabled} onClick={onEnd}>
          结束
        </button>
      </div>
    </div>
  )
}

function Timeline({
  stats,
}: {
  stats: ReturnType<typeof getDayStats>
}) {
  return (
    <section className="timeline-panel" aria-label="今日24小时记录时间轴">
      <div className="section-title">
        <Clock3 aria-hidden="true" size={18} />
        <h2>{format(stats.date, 'MM月dd日')} 时间轴</h2>
        <div className="timeline-legend" aria-label="时间轴图例">
          <span>
            <i className="legend-sleep" />
            睡眠
          </span>
          <span>
            <i className="legend-feed" />
            吃奶
          </span>
          <span>
            <i className="legend-poop" />
            便便
          </span>
          <span>
            <i className="legend-pee" />
            尿泡
          </span>
        </div>
      </div>
      <div className="timeline">
        <div className="timeline-track">
          {stats.sleepSegments.map((segment, index) => (
            <span
              className={`sleep-segment ${segment.active ? 'active' : ''}`}
              key={`${segment.startLabel}-${segment.endLabel}-${index}`}
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
              title={`${segment.startLabel}-${segment.endLabel} ${formatDuration(
                segment.minutes,
              )}`}
            />
          ))}
          {stats.feedSegments.map((segment, index) => (
            <span
              className={`feed-segment ${segment.active ? 'active' : ''}`}
              key={`feed-segment-${segment.startLabel}-${segment.endLabel}-${index}`}
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
              title={`吃奶 ${segment.startLabel}-${segment.endLabel} ${formatDuration(
                segment.minutes,
              )}`}
            />
          ))}
          {stats.feedMarkers.map((marker, index) => (
            <span
              className="event-marker feed-marker"
              key={`${marker.label}-${index}`}
              style={{ left: `${marker.left}%` }}
              title={`吃奶 ${marker.label}`}
            />
          ))}
          {stats.poopMarkers.map((marker, index) => (
            <span
              className="event-marker poop-marker"
              key={`poop-${marker.label}-${index}`}
              style={{ left: `${marker.left}%` }}
              title={`便便 ${marker.label}`}
            />
          ))}
          {stats.peeMarkers.map((marker, index) => (
            <span
              className="event-marker pee-marker"
              key={`pee-${marker.label}-${index}`}
              style={{ left: `${marker.left}%` }}
              title={`尿泡 ${marker.label}`}
            />
          ))}
        </div>
        <div className="timeline-scale" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>
    </section>
  )
}

function RecentEvents({
  events,
  onDelete,
  onEdit,
}: {
  events: BabyEvent[]
  onDelete: (event: BabyEvent) => void
  onEdit: (event: BabyEvent) => void
}) {
  const recent = sortEvents(events).reverse().slice(0, 8)

  if (recent.length === 0) {
    return (
      <EmptyState
        title="还没有记录"
        body="第一次点击任意记录后，这里会自动出现时间线。"
      />
    )
  }

  return (
    <section className="event-list" aria-label="最近记录">
      <div className="section-title">
        <List aria-hidden="true" size={18} />
        <h2>最近记录</h2>
      </div>
      {recent.map((event) => {
        const Icon = getEventIcon(event.type)
        const timestamp = new Date(event.timestamp)
        return (
          <article className="event-row" key={event.id ?? event.timestamp}>
            <span className={`event-icon ${eventTone[event.type]}`}>
              <Icon aria-hidden="true" size={18} />
            </span>
            <div>
              <strong>{eventLabels[event.type]}</strong>
              <span>{format(timestamp, 'MM月dd日 HH:mm')}</span>
            </div>
            {event.id != null && (
              <div className="event-row-actions">
                <button
                  className="edit-event-button"
                  type="button"
                  aria-label={`修改${eventLabels[event.type]}记录的时间`}
                  onClick={() => onEdit(event)}
                >
                  <Pencil aria-hidden="true" size={16} />
                </button>
                <button
                  className="delete-event-button"
                  type="button"
                  aria-label={`删除${eventLabels[event.type]}记录`}
                  onClick={() => onDelete(event)}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}

function EditTimeModal({
  event,
  onClose,
  onSave,
}: {
  event: BabyEvent
  onClose: () => void
  onSave: (newTimestamp: Date) => void
}) {
  const originalDate = useMemo(() => new Date(event.timestamp), [event.timestamp])
  const initialMinutes = originalDate.getHours() * 60 + originalDate.getMinutes()
  const [minutes, setMinutes] = useState(initialMinutes)

  const previewDate = useMemo(() => {
    const next = new Date(originalDate)
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    return next
  }, [minutes, originalDate])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="修改记录时间"
      onClick={onClose}
    >
      <div
        className="modal-content"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <header className="modal-header">
          <span className={`event-icon ${eventTone[event.type]}`}>
            {createElement(getEventIcon(event.type), {
              'aria-hidden': true,
              size: 18,
            })}
          </span>
          <div>
            <strong>修改时间</strong>
            <span>{eventLabels[event.type]}</span>
          </div>
        </header>

        <div className="time-preview">
          <span>调整后时间</span>
          <strong>{format(previewDate, 'HH:mm')}</strong>
          <small>
            {format(previewDate, 'MM月dd日')}（原 {format(originalDate, 'HH:mm')}）
          </small>
        </div>

        <input
          className="time-slider"
          type="range"
          min={0}
          max={1439}
          step={1}
          value={minutes}
          aria-label="拖动调整时间"
          onChange={(changeEvent) =>
            setMinutes(Number(changeEvent.target.value))
          }
        />
        <div className="time-slider-scale" aria-hidden="true">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="modal-cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="modal-save"
            onClick={() => onSave(previewDate)}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [events, setEvents] = useState<BabyEvent[]>([])
  const [activeTab, setActiveTab] = useState<TabId>('record')
  const [selectedDate, setSelectedDate] = useState(() =>
    format(new Date(), 'yyyy-MM-dd'),
  )
  const [now, setNow] = useState(() => new Date())
  const [notice, setNotice] = useState('数据只保存在这台手机的浏览器里')
  const [editingEvent, setEditingEvent] = useState<BabyEvent | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshEvents = useCallback(async () => {
    setEvents(await getEvents())
  }, [])

  useEffect(() => {
    let cancelled = false

    void getEvents().then((loadedEvents) => {
      if (!cancelled) {
        setEvents(loadedEvents)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const selectedDay = useMemo(
    () => parseDateInput(selectedDate),
    [selectedDate],
  )
  const currentSleepStart = useMemo(
    () => getCurrentSleepStart(events),
    [events],
  )
  const currentFeedStart = useMemo(
    () => getCurrentFeedStart(events),
    [events],
  )
  const dayStats = useMemo(
    () => getDayStats(events, selectedDay, now),
    [events, now, selectedDay],
  )
  const todayStats = useMemo(
    () => getDayStats(events, now, now),
    [events, now],
  )
  const sevenDaySleep = useMemo(
    () => getSevenDaySleep(events, now),
    [events, now],
  )
  const lastFeed = useMemo(() => getLastFeed(events), [events])
  const lastSleep = useMemo(
    () => getLastCompletedSleep(events, now),
    [events, now],
  )
  const sleepSessions = useMemo(
    () => buildSleepSessions(events, now),
    [events, now],
  )
  const feedSessions = useMemo(
    () => buildFeedSessions(events, now),
    [events, now],
  )

  const handleSleepStart = async () => {
    await addEvent('sleep_start')
    setNotice('已记录睡觉开始时间')
    await refreshEvents()
  }

  const handleSleepEnd = async () => {
    await addEvent('sleep_end')
    setNotice('已记录睡觉结束时间')
    await refreshEvents()
  }

  const handleFeedStart = async () => {
    await addEvent('feed_start')
    setNotice('已记录吃奶开始时间')
    await refreshEvents()
  }

  const handleFeedEnd = async () => {
    await addEvent('feed_end')
    setNotice('已记录吃奶结束时间')
    await refreshEvents()
  }

  const handlePoop = async () => {
    await addEvent('poop')
    setNotice('已记录便便时间')
    await refreshEvents()
  }

  const handlePee = async () => {
    await addEvent('pee')
    setNotice('已记录尿泡时间')
    await refreshEvents()
  }

  const handleExportJson = () => {
    const payload: ImportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      events,
    }
    downloadTextFile(
      `dangdang-backup-${getExportFileStamp()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    )
    setNotice('JSON备份已导出')
  }

  const handleExportCsv = () => {
    downloadTextFile(
      `dangdang-records-${getExportFileStamp()}.csv`,
      toCsv(events),
      'text/csv;charset=utf-8',
    )
    setNotice('CSV表格已导出')
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) {
      return
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown
      if (!isImportPayload(parsed)) {
        throw new Error('invalid payload')
      }

      if (!window.confirm('导入会覆盖当前本机数据，继续吗？')) {
        return
      }

      await replaceEvents(parsed.events)
      await refreshEvents()
      setNotice(`已导入 ${parsed.events.length} 条记录`)
    } catch {
      setNotice('导入失败，请选择本应用导出的JSON备份')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleClear = async () => {
    if (!window.confirm('确定清空所有本机记录吗？此操作不能撤销。')) {
      return
    }

    await clearEvents()
    await refreshEvents()
    setNotice('已清空本机记录')
  }

  const handleDeleteEvent = async (event: BabyEvent) => {
    if (event.id == null) {
      return
    }

    const timestamp = format(new Date(event.timestamp), 'MM月dd日 HH:mm')
    if (!window.confirm(`确定删除「${eventLabels[event.type]} ${timestamp}」吗？`)) {
      return
    }

    await deleteEvent(event.id)
    await refreshEvents()
    setNotice('已删除单条记录')
  }

  const handleEditEvent = (event: BabyEvent) => {
    if (event.id == null) {
      return
    }
    setEditingEvent(event)
  }

  const handleSaveEditedEvent = async (newTimestamp: Date) => {
    if (!editingEvent || editingEvent.id == null) {
      return
    }

    await updateEventTimestamp(editingEvent.id, newTimestamp)
    setEditingEvent(null)
    await refreshEvents()
    setNotice(`已将时间修改为 ${format(newTimestamp, 'HH:mm')}`)
  }

  const lastFeedTime = lastFeed ? new Date(lastFeed.timestamp) : null
  const currentSleepDuration = currentSleepStart
    ? formatDuration(Math.max(0, Math.round((now.getTime() - currentSleepStart.getTime()) / 60000)))
    : null
  const currentFeedDuration = currentFeedStart
    ? formatDuration(Math.max(0, Math.round((now.getTime() - currentFeedStart.getTime()) / 60000)))
    : null

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/icon-192.png" alt="" />
          <div>
            <h1>当当日记</h1>
            <p>{notice}</p>
          </div>
        </div>
        <time dateTime={now.toISOString()}>{format(now, 'HH:mm')}</time>
      </header>

      <section className={`status-strip ${currentSleepStart ? 'sleeping' : ''}`}>
        <div>
          <span>当前状态</span>
          <strong>{currentSleepStart ? '正在睡觉中' : '正在清醒'}</strong>
        </div>
        <div>
          <span>
            {currentSleepStart ? '已睡' : currentFeedStart ? '正在吃奶' : '上次吃奶'}
          </span>
          <strong>
            {currentSleepStart
              ? currentSleepDuration
              : currentFeedStart
                ? currentFeedDuration
              : formatSince(lastFeedTime, now)}
          </strong>
        </div>
      </section>

      {activeTab === 'record' && (
        <section className="screen">
          <div className="action-grid">
            <SplitAction
              className={`sleep ${currentSleepStart ? 'is-active' : ''}`}
              icon={currentSleepStart ? Sunrise : Moon}
              title="睡觉"
              activeText={
                currentSleepStart
                  ? `已睡 ${currentSleepDuration ?? '--'}`
                  : '记录开始和结束'
              }
              startDisabled={Boolean(currentSleepStart)}
              endDisabled={!currentSleepStart}
              onStart={handleSleepStart}
              onEnd={handleSleepEnd}
            />
            <SplitAction
              className={`feed ${currentFeedStart ? 'is-active' : ''}`}
              icon={Milk}
              title="吃奶"
              activeText={
                currentFeedStart
                  ? `已吃 ${currentFeedDuration ?? '--'}`
                  : '记录开始和结束'
              }
              startDisabled={Boolean(currentFeedStart)}
              endDisabled={!currentFeedStart}
              onStart={handleFeedStart}
              onEnd={handleFeedEnd}
            />
            <button className="quick-action poop" type="button" onClick={handlePoop}>
              <Toilet aria-hidden="true" size={30} />
              <span>便便</span>
              <small>点击自动记录当前时间</small>
            </button>
            <button className="quick-action pee" type="button" onClick={handlePee}>
              <Droplets aria-hidden="true" size={30} />
              <span>尿泡</span>
              <small>点击自动记录当前时间</small>
            </button>
          </div>

          <div className="metric-grid" aria-label="今日汇总">
            <article className="metric">
              <span>睡眠次数</span>
              <strong>{todayStats.sleepCount}</strong>
            </article>
            <article className="metric">
              <span>睡眠总时长</span>
              <strong>{formatDuration(todayStats.totalSleepMinutes)}</strong>
            </article>
            <article className="metric">
              <span>吃奶次数</span>
              <strong>{todayStats.feedEvents.length}</strong>
            </article>
            <article className="metric">
              <span>吃奶总时长</span>
              <strong>{formatDuration(todayStats.totalFeedMinutes)}</strong>
            </article>
            <article className="metric">
              <span>便便次数</span>
              <strong>{todayStats.poopEvents.length}</strong>
            </article>
            <article className="metric">
              <span>尿泡次数</span>
              <strong>{todayStats.peeEvents.length}</strong>
            </article>
            <article className="metric">
              <span>平均间隔</span>
              <strong>{formatDuration(todayStats.averageFeedIntervalMinutes)}</strong>
            </article>
          </div>

          <Timeline stats={todayStats} />

          <section className="insight-row">
            <article>
              <span>上次完整睡眠</span>
              <strong>
                {lastSleep
                  ? `${formatDuration(
                      Math.round(
                        (lastSleep.end.getTime() - lastSleep.start.getTime()) /
                          60000,
                      ),
                    )}`
                  : '--'}
              </strong>
              <small>
                {lastSleep
                  ? `${format(lastSleep.start, 'HH:mm')} - ${format(
                      lastSleep.end,
                      'HH:mm',
                    )}`
                  : '暂无完整睡眠'}
              </small>
            </article>
            <article>
              <span>记录总数</span>
              <strong>{events.length}</strong>
              <small>
                {sleepSessions.length} 段睡眠 / {feedSessions.length} 段吃奶
              </small>
            </article>
          </section>

          <RecentEvents
            events={events}
            onDelete={handleDeleteEvent}
            onEdit={handleEditEvent}
          />
        </section>
      )}

      {activeTab === 'analysis' && (
        <section className="screen">
          <div className="date-toolbar">
            <label htmlFor="selected-date">
              <CalendarDays aria-hidden="true" size={18} />
              分析日期
            </label>
            <input
              id="selected-date"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </div>

          <div className="metric-grid" aria-label="所选日期汇总">
            <article className="metric">
              <span>吃奶次数</span>
              <strong>{dayStats.feedEvents.length}</strong>
            </article>
            <article className="metric">
              <span>吃奶总时长</span>
              <strong>{formatDuration(dayStats.totalFeedMinutes)}</strong>
            </article>
            <article className="metric">
              <span>便便次数</span>
              <strong>{dayStats.poopEvents.length}</strong>
            </article>
            <article className="metric">
              <span>尿泡次数</span>
              <strong>{dayStats.peeEvents.length}</strong>
            </article>
            <article className="metric">
              <span>平均喂奶间隔</span>
              <strong>{formatDuration(dayStats.averageFeedIntervalMinutes)}</strong>
            </article>
            <article className="metric">
              <span>睡眠次数</span>
              <strong>{dayStats.sleepCount}</strong>
            </article>
            <article className="metric">
              <span>睡眠总时长</span>
              <strong>{formatDuration(dayStats.totalSleepMinutes)}</strong>
            </article>
          </div>

          <Timeline stats={dayStats} />

          <section className="chart-panel">
            <div className="section-title">
              <Milk aria-hidden="true" size={18} />
              <h2>喂奶间隔曲线</h2>
            </div>
            {dayStats.feedIntervals.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dayStats.feedIntervals} margin={{ left: -18, right: 8 }}>
                  <CartesianGrid stroke="#e8efed" strokeDasharray="4 4" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    unit="分"
                    width={58}
                  />
                  <Tooltip
                    formatter={(value) => [`${value}分钟`, '间隔']}
                    labelFormatter={(label) => `截至 ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="minutes"
                    stroke="#f26f5e"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#f26f5e' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="还没有间隔"
                body="同一天记录两次以上吃奶后，会显示相邻间隔。"
              />
            )}
          </section>

          <section className="chart-panel">
            <div className="section-title">
              <Moon aria-hidden="true" size={18} />
              <h2>近7天睡眠总时长</h2>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sevenDaySleep} margin={{ left: -18, right: 8 }}>
                <CartesianGrid stroke="#e8efed" strokeDasharray="4 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} unit="h" width={52} />
                <Tooltip formatter={(value) => [`${value}小时`, '睡眠']} />
                <Bar dataKey="hours" fill="#61b7a6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>
        </section>
      )}

      {activeTab === 'data' && (
        <section className="screen">
          <section className="backup-panel">
            <div className="section-title">
              <ShieldCheck aria-hidden="true" size={18} />
              <h2>备份与迁移</h2>
            </div>
            <p>
              记录保存在本机 IndexedDB。建议隔几天导出一次 JSON 备份，换手机时可以导入恢复。
            </p>
            <div className="backup-actions">
              <button type="button" onClick={handleExportJson}>
                <FileJson aria-hidden="true" size={18} />
                导出JSON
              </button>
              <button type="button" onClick={handleExportCsv}>
                <FileSpreadsheet aria-hidden="true" size={18} />
                导出CSV
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload aria-hidden="true" size={18} />
                导入JSON
              </button>
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
          </section>

          <section className="backup-panel">
            <div className="section-title">
              <Download aria-hidden="true" size={18} />
              <h2>数据概览</h2>
            </div>
            <div className="metric-grid compact">
              <article className="metric">
                <span>总记录</span>
                <strong>{events.length}</strong>
              </article>
              <article className="metric">
                <span>喂奶</span>
                <strong>
                  {
                    events.filter(
                      (event) =>
                        event.type === 'feed' || event.type === 'feed_start',
                    ).length
                  }
                </strong>
              </article>
              <article className="metric">
                <span>便便</span>
                <strong>{events.filter((event) => event.type === 'poop').length}</strong>
              </article>
              <article className="metric">
                <span>尿泡</span>
                <strong>{events.filter((event) => event.type === 'pee').length}</strong>
              </article>
              <article className="metric">
                <span>睡眠段</span>
                <strong>{sleepSessions.length}</strong>
              </article>
              <article className="metric">
                <span>吃奶段</span>
                <strong>{feedSessions.length}</strong>
              </article>
            </div>
            <button className="danger-button" type="button" onClick={handleClear}>
              <Trash2 aria-hidden="true" size={18} />
              清空本机记录
            </button>
          </section>

          <RecentEvents
            events={events}
            onDelete={handleDeleteEvent}
            onEdit={handleEditEvent}
          />
        </section>
      )}

      <nav className="bottom-tabs" aria-label="主导航">
        {tabs.map(({ id, label, Icon }) => (
          <button
            aria-current={activeTab === id ? 'page' : undefined}
            className={activeTab === id ? 'active' : ''}
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {editingEvent && (
        <EditTimeModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={handleSaveEditedEvent}
        />
      )}
    </main>
  )
}

export default App
