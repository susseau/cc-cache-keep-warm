// The session's life: its start, a reopened or cleared conversation, a compaction.
import type { EngineInterface } from 'claude-code'

import { MINUTE_MS } from '../cache-timing'
import { COMMAND } from '../command'
import { switchOnIfNew } from '../keep-warm-switch'
import { tick, TICK_MS } from '../ping/schedule'
import { forgetOldSessions, openSessionStore, restoreSaved, saveIfRestored } from '../session-store'
import { live, readSnapshot, writeSession } from '../state'
import { syncTitle } from '../title'

const TITLE_SYNC_MS = 5 * MINUTE_MS
// A reopened session reports how long ago its last answer came. Its cache's life began when
// that last request was sent, a little earlier: counting from this much before the answer keeps
// the ping early rather than late (a late ping would re-write a cache that already went cold).
const RESUME_MARGIN_MS = 3 * MINUTE_MS

export async function startSession($: EngineInterface) {
  await $.command.register(COMMAND)
  await openSessionStore($)
  live.isFirstRequest = true
  if (await restoreSaved($)) await switchOnIfNew($)
  await forgetOldSessions($, await $.clock.now())

  await tick($)
  $.clock.every(TICK_MS, () => void tick($))
  void syncTitle($)
  $.clock.every(TITLE_SYNC_MS, () => void syncTitle($))
}

// Claude Code started the session new, not reopened: "On in new sessions" may apply.
export async function markStartedNew($: EngineInterface) {
  live.startedNew = true
  await switchOnIfNew($)
}

export type Resumed = { secondsSinceLastResponse: number, contextTokens: number | undefined }

// A session reopened (an app relaunch, a resume): Claude Code says how long ago its last answer
// came and how big the conversation is, so the countdown carries on before the first message.
export async function carryOnResumed($: EngineInterface, { secondsSinceLastResponse, contextTokens }: Resumed) {
  const now = await $.clock.now()
  const lastAt = now - secondsSinceLastResponse * 1000 - RESUME_MARGIN_MS
  const { lastRequestAt: last } = await readSnapshot($)
  if (lastAt > last) await writeSession($, { lastRequestAt: lastAt })
  if (contextTokens) await writeSession($, { contextTokens })
  await writeSession($, { now })
  // At a relaunch this can run before session.start has restored the saved values.
  await saveIfRestored($)
}

// The conversation starts over (cleared, or replaced by its summary): nothing of it is cached
// until the next request writes it.
export async function startOver($: EngineInterface) {
  await writeSession($, { lastRequestAt: 0, pings: [], sawResponse: false, contextTokens: 0, pingError: '', now: await $.clock.now() })
  live.roomChecked = false
  await saveIfRestored($)
}

export type Compaction = { agentId: string | undefined, trigger: string, isSkipped: boolean }

// A compaction of the main conversation (/compact, the threshold, a plugin) replaces it with its
// summary. A subagent's own (agentId) is not this cache, a precomputed one is not applied yet,
// and a skipped one changed nothing.
export function replacesConversation({ agentId, trigger, isSkipped }: Compaction) {
  return !agentId && trigger !== 'precompute' && !isSkipped
}
