import type { EngineInterface } from 'claude-code'

import { isTooShortToKeepWarm } from './cache-timing'
import { live, readSnapshot } from './state'

// While keep-warm is on, the session's title in the app's list starts with this mark. The app
// asks before changing a title you typed yourself; titles it generated change without asking.
const TITLE_MARK = '🟢 '
const GET_SESSION_TOOL = 'mcp__ccd_session_mgmt__get_session'
const SET_TITLE_TOOL = 'mcp__ccd_session_mgmt__set_session_title'
const TITLE_FIELD = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/

// Puts the mark on this session's title in the app's list while keep-warm is on, and takes it
// off otherwise (or always, with the setting off). Runs on every switch, at start (which also
// clears a mark a crash left behind) and every few minutes (a title the app regenerated loses
// the mark). Outside the desktop app there are no session tools and nothing is marked.
export async function syncTitle($: EngineInterface) {
  const { isOn, ttl } = await readSnapshot($)
  const wantsMark = live.titleMark && isOn && !isTooShortToKeepWarm(ttl)
  try {
    const found = await $.tool.call({ tool: GET_SESSION_TOOL, session_id: 'self' })
    if ('deny' in found && found.deny) return
    const title = titleIn(found.text ?? '')
    if (title === undefined) return
    const hasMark = title.startsWith(TITLE_MARK)
    if (wantsMark === hasMark) return
    const base = hasMark ? title.slice(TITLE_MARK.length) : title
    await $.tool.call({ tool: SET_TITLE_TOOL, session_id: 'self', title: wantsMark ? TITLE_MARK + base : base })
  } catch {
    // No session tools here (a terminal session), or the app declined the rename: leave the title.
  }
}

function titleIn(sessionText: string): string | undefined {
  const match = TITLE_FIELD.exec(sessionText)
  return match ? JSON.parse(`"${match[1]}"`) : undefined
}
