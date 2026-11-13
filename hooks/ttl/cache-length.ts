// The cache length: read its sources, decide, and keep what the next check or session needs.
import type { EngineInterface, ModelUsage, SessionUsage } from 'claude-code'

import type { KeepWarmTtl } from '../../types'
import { rememberPlan } from '../session-store'
import { live, readSnapshot, writeSession } from '../state'
import { decideTtl, shortAfterGap } from './decide-ttl'
import { readTtlSources } from './read-ttl'

export async function detectTtl($: EngineInterface, usage: SessionUsage): Promise<KeepWarmTtl> {
  const decision = decideTtl(await readTtlSources($, usage), live)
  if (decision.sawPlanWindows) live.answersWithoutPlan = 0
  if (decision.isPlan && decision.ttl) return rememberPlan($, decision.ttl)
  return decision.ttl
}

// Records what a request after an idle gap showed about the cache's length.
export async function observeGap($: EngineInterface, gapMs: number, usage: ModelUsage) {
  const { ttl, shortAfterMs } = await readSnapshot($)
  const next = shortAfterGap({ gapMs, usage, ttl, shortAfterMs })
  if (next !== shortAfterMs) await writeSession($, { shortAfterMs: next })
}
