// What keep-warm cost and saved in this session, from the usage of its pings and of the returns
// they kept warm. Prices relative to one input token, from Anthropic's price list: a cache read
// costs 0.1x, a 1-hour cache write 2x, an output token 5x. Keep-warm only runs on the 1-hour cache.
import type { ModelUsage } from 'claude-code'

import type { KeepWarmSavings, KeepWarmTtl } from '../types'
import { isCacheHit } from './cache-timing'

const READ_PRICE = 0.1
const HOUR_WRITE_PRICE = 2
const OUTPUT_PRICE = 5

export const NO_SAVINGS: KeepWarmSavings = { pings: 0, pingCost: 0, returns: 0, saved: 0 }

export function requestCost(usage: ModelUsage) {
  return usage.input_tokens
    + READ_PRICE * usage.cache_read_input_tokens
    + HOUR_WRITE_PRICE * usage.cache_creation_input_tokens
    + OUTPUT_PRICE * usage.output_tokens
}

export function addPing(savings: KeepWarmSavings, usage: ModelUsage): KeepWarmSavings {
  return { ...savings, pings: savings.pings + 1, pingCost: savings.pingCost + requestCost(usage) }
}

export type RealRequest = { lastRealRequestAt: number, lastWarmPingAt: number, now: number, ttl: KeepWarmTtl, usage: ModelUsage }

// A real request after a break longer than the cache's life that still read the cache: only a
// warm ping since the last real request can have kept it.
export function isSavedReturn({ lastRealRequestAt, lastWarmPingAt, now, ttl, usage }: RealRequest) {
  if (ttl === null || lastRealRequestAt === 0) return false
  return lastWarmPingAt > lastRealRequestAt && now - lastRealRequestAt > ttl.ms && isCacheHit(usage)
}

// Without the pings this request would have re-written what it read.
export function addSavedReturn(savings: KeepWarmSavings, usage: ModelUsage): KeepWarmSavings {
  const read = usage.cache_read_input_tokens
  return { ...savings, returns: savings.returns + 1, saved: savings.saved + HOUR_WRITE_PRICE * read - READ_PRICE * read }
}

export function netSaving({ saved, pingCost }: KeepWarmSavings) {
  return saved - pingCost
}
