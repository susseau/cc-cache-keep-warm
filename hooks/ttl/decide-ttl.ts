// How long this session's cache lasts: decided from what read-ttl.ts gathered, with no reads
// of its own.
import type { ModelUsage } from 'claude-code'

import type { KeepWarmTtl } from '../../types'
import { FIVE_MIN_MS, HOUR_MS, isCacheHit, KNOWN_TTLS_MS, MINUTE_MS, PING_MARGIN_MS } from '../cache-timing'

const TTL_VALUE = /^(\d+)\s*(s|m|h)$/
// Rate-limit windows that only a Claude subscription reports; an API key or a cloud provider reports none.
const PLAN_WINDOWS = ['five_hour', 'seven_day']
const PLAN_LIMIT_PERCENT = 100
// The windows can come a moment after an answer: with a plan seen before, only this many answers
// in a row without them mean an API key (one empty look labelled a subscription "API key").
const API_AFTER_ANSWERS = 3
// A re-write after a shorter gap is a change to the prompt (compaction, a model switch),
// not an expiry, so it says nothing about the cache's length.
const EVIDENCE_GAP_MS = FIVE_MIN_MS + 30_000

export type TtlSources = {
  isFiveMinutesForced: boolean
  envTtlMs: number
  settingsTtlMs: number
  isHourEnabled: boolean
  rateLimits: { kind: string, percentUsed: number }[]
  sawResponse: boolean
}

// What earlier checks and sessions learned: the plan seen last, this session's saved length, and
// the answers since the plan's windows were last seen.
export type TtlMemory = {
  planTtl: KeepWarmTtl | undefined
  savedTtl: KeepWarmTtl | undefined
  answersWithoutPlan: number
}

// `isWorthRemembering`: a length the next session should start from: the plan's windows, or
// their lasting absence (an API key).
// `sawPlanWindows`: the windows were there, which starts the answers without them over.
export type TtlDecision = { ttl: KeepWarmTtl, isWorthRemembering: boolean, sawPlanWindows: boolean }

// "5m", "1h", "30m", "90s": any length, so a cache length Claude Code adds later still reads.
export function parseTtl(value: unknown) {
  if (typeof value !== 'string') return 0
  const m = TTL_VALUE.exec(value.trim())
  if (!m) return 0
  return Number(m[1]) * (m[2] === 'h' ? HOUR_MS : m[2] === 'm' ? MINUTE_MS : 1000)
}

// The same precedence Claude Code itself applies, then the plan: a subscription within its
// limits gets the hour, one over its limit (paying usage credits) and an API key get 5 minutes.
export function decideTtl(sources: TtlSources, memory: TtlMemory): TtlDecision {
  const setting = settingTtl(sources)
  if (setting) return { ttl: setting, isWorthRemembering: false, sawPlanWindows: false }

  const plan = sources.rateLimits.filter(w => PLAN_WINDOWS.includes(w.kind))
  if (plan.length > 0) {
    const isOverLimit = plan.some(w => w.percentUsed >= PLAN_LIMIT_PERCENT)
    const ttl = isOverLimit ? { ms: FIVE_MIN_MS, reason: 'overage' as const } : { ms: HOUR_MS, reason: 'subscription' as const }
    return { ttl, isWorthRemembering: true, sawPlanWindows: true }
  }
  return ttlWithoutPlanWindows(sources.sawResponse, memory)
}

function settingTtl(sources: TtlSources): KeepWarmTtl {
  if (sources.isFiveMinutesForced) return { ms: FIVE_MIN_MS, reason: 'setting' }
  if (sources.envTtlMs) return { ms: sources.envTtlMs, reason: 'setting' }
  if (sources.settingsTtlMs) return { ms: sources.settingsTtlMs, reason: 'setting' }
  if (sources.isHourEnabled) return { ms: HOUR_MS, reason: 'setting' }
  return null
}

// The windows arrive with the first response, so before one an empty list proves nothing:
// until then, go by the length this session's cache had when last saved (what its last
// request really got), else by what the plan showed last time in any session.
// A saved "API key" next to a plan seen since may be that wrong label: the plan wins.
function ttlWithoutPlanWindows(sawResponse: boolean, { planTtl, savedTtl, answersWithoutPlan }: TtlMemory): TtlDecision {
  const known = planTtl && planTtl.reason !== 'api' ? planTtl : undefined
  if (!sawResponse) {
    const ttl = (savedTtl?.reason === 'api' ? known : savedTtl) ?? planTtl ?? null
    return { ttl, isWorthRemembering: false, sawPlanWindows: false }
  }
  if (known && answersWithoutPlan < API_AFTER_ANSWERS) return { ttl: known, isWorthRemembering: false, sawPlanWindows: false }
  return { ttl: { ms: FIVE_MIN_MS, reason: 'api' }, isWorthRemembering: true, sawPlanWindows: false }
}

// What the cache actually did beats what the settings say: if it went cold after a gap it
// should have survived, use the longest known length shorter than that gap.
export function correctTtl(base: KeepWarmTtl, shortAfterMs: number): KeepWarmTtl {
  if (!base || shortAfterMs <= 0 || shortAfterMs >= base.ms - PING_MARGIN_MS) return base
  const shorter = KNOWN_TTLS_MS.filter(ms => ms < shortAfterMs)
  return { ms: shorter.length ? Math.max(...shorter) : FIVE_MIN_MS, reason: 'observed' }
}

export type GapEvidence = { gapMs: number, usage: ModelUsage, ttl: KeepWarmTtl, shortAfterMs: number }

// Each request after an idle gap shows whether the cache outlived that gap: a read clears an
// earlier "went cold too soon"; a re-write after a gap the cache should have survived records
// one. Answers the shortest gap the cache is known not to outlive (0: none).
export function shortAfterGap({ gapMs, usage, ttl, shortAfterMs }: GapEvidence) {
  const total = usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  if (total === 0 || gapMs < EVIDENCE_GAP_MS) return shortAfterMs
  if (isCacheHit(usage)) return 0
  const expected = ttl?.reason === 'observed' ? HOUR_MS : (ttl?.ms ?? HOUR_MS)
  if (gapMs >= expected - PING_MARGIN_MS) return shortAfterMs
  return shortAfterMs > 0 ? Math.min(shortAfterMs, gapMs) : gapMs
}
