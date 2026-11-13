// The check every TICK_MS: refresh what the line shows, then ping when it is time.
import type { EngineInterface, SessionUsage } from 'claude-code'

import type { KeepWarmTtl } from '../../types'
import { MAX_PINGS, MINUTE_MS } from '../cache-timing'
import { clockTime } from '../format'
import { setKeepWarm } from '../keep-warm-switch'
import { live, needsVisiblePing, readSnapshot, type SessionSnapshot, writeSession } from '../state'
import { detectTtl } from '../ttl/cache-length'
import { correctTtl } from '../ttl/decide-ttl'
import { decidePing } from './decide-ping'
import { checkRoom, ping, visiblePing } from './ping'

// One check every 15 s: local reads only (clock, session figures, settings), no model call.
// The line is redrawn only when its text changes, at most once a minute.
export const TICK_MS = 15_000
const PING_PENDING_MS = 5 * MINUTE_MS

export async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const usage = await $.session.usage()
  const session = await readSnapshot($)
  const ttl = correctTtl(await detectTtl($, usage), session.shortAfterMs)
  const contextTokens = await refreshShown($, { now, ttl, usage, session })
  if (session.isOn) await keepWarm($, { now, ttl, usage, contextTokens, session })
}

type Shown = { now: number, ttl: KeepWarmTtl, usage: SessionUsage, session: SessionSnapshot }

// Redraw only when what the band shows would change: each minute, and whenever the cache
// length or the context size moves. A reopened session reports its size before its first
// answer, while the engine has none yet: keep that one until the engine has its own.
async function refreshShown($: EngineInterface, { now, ttl, usage, session }: Shown) {
  const contextTokens = usage.context.tokens ?? session.contextTokens
  const shownKey = `${Math.floor(now / MINUTE_MS)}|${ttl?.ms ?? 0}|${ttl?.reason ?? ''}|${contextTokens}|${session.lastRequestAt}|${session.shortAfterMs}`
  if (shownKey !== live.shownKey) {
    live.shownKey = shownKey
    await writeSession($, { ttl, contextTokens, now })
  }
  return contextTokens
}

type KeepWarmCheck = { now: number, ttl: KeepWarmTtl, usage: SessionUsage, contextTokens: number, session: SessionSnapshot }

// Invisible once the conversation has answered in this run; before that, the visible ping,
// whose fit is worked out once so the line can say in advance when it has to wait.
async function keepWarm($: EngineInterface, { now, ttl, usage, contextTokens, session }: KeepWarmCheck) {
  const needsVisible = needsVisiblePing(session)
  let { nearlyFull } = session
  if (needsVisible && !live.roomChecked) nearlyFull = await checkRoom($, usage.context.window, contextTokens)
  const { lastRequestAt, stopAt, pings } = session
  const step = decidePing({ now, ttl, lastRequestAt, stopAt, pendingUntil: live.pingPendingUntil, pingsInRow: pings.length, needsVisible, nearlyFull })

  switch (step) {
    case 'none':
      return
    case 'stop-at-time':
      await setKeepWarm($, false, 0)
      $.ui.toast(`Keep-warm stopped at ${clockTime(stopAt)} as asked; the cache will expire normally.`)
      return
    case 'stop-after-max':
      await setKeepWarm($, false, 0)
      $.ui.toast(`Keep-warm stopped itself after ${MAX_PINGS} pings in a row; the cache will expire.`)
      return
  }
  live.pingPendingUntil = now + PING_PENDING_MS
  if (step === 'ping') await ping($, now, lastRequestAt)
  else if (step === 'visible-ping') await visiblePing($, now)
}
