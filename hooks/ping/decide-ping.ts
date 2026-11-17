// When to ping and how: pure decisions over what schedule.ts and ping.ts read.
import type { KeepWarmTtl } from '../../types'
import { isLongEnoughToKeepWarm, PING_LEAD_MS, PING_MARGIN_MS } from '../cache-timing'
import type { QuietHours } from '../quiet-hours'

const HOUR_MIN = 60

// The visible ping is a real turn, and after a restart Claude Code re-sends the project's
// instruction files (CLAUDE.md, the files it imports, MEMORY.md) with it: 130k tokens in a big
// project. If the conversation, those files and this much room for the ping and its reply do not
// fit in the window's free space (before the compaction reserve), the turn would fail ("Prompt is
// too long") or be compacted, which a ping must never cause: keep-warm then waits for the
// person's own message instead.
const VISIBLE_PING_ROOM = 30_000
// Only where Claude Code gives no breakdown of the window: wait above this share of it.
const VISIBLE_PING_MAX_FILL = 0.75

type Breakdown = {
  categories: { kind: string, tokens: number }[]
  memoryFiles: { tokens: number }[]
}

export type Room = { breakdown: Breakdown | undefined, window: number, contextTokens: number }

// Whether the visible ping would not fit: the conversation, the instruction files Claude Code
// re-sends after a restart, and the ping with its reply must all fit in the window's free space.
export function isTooFullForVisiblePing({ breakdown, window, contextTokens }: Room) {
  if (breakdown) {
    const free = breakdown.categories.filter(c => c.kind === 'free').reduce((n, c) => n + c.tokens, 0)
    const instructions = breakdown.memoryFiles.reduce((n, f) => n + f.tokens, 0)
    return free < instructions + VISIBLE_PING_ROOM
  }
  return window > 0 && contextTokens >= VISIBLE_PING_MAX_FILL * window
}

export type PingCheck = {
  now: number
  ttl: KeepWarmTtl
  lastRequestAt: number
  stopAt: number
  pendingUntil: number
  pingsInRow: number
  maxPings: number
  needsVisible: boolean
  nearlyFull: boolean
  quiet: QuietHours
}

// `blocked`: the visible ping is due but would not fit; nothing goes out, the window is held.
// `quiet`: the ping is due in the quiet hours without a stop time; nothing goes out.
export type PingStep = 'none' | 'stop-at-time' | 'stop-after-max' | 'quiet' | 'ping' | 'visible-ping' | 'blocked'

// One check of a session with keep-warm on. A stop time overrides the quiet hours.
export function decidePing(check: PingCheck): PingStep {
  if (check.stopAt > 0 && check.now >= check.stopAt) return 'stop-at-time'
  if (!isInPingWindow(check) || check.now < check.pendingUntil) return 'none'
  if (check.stopAt === 0 && isQuiet(check.now, check.quiet)) return 'quiet'
  if (check.stopAt === 0 && check.pingsInRow >= check.maxPings) return 'stop-after-max'
  if (!check.needsVisible) return 'ping'
  return check.nearlyFull ? 'blocked' : 'visible-ping'
}

// A cache long enough to keep warm, PING_LEAD_MS before it expires, and never in its last minute.
function isInPingWindow({ ttl, lastRequestAt, now }: PingCheck) {
  if (!ttl || !isLongEnoughToKeepWarm(ttl) || lastRequestAt <= 0) return false
  const idle = now - lastRequestAt
  return idle >= ttl.ms - PING_LEAD_MS && idle < ttl.ms - PING_MARGIN_MS
}

// Whether a moment falls in the quiet hours, in local time; a setting that could not be read
// counts as quiet all day, so nothing goes out until it is fixed.
export function isQuiet(ms: number, quiet: QuietHours) {
  if (quiet.kind === 'off') return false
  if (quiet.kind === 'invalid') return true
  const at = new Date(ms)
  const minute = at.getHours() * HOUR_MIN + at.getMinutes()
  const { startMin, endMin } = quiet
  return startMin < endMin ? minute >= startMin && minute < endMin : minute >= startMin || minute < endMin
}
