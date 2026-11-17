// When the check runs: once right away, then on every full minute; pings only on full minutes.
import type { EngineInterface } from 'claude-code'

import { MINUTE_MS } from '../cache-timing'
import { tick } from './schedule'

// One check a minute, on the full minute, so the ping goes out at the minute the line names.
const TICK_MS = MINUTE_MS

// A start between full minutes refreshes the line at once but pings no earlier than the next
// full minute, the one the line names. The repeat is set before the check runs: a slow check
// cannot delay it.
export async function startTicking($: EngineInterface) {
  const now = await $.clock.now()
  const toNextMinute = TICK_MS - (now % TICK_MS)
  await tick($, { canPing: toNextMinute === TICK_MS })
  $.clock.after(toNextMinute, () => {
    $.clock.every(TICK_MS, () => void tick($))
    void tick($)
  })
}
