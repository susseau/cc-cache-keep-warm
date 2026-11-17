// What keep-warm cost and saved, without an engine: the account and how the line and /keepwarm word it.
import { expect, test } from 'claude-code/testing'

import { statusText } from '../hooks/command'
import { lineModel } from '../hooks/line/line-model'
import { parseQuietHours } from '../hooks/quiet-hours'
import { addPing, addSavedReturn, isSavedReturn, NO_SAVINGS, requestCost } from '../hooks/savings'
import type { SessionSnapshot } from '../hooks/session-snapshot'
import { MINUTE, READ, START, WRITE } from './engine'

const SUBSCRIPTION_TTL = { ms: 60 * MINUTE, reason: 'subscription' } as const
const OBSERVED_TTL = { ms: 10 * MINUTE, reason: 'observed' } as const
const PAID_BACK = { pings: 1, pingCost: 5_035, returns: 1, saved: 95_000 }
const NOT_PAID_BACK = { pings: 1, pingCost: 5_035, returns: 0, saved: 0 }

const snapshot = (fields: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  lastRequestAt: START, now: START, isOn: false, stopAt: 0, pings: [], ttl: SUBSCRIPTION_TTL, contextTokens: 54_000,
  isWaiting: false, shortAfterMs: 0, waitsForMessage: false, sawResponse: true, pingError: '', nearlyFull: false,
  lastRealRequestAt: START, lastWarmPingAt: 0, savings: NO_SAVINGS, quiet: parseQuietHours(undefined, undefined), ...fields,
})

test('requestCost: input 1, cache read 0.1, 1-hour write 2, output 5', async () => {
  expect(requestCost(READ)).toEqual(5_035)
  expect(requestCost(WRITE)).toEqual(100_035)
})

test('addPing: counts the ping and adds its whole request', async () => {
  expect(addPing(NO_SAVINGS, READ)).toEqual({ pings: 1, pingCost: 5_035, returns: 0, saved: 0 })
})

test('addSavedReturn: a return saves re-writing what it read, less reading it', async () => {
  const pinged = { pings: 1, pingCost: 5_035, returns: 0, saved: 0 }
  expect(addSavedReturn(pinged, READ)).toEqual({ pings: 1, pingCost: 5_035, returns: 1, saved: 95_000 })
})

test('isSavedReturn: a warm cache after a break longer than the cache, with a warm ping in it', async () => {
  const back = { lastRealRequestAt: START, lastWarmPingAt: START + 52 * MINUTE, now: START + 70 * MINUTE, ttl: SUBSCRIPTION_TTL, usage: READ }
  expect(isSavedReturn(back)).toEqual(true)
  expect(isSavedReturn({ ...back, now: START + 50 * MINUTE })).toEqual(false)
  expect(isSavedReturn({ ...back, lastWarmPingAt: 0 })).toEqual(false)
  expect(isSavedReturn({ ...back, lastWarmPingAt: START - MINUTE })).toEqual(false)
  expect(isSavedReturn({ ...back, usage: WRITE })).toEqual(false)
  expect(isSavedReturn({ ...back, lastRealRequestAt: 0 })).toEqual(false)
  expect(isSavedReturn({ ...back, ttl: null })).toEqual(false)
})

test('lineModel: a net saving reads "saved", after the ping count', async () => {
  const pings = [{ at: START - 8 * MINUTE, isHit: true, read: 50_000 }]
  expect(lineModel(snapshot({ isOn: true, pings, savings: PAID_BACK })).details).toEqual(['󰁔 ping 10:52', '1 ping ✓', '󰆼 saved 90k', '54k cached'])
})

test('lineModel: pings not paid back yet read "cost"', async () => {
  expect(lineModel(snapshot({ isOn: true, savings: NOT_PAID_BACK })).details).toContain('󰆼 cost 5k')
})

test('lineModel: the account stays while keep-warm is paused', async () => {
  expect(lineModel(snapshot({ isOn: true, ttl: OBSERVED_TTL, shortAfterMs: 10 * MINUTE, savings: NOT_PAID_BACK })).details).toContain('󰆼 cost 5k')
})

test('lineModel: no account while keep-warm is off', async () => {
  expect(lineModel(snapshot({ savings: PAID_BACK })).details).not.toContain('󰆼 saved 90k')
})

test('lineModel: no account before the first ping', async () => {
  expect(lineModel(snapshot({ isOn: true })).details).toEqual(['󰁔 ping 10:52', '54k cached'])
})

test('statusText: pings, saved returns, cost and a net saving', async () => {
  const savings = { pings: 3, pingCost: 15_105, returns: 1, saved: 95_000 }
  expect(statusText(snapshot({ savings }), 8).split('\n')).toContain('This session: 3 pings cost 15k, 1 return to a warm cache saved 95k: 80k saved (input-token equivalents).')
})

test('statusText: pings not paid back yet are spent', async () => {
  const savings = { pings: 1, pingCost: 5_035, returns: 0, saved: 0 }
  expect(statusText(snapshot({ savings }), 8).split('\n')).toContain('This session: 1 ping cost 5k, 0 returns to a warm cache saved 0k: 5k spent (input-token equivalents).')
})

test('statusText: no account before the first ping', async () => {
  expect(statusText(snapshot({}), 8)).not.toContain('This session:')
})
