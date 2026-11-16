// The main conversation's requests: each one restarts the cache's life.
import type { EngineInterface, ModelUsage } from 'claude-code'

import { accountPing, accountRealRequest } from '../savings-account'
import { save } from '../session-store'
import { live, readSnapshot, writeSession } from '../state'
import { observeGap } from '../ttl/cache-length'

// Before the request goes out: from now on the cache lives from this request. Answers the time
// of the request before, to put back if this one never reaches the model.
export async function startRequest($: EngineInterface) {
  const now = await $.clock.now()
  const { lastRequestAt: previous } = await readSnapshot($)
  live.pingPendingUntil = 0
  await writeSession($, { lastRequestAt: now, now })
  await save($)
  return { now, previous }
}

export type FinishedRequest = { turnId: string, now: number, previous: number, usage: ModelUsage | undefined }

// After the request: its usage shows whether it reached the cache and whether the cache
// outlived the gap before it.
export async function finishRequest($: EngineInterface, { turnId, now, previous, usage }: FinishedRequest) {
  if (!usage || !reachedModel(usage)) return putBack($, previous)
  await writeSession($, { waitsForMessage: false, pingError: '' })
  if (live.visiblePingAt > 0) await recordVisiblePing($, turnId, usage)
  else await accountRealRequest($, now, usage)
  // Not the first request after a start: a restart can change the prompt itself (a new
  // Claude Code version), which re-writes the cache whatever the gap, so it proves nothing.
  const isFirst = live.isFirstRequest
  live.isFirstRequest = false
  if (previous > 0 && !isFirst) await observeGap($, now - previous, usage)
}

function reachedModel(usage: ModelUsage) {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0
}

// A request that never reached the model (an error, the conversation over its limit) did not
// touch the cache, so its life still runs from the request before.
async function putBack($: EngineInterface, previous: number) {
  await writeSession($, { lastRequestAt: previous })
  await save($)
}

async function recordVisiblePing($: EngineInterface, turnId: string, usage: ModelUsage) {
  await accountPing($, live.visiblePingAt, usage)
  live.visiblePingAt = 0
  live.pingTurnId = turnId
}
