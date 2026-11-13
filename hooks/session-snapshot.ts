// The session's values as one plain object, and what follows from them alone: no reads here,
// so the pure decisions (the line, /keepwarm's text) can use it without the state module.
import type { KeepWarmPing, KeepWarmTtl } from '../types'

// Everything the line and /keepwarm show, read in one go.
export type SessionSnapshot = {
  lastRequestAt: number
  now: number
  isOn: boolean
  stopAt: number
  pings: KeepWarmPing[]
  ttl: KeepWarmTtl
  contextTokens: number
  isWaiting: boolean
  shortAfterMs: number
  waitsForMessage: boolean
  sawResponse: boolean
  pingError: string
  nearlyFull: boolean
}

// Before the conversation has answered in this run, Claude Code has nothing to repeat
// invisibly, so the next ping has to be a real message.
export function needsVisiblePing({ sawResponse, waitsForMessage }: Pick<SessionSnapshot, 'sawResponse' | 'waitsForMessage'>) {
  return !sawResponse || waitsForMessage
}
