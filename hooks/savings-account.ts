// The session's keep-warm account in $.state: what each ping cost, and the returns the pings saved.
import type { EngineInterface, ModelUsage } from 'claude-code'

import { isCacheHit } from './cache-timing'
import { addPing, addSavedReturn, isSavedReturn } from './savings'
import { appendPing, readSnapshot, writeSession } from './state'

// A ping (invisible or visible): its place in the ping history, what it cost, and, when it found
// the cache warm, its time, which later tells a saved return.
export async function accountPing($: EngineInterface, at: number, usage: ModelUsage) {
  await appendPing($, at, usage)
  const { savings } = await readSnapshot($)
  await writeSession($, { savings: addPing(savings, usage) })
  if (isCacheHit(usage)) await writeSession($, { lastWarmPingAt: at })
}

// A request of yours or one the session ran by itself, not a ping: after a break longer than the
// cache, finding it warm is what the pings saved.
export async function accountRealRequest($: EngineInterface, now: number, usage: ModelUsage) {
  const { lastRealRequestAt, lastWarmPingAt, ttl, savings } = await readSnapshot($)
  if (isSavedReturn({ lastRealRequestAt, lastWarmPingAt, now, ttl, usage })) await writeSession($, { savings: addSavedReturn(savings, usage) })
  await writeSession($, { lastRealRequestAt: now })
}
