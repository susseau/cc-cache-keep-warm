// Cache Keep-Warm: hooks the mod into Claude Code. Each hook only hands its event to the module
// that owns it.
import type { Register } from 'claude-code'

import { pingLimit } from './cache-timing'
import { COMMAND, runKeepwarm } from './command'
import { carryOnResumed, markStartedNew, replacesConversation, startCleared, startOver, startSession } from './events/session'
import { finishRequest, startRequest } from './events/request'
import { finishTurn } from './events/turn'
import { switchOff, switchOn } from './keep-warm-switch'
import { lineModel } from './line/line-model'
import { drawLine } from './line/line-view'
import { parseQuietHours } from './quiet-hours'
import { live, readSnapshot, writeSession } from './state'

// The userConfig keys in plugin.json: the title mark, keep-warm on in every new session, how many
// pings in a row before keep-warm stops itself, and the quiet hours (a switch and a range).
const TITLE_MARK_OPTION = 'title_mark'
const DEFAULT_ON_OPTION = 'default_on'
const MAX_PINGS_OPTION = 'max_pings'
const QUIET_HOURS_OPTION = 'quiet_hours'
const QUIET_RANGE_OPTION = 'quiet_range'

export const register: Register = (on, options) => {
  live.titleMark = options[TITLE_MARK_OPTION] !== false
  live.defaultOn = options[DEFAULT_ON_OPTION] === true
  live.maxPings = pingLimit(options[MAX_PINGS_OPTION])
  live.quiet = parseQuietHours(options[QUIET_HOURS_OPTION], options[QUIET_RANGE_OPTION])

  on('session.start', async ($, e, next) => {
    await startSession($)
    return next(e)
  })

  // After /clear, a new session: keep-warm carries over as it was and the conversation starts over
  // (no cache to count down yet). Its 'compact' is not used: it also comes when a subagent compacts
  // its own conversation, with nothing saying so (no agent_id), which reset the main countdown.
  // session.compact says whose.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'startup') await markStartedNew($)
    else if (e.source === 'clear') await startCleared($)
    else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      await carryOnResumed($, { secondsSinceLastResponse: e.seconds_since_last_response, contextTokens: e.context_tokens })
    }
    return next(e)
  })

  // Read only: the compaction passes on unchanged.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (replacesConversation({ agentId: e.agentId, trigger: e.trigger, isSkipped: result.skip !== undefined })) {
      try {
        await startOver($)
      } catch {
        // Never fail a compaction over the countdown.
      }
    }
    return result
  })

  // Each model request of the main conversation (not a subagent's: its cache is its own).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const { now, previous } = await startRequest($)
    const result = yield* next(e)
    await finishRequest($, { turnId: e.turnId, now, previous, usage: result?.usage ?? undefined })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await finishTurn($, { turnId: e.turnId, hasUsage: Boolean(e.usage), reason: e.reason, answer: e.answer })
    return next(e)
  })

  // While Claude's question waits for an answer the turn stays open; the band says so.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await writeSession($, { isWaiting: true })
    try {
      return await next(e)
    } finally {
      await writeSession($, { isWaiting: false })
    }
  })

  // A literal on purpose: the validator reads a constant matcher as command=?. Same as COMMAND.name.
  on('command.run', { command: 'keepwarm' }, async ($, e) => runKeepwarm($, e.args))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const session = await readSnapshot($)
    return drawLine($.ui.resolve(e), lineModel(session), () => (session.isOn ? switchOff($) : switchOn($, 0)))
  })
}
