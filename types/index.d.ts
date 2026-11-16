/**
 * What the mod remembers per session id in `$.store`, so a relaunch keeps it. `ttl` is the cache
 * length in effect when it was saved (absent before 1.0.3); `savedAt` when it was saved, which
 * ages the entry for the weekly clean-up (absent before 1.0.4); `lastRealRequestAt`,
 * `lastWarmPingAt` and `savings` keep what keep-warm cost and saved (absent before ckw-0zj).
 */
export type KeepWarmSaved = {
  lastRequestAt: number; keepWarm: boolean; stopAt: number; ttl?: KeepWarmTtl; savedAt?: number
  lastRealRequestAt?: number; lastWarmPingAt?: number; savings?: KeepWarmSavings
}

/** One keep-warm ping: when it started, whether the cache still held the conversation, how much it read. */
export type KeepWarmPing = { at: number; isHit: boolean; read: number }

/**
 * What keep-warm cost and saved in this session, in input-token equivalents (an input token 1, a
 * cache read 0.1, a 1-hour cache write 2, an output token 5). `pingCost`: every ping's whole
 * request; `returns`: real requests after a break longer than the cache that found it warm thanks
 * to the pings; `saved`: what re-writing their cache would have cost more than reading it.
 */
export type KeepWarmSavings = { pings: number; pingCost: number; returns: number; saved: number }

/**
 * How long the main conversation's cache lives, and why: from a setting, from the plan, or
 * corrected by what the cache actually did. Null until it can be told. The last one the plan
 * showed is also kept in `$.store` under `plan-ttl`, shared by every session.
 */
export type KeepWarmTtl = { ms: number; reason: 'subscription' | 'api' | 'overage' | 'setting' | 'observed' } | null

declare module 'claude-code' {
  interface PluginState {
    'cache-keep-warm': {
      /** When the main conversation's last model request started (ms since epoch); 0 = unknown. */
      lastRequestAt: number
      /** Whether this session keeps its cache warm. */
      keepWarm: boolean
      /** When keep-warm switches itself off (ms since epoch); 0 = after the ping limit. */
      stopAt: number
      /** The clock as the band last showed it. */
      now: number
      /** Pings since keep-warm was last switched on, oldest first. */
      pings: KeepWarmPing[]
      /** The cache lifetime as last worked out. */
      ttl: KeepWarmTtl
      /** Tokens the last request sent: what a cold cache would make the next message re-write. */
      contextTokens: number
      /** True while Claude waits on an answer to its question. */
      isWaiting: boolean
      /**
       * True once this process has seen a main-thread response: the ping can then be invisible (a
       * fork), and an empty plan list then means an API key. Reset by /clear.
       */
      sawResponse: boolean
      /** The idle gap after which the cache was found cold although it should have lasted; 0 = none seen. */
      shortAfterMs: number
      /** True when the invisible ping found nothing to repeat, so the visible one is used, until the next request. */
      waitsForMessage: boolean
      /** True once this process has restored the session's saved values from the store. */
      restored: boolean
      /** Why the last ping did not reach the model (Claude Code's words or the HTTP status); '' = none. */
      pingError: string
      /** True while the conversation fills too much of the context window for a visible ping. */
      nearlyFull: boolean
      /** When the main conversation's last request that was not a ping started (ms since epoch); 0 = none yet. */
      lastRealRequestAt: number
      /** When the last ping that found the cache warm started (ms since epoch); 0 = none yet. */
      lastWarmPingAt: number
      /** What keep-warm cost and saved in this session; never reset while the session lives. */
      savings: KeepWarmSavings
    }
  }
}
