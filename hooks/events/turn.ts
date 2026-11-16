// The main conversation's turns: the end of one says whether it answered and whose it was.
import type { EngineInterface } from 'claude-code'

import { live, writeSession } from '../state'

export type FinishedTurn = { turnId: string, hasUsage: boolean, reason: string, answer: string }

// A turn with real requests behind it: the conversation has answered in this run (so the next
// ping can be invisible, and an empty plan list now means an API key), and unless it was the
// mod's own visible ping, the conversation is in use, yours or a turn it ran by itself (an
// agent's report, another session's message): the pings in a row start over. A turn that died
// on an error has no usage; if it was the visible ping, the line says why it failed.
export async function finishTurn($: EngineInterface, { turnId, hasUsage, reason, answer }: FinishedTurn) {
  const isPingTurn = turnId === live.pingTurnId
  if (isPingTurn) live.pingTurnId = ''
  if (hasUsage) {
    await writeSession($, { sawResponse: true })
    if (!isPingTurn) await writeSession($, { pings: [] })
    live.answersWithoutPlan++
    return
  }
  if (live.visiblePingAt === 0) return
  live.visiblePingAt = 0
  if (reason !== 'error') return
  const why = answer.trim() || 'an API error'
  await writeSession($, { pingError: why })
  $.ui.toast(`Keep-warm ping failed: ${why}. The cache will expire normally.`)
}
