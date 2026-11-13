import type { EngineInterface } from 'claude-code'

import { save } from './session-store'
import { live, writeSession } from './state'
import { syncTitle } from './title'

// Switching starts the pings in a row over; `stopAt` 0 means no stop time.
export async function setKeepWarm($: EngineInterface, isOn: boolean, stopAt: number) {
  await writeSession($, { isOn, stopAt: isOn ? stopAt : 0, pings: [], pingError: '' })
  await save($)
  await syncTitle($)
}

// The "On in new sessions" setting: keep-warm on for a session Claude Code started new and the
// store has never seen. A reopened session keeps its own switch, even once the store has forgotten
// it after a week. Needs both the start event and the restore, which come in either order.
export async function switchOnIfNew($: EngineInterface) {
  if (!live.defaultOn || !live.isUnseen || !live.startedNew) return
  live.isUnseen = false
  await setKeepWarm($, true, 0)
}
