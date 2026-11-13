// The pure decisions, without an engine: cache length, when to ping, /keepwarm and the line.
import { expect, test } from 'claude-code/testing'

import { DEFAULT_MAX_PINGS, pingLimit } from '../hooks/cache-timing'
import { parseStop, statusText } from '../hooks/command'
import { lineModel } from '../hooks/line/line-model'
import { decidePing, isTooFullForVisiblePing, type PingCheck } from '../hooks/ping/decide-ping'
import type { SessionSnapshot } from '../hooks/session-snapshot'
import { correctTtl, decideTtl, parseTtl, shortAfterGap, type TtlMemory, type TtlSources } from '../hooks/ttl/decide-ttl'
import { MINUTE, READ, START, WRITE } from './engine'

const HOUR = 60 * MINUTE
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
  now: START + 52 * MINUTE, ttl: SUBSCRIPTION_TTL, lastRequestAt: START, stopAt: 0, pendingUntil: 0, pingsInRow: 0, maxPings: DEFAULT_MAX_PINGS, needsVisible: false, nearlyFull: false, ...fields,
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
  expect(decidePing(check({ pingsInRow: 7 }))).toEqual('ping')
  expect(decidePing(check({ pingsInRow: 8 }))).toEqual('stop-after-max')
  expect(decidePing(check({ pingsInRow: 8, maxPings: 12 }))).toEqual('ping')
  expect(decidePing(check({ pingsInRow: 8, stopAt: START + 3 * HOUR }))).toEqual('ping')
  expect(decidePing(check({ needsVisible: true }))).toEqual('visible-ping')
  expect(decidePing(check({ needsVisible: true, nearlyFull: true }))).toEqual('blocked')
})

test('pingLimit: the max_pings option, 1 to 20, else 8', async () => {
  expect(pingLimit(undefined)).toEqual(8)
  expect(pingLimit(12)).toEqual(12)
  expect(pingLimit(3.7)).toEqual(3)
  expect(pingLimit(50)).toEqual(20)
  expect(pingLimit(0)).toEqual(8)
  expect(pingLimit('12')).toEqual(8)
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
  isWaiting: false, shortAfterMs: 0, waitsForMessage: false, sawResponse: true, pingError: '', nearlyFull: false, ...fields,
})

test('statusText: on, its ping history and a short cache', async () => {
  const on = snapshot({ isOn: true, pings: [{ at: START, isHit: true, read: 54_000 }, { at: START + HOUR, isHit: false, read: 0 }] })
  expect(statusText(on, 8).split('\n')[0]).toContain('(stops itself after 8 pings in a row)')
  expect(statusText(on, 8).split('\n').slice(-2)).toEqual(['10:00 · read 54k from cache', '11:00 · found the cache cold'])
  expect(statusText(snapshot({ ttl: API_TTL }), 8).split('\n')).toContain('Keep-warm only pings a cache of 30 min or longer.')
})

test('lineModel: green only while on and able to ping', async () => {
  expect(lineModel(snapshot({ isOn: true }), 'terminal')).toEqual({
    circle: '●', filledCells: 10, isGreen: true, main: '60 min left', expiresText: ' (11:00)', details: ['next ping 10:52', '54k cached'], canToggle: true, isOn: true,
  })
  expect(lineModel(snapshot({ isOn: true, pingError: 'HTTP 400' }), 'desktop').isGreen).toEqual(false)
  expect(lineModel(snapshot({ isOn: true, sawResponse: false, nearlyFull: true }), 'desktop').details).toContain('conversation nearly full: keep-warm waits for you')
  expect(lineModel(snapshot({ ttl: API_TTL }), 'desktop').canToggle).toEqual(false)
})
