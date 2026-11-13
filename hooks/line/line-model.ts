// What the line above the prompt says, decided from the session's values alone.
import { HOUR_MS, isLongEnoughToKeepWarm, MINUTE_MS, PING_LEAD_MS } from '../cache-timing'
import { cacheLength, clockTime, minutes, timeLeft, tokens } from '../format'
import { needsVisiblePing, type SessionSnapshot } from '../session-snapshot'

// Blocks that empty over the cache's life, the one gauge of the time left: filled blocks in the
// line's tone, outlined blocks for the time already gone.
export const BAR_CELLS = 10
// Nerd Font icons, as in the aby panel: the next ping and the clock time the cache expires.
const NEXT_ICON = '󰁔'
const EXPIRES_ICON = '󰔟'
// With keep-warm off, the band names what is at stake once this little time is left.
const EXPIRING_MS = 10 * MINUTE_MS
const WAITS_TEXT = 'keep-warm starts after your next message'
const SHOWS_IN_CHAT = ' (shows in chat)'
const NEARLY_FULL_TEXT = 'conversation nearly full: keep-warm waits for you'

// green: keep-warm is on and able to ping; amber: it is on but cannot ping (paused, failed,
// waiting for room); grey: it is off.
export type LineTone = 'green' | 'amber' | 'grey'

export type LineModel = {
  filledCells: number
  tone: LineTone
  // The time left, drawn bold after the bar; the bar's colour and the button already say whether
  // keep-warm is on, so the text does not repeat it.
  main: string
  details: string[]
  // No toggle where keep-warm can never ping (an API key, or a short cache set on purpose).
  canToggle: boolean
  isOn: boolean
}

// The countdown as the line sees it: the latest of the last tick and the last request.
type Countdown = { ttlMs: number, expiresAt: number, remaining: number, isWarm: boolean }

export function lineModel(session: SessionSnapshot): LineModel {
  const { lastRequestAt, ttl, isOn } = session
  const countdown = countdownOf(session)
  const canKeepWarm = isLongEnoughToKeepWarm(ttl)
  const isGreen = isOn && canKeepWarm && !session.pingError && !isBlocked(session)
  return {
    filledCells: countdown.isWarm ? Math.max(1, Math.ceil((countdown.remaining / countdown.ttlMs) * BAR_CELLS)) : 0,
    tone: isGreen ? 'green' : isOn ? 'amber' : 'grey',
    main: lastRequestAt === 0 ? 'nothing cached yet' : countdown.isWarm ? timeLeft(countdown.remaining) : `cold since ${clockTime(countdown.expiresAt)}`,
    details: [...waitingDetails(session, countdown), ...expiryDetails(session, countdown, isGreen), ...keepWarmDetails(session, countdown), ...cachedDetails(session, countdown, isGreen)],
    canToggle: isOn || !ttl || canKeepWarm || ttl.reason === 'overage' || ttl.reason === 'observed',
    isOn,
  }
}

function countdownOf({ now, lastRequestAt, ttl }: SessionSnapshot): Countdown {
  const ttlMs = ttl?.ms ?? HOUR_MS
  const expiresAt = lastRequestAt + ttlMs
  const remaining = expiresAt - Math.max(now, lastRequestAt)
  return { ttlMs, expiresAt, remaining, isWarm: lastRequestAt > 0 && remaining > 0 }
}

// The next ping has to be the visible one but the conversation is too full for it.
function isBlocked(session: SessionSnapshot) {
  return needsVisiblePing(session) && session.nearlyFull
}

// While keep-warm holds the cache the next ping matters, not the expiry; near the end the
// re-write warning names the time itself.
function expiryDetails({ contextTokens }: SessionSnapshot, { isWarm, remaining, expiresAt }: Countdown, isGreen: boolean) {
  if (isGreen || !isWarm || (contextTokens > 0 && remaining < EXPIRING_MS)) return []
  return [`${EXPIRES_ICON} expires ${clockTime(expiresAt)}`]
}

function waitingDetails({ isWaiting }: SessionSnapshot, { isWarm }: Countdown) {
  return isWaiting && isWarm ? ['waiting for your answer'] : []
}

function keepWarmDetails(session: SessionSnapshot, countdown: Countdown): string[] {
  const { ttl } = session
  if (ttl && !isLongEnoughToKeepWarm(ttl)) {
    if (ttl.reason === 'observed') return [`cache expired after ${minutes(session.shortAfterMs)} min, sooner than expected`, 'keep-warm paused']
    if (ttl.reason === 'overage') return [`${cacheLength(ttl.ms)} cache while over your plan limit`, 'keep-warm paused']
    return [`${cacheLength(ttl.ms)} cache (${ttl.reason === 'api' ? 'API key' : 'your settings'})`, 'keep-warm needs the 1-hour cache']
  }
  if (!session.isOn) return []
  return [
    ...(session.stopAt ? [`keep-warm stops ${clockTime(session.stopAt)}`] : []),
    ...nextPingDetails(session, countdown),
    ...pingCountDetails(session),
  ]
}

// With the cache length unknown no ping can go out; before the conversation has answered in
// this run the next one is the visible ping.
function nextPingDetails(session: SessionSnapshot, { isWarm, ttlMs }: Countdown) {
  if (session.pingError) return [`ping failed: ${session.pingError}`]
  if (!session.ttl) return [WAITS_TEXT]
  if (isBlocked(session)) return [NEARLY_FULL_TEXT]
  if (!isWarm) return []
  const nextPingAt = clockTime(session.lastRequestAt + ttlMs - PING_LEAD_MS)
  return [`${NEXT_ICON} ping ${nextPingAt}${needsVisiblePing(session) ? SHOWS_IN_CHAT : ''}`]
}

function pingCountDetails({ pings }: SessionSnapshot) {
  const lastPing = pings[pings.length - 1]
  if (!lastPing) return []
  return [`${pings.length} ping${pings.length === 1 ? '' : 's'} ${lastPing.isHit ? '✓' : '✗'}`]
}

function cachedDetails({ contextTokens, lastRequestAt }: SessionSnapshot, { isWarm, remaining, expiresAt }: Countdown, isGreen: boolean) {
  if (contextTokens <= 0 || lastRequestAt <= 0) return []
  const size = tokens(contextTokens)
  if (!isWarm) return [`your next message re-writes ${size}`, ...(isGreen ? ['keep-warm restarts after it'] : [])]
  if (!isGreen && remaining < EXPIRING_MS) return [`after ${clockTime(expiresAt)} your next message re-writes ${size}`]
  return [`${size} cached`]
}
