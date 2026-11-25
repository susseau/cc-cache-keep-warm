// The pure decisions, without an engine: cache length, when to ping, /keepwarm and the line.
import { expect, test } from 'claude-code/testing'

import { DEFAULT_MAX_PINGS, pingLimit } from '../hooks/cache-timing'
import { parseStop, statusText } from '../hooks/command'
import { DEFAULT_RETURN_CURVE, isLikelyIdle, parseReturnCurve, seriesValues } from '../hooks/idle-advice'
import { NO_SAVINGS } from '../hooks/savings'
import { lineModel } from '../hooks/line/line-model'
import { decidePing, isQuiet, isTooFullForVisiblePing, type PingCheck } from '../hooks/ping/decide-ping'
import { parseQuietHours, type QuietHours } from '../hooks/quiet-hours'
import type { SessionSnapshot } from '../hooks/session-snapshot'
import { correctTtl, decideTtl, parseTtl, shortAfterGap, type TtlMemory, type TtlSources } from '../hooks/ttl/decide-ttl'
import { MINUTE, READ, START, WRITE } from './engine'

const HOUR = 60 * MINUTE
// The quiet hours the kit runs with (it cannot pass options): 21:30–08:00.
const QUIET = parseQuietHours(undefined, undefined)
// A clock time on the stub's day, in local time like the quiet hours.
const at = (hours: number, mins = 0) => new Date(2026, 10, 13, hours, mins).getTime()
const SUBSCRIPTION_TTL = { ms: HOUR, reason: 'subscription' } as const
const API_TTL = { ms: 5 * MINUTE, reason: 'api' } as const

const sources = (fields: Partial<TtlSources> = {}): TtlSources => ({
  isFiveMinutesForced: false, envTtlMs: 0, settingsTtlMs: 0, isHourEnabled: false, rateLimits: [], sawResponse: true, ...fields,
})
const memory = (fields: Partial<TtlMemory> = {}): TtlMemory => ({ planTtl: undefined, savedTtl: undefined, answersWithoutPlan: 0, ...fields })

test('parseTtl reads any length and nothing else', async () => {
  expect(parseTtl('1h')).toEqual(HOUR)
  expect(parseTtl(' 30m ')).toEqual(30 * MINUTE)
  expect(parseTtl('90s')).toEqual(90_000)
  expect(parseTtl('soon')).toEqual(0)
  expect(parseTtl(5)).toEqual(0)
})

test('decideTtl: settings first, then the plan', async () => {
  expect(decideTtl(sources({ isFiveMinutesForced: true, isHourEnabled: true }), memory()).ttl).toEqual({ ms: 5 * MINUTE, reason: 'setting' })
  expect(decideTtl(sources({ envTtlMs: 30 * MINUTE }), memory()).ttl).toEqual({ ms: 30 * MINUTE, reason: 'setting' })
  expect(decideTtl(sources({ rateLimits: [{ kind: 'five_hour', percentUsed: 40 }] }), memory())).toEqual({ ttl: SUBSCRIPTION_TTL, isWorthRemembering: true, sawPlanWindows: true })
  expect(decideTtl(sources({ rateLimits: [{ kind: 'seven_day', percentUsed: 100 }] }), memory()).ttl).toEqual({ ms: 5 * MINUTE, reason: 'overage' })
})

test('decideTtl without plan windows: an API key only after 3 answers, when a plan was seen', async () => {
  expect(decideTtl(sources(), memory()).ttl).toEqual(API_TTL)
  expect(decideTtl(sources(), memory({ planTtl: SUBSCRIPTION_TTL, answersWithoutPlan: 2 })).ttl).toEqual(SUBSCRIPTION_TTL)
  expect(decideTtl(sources(), memory({ planTtl: SUBSCRIPTION_TTL, answersWithoutPlan: 3 })).ttl).toEqual(API_TTL)
})

test('decideTtl before the first answer: the saved length, a saved "api" giving way to a plan', async () => {
  const before = sources({ sawResponse: false })
  expect(decideTtl(before, memory()).ttl).toEqual(null)
  expect(decideTtl(before, memory({ savedTtl: SUBSCRIPTION_TTL })).ttl).toEqual(SUBSCRIPTION_TTL)
  expect(decideTtl(before, memory({ savedTtl: API_TTL, planTtl: SUBSCRIPTION_TTL })).ttl).toEqual(SUBSCRIPTION_TTL)
})

test('correctTtl: a cache seen going cold sooner wins', async () => {
  expect(correctTtl(SUBSCRIPTION_TTL, 0)).toEqual(SUBSCRIPTION_TTL)
  expect(correctTtl(SUBSCRIPTION_TTL, 20 * MINUTE)).toEqual({ ms: 5 * MINUTE, reason: 'observed' })
  expect(correctTtl(null, 20 * MINUTE)).toEqual(null)
})

test('shortAfterGap: only a re-write after a gap the cache should have outlived counts', async () => {
  const gap = (gapMs: number, usage = WRITE, shortAfterMs = 0) => shortAfterGap({ gapMs, usage, ttl: SUBSCRIPTION_TTL, shortAfterMs })
  expect(gap(3 * MINUTE)).toEqual(0)
  expect(gap(20 * MINUTE)).toEqual(20 * MINUTE)
  expect(gap(20 * MINUTE, READ, 15 * MINUTE)).toEqual(0)
  expect(gap(70 * MINUTE)).toEqual(0)
})

const check = (fields: Partial<PingCheck> = {}): PingCheck => ({
  now: START + 52 * MINUTE, ttl: SUBSCRIPTION_TTL, lastRequestAt: START, stopAt: 0, pendingUntil: 0, pingsInRow: 0, maxPings: DEFAULT_MAX_PINGS, needsVisible: false, nearlyFull: false, quiet: QUIET, ...fields,
})

test('decidePing: only between 52 and 59 min, never on a cold cache', async () => {
  expect(decidePing(check({ now: START + 51 * MINUTE }))).toEqual('none')
  expect(decidePing(check())).toEqual('ping')
  expect(decidePing(check({ now: START + 59 * MINUTE }))).toEqual('none')
  expect(decidePing(check({ ttl: API_TTL, now: START + 2 * MINUTE }))).toEqual('none')
  expect(decidePing(check({ lastRequestAt: 0 }))).toEqual('none')
  expect(decidePing(check({ pendingUntil: START + 53 * MINUTE }))).toEqual('none')
})

test('decidePing: the stops, and the visible ping', async () => {
  expect(decidePing(check({ stopAt: START + 30 * MINUTE }))).toEqual('stop-at-time')
  expect(decidePing(check({ pingsInRow: 5 }))).toEqual('ping')
  expect(decidePing(check({ pingsInRow: 6 }))).toEqual('stop-after-max')
  expect(decidePing(check({ pingsInRow: 8, maxPings: 12 }))).toEqual('ping')
  expect(decidePing(check({ pingsInRow: 8, stopAt: START + 3 * HOUR }))).toEqual('ping')
  expect(decidePing(check({ needsVisible: true }))).toEqual('visible-ping')
  expect(decidePing(check({ needsVisible: true, nearlyFull: true }))).toEqual('blocked')
})

test('parseQuietHours: on by default, from 21:30 to 08:00', async () => {
  expect(QUIET).toEqual({ kind: 'on', startMin: 21 * 60 + 30, endMin: 8 * 60 })
})

test('parseQuietHours: switched off, the range is not read', async () => {
  expect(parseQuietHours(false, 'nights')).toEqual({ kind: 'off' })
})

test('parseQuietHours: a range to the minute, one-digit hours and spaces allowed', async () => {
  expect(parseQuietHours(true, '22:00-7:30')).toEqual({ kind: 'on', startMin: 22 * 60, endMin: 7 * 60 + 30 })
  expect(parseQuietHours(undefined, ' 1:05 - 6:45 ')).toEqual({ kind: 'on', startMin: 65, endMin: 6 * 60 + 45 })
})

test('parseQuietHours: a range it cannot read is an invalid range', async () => {
  expect(parseQuietHours(true, '24:00-08:00')).toEqual({ kind: 'invalid', setting: 'range', text: '24:00-08:00' })
  expect(parseQuietHours(true, '21:60-08:00')).toEqual({ kind: 'invalid', setting: 'range', text: '21:60-08:00' })
  expect(parseQuietHours(true, '08:00-08:00')).toEqual({ kind: 'invalid', setting: 'range', text: '08:00-08:00' })
  expect(parseQuietHours(true, 'nights')).toEqual({ kind: 'invalid', setting: 'range', text: 'nights' })
  expect(parseQuietHours(true, 2130)).toEqual({ kind: 'invalid', setting: 'range', text: '2130' })
  expect(parseQuietHours(true, null)).toEqual({ kind: 'invalid', setting: 'range', text: 'null' })
})

test('parseQuietHours: a switch that is neither true nor false is an invalid switch', async () => {
  expect(parseQuietHours('yes', '21:30-08:00')).toEqual({ kind: 'invalid', setting: 'switch', text: 'yes' })
})

test('isQuiet: from the start, up to the end, across midnight or not; an unread setting is always quiet', async () => {
  expect(isQuiet(at(21, 29), QUIET)).toEqual(false)
  expect(isQuiet(at(21, 30), QUIET)).toEqual(true)
  expect(isQuiet(at(3), QUIET)).toEqual(true)
  expect(isQuiet(at(7, 59), QUIET)).toEqual(true)
  expect(isQuiet(at(8), QUIET)).toEqual(false)
  const lunch = parseQuietHours(true, '12:00-13:00')
  expect(isQuiet(at(12, 30), lunch)).toEqual(true)
  expect(isQuiet(at(13), lunch)).toEqual(false)
  expect(isQuiet(at(3), lunch)).toEqual(false)
  expect(isQuiet(at(3), { kind: 'off' })).toEqual(false)
  expect(isQuiet(at(12), { kind: 'invalid', setting: 'range', text: 'nights' })).toEqual(true)
})

test('decidePing: no ping in the quiet hours unless a stop time was given', async () => {
  const evening = { lastRequestAt: at(20, 38), now: at(21, 30) }
  expect(decidePing(check(evening))).toEqual('quiet')
  expect(decidePing(check({ ...evening, pingsInRow: 6 }))).toEqual('quiet')
  expect(decidePing(check({ ...evening, stopAt: at(23) }))).toEqual('ping')
  expect(decidePing(check({ ...evening, stopAt: at(21) }))).toEqual('stop-at-time')
  expect(decidePing(check({ lastRequestAt: at(21), now: at(21, 30) }))).toEqual('none')
  expect(decidePing(check({ quiet: { kind: 'invalid', setting: 'range', text: 'nights' } }))).toEqual('quiet')
})

test('pingLimit: the max_pings option brought into 1..20; not a number, 6', async () => {
  expect(pingLimit(undefined)).toEqual(6)
  expect(pingLimit(12)).toEqual(12)
  expect(pingLimit(3.7)).toEqual(3)
  expect(pingLimit(50)).toEqual(20)
  expect(pingLimit(0)).toEqual(1)
  expect(pingLimit(Number.NaN)).toEqual(6)
  expect(pingLimit('12')).toEqual(6)
})

test('isTooFullForVisiblePing: free room against the instruction files plus 30k', async () => {
  const breakdown = (free: number, instructions: number) => ({ categories: [{ kind: 'free', tokens: free }, { kind: 'messages', tokens: 1 }], memoryFiles: [{ tokens: instructions }] })
  expect(isTooFullForVisiblePing({ breakdown: breakdown(200_000, 100_000), window: 1_000_000, contextTokens: 0 })).toEqual(false)
  expect(isTooFullForVisiblePing({ breakdown: breakdown(120_000, 100_000), window: 1_000_000, contextTokens: 0 })).toEqual(true)
  expect(isTooFullForVisiblePing({ breakdown: undefined, window: 200_000, contextTokens: 150_000 })).toEqual(true)
  expect(isTooFullForVisiblePing({ breakdown: undefined, window: 200_000, contextTokens: 100_000 })).toEqual(false)
})

test('parseStop: a duration, a clock time (tomorrow once past), or not understood', async () => {
  expect(parseStop('', START)).toEqual(0)
  expect(parseStop('3h', START)).toEqual(START + 3 * HOUR)
  expect(parseStop('90m', START)).toEqual(START + 90 * MINUTE)
  expect(parseStop('until 18:00', START)).toEqual(START + 8 * HOUR)
  expect(parseStop('until 9:30', START)).toEqual(START + 23.5 * HOUR)
  expect(parseStop('later', START)).toEqual(-1)
})

const snapshot = (fields: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  lastRequestAt: START, now: START, isOn: false, stopAt: 0, pings: [], ttl: SUBSCRIPTION_TTL, contextTokens: 54_000,
  isWaiting: false, shortAfterMs: 0, waitsForMessage: false, sawResponse: true, pingError: '', nearlyFull: false,
  lastRealRequestAt: START, lastWarmPingAt: 0, savings: NO_SAVINGS, quiet: QUIET, maxPings: DEFAULT_MAX_PINGS,
  returnCurve: DEFAULT_RETURN_CURVE, ...fields,
})

test('statusText: on, its ping history and a short cache', async () => {
  const on = snapshot({ isOn: true, pings: [{ at: START, isHit: true, read: 54_000 }, { at: START + HOUR, isHit: false, read: 0 }] })
  expect(statusText(on, 6).split('\n')[0]).toContain('(stops itself after 6 pings in a row)')
  expect(statusText(on, 6).split('\n').slice(-2)).toEqual(['10:00 · read 54k from cache', '11:00 · found the cache cold'])
  expect(statusText(snapshot({ ttl: API_TTL }), 6).split('\n')).toContain('Keep-warm only pings a cache of 30 min or longer.')
})

test('lineModel: keeping while on and able to ping, stalled while on and not, off while off', async () => {
  expect(lineModel(snapshot({ isOn: true }))).toEqual({
    filledCells: 6, tone: 'keeping', main: '60 min left', details: ['󰁔 ping 10:52', '54k cached'], advice: '', canToggle: true, isOn: true,
  })
  expect(lineModel(snapshot({ isOn: true, pingError: 'HTTP 400' })).tone).toEqual('stalled')
  expect(lineModel(snapshot({ isOn: true, pingError: 'HTTP 400' })).details[0]).toEqual('󰔟 expires 11:00')
  expect(lineModel(snapshot({})).tone).toEqual('off')
  expect(lineModel(snapshot({ isOn: true, sawResponse: false, nearlyFull: true })).details).toContain('conversation nearly full: keep-warm waits for you')
  expect(lineModel(snapshot({ ttl: API_TTL })).canToggle).toEqual(false)
})

test('lineModel: a ping that would fall in the quiet hours is named', async () => {
  // 20:38: the ping would be due at 21:30, the start of the quiet hours.
  const evening = at(20, 38)
  const quiet = lineModel(snapshot({ isOn: true, lastRequestAt: evening, now: evening }))
  expect(quiet.tone).toEqual('stalled')
  expect(quiet.details).toEqual(['󰔟 expires 21:38', '󰁔 no ping: quiet hours to 08:00', '54k cached'])
  const earlier = evening - MINUTE
  expect(lineModel(snapshot({ isOn: true, lastRequestAt: earlier, now: earlier })).details).toEqual(['󰁔 ping 21:29', '54k cached'])
  const stopped = lineModel(snapshot({ isOn: true, lastRequestAt: evening, now: evening, stopAt: at(23) }))
  expect(stopped.details).toEqual(['keep-warm stops 23:00', '󰁔 ping 21:30', '54k cached'])
  const unread = lineModel(snapshot({ isOn: true, quiet: { kind: 'invalid', setting: 'range', text: 'nights' } }))
  expect(unread.details).toEqual(['󰔟 expires 11:00', 'quiet hours setting not understood', '54k cached'])
})

test('lineModel: the ping time is the full minute the check sends it at', async () => {
  // 20:37:30: due at 21:29:30, sent by the check at 21:30, the start of the quiet hours.
  const evening = at(20, 37) + 30_000
  expect(lineModel(snapshot({ isOn: true, lastRequestAt: evening, now: evening })).details).toEqual(['󰔟 expires 21:37', '󰁔 no ping: quiet hours to 08:00', '54k cached'])
  // 21:29:40, the window already open: the next check is at 21:30.
  expect(lineModel(snapshot({ isOn: true, quiet: { kind: 'off' }, lastRequestAt: at(20, 37), now: at(21, 29) + 40_000 })).details).toContain('󰁔 ping 21:30')
})

test('lineModel: the quiet hours end inside the ping window: the first check after them pings', async () => {
  // 07:05: the window runs 07:57–08:04; the checks at 07:57–07:59 are quiet, the one at 08:00 is not.
  const morning = at(7, 5)
  const line = lineModel(snapshot({ isOn: true, lastRequestAt: morning, now: morning }))
  expect(line.tone).toEqual('keeping')
  expect(line.details).toEqual(['󰁔 ping 08:00', '54k cached'])
})

test('lineModel: no ping is announced once no check is left in the ping window', async () => {
  // A request at 10:00: the last check that may ping is 10:58 (never in the cache's last minute).
  const resumed = (now: number) => lineModel(snapshot({ isOn: true, now }))
  expect(resumed(START + 58 * MINUTE).details).toContain('󰁔 ping 10:58')
  const late = resumed(START + 59 * MINUTE + 30_000)
  expect(late.tone).toEqual('stalled')
  expect(late.details).toEqual(['after 11:00 your next message re-writes 54k'])
  expect(resumed(START + 58 * MINUTE + 30_000).details).toEqual(['after 11:00 your next message re-writes 54k'])
  expect(lineModel(snapshot({ isOn: true, now: START + 59 * MINUTE, contextTokens: 0 })).details).toEqual(['󰔟 expires 11:00'])
})

test('lineModel: no ping is announced after the stop time', async () => {
  const early = lineModel(snapshot({ isOn: true, stopAt: START + 40 * MINUTE }))
  expect(early.tone).toEqual('stalled')
  expect(early.details).toEqual(['󰔟 expires 11:00', 'keep-warm stops 10:40', '54k cached'])
  expect(lineModel(snapshot({ isOn: true, stopAt: START + 55 * MINUTE })).details).toContain('󰁔 ping 10:52')
})

test('statusText: the quiet hours while keep-warm is on', async () => {
  const lines = (quiet: QuietHours) => statusText(snapshot({ isOn: true, quiet }), 6).split('\n')
  expect(lines(QUIET)[1]).toEqual('Quiet hours 21:30–08:00: no pings then (a stop time overrides them).')
  expect(lines({ kind: 'off' })[1]).toEqual('Quiet hours: off.')
  expect(lines({ kind: 'invalid', setting: 'range', text: 'nights' })[1]).toEqual('Quiet hours range "nights" not understood (use HH:MM-HH:MM); keep-warm will not ping without a stop time until it is fixed.')
  expect(lines({ kind: 'invalid', setting: 'switch', text: 'yes' })[1]).toEqual('Quiet hours setting "yes" not understood (use true or false); keep-warm will not ping without a stop time until it is fixed.')
  expect(statusText(snapshot({}), 6)).not.toContain('Quiet hours')
})

// Three warm pings in a row, 52 min apart, after the request at 10:00.
const THREE = [1, 2, 3].map(i => ({ at: START + i * 52 * MINUTE, isHit: true, read: 54_000 }))
const idleCheck = (n: number, maxPings = 6) => ({ lastRequestAt: START, firstPingAt: START + 52 * MINUTE, ttlMs: HOUR, pingsInRow: n, maxPings, curve: DEFAULT_RETURN_CURVE, quiet: QUIET })

test('seriesValues: a ping that pays at n = 2', async () => {
  expect(seriesValues(idleCheck(2))[0]).toBeGreaterThan(0)
})

test('isLikelyIdle: no series pays from n = 3 with the default curve', async () => {
  expect(isLikelyIdle(idleCheck(3))).toEqual(true)
  expect(seriesValues(idleCheck(3)).every(value => value <= 0)).toEqual(true)
})

test('isLikelyIdle: worth it at n = 0, 1, 2', async () => {
  expect([0, 1, 2].map(n => isLikelyIdle(idleCheck(n)))).toEqual([false, false, false])
})

test('isLikelyIdle: no ping left', async () => {
  expect(isLikelyIdle(idleCheck(6, 6))).toEqual(false)
  expect(seriesValues(idleCheck(6, 6))).toEqual([])
})

test('isLikelyIdle: past the table the last value', async () => {
  expect(isLikelyIdle(idleCheck(10, 20))).toEqual(true)
})

// A request at 20:28: the ping at 21:20 holds the cache to 22:20, all but 2 of its 52 min in the quiet hours.
const eveningCheck = (quiet: QuietHours) => ({ lastRequestAt: at(20, 28), firstPingAt: at(21, 20), ttlMs: HOUR, pingsInRow: 0, maxPings: 6, curve: DEFAULT_RETURN_CURVE, quiet })

test('isLikelyIdle: a ping whose window is mostly quiet hours does not pay', async () => {
  expect(isLikelyIdle(eveningCheck(QUIET))).toEqual(true)
  // The second ping, at 22:12, would fall in the quiet hours.
  expect(seriesValues(eveningCheck(QUIET)).length).toEqual(1)
})

test('isLikelyIdle: the same ping without quiet hours pays', async () => {
  expect(isLikelyIdle(eveningCheck({ kind: 'off' }))).toEqual(false)
})

test('lineModel: likely idle after 3 pings in a row', async () => {
  const line = lineModel(snapshot({ isOn: true, pings: THREE }))
  expect(line.advice).toEqual('󰔢 likely idle: stop?')
  expect(line.tone).toEqual('keeping')
})

test('lineModel: likely idle before the first ping when its window is quiet hours', async () => {
  const line = lineModel(snapshot({ isOn: true, lastRequestAt: at(20, 28), now: at(20, 28) }))
  expect(line.details).toContain('󰁔 ping 21:20')
  expect(line.advice).toEqual('󰔢 likely idle: stop?')
})

test('lineModel: no advice where the user decides or keep-warm cannot ping', async () => {
  const advice = (fields: Partial<SessionSnapshot>) => lineModel(snapshot({ isOn: true, pings: THREE, ...fields })).advice
  expect(advice({ isOn: false })).toEqual('')
  expect(advice({ stopAt: START + 3 * HOUR })).toEqual('')
  expect(advice({ isWaiting: true })).toEqual('')
  expect(advice({ pingError: 'HTTP 400' })).toEqual('')
  expect(advice({ ttl: API_TTL })).toEqual('')
  expect(advice({ lastRequestAt: START, now: START + 61 * MINUTE })).toEqual('')
  expect(advice({ maxPings: 3 })).toEqual('')
  expect(advice({ lastRequestAt: at(20, 38), now: at(20, 38) })).toEqual('')
  expect(advice({ pings: THREE.slice(0, 2) })).toEqual('')
})

test('parseReturnCurve: a list of 1 to 20 numbers from 0 to 1', async () => {
  expect(parseReturnCurve([0.5])).toEqual([0.5])
  expect(parseReturnCurve([0, 1])).toEqual([0, 1])
  const twenty = Array(20).fill(0.1)
  expect(parseReturnCurve(twenty)).toEqual(twenty)
})

test('parseReturnCurve: anything else is the default curve', async () => {
  const unreadable = [undefined, 'x', [], Array(21).fill(0.1), [0.2, 1.5], [0.2, -0.1], [NaN], [0.2, '0.3']]
  for (const value of unreadable) expect(parseReturnCurve(value)).toEqual(DEFAULT_RETURN_CURVE)
})

test('lineModel: a curve whose 4th ping pays keeps quiet at n = 3', async () => {
  const line = lineModel(snapshot({ isOn: true, pings: THREE, returnCurve: [0.183, 0.110, 0.063, 0.2] }))
  expect(line.advice).toEqual('')
})
