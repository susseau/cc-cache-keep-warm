// Sending a ping: the invisible one (a fork of the last request) and the visible fallback.
import type { EngineInterface, ModelUsage } from 'claude-code'

import { save } from '../session-store'
import { appendPing, live, readSnapshot, writeSession } from '../state'
import { observeGap } from '../ttl/cache-length'
import { isTooFullForVisiblePing } from './decide-ping'

const PING_TEXT = 'Keep-warm ping. Reply with just "ok".'
// After an app restart Claude Code can repeat (fork) a conversation only once it has answered in
// this run. Until then the ping is a real message instead: it shows in the chat, Claude answers
// "ok", and from then on the pings are invisible again. Same window, so never on a cold cache.
const VISIBLE_PING_TEXT = 'Keep-warm ping from the Cache Keep-Warm mod. Reply with exactly "ok" and nothing else. Use no tools.'
// After a failed ping, wait this long before trying again inside the window.
const PING_RETRY_MS = 30_000

// The ping re-sends the main thread's last request outside the conversation with one short
// question after it: it reads the conversation from cache (restarting its life), adds no
// message, and runs even while the session waits on a question or a permission prompt.
export async function ping($: EngineInterface, startedAt: number, lastRequestAt: number) {
  const r = await $.model.fork({ prompt: PING_TEXT })
  if (r.isAnswered) return recordPing($, { startedAt, lastRequestAt, usage: r.usage })
  if (r.reason === 'nothing-to-fork') return pingVisiblyInstead($, startedAt)
  if (r.reason === 'api-error') return handleApiError($, startedAt, r.status ?? 0)
}

// Claude Code has no request of this conversation to repeat yet: send the visible one.
async function pingVisiblyInstead($: EngineInterface, startedAt: number) {
  await writeSession($, { waitsForMessage: true })
  const { contextTokens } = await readSnapshot($)
  const { context } = await $.session.usage()
  if (!(await checkRoom($, context.window, contextTokens))) await visiblePing($, startedAt)
}

// A busy or failing API may answer on a retry; a request the API refuses (the conversation
// over the model's limit, for one) gets the same answer every time, so stop and say so.
async function handleApiError($: EngineInterface, startedAt: number, status: number) {
  if (status >= 400 && status < 500 && status !== 429) {
    await writeSession($, { pingError: `HTTP ${status}` })
    $.ui.toast(`Keep-warm ping failed (HTTP ${status}); the cache will expire normally.`)
    return
  }
  $.ui.toast(`Keep-warm ping failed (HTTP ${status || '?'}); retrying in ${PING_RETRY_MS / 1000} s.`)
  live.pingPendingUntil = startedAt + PING_RETRY_MS
}

type AnsweredPing = { startedAt: number, lastRequestAt: number, usage: ModelUsage }

// A ping that found the cache cold proves the cache is shorter than assumed, which pauses
// keep-warm (another cold ping would only pay for a full re-write again).
async function recordPing($: EngineInterface, { startedAt, lastRequestAt, usage }: AnsweredPing) {
  await appendPing($, startedAt, usage)
  await observeGap($, startedAt - lastRequestAt, usage)
  await writeSession($, { lastRequestAt: startedAt })
  await save($)
}

// Works out once per start, and only while the next ping would be the visible one, whether it
// fits; the line shows the answer before the ping is due.
export async function checkRoom($: EngineInterface, window: number, contextTokens: number) {
  live.roomChecked = true
  const wontFit = isTooFullForVisiblePing({ breakdown: await readBreakdown($), window, contextTokens })
  const { nearlyFull: was } = await readSnapshot($)
  if (wontFit !== was) await writeSession($, { nearlyFull: wontFit })
  return wontFit
}

// Claude Code estimates the breakdown locally (no request), from the same figures as /context.
async function readBreakdown($: EngineInterface) {
  try {
    return (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  } catch {
    // No breakdown here: the decision goes by the share of the window.
    return undefined
  }
}

// The fallback ping: a real prompt, so it shows in the chat with Claude's "ok". Its request reads
// the conversation from cache like the invisible ping, and the turn.step hook records it.
export async function visiblePing($: EngineInterface, startedAt: number) {
  live.visiblePingAt = startedAt
  const r = await $.prompt.submit({ text: VISIBLE_PING_TEXT })
  if (typeof r.drop === 'string') {
    live.visiblePingAt = 0
    $.ui.toast(`Keep-warm ping not sent: ${r.drop}`)
  }
}
