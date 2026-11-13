import type { ModelUsage } from 'claude-code'

import type { KeepWarmTtl } from '../types'

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const FIVE_MIN_MS = 5 * MINUTE_MS
// The cache lengths Claude Code offers today; a value seen elsewhere is still accepted.
export const KNOWN_TTLS_MS = [FIVE_MIN_MS, HOUR_MS]
// Keep-warm only for a cache this long or longer: on a short cache, pinging every few
// minutes costs more than the single re-write it saves after any real break.
export const KEEP_WARM_MIN_TTL_MS = 30 * MINUTE_MS
// A ping goes out this long before the cache would expire (52 min into a 1-hour cache), and
// never in its last minute: a cold cache is never pinged. 52 min comes before Claude Code's
// idle compaction, which compacts a long idle conversation at 90% of the hour (54 min); a later
// ping would mean fewer of them, and the lead leaves minutes of retries if the API is busy.
// The cache's life runs from when a request reaches the server, a moment after the time
// recorded here, so the real deadline is slightly later than computed.
export const PING_LEAD_MS = 8 * MINUTE_MS
export const PING_MARGIN_MS = MINUTE_MS
// Without an explicit stop time, keep-warm stops itself after this many pings in a row (the
// `max_pings` option; 8 by default, ~7 h). A ping reads the cache at 0.1x its size, re-writing a
// 1-hour cache costs 2x: 20 pings is where pinging stops paying even for a sure return, and the
// longer the break, the less likely the return.
export const DEFAULT_MAX_PINGS = 8
export const MAX_PINGS_CAP = 20

// The `max_pings` option as a whole number brought into 1..MAX_PINGS_CAP; not a number, the default.
export function pingLimit(option: unknown) {
  if (typeof option !== 'number' || !Number.isFinite(option)) return DEFAULT_MAX_PINGS
  return Math.min(Math.max(Math.floor(option), 1), MAX_PINGS_CAP)
}

// A request reading at least this share of the conversation from cache found it still warm.
const HIT_SHARE = 0.5

export function isCacheHit({ cache_read_input_tokens: read, cache_creation_input_tokens: written }: ModelUsage) {
  return read > 0 && read >= HIT_SHARE * (read + written)
}

export function isLongEnoughToKeepWarm(ttl: KeepWarmTtl) {
  return ttl !== null && ttl.ms >= KEEP_WARM_MIN_TTL_MS
}

// Known to be too short; an unknown length is not.
export function isTooShortToKeepWarm(ttl: KeepWarmTtl) {
  return ttl !== null && ttl.ms < KEEP_WARM_MIN_TTL_MS
}
