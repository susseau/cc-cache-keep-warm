// At a session's start, a quiet-hours setting keep-warm cannot read is said once, with the fix.
import type { EngineInterface } from 'claude-code'

import { quietNotUnderstood } from './command'
import { live } from './state'

export function noticeUnreadQuiet($: EngineInterface) {
  if (live.quiet.kind === 'invalid') $.ui.toast(quietNotUnderstood(live.quiet))
}
