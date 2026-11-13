import type { EngineInterface } from 'claude-code'

import type { KeepWarmSaved, KeepWarmTtl } from '../types'
import { HOUR_MS } from './cache-timing'
import { isRestored, live, markRestored, readSnapshot, writeSession } from './state'

// $.store is shared by every session and survives an app relaunch, which empties $.state: each
// session keeps there what it needs to carry on, under its own key.
const STORE_PREFIX = 'session:'
const STORE_MAX_AGE_MS = 7 * 24 * HOUR_MS
// Shared by every session: the cache length the plan showed last. Claude Code reports the plan
// only with a response, so a session reopened after a relaunch would otherwise not know its
// cache length (and could not keep it warm) until its first answer.
const PLAN_TTL_KEY = 'plan-ttl'

export async function save($: EngineInterface) {
  if (!live.storeKey) return
  const { lastRequestAt, isOn: keepWarm, stopAt, ttl } = await readSnapshot($)
  const saved: KeepWarmSaved = { lastRequestAt, keepWarm, stopAt, ttl, savedAt: await $.clock.now() }
  await $.store.set(live.storeKey, saved)
}

// Saves only once session.start has restored: before that, it would write the defaults
// (keep-warm off) over the saved values.
export async function saveIfRestored($: EngineInterface) {
  if (await isRestored($)) await save($)
}

export async function openSessionStore($: EngineInterface) {
  live.storeKey = STORE_PREFIX + (await $.session.id())
  const plan = (await $.store.get(PLAN_TTL_KEY)) as KeepWarmTtl | undefined
  if (plan && typeof plan.ms === 'number') live.planTtl = plan
}

// After an app relaunch the session's values are gone; the store keeps them per session id.
// A reopened session may already have its last answer's time from Claude Code (the
// classic.SessionStart hook, which can run before or after session.start): keep the later.
// Runs once per process; a reload of the module keeps $.state and needs nothing back.
export async function restoreSaved($: EngineInterface) {
  if (await isRestored($)) return false
  const saved = (await $.store.get(live.storeKey)) as KeepWarmSaved | undefined
  if (saved) {
    if (saved.ttl && typeof saved.ttl.ms === 'number') live.savedTtl = saved.ttl
    const { lastRequestAt: last } = await readSnapshot($)
    if (saved.lastRequestAt > last) await writeSession($, { lastRequestAt: saved.lastRequestAt })
    await writeSession($, { isOn: saved.keepWarm, stopAt: saved.stopAt ?? 0 })
  } else live.isUnseen = true
  await markRestored($)
  await save($)
  return true
}

// Forget sessions untouched for a week so the store stays small.
export async function forgetOldSessions($: EngineInterface, now: number) {
  for (const key of await $.store.keys()) {
    if (!key.startsWith(STORE_PREFIX) || key === live.storeKey) continue
    const old = (await $.store.get(key)) as KeepWarmSaved | undefined
    if (isForgotten(old, now)) await $.store.delete(key)
  }
}

// Aged by the last save: a session /compact or /clear just reset has no last request, yet is in
// use (counting from 0 deleted its entry, keep-warm switch included). An old entry with no date
// at all is kept while its keep-warm is on.
function isForgotten(old: KeepWarmSaved | undefined, now: number) {
  if (!old) return true
  const at = old.savedAt ?? old.lastRequestAt
  return at > 0 ? now - at > STORE_MAX_AGE_MS : !old.keepWarm
}

// Keeps what the plan showed for the next session that opens before its first answer; written
// only when it changes, though this runs on every check.
export async function rememberPlan($: EngineInterface, ttl: NonNullable<KeepWarmTtl>): Promise<KeepWarmTtl> {
  if (live.planTtl?.ms !== ttl.ms || live.planTtl?.reason !== ttl.reason) {
    live.planTtl = ttl
    await $.store.set(PLAN_TTL_KEY, ttl)
  }
  return ttl
}
