// What says how long the cache lasts: Claude Code's environment and settings, the plan's
// rate-limit windows, and whether the conversation has answered in this run.
import type { EngineInterface, SessionUsage } from 'claude-code'

import { readSnapshot } from '../state'
import { parseTtl, type TtlSources } from './decide-ttl'

export async function readTtlSources($: EngineInterface, usage: SessionUsage): Promise<TtlSources> {
  const isFiveMinutesForced = (await $.env.get('FORCE_PROMPT_CACHING_5M')) === '1'
  const envTtlMs = parseTtl(await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'))
  // Only this one setting: asked by its key, Claude Code hands over its value and nothing else.
  const settingsTtlMs = parseTtl(await $.settings.read({ key: 'promptCacheTtl' }))
  const isHourEnabled = (await $.env.get('ENABLE_PROMPT_CACHING_1H')) === '1'
  const { sawResponse } = await readSnapshot($)
  return { isFiveMinutesForced, envTtlMs, settingsTtlMs, isHourEnabled, rateLimits: usage.rateLimits, sawResponse }
}
