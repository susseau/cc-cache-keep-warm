// Whether further pings are likely to pay for themselves: pure, over the session's pings in a row
// and the chance the person comes back. Advice for the line only: keep-warm never stops by it.
import { MAX_PINGS_CAP, MINUTE_MS, PING_LEAD_MS } from './cache-timing'
import { isQuiet, pingWindowOpensAfter } from './ping/decide-ping'
import type { QuietHours } from './quiet-hours'
import { HOUR_WRITE_PRICE, READ_PRICE } from './savings'

// h[i]: the chance the person comes back in the window the i-th ping of a row adds, given they
// have not come back before it.
export type ReturnCurve = readonly number[]

// From the calibration of 2026-11-16: 997 breaks longer than 52 min over 10.7 weeks.
export const DEFAULT_RETURN_CURVE: ReturnCurve = [0.183, 0.110, 0.063, 0.040, 0.037, 0.023, 0.012, 0.002]

// A curve read from the store: 1 to 20 numbers from 0 to 1, or the default for anything else.
export function parseReturnCurve(value: unknown): ReturnCurve {
  const isCurve = Array.isArray(value) && value.length >= 1 && value.length <= MAX_PINGS_CAP &&
    value.every(chance => typeof chance === 'number' && Number.isFinite(chance) && chance >= 0 && chance <= 1)
  return isCurve ? value : DEFAULT_RETURN_CURVE
}

// `lastRequestAt`: the request the cache is warm from; `firstPingAt`: the ping the line announces
// (outside the quiet hours); `ttlMs`: the cache's length.
export type IdleCheck = {
  lastRequestAt: number, firstPingAt: number, ttlMs: number, pingsInRow: number, maxPings: number, curve: ReturnCurve, quiet: QuietHours,
}

// A return to a warm cache saves its re-write, less reading it.
const RETURN_GAIN = HOUR_WRITE_PRICE - READ_PRICE

// Likely idle: a ping is left in the row, and no series of them pays for itself.
export function isLikelyIdle(check: IdleCheck) {
  const values = seriesValues(check)
  return values.length > 0 && values.every(value => value <= 0)
}

// The value of a series of 1..K more pings (K: the pings left in the row), in units of the cache's
// size: the gain of a return within the series, less a read for each ping sent before it. The
// series ends before a ping that would fall in the quiet hours (nothing goes out, the cache
// expires), and a return counts only in the part of a ping's window outside them.
export function seriesValues({ lastRequestAt, firstPingAt, ttlMs, pingsInRow, maxPings, curve, quiet }: IdleCheck): number[] {
  const values: number[] = []
  let stayed = 1, cost = 0
  for (let j = 1; j <= maxPings - pingsInRow; j++) {
    const pingAt = firstPingAt + (j - 1) * pingWindowOpensAfter(ttlMs)
    if (j >= 2 && isQuiet(pingAt, quiet)) break
    const windowStart = j === 1 ? lastRequestAt + ttlMs : pingAt + PING_LEAD_MS
    cost += READ_PRICE * stayed
    stayed *= 1 - hazard(curve, pingsInRow + j) * awakeShare(windowStart, pingAt + ttlMs, quiet)
    values.push(RETURN_GAIN * (1 - stayed) - cost)
  }
  return values
}

// h[i] for the i-th ping in the row (1-based); past the table, its last value. An empty curve
// knows no return.
function hazard(curve: ReturnCurve, i: number) {
  return curve[Math.min(i, curve.length) - 1] ?? 0
}

// The share of the full minutes in (from, to], counted from `from` and each read at its start,
// that fall outside the quiet hours: no one comes back in them.
function awakeShare(from: number, to: number, quiet: QuietHours) {
  if (quiet.kind === 'off') return 1
  const minutes = Math.floor((to - from) / MINUTE_MS)
  let awake = 0
  for (let i = 0; i < minutes; i++) {
    if (!isQuiet(from + i * MINUTE_MS, quiet)) awake++
  }
  return awake / minutes
}
