import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { format } from 'date-fns'
import {
  BarChart3,
  CalendarDays,
  Cloud,
  CloudOff,
  Clock3,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Home,
  List,
  Lock,
  LogOut,
  Mail,
  Milk,
  Moon,
  Pencil,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sunrise,
  Toilet,
  Trash2,
  Upload,
  WifiOff,
  Droplets,
  type LucideIcon,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
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
  formatWeightKg,
  getCsvRows,
  getCurrentFeedStart,
  getCurrentSleepStart,
  getDayStats,
  getExportFileStamp,
  getLastCompletedSleep,
  getLastFeed,
  getLastPump,
  getLatestWeight,
  getSevenDaySleep,
  getTimelineWindowStats,
  getWeightTrend,
  isValidWeightKg,
  parseDateInput,
  sortEvents,
} from './analytics'
import {
  addEvent,
  addWeightEvent,
  clearEvents,
  deleteEvent,
  getEvents,
  getPendingEventCount,
  replaceEvents,
  updateEventDetails,
} from './db'
import { isSupabaseConfigured, supabase } from './supabase'
import { getLastSyncAt, syncEvents } from './sync'
import type {
  BabyEvent,
  BabyEventType,
  ImportPayload,
  WeightOwner,
} from './types'
import {
  normalizeWeightKg,
  normalizeWeightOwner,
  weightOwnerLabels,
  weightOwners,
} from './weights'

type TabId = 'record' | 'analysis' | 'data'

const tabs: Array<{ id: TabId; label: string; Icon: LucideIcon }> = [
  { id: 'record', label: '记录', Icon: Home },
  { id: 'analysis', label: '分析', Icon: BarChart3 },
  { id: 'data', label: '数据', Icon: Database },
]

const chartMargin = { top: 8, right: 8, bottom: 0, left: 2 }
const chartAxisTick = { fill: '#62716e', fontSize: 12 }

const eventLabels: Record<BabyEventType, string> = {
  sleep_start: '睡觉开始',
  sleep_end: '睡觉结束',
  feed: '吃奶',
  feed_start: '吃奶开始',
  feed_end: '吃奶结束',
  pump: '吸奶',
  poop: '便便',
  pee: '尿泡',
  weight: '体重',
}

const eventTone: Record<BabyEventType, string> = {
  sleep_start: 'sleep',
  sleep_end: 'wake',
  feed: 'feed',
  feed_start: 'feed',
  feed_end: 'feed',
  pump: 'pump',
  poop: 'poop',
  pee: 'pee',
  weight: 'weight',
}

function getEventIcon(type: BabyEventType) {
  if (
    type === 'feed' ||
    type === 'feed_start' ||
    type === 'feed_end' ||
    type === 'pump'
  ) {
    return Milk
  }

  if (type === 'poop') {
    return Toilet
  }

  if (type === 'pee') {
    return Droplets
  }

  if (type === 'weight') {
    return Scale
  }

  return type === 'sleep_start' ? Moon : Sunrise
}

function parseWeightInput(value: string) {
  return normalizeWeightKg(value.trim().replace(',', '.'))
}

function getWeightOwnerForEvent(event: BabyEvent) {
  return normalizeWeightOwner(event.weightOwner, event.weightKg ?? null)
}

function getEventTitle(event: BabyEvent) {
  if (event.type === 'weight' && isValidWeightKg(event.weightKg)) {
    const owner = getWeightOwnerForEvent(event)
    const ownerLabel = owner ? weightOwnerLabels[owner] : ''
    return `${ownerLabel}体重 ${formatWeightKg(event.weightKg)} kg`
  }

  return eventLabels[event.type]
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
      type === 'pump' ||
      type === 'poop' ||
      type === 'pee' ||
      type === 'weight') &&
    typeof timestamp === 'string' &&
    !Number.isNaN(new Date(timestamp).getTime()) &&
    (type !== 'weight' ||
      (isValidWeightKg(event.weightKg) &&
        (event.weightOwner == null ||
          weightOwners.includes(event.weightOwner as WeightOwner))))
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
  const header = [
    '类型',
    'ISO时间',
    '日期',
    '时间',
    '体重对象',
    '宝宝体重kg',
    '妈妈体重kg',
  ]
  const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`
  return [
    header.join(','),
    ...rows.map((row) =>
      [
        row.类型,
        row.ISO时间,
        row.日期,
        row.时间,
        row.体重对象,
        row.宝宝体重kg,
        row.妈妈体重kg,
      ]
        .map(escapeCell)
        .join(','),
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

function WeightRecorder({
  values,
  latestWeights,
  onChange,
  onSubmit,
}: {
  values: Record<WeightOwner, string>
  latestWeights: Record<WeightOwner, BabyEvent | undefined>
  onChange: (owner: WeightOwner, value: string) => void
  onSubmit: (owner: WeightOwner) => void
}) {
  return (
    <section className="weight-recorder" aria-label="体重记录">
      <div className="section-title">
        <Scale aria-hidden="true" size={18} />
        <h2>体重</h2>
      </div>
      <div className="weight-form">
        {weightOwners.map((owner) => {
          const latestWeight = latestWeights[owner]
          const parsedWeight = parseWeightInput(values[owner])
          return (
            <article className="weight-card" key={owner}>
              <label>
                <span>{weightOwnerLabels[owner]}体重</span>
                <div className="weight-input-wrap">
                  <input
                    inputMode="decimal"
                    min="0"
                    placeholder={owner === 'baby' ? '例如 4.25' : '例如 55'}
                    step="0.01"
                    type="number"
                    value={values[owner]}
                    onChange={(event) => onChange(owner, event.target.value)}
                  />
                  <strong>kg</strong>
                </div>
              </label>
              <button
                disabled={parsedWeight == null}
                type="button"
                onClick={() => onSubmit(owner)}
              >
                <Scale aria-hidden="true" size={18} />
                记录{weightOwnerLabels[owner]}
              </button>
              <p>
                最近：
                {latestWeight && isValidWeightKg(latestWeight.weightKg)
                  ? `${formatWeightKg(latestWeight.weightKg)} kg · ${format(
                      new Date(latestWeight.timestamp),
                      'MM月dd日 HH:mm',
                    )}`
                  : '暂无记录'}
              </p>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Timeline({
  scrollKey,
  scrollTarget,
  timeline,
}: {
  scrollKey: string
  scrollTarget: 'focus-start' | 'now'
  timeline: ReturnType<typeof getTimelineWindowStats>
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrollStateRef = useRef({ scrollTarget, timeline })
  const timelineWidth = Math.max(Math.round(timeline.hours * 28), 1020)

  useEffect(() => {
    scrollStateRef.current = { scrollTarget, timeline }
  }, [scrollTarget, timeline])

  useEffect(() => {
    const scroller = scrollerRef.current

    if (!scroller) {
      return
    }

    const { scrollTarget: targetMode, timeline: currentTimeline } =
      scrollStateRef.current
    const scrollableWidth = scroller.scrollWidth - scroller.clientWidth

    if (scrollableWidth <= 0) {
      scroller.scrollLeft = 0
      return
    }

    const targetLeft =
      targetMode === 'now' && currentTimeline.nowLeft != null
        ? currentTimeline.nowLeft
        : currentTimeline.focusLeft
    const targetPixel = (targetLeft / 100) * scroller.scrollWidth
    const offset = targetMode === 'now' ? scroller.clientWidth * 0.62 : 12
    scroller.scrollLeft = Math.max(
      0,
      Math.min(scrollableWidth, targetPixel - offset),
    )
  }, [scrollKey])

  return (
    <section
      className="timeline-panel"
      aria-label={`${format(timeline.start, 'MM月dd日')}至${format(
        timeline.end,
        'MM月dd日',
      )}连续记录时间轴`}
    >
      <div className="section-title">
        <Clock3 aria-hidden="true" size={18} />
        <h2>{format(timeline.centerDate, 'MM月dd日')} 时间轴</h2>
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
      <div ref={scrollerRef} className="timeline" tabIndex={0}>
        <div className="timeline-strip" style={{ width: timelineWidth }}>
          <div className="timeline-track">
            {timeline.ticks.map((tick, index) => (
              <span
                aria-hidden="true"
                className={`timeline-grid-line ${
                  tick.isDayStart ? 'day-start' : ''
                }`}
                key={`grid-${tick.label}-${index}`}
                style={{ left: `${tick.left}%` }}
              />
            ))}
            {timeline.sleepSegments.map((segment, index) => (
              <span
                className={`sleep-segment ${segment.active ? 'active' : ''}`}
                key={`${segment.startLabel}-${segment.endLabel}-${index}`}
                style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                title={`${segment.startLabel}-${segment.endLabel} ${formatDuration(
                  segment.minutes,
                )}`}
              />
            ))}
            {timeline.feedSegments.map((segment, index) => (
              <span
                className={`feed-segment ${segment.active ? 'active' : ''}`}
                key={`feed-segment-${segment.startLabel}-${segment.endLabel}-${index}`}
                style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                title={`吃奶 ${segment.startLabel}-${segment.endLabel} ${formatDuration(
                  segment.minutes,
                )}`}
              />
            ))}
            {timeline.feedMarkers.map((marker, index) => (
              <span
                className="event-marker feed-marker"
                key={`${marker.label}-${index}`}
                style={{ left: `${marker.left}%` }}
                title={`吃奶 ${marker.label}`}
              />
            ))}
            {timeline.poopMarkers.map((marker, index) => (
              <span
                className="event-marker poop-marker"
                key={`poop-${marker.label}-${index}`}
                style={{ left: `${marker.left}%` }}
                title={`便便 ${marker.label}`}
              />
            ))}
            {timeline.peeMarkers.map((marker, index) => (
              <span
                className="event-marker pee-marker"
                key={`pee-${marker.label}-${index}`}
                style={{ left: `${marker.left}%` }}
                title={`尿泡 ${marker.label}`}
              />
            ))}
          </div>
          <div className="timeline-scale" aria-hidden="true">
            {timeline.ticks.map((tick, index) => (
              <span
                className={tick.isDayStart ? 'day-tick' : undefined}
                key={`scale-${tick.label}-${index}`}
                style={{ left: `${tick.left}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
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
        const title = getEventTitle(event)
        return (
          <article className="event-row" key={event.id ?? event.timestamp}>
            <span className={`event-icon ${eventTone[event.type]}`}>
              <Icon aria-hidden="true" size={18} />
            </span>
            <div>
              <strong>{title}</strong>
              <span>{format(timestamp, 'MM月dd日 HH:mm')}</span>
            </div>
            {event.id != null && (
              <div className="event-actions">
                <button
                  className="edit-event-button"
                  type="button"
                  aria-label={`修改${title}记录`}
                  onClick={() => onEdit(event)}
                >
                  <Pencil aria-hidden="true" size={16} />
                </button>
                <button
                  className="delete-event-button"
                  type="button"
                  aria-label={`删除${title}记录`}
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

function EditEventModal({
  event,
  onClose,
  onSave,
}: {
  event: BabyEvent
  onClose: () => void
  onSave: (
    newTimestamp: Date,
    weightKg?: number,
    weightOwner?: WeightOwner,
  ) => void
}) {
  const originalDate = useMemo(() => new Date(event.timestamp), [event.timestamp])
  const initialMinutes = originalDate.getHours() * 60 + originalDate.getMinutes()
  const isWeightEvent = event.type === 'weight'
  const initialWeightOwner = isWeightEvent
    ? getWeightOwnerForEvent(event) ?? 'baby'
    : 'baby'
  const [minutes, setMinutes] = useState(initialMinutes)
  const [weightValue, setWeightValue] = useState(() =>
    event.type === 'weight' && isValidWeightKg(event.weightKg)
      ? formatWeightKg(event.weightKg)
      : '',
  )
  const [weightOwner, setWeightOwner] =
    useState<WeightOwner>(initialWeightOwner)
  const [weightError, setWeightError] = useState('')

  const previewDate = useMemo(() => {
    const next = new Date(originalDate)
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
    return next
  }, [minutes, originalDate])

  const handleSave = () => {
    if (!isWeightEvent) {
      onSave(previewDate)
      return
    }

    const nextWeightKg = parseWeightInput(weightValue)
    if (nextWeightKg == null) {
      setWeightError('请输入有效的体重，单位 kg')
      return
    }

    onSave(previewDate, nextWeightKg, weightOwner)
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="修改记录"
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
            <strong>修改记录</strong>
            <span>{getEventTitle(event)}</span>
          </div>
        </header>

        {isWeightEvent && (
          <>
            <div className="modal-field">
              <span>对象</span>
              <div className="owner-toggle" role="group" aria-label="体重对象">
                {weightOwners.map((owner) => (
                  <button
                    className={owner === weightOwner ? 'active' : ''}
                    key={owner}
                    type="button"
                    onClick={() => setWeightOwner(owner)}
                  >
                    {weightOwnerLabels[owner]}
                  </button>
                ))}
              </div>
            </div>
            <label className="modal-field">
              <span>体重（kg）</span>
              <input
                inputMode="decimal"
                min="0"
                step="0.01"
                type="number"
                value={weightValue}
                onChange={(changeEvent) => {
                  setWeightValue(changeEvent.target.value)
                  setWeightError('')
                }}
              />
              {weightError && <small>{weightError}</small>}
            </label>
          </>
        )}

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
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function formatSyncTime(value: string | null) {
  if (!value) {
    return '尚未同步'
  }

  return format(new Date(value), 'MM月dd日 HH:mm')
}

function AuthScreen({
  mode,
  email,
  password,
  message,
  isBusy,
  onEmailChange,
  onPasswordChange,
  onModeChange,
  onSubmit,
}: {
  mode: 'signin' | 'signup'
  email: string
  password: string
  message: string
  isBusy: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onModeChange: (mode: 'signin' | 'signup') => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const isSignup = mode === 'signup'

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <img src="/icon-192.png" alt="" />
          <div>
            <h1>当当日记</h1>
            <p>登录后在不同设备间同步记录</p>
          </div>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>
              <Mail aria-hidden="true" size={16} />
              邮箱
            </span>
            <input
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
            />
          </label>
          <label>
            <span>
              <Lock aria-hidden="true" size={16} />
              密码
            </span>
            <input
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              minLength={6}
              required
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </label>
          <button disabled={isBusy} type="submit">
            {isBusy ? '处理中...' : isSignup ? '注册并登录' : '登录'}
          </button>
        </form>

        {message && <p className="auth-message">{message}</p>}

        <button
          className="link-button"
          type="button"
          onClick={() => onModeChange(isSignup ? 'signin' : 'signup')}
        >
          {isSignup ? '已有账号，去登录' : '没有账号，注册一个家庭账号'}
        </button>
      </section>
    </main>
  )
}

function SyncPanel({
  session,
  pendingCount,
  lastSyncAt,
  syncMessage,
  isSyncing,
  onSync,
  onSignOut,
}: {
  session: Session | null
  pendingCount: number
  lastSyncAt: string | null
  syncMessage: string
  isSyncing: boolean
  onSync: () => void
  onSignOut: () => void
}) {
  if (!isSupabaseConfigured) {
    return (
      <section className="backup-panel sync-panel">
        <div className="section-title">
          <CloudOff aria-hidden="true" size={18} />
          <h2>云同步未配置</h2>
        </div>
        <p>
          添加 Supabase 环境变量后，登录界面和多设备同步会自动启用。当前仍可本机离线记录。
        </p>
        <code>VITE_SUPABASE_URL</code>
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
      </section>
    )
  }

  return (
    <section className="backup-panel sync-panel">
      <div className="section-title">
        <Cloud aria-hidden="true" size={18} />
        <h2>云同步</h2>
      </div>
      <div className="sync-grid">
        <article>
          <span>当前账号</span>
          <strong>{session?.user.email ?? '--'}</strong>
        </article>
        <article>
          <span>最后同步</span>
          <strong>{formatSyncTime(lastSyncAt)}</strong>
        </article>
        <article>
          <span>待同步</span>
          <strong>{pendingCount}</strong>
        </article>
      </div>
      <p>{syncMessage}</p>
      <div className="backup-actions">
        <button disabled={isSyncing || !session} type="button" onClick={onSync}>
          <RefreshCw aria-hidden="true" size={18} />
          {isSyncing ? '同步中' : '手动同步'}
        </button>
        <button type="button" onClick={onSignOut}>
          <LogOut aria-hidden="true" size={18} />
          退出登录
        </button>
      </div>
    </section>
  )
}

function App() {
  const [events, setEvents] = useState<BabyEvent[]>([])
  const [activeTab, setActiveTab] = useState<TabId>('record')
  const [selectedDate, setSelectedDate] = useState(() =>
    format(new Date(), 'yyyy-MM-dd'),
  )
  const [now, setNow] = useState(() => new Date())
  const [notice, setNotice] = useState(
    isSupabaseConfigured
      ? '登录后可在不同设备间同步'
      : '未配置云同步，当前只保存在本机',
  )
  const [weightInputs, setWeightInputs] = useState<Record<WeightOwner, string>>(
    {
      baby: '',
      mother: '',
    },
  )
  const [editingEvent, setEditingEvent] = useState<BabyEvent | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getLastSyncAt(),
  )
  const [syncMessage, setSyncMessage] = useState(
    isSupabaseConfigured
      ? '登录后会自动同步'
      : '缺少 Supabase 环境变量',
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshEvents = useCallback(async () => {
    const [loadedEvents, loadedPendingCount] = await Promise.all([
      getEvents(),
      getPendingEventCount(),
    ])
    setEvents(loadedEvents)
    setPendingCount(loadedPendingCount)
  }, [])

  const performSync = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!isSupabaseConfigured || !supabase) {
        return
      }

      if (!session) {
        setSyncMessage('请先登录后再同步')
        return
      }

      if (!navigator.onLine) {
        setSyncMessage('当前离线，记录会先保存在本机')
        await refreshEvents()
        return
      }

      setIsSyncing(true)
      if (!silent) {
        setSyncMessage('正在同步...')
      }

      try {
        const result = await syncEvents(session.user.id)
        await refreshEvents()
        setLastSyncAt(result.syncedAt)
        setSyncMessage(
          result.warning ??
            `同步完成：上传 ${result.pushed} 条，拉取 ${result.pulled} 条，待同步 ${result.pending} 条`,
        )
        if (!silent) {
          setNotice(result.warning ? '部分记录尚未同步' : '已同步到云端')
        }
      } catch (error) {
        await refreshEvents()
        const message = error instanceof Error ? error.message : '未知错误'
        setSyncMessage(`同步失败：${message}`)
        if (!silent) {
          setNotice('同步失败，记录已保存在本机')
        }
      } finally {
        setIsSyncing(false)
      }
    },
    [refreshEvents, session],
  )

  useEffect(() => {
    let cancelled = false

    void Promise.all([getEvents(), getPendingEventCount()]).then(
      ([loadedEvents, loadedPendingCount]) => {
      if (!cancelled) {
        setEvents(loadedEvents)
          setPendingCount(loadedPendingCount)
      }
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return
    }

    let cancelled = false
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session)
        setAuthReady(true)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      return
    }

    const syncTimer = window.setTimeout(() => {
      void performSync({ silent: true })
    }, 0)

    const handleOnline = () => {
      void performSync({ silent: true })
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void performSync({ silent: true })
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearTimeout(syncTimer)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [performSync, session])

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
  const dayTimeline = useMemo(
    () => getTimelineWindowStats(events, selectedDay, now),
    [events, now, selectedDay],
  )
  const todayStats = useMemo(
    () => getDayStats(events, now, now),
    [events, now],
  )
  const todayTimeline = useMemo(
    () => getTimelineWindowStats(events, now, now),
    [events, now],
  )
  const sevenDaySleep = useMemo(
    () => getSevenDaySleep(events, now),
    [events, now],
  )
  const babyWeightTrend = useMemo(
    () => getWeightTrend(events, 'baby'),
    [events],
  )
  const motherWeightTrend = useMemo(
    () => getWeightTrend(events, 'mother'),
    [events],
  )
  const latestBabyWeight = useMemo(
    () => getLatestWeight(events, 'baby'),
    [events],
  )
  const latestMotherWeight = useMemo(
    () => getLatestWeight(events, 'mother'),
    [events],
  )
  const lastFeed = useMemo(() => getLastFeed(events), [events])
  const lastPump = useMemo(() => getLastPump(events), [events])
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

  const finishLocalChange = useCallback(async () => {
    await refreshEvents()

    if (session && isSupabaseConfigured) {
      void performSync({ silent: true })
      return
    }

    setSyncMessage(
      isSupabaseConfigured
        ? '已保存在本机，登录后会同步'
        : '当前为本机离线记录',
    )
  }, [performSync, refreshEvents, session])

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!supabase) {
      setAuthMessage('Supabase 尚未配置')
      return
    }

    setAuthBusy(true)
    setAuthMessage('')

    const credentials = {
      email: authEmail.trim(),
      password: authPassword,
    }
    const { data, error } =
      authMode === 'signin'
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials)

    setAuthBusy(false)

    if (error) {
      setAuthMessage(error.message)
      return
    }

    if (data.session) {
      setSession(data.session)
      setNotice('已登录，正在同步云端数据')
      return
    }

    setAuthMessage('注册成功，请按邮件提示确认后再登录')
  }

  const handleSignOut = async () => {
    if (!supabase) {
      return
    }

    await supabase.auth.signOut()
    setSession(null)
    setNotice('已退出登录，本机记录仍保留')
    setSyncMessage('登录后会自动同步')
  }

  const handleSleepStart = async () => {
    await addEvent('sleep_start')
    setNotice('已记录睡觉开始时间')
    await finishLocalChange()
  }

  const handleSleepEnd = async () => {
    await addEvent('sleep_end')
    setNotice('已记录睡觉结束时间')
    await finishLocalChange()
  }

  const handleFeedStart = async () => {
    await addEvent('feed_start')
    setNotice('已记录吃奶开始时间')
    await finishLocalChange()
  }

  const handleFeedEnd = async () => {
    await addEvent('feed_end')
    setNotice('已记录吃奶结束时间')
    await finishLocalChange()
  }

  const handlePump = async () => {
    await addEvent('pump')
    setNotice('已记录吸奶时间')
    await finishLocalChange()
  }

  const handlePoop = async () => {
    await addEvent('poop')
    setNotice('已记录便便时间')
    await finishLocalChange()
  }

  const handlePee = async () => {
    await addEvent('pee')
    setNotice('已记录尿泡时间')
    await finishLocalChange()
  }

  const handleWeight = async (owner: WeightOwner) => {
    const weightKg = parseWeightInput(weightInputs[owner])
    if (weightKg == null) {
      setNotice('请输入有效的体重，单位 kg')
      return
    }

    await addWeightEvent(weightKg, owner)
    setWeightInputs((current) => ({ ...current, [owner]: '' }))
    setNotice(
      `已记录${weightOwnerLabels[owner]}体重 ${formatWeightKg(weightKg)} kg`,
    )
    await finishLocalChange()
  }

  const handleExportJson = () => {
    const payload: ImportPayload = {
      version: 2,
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

      if (!window.confirm('导入会替换当前本机缓存，并在登录后同步到云端，继续吗？')) {
        return
      }

      await replaceEvents(parsed.events)
      setNotice(`已导入 ${parsed.events.length} 条记录`)
      await finishLocalChange()
    } catch {
      setNotice('导入失败，请选择本应用导出的JSON备份')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleClear = async () => {
    if (!window.confirm('确定清空全部记录吗？登录后会同步删除到云端。')) {
      return
    }

    await clearEvents()
    setNotice('已清空全部记录')
    await finishLocalChange()
  }

  const handleDeleteEvent = async (event: BabyEvent) => {
    if (event.id == null) {
      return
    }

    const timestamp = format(new Date(event.timestamp), 'MM月dd日 HH:mm')
    if (!window.confirm(`确定删除「${getEventTitle(event)} ${timestamp}」吗？`)) {
      return
    }

    await deleteEvent(event.id)
    setNotice('已删除单条记录')
    await finishLocalChange()
  }

  const handleEditEvent = (event: BabyEvent) => {
    if (event.id == null) {
      return
    }
    setEditingEvent(event)
  }

  const handleSaveEditedEvent = async (
    newTimestamp: Date,
    weightKg?: number,
    weightOwner?: WeightOwner,
  ) => {
    if (!editingEvent || editingEvent.id == null) {
      return
    }

    await updateEventDetails(editingEvent.id, {
      timestamp: newTimestamp,
      weightKg: editingEvent.type === 'weight' ? weightKg : undefined,
      weightOwner: editingEvent.type === 'weight' ? weightOwner : undefined,
    })
    setEditingEvent(null)
    setNotice(
      editingEvent.type === 'weight' && weightKg != null
        ? `已修改${weightOwner ? weightOwnerLabels[weightOwner] : ''}体重为 ${formatWeightKg(weightKg)} kg`
        : `已将时间修改为 ${format(newTimestamp, 'HH:mm')}`,
    )
    await finishLocalChange()
  }

  const lastFeedTime = lastFeed ? new Date(lastFeed.timestamp) : null
  const lastPumpTime = lastPump ? new Date(lastPump.timestamp) : null
  const currentSleepDuration = currentSleepStart
    ? formatDuration(Math.max(0, Math.round((now.getTime() - currentSleepStart.getTime()) / 60000)))
    : null
  const currentFeedDuration = currentFeedStart
    ? formatDuration(Math.max(0, Math.round((now.getTime() - currentFeedStart.getTime()) / 60000)))
    : null
  const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
  const SyncBadgeIcon = !isSupabaseConfigured
    ? CloudOff
    : !isOnline
      ? WifiOff
      : Cloud
  const syncBadgeText = !isSupabaseConfigured
    ? '本机'
    : !isOnline
      ? '离线'
      : pendingCount > 0
        ? `${pendingCount} 待同步`
        : '已同步'

  if (isSupabaseConfigured && !authReady) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="brand auth-brand">
            <img src="/icon-192.png" alt="" />
            <div>
              <h1>当当日记</h1>
              <p>正在检查登录状态...</p>
            </div>
          </div>
        </section>
      </main>
    )
  }

  if (isSupabaseConfigured && authReady && !session) {
    return (
      <AuthScreen
        email={authEmail}
        isBusy={authBusy}
        message={authMessage}
        mode={authMode}
        password={authPassword}
        onEmailChange={setAuthEmail}
        onModeChange={setAuthMode}
        onPasswordChange={setAuthPassword}
        onSubmit={handleAuthSubmit}
      />
    )
  }

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
        <div className="header-meta">
          <span className="sync-pill">
            <SyncBadgeIcon aria-hidden="true" size={15} />
            {syncBadgeText}
          </span>
          <time dateTime={now.toISOString()}>{format(now, 'HH:mm')}</time>
        </div>
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

          <button className="quick-action pump" type="button" onClick={handlePump}>
            <Milk aria-hidden="true" size={30} />
            <span>吸奶</span>
            <small>
              {lastPumpTime ? `距上次 ${formatSince(lastPumpTime, now)}` : '暂无记录'}
            </small>
          </button>

          <WeightRecorder
            latestWeights={{
              baby: latestBabyWeight,
              mother: latestMotherWeight,
            }}
            values={weightInputs}
            onChange={(owner, value) =>
              setWeightInputs((current) => ({ ...current, [owner]: value }))
            }
            onSubmit={(owner) => void handleWeight(owner)}
          />

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
              <span>吸奶次数</span>
              <strong>{todayStats.pumpEvents.length}</strong>
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
            <article className="metric">
              <span>今日宝宝体重</span>
              <strong>
                {todayStats.babyWeightEvents.at(-1)
                  ? `${formatWeightKg(todayStats.babyWeightEvents.at(-1)?.weightKg)} kg`
                  : '--'}
              </strong>
            </article>
            <article className="metric">
              <span>今日妈妈体重</span>
              <strong>
                {todayStats.motherWeightEvents.at(-1)
                  ? `${formatWeightKg(todayStats.motherWeightEvents.at(-1)?.weightKg)} kg`
                  : '--'}
              </strong>
            </article>
          </div>

          <Timeline
            scrollKey={format(todayTimeline.centerDate, 'yyyy-MM-dd')}
            scrollTarget="now"
            timeline={todayTimeline}
          />

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
              <span>吸奶次数</span>
              <strong>{dayStats.pumpEvents.length}</strong>
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
            <article className="metric">
              <span>宝宝体重记录</span>
              <strong>{dayStats.babyWeightEvents.length}</strong>
            </article>
            <article className="metric">
              <span>当日宝宝体重</span>
              <strong>
                {dayStats.babyWeightEvents.at(-1)
                  ? `${formatWeightKg(dayStats.babyWeightEvents.at(-1)?.weightKg)} kg`
                  : '--'}
              </strong>
            </article>
            <article className="metric">
              <span>妈妈体重记录</span>
              <strong>{dayStats.motherWeightEvents.length}</strong>
            </article>
            <article className="metric">
              <span>当日妈妈体重</span>
              <strong>
                {dayStats.motherWeightEvents.at(-1)
                  ? `${formatWeightKg(dayStats.motherWeightEvents.at(-1)?.weightKg)} kg`
                  : '--'}
              </strong>
            </article>
          </div>

          <Timeline
            scrollKey={selectedDate}
            scrollTarget="focus-start"
            timeline={dayTimeline}
          />

          <section className="chart-panel">
            <div className="section-title">
              <Milk aria-hidden="true" size={18} />
              <h2>喂奶间隔曲线</h2>
            </div>
            {dayStats.feedIntervals.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dayStats.feedIntervals} margin={chartMargin}>
                  <CartesianGrid stroke="#e8efed" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="label"
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={chartAxisTick}
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
              <BarChart data={sevenDaySleep} margin={chartMargin}>
                <CartesianGrid stroke="#e8efed" strokeDasharray="4 4" />
                <XAxis
                  dataKey="label"
                  tick={chartAxisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={chartAxisTick}
                  tickLine={false}
                  axisLine={false}
                  unit="h"
                  width={52}
                />
                <Tooltip formatter={(value) => [`${value}小时`, '睡眠']} />
                <Bar dataKey="hours" fill="#61b7a6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="chart-panel">
            <div className="section-title">
              <Scale aria-hidden="true" size={18} />
              <h2>宝宝体重趋势</h2>
            </div>
            {babyWeightTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={babyWeightTrend} margin={chartMargin}>
                  <CartesianGrid stroke="#e8efed" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="label"
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                    unit="kg"
                    width={58}
                  />
                  <Tooltip
                    formatter={(value) => [`${value} kg`, '宝宝体重']}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="weightKg"
                    stroke="#6f63c5"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#6f63c5' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="还没有宝宝体重趋势"
                body="记录一次宝宝体重后，这里会按时间显示 kg 变化。"
              />
            )}
          </section>

          <section className="chart-panel">
            <div className="section-title">
              <Scale aria-hidden="true" size={18} />
              <h2>妈妈体重趋势</h2>
            </div>
            {motherWeightTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={motherWeightTrend} margin={chartMargin}>
                  <CartesianGrid stroke="#e8efed" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="label"
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={chartAxisTick}
                    tickLine={false}
                    axisLine={false}
                    unit="kg"
                    width={58}
                  />
                  <Tooltip
                    formatter={(value) => [`${value} kg`, '妈妈体重']}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="weightKg"
                    stroke="#a66b42"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#a66b42' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="还没有妈妈体重趋势"
                body="记录一次妈妈体重后，这里会按时间显示 kg 变化。"
              />
            )}
          </section>
        </section>
      )}

      {activeTab === 'data' && (
        <section className="screen">
          <SyncPanel
            isSyncing={isSyncing}
            lastSyncAt={lastSyncAt}
            pendingCount={pendingCount}
            session={session}
            syncMessage={syncMessage}
            onSignOut={() => void handleSignOut()}
            onSync={() => void performSync({ silent: false })}
          />

          <section className="backup-panel">
            <div className="section-title">
              <ShieldCheck aria-hidden="true" size={18} />
              <h2>备份与迁移</h2>
            </div>
            <p>
              记录会先保存在本机 IndexedDB；登录后自动同步到云端。JSON 备份仍可用于手动迁移或留档。
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
                <span>吸奶</span>
                <strong>{events.filter((event) => event.type === 'pump').length}</strong>
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
                <span>宝宝体重</span>
                <strong>
                  {
                    events.filter(
                      (event) =>
                        event.type === 'weight' &&
                        event.weightOwner === 'baby',
                    ).length
                  }
                </strong>
              </article>
              <article className="metric">
                <span>最新宝宝</span>
                <strong>
                  {latestBabyWeight && isValidWeightKg(latestBabyWeight.weightKg)
                    ? `${formatWeightKg(latestBabyWeight.weightKg)} kg`
                    : '--'}
                </strong>
              </article>
              <article className="metric">
                <span>妈妈体重</span>
                <strong>
                  {
                    events.filter(
                      (event) =>
                        event.type === 'weight' &&
                        event.weightOwner === 'mother',
                    ).length
                  }
                </strong>
              </article>
              <article className="metric">
                <span>最新妈妈</span>
                <strong>
                  {latestMotherWeight &&
                  isValidWeightKg(latestMotherWeight.weightKg)
                    ? `${formatWeightKg(latestMotherWeight.weightKg)} kg`
                    : '--'}
                </strong>
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
              清空全部记录
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
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={handleSaveEditedEvent}
        />
      )}
    </main>
  )
}

export default App
