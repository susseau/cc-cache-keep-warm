// /keepwarm: on [3h | until 18:00], off, or status.
import type { EngineInterface } from 'claude-code'

import { HOUR_MS, isTooShortToKeepWarm, KEEP_WARM_MIN_TTL_MS, MAX_PINGS, MINUTE_MS, PING_LEAD_MS } from './cache-timing'
import { cacheLength, clockTime, minutes, tokens } from './format'
import { switchOff, switchOn } from './keep-warm-switch'
import { needsVisiblePing, type SessionSnapshot } from './session-snapshot'
import { readSnapshot } from './state'

export const COMMAND = {
  name: 'keepwarm',
  description: 'Keep this session\'s prompt cache warm: on [3h | until 18:00], off, or status',
  argumentHint: '[on [3h|until 18:00] | off]',
  immediate: true,
} as const

const DURATION = /^(\d+(?:\.\d+)?)\s*(h|m|min)$/
const UNTIL = /^until\s+(\d{1,2}):(\d{2})$/
const HISTORY_SHOWN = 5
const NOT_UNDERSTOOD = 'Not understood. Try: /keepwarm on, /keepwarm 3h, /keepwarm until 18:00, /keepwarm off'

export async function runKeepwarm($: EngineInterface, args: string) {
  const words = args.trim().toLowerCase()
  const [first = ''] = words.split(/\s+/)
  if (first === 'off') {
    await switchOff($)
  } else if (words !== '' && words !== 'status') {
    const stopAt = parseStop(first === 'on' ? words.slice(2).trim() : words, await $.clock.now())
    if (stopAt < 0) return { text: NOT_UNDERSTOOD }
    await switchOn($, stopAt)
  }
  return { text: statusText(await readSnapshot($)) }
}

// "3h", "90m", "until 18:00" -> when keep-warm stops; 0 = no stop time; -1 = not understood.
export function parseStop(text: string, now: number) {
  if (text === '') return 0
  const duration = DURATION.exec(text)
  if (duration) return now + Number(duration[1]) * (duration[2] === 'h' ? HOUR_MS : MINUTE_MS)
  const until = UNTIL.exec(text)
  if (!until) return -1
  const at = new Date(now)
  at.setHours(Number(until[1]), Number(until[2]), 0, 0)
  return at.getTime() > now ? at.getTime() : at.getTime() + 24 * HOUR_MS
}

export function statusText(session: SessionSnapshot) {
  const { isOn, stopAt, ttl, pings } = session
  const lines = [
    isOn
      ? `Keep-warm on${stopAt ? ` until ${clockTime(stopAt)}` : ` (stops itself after ${MAX_PINGS} pings in a row)`}: about ${minutes(PING_LEAD_MS)} min before the cache would expire, it re-reads the conversation from cache in the background. A cold cache is never pinged.`
      : 'Keep-warm off: the cache expires normally.',
  ]
  if (isOn && needsVisiblePing(session)) lines.push('Claude Code can repeat this conversation invisibly only once it has answered since the app started, so the next ping is a short message in the chat.')
  if (ttl) lines.push(`This session's cache lasts ${cacheLength(ttl.ms)} (${ttl.reason === 'observed' ? 'seen expiring sooner than expected' : ttl.reason}).`)
  if (isTooShortToKeepWarm(ttl)) lines.push(`Keep-warm only pings a cache of ${minutes(KEEP_WARM_MIN_TTL_MS)} min or longer.`)
  for (const p of pings.slice(-HISTORY_SHOWN)) {
    lines.push(`${clockTime(p.at)} · ${p.isHit ? `read ${tokens(p.read)} from cache` : 'found the cache cold'}`)
  }
  return lines.join('\n')
}
