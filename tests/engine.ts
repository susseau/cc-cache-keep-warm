// A stand-in for Claude Code under the mod in `claude plugin test`: the engine calls the mod makes
// ($.session.usage, $.model.fork, ...) answer from `engine`, which a test changes as it goes.
// Run (from the repo root): claude plugin test
import { mock } from 'claude-code/testing'

export const MINUTE = 60_000
// 10:00 local time, so the clock times on the line read the same in every time zone.
export const START = new Date(2026, 10, 13, 10, 0, 0, 0).getTime()

export const WRITE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 50_000 }
export const READ = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 0 }
export const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const SUBSCRIPTION = [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 20 }]

type Usage = typeof WRITE

export type Engine = {
  rateLimits: { kind: string, percentUsed: number }[]
  contextTokens: number
  window: number
  breakdown: unknown
  fork: unknown
  submitted: string[]
  forks: number
  toasts: string[]
  title: string | undefined
  titles: string[]
  store: Record<string, unknown>
  sessionId: string
  nextUsage?: Usage
}

export function stubEngine(on: any, { env = {}, store = {} }: { env?: Record<string, string>, store?: Record<string, unknown> } = {}) {
  const engine: Engine = {
    rateLimits: SUBSCRIPTION,
    contextTokens: 54_000,
    window: 1_000_000,
    breakdown: undefined,
    fork: { isAnswered: true, usage: READ },
    submitted: [],
    forks: 0,
    toasts: [],
    title: undefined,
    titles: [],
    store: { ...store },
    sessionId: 'S1',
  }
  const clock = mock.clock(on, { now: START })
  mock.env(on, env)
  on('store.get', (_$: any, e: any) => ({ value: engine.store[e.key] }))
  on('store.set', (_$: any, e: any) => {
    engine.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$: any, e: any) => {
    delete engine.store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(engine.store) }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: engine.sessionId }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('settings.read', () => ({ value: {} }))
  on('session.usage', (_$: any, e: any) => ({
    value: {
      rateLimits: engine.rateLimits,
      context: { tokens: engine.contextTokens, window: engine.window, ...(e.breakdown && engine.breakdown ? { breakdown: engine.breakdown } : {}) },
    },
  }))
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', (_$: any, e: any) => {
    engine.toasts.push(e.text ?? e.message ?? String(e))
    return { value: undefined }
  })
  on('tool.call', (_$: any, e: any) => {
    if (engine.title === undefined) return { deny: 'no session tools in a terminal' }
    // Like Claude Code 2.1.323: the tool's record in `result`, its answer as text in `text`.
    if (e.tool === 'mcp__ccd_session_mgmt__get_session') {
      const text = JSON.stringify({ title: engine.title })
      return { result: text, text }
    }
    engine.title = e.title
    engine.titles.push(e.title)
    return { result: 'ok', text: 'ok' }
  })
  on('model.fork', () => {
    engine.forks++
    return { value: engine.fork }
  })
  on('prompt.submit', (_$: any, e: any) => {
    engine.submitted.push(e.text)
    return { text: e.text }
  })
  on('classic.SessionStart', () => ({}))
  on('session.compact', (_$: any, e: any) => ({ messages: e.messages }))
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, usage: engine.nextUsage, stopReason: 'end_turn', answer: 'ok', toolUses: [] }
  })
  on('turn.complete', () => ({ text: '' }))
  return { engine, clock }
}

let turns = 0

// One main-conversation turn with one request: its usage reaches the mod through turn.step and
// turn.complete, as a real answer does.
export async function answer($: any, engine: Engine, usage: Usage = WRITE, fields: Record<string, unknown> = {}) {
  const turnId = `t${++turns}`
  engine.nextUsage = usage
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', ...fields })) {
    // The chunks do not matter here, only the step's result.
  }
  const hasUsage = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0
  await $.turn.complete({
    turnId,
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    reason: hasUsage ? 'answer' : 'error',
    ...(hasUsage ? { usage } : {}),
    ...fields,
  })
  return turnId
}

// The session id /clear moves to.
export const CLEARED_ID = 'S2'

// A stub engine whose $.state belongs to one session, as Claude Code's does: after /clear the
// new session starts with an empty one. Only for the /clear tests: answering $.state here slows
// every check down, too much for the longest test.
export function stubClearableEngine(on: any) {
  const stub = stubEngine(on)
  const stateBySession: Record<string, Record<string, unknown>> = {}
  const sessionState = () => (stateBySession[stub.engine.sessionId] ??= {})
  on('state.get', (_$: any, e: any) => ({ value: { value: sessionState()[e.key] } }))
  on('state.set', (_$: any, e: any) => {
    sessionState()[e.key] = e.value
    return { value: undefined }
  })
  return stub
}

// /clear as Claude Code 2.1.332 runs it (seen live, 2026-11-25): the session ends, then a new one
// under a new id, with an empty $.state, gets the SessionStart hook only, no session.start.
export async function clear($: any, engine: Engine) {
  await $.session.end({ reason: 'clear', sessionId: engine.sessionId })
  engine.sessionId = CLEARED_ID
  await $.classic.SessionStart({ session_id: CLEARED_ID, transcript_path: '/t', cwd: '/work', hook_event_name: 'SessionStart', source: 'clear' })
}

export async function start($: any) {
  await $.session.start({ cwd: '/work' })
}

export async function line($: any, surface = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'cache-keep-warm', viewport: { columns: 200, rows: 5 }, surface, component: 'AbovePrompt', props: {} })
  return (await ui.find({ type: 'Box' }))?.text ?? ''
}

export async function pressToggle($: any) {
  const ui = await $.ui.mount({ plugin: 'cache-keep-warm', viewport: { columns: 200, rows: 5 }, surface: 'terminal', component: 'AbovePrompt', props: {} })
  await ui.press({ key: 'toggle' })
}

export async function keepwarm($: any, args: string) {
  const r = await $.command.run({ command: 'keepwarm', args })
  return r.text as string
}
