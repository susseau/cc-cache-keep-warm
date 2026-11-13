import type { EngineInterface, ModelUsage } from 'claude-code'

import type { KeepWarmPing, KeepWarmTtl } from '../types'
import { DEFAULT_MAX_PINGS, isCacheHit, MAX_PINGS_CAP } from './cache-timing'
import type { SessionSnapshot } from './session-snapshot'

// Per-session values in $.state: they survive a reload of the module, not an app relaunch (the
// session store in session-store.ts carries the ones that must). Only this file touches them:
// Claude Code takes a $.state reference only as literals written in the calling file.
const LAST = { plugin: 'cache-keep-warm', key: 'lastRequestAt' } as const
const KEEP_WARM = { plugin: 'cache-keep-warm', key: 'keepWarm' } as const
const STOP_AT = { plugin: 'cache-keep-warm', key: 'stopAt' } as const
const NOW = { plugin: 'cache-keep-warm', key: 'now' } as const
const PINGS = { plugin: 'cache-keep-warm', key: 'pings' } as const
const TTL = { plugin: 'cache-keep-warm', key: 'ttl' } as const
const CONTEXT = { plugin: 'cache-keep-warm', key: 'contextTokens' } as const
const WAITING = { plugin: 'cache-keep-warm', key: 'isWaiting' } as const
const SAW_RESPONSE = { plugin: 'cache-keep-warm', key: 'sawResponse' } as const
const SHORT_AFTER = { plugin: 'cache-keep-warm', key: 'shortAfterMs' } as const
const WAITS = { plugin: 'cache-keep-warm', key: 'waitsForMessage' } as const
const RESTORED = { plugin: 'cache-keep-warm', key: 'restored' } as const
const PING_ERROR = { plugin: 'cache-keep-warm', key: 'pingError' } as const
const NEARLY_FULL = { plugin: 'cache-keep-warm', key: 'nearlyFull' } as const

// The module's own variables start over on a reload; what must survive one is in $.state.
// `titleMark` is the user's "Mark the session title" setting; changing it in /config reloads
// the module, so it is read once in register(), like `defaultOn` ("On in new sessions") and
// `maxPings` ("Pings in a row").
// `isUnseen`: the store had nothing for this session at start; `startedNew`: Claude Code started
// it as a new session (not reopened). `planTtl` mirrors the shared plan-ttl store entry;
// `savedTtl` is the length this session's own cache had when the store last saw it.
// `visiblePingAt`: when a visible ping was submitted, until its request is seen.
// `pingTurnId`: the visible ping's turn, which is no sign of use when it ends.
// `answersWithoutPlan`: answers since the plan's windows were last seen.
// `roomChecked`: whether this process has worked out if the visible ping fits.
// `isFirstRequest`: the first request after a start says nothing about the cache's length.
export const live: {
  storeKey: string
  pingPendingUntil: number
  shownKey: string
  titleMark: boolean
  defaultOn: boolean
  maxPings: number
  isUnseen: boolean
  startedNew: boolean
  planTtl: KeepWarmTtl | undefined
  savedTtl: KeepWarmTtl | undefined
  isFirstRequest: boolean
  visiblePingAt: number
  pingTurnId: string
  answersWithoutPlan: number
  roomChecked: boolean
} = {
  storeKey: '',
  pingPendingUntil: 0,
  shownKey: '',
  titleMark: true,
  defaultOn: false,
  maxPings: DEFAULT_MAX_PINGS,
  isUnseen: false,
  startedNew: false,
  planTtl: undefined,
  savedTtl: undefined,
  isFirstRequest: true,
  visiblePingAt: 0,
  pingTurnId: '',
  answersWithoutPlan: 0,
  roomChecked: false,
}

export async function readSnapshot($: EngineInterface): Promise<SessionSnapshot> {
  const [last, now, isOn, stopAt, pings, ttl, context, waiting, shortAfter, waits, sawResponse, pingError, nearlyFull] = await Promise.all([
    $.state.get(LAST), $.state.get(NOW), $.state.get(KEEP_WARM), $.state.get(STOP_AT), $.state.get(PINGS), $.state.get(TTL), $.state.get(CONTEXT),
    $.state.get(WAITING), $.state.get(SHORT_AFTER), $.state.get(WAITS), $.state.get(SAW_RESPONSE), $.state.get(PING_ERROR), $.state.get(NEARLY_FULL),
  ])
  return {
    lastRequestAt: last.value ?? 0,
    now: now.value ?? 0,
    isOn: isOn.value ?? false,
    stopAt: stopAt.value ?? 0,
    pings: pings.value ?? [],
    ttl: ttl.value ?? null,
    contextTokens: context.value ?? 0,
    isWaiting: waiting.value ?? false,
    shortAfterMs: shortAfter.value ?? 0,
    waitsForMessage: waits.value ?? false,
    sawResponse: sawResponse.value ?? false,
    pingError: pingError.value ?? '',
    nearlyFull: nearlyFull.value ?? false,
  }
}

// Writes the values given, each under its own key.
export async function writeSession($: EngineInterface, patch: Partial<SessionSnapshot>) {
  if (patch.lastRequestAt !== undefined) await $.state.set(LAST, patch.lastRequestAt)
  if (patch.now !== undefined) await $.state.set(NOW, patch.now)
  if (patch.isOn !== undefined) await $.state.set(KEEP_WARM, patch.isOn)
  if (patch.stopAt !== undefined) await $.state.set(STOP_AT, patch.stopAt)
  if (patch.pings !== undefined) await $.state.set(PINGS, patch.pings)
  if (patch.ttl !== undefined) await $.state.set(TTL, patch.ttl)
  if (patch.contextTokens !== undefined) await $.state.set(CONTEXT, patch.contextTokens)
  if (patch.isWaiting !== undefined) await $.state.set(WAITING, patch.isWaiting)
  if (patch.shortAfterMs !== undefined) await $.state.set(SHORT_AFTER, patch.shortAfterMs)
  if (patch.waitsForMessage !== undefined) await $.state.set(WAITS, patch.waitsForMessage)
  if (patch.sawResponse !== undefined) await $.state.set(SAW_RESPONSE, patch.sawResponse)
  if (patch.pingError !== undefined) await $.state.set(PING_ERROR, patch.pingError)
  if (patch.nearlyFull !== undefined) await $.state.set(NEARLY_FULL, patch.nearlyFull)
}

// Whether session.start has restored the saved values in this process.
export async function isRestored($: EngineInterface) {
  const { value: restored = false } = await $.state.get(RESTORED)
  return restored
}

export async function markRestored($: EngineInterface) {
  await $.state.set(RESTORED, true)
}

// A ping (invisible or visible) and what its request found in the cache.
export async function appendPing($: EngineInterface, at: number, usage: ModelUsage) {
  const ping: KeepWarmPing = { at, isHit: isCacheHit(usage), read: usage.cache_read_input_tokens }
  const { value: pings = [] } = await $.state.get(PINGS)
  await $.state.set(PINGS, [...pings, ping].slice(-MAX_PINGS_CAP))
}
