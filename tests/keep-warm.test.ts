// /keepwarm, the pings and what starts the countdown or the pings over.
// Run (from the repo root): claude plugin test
import { expect, test } from 'claude-code/testing'

import { answer, keepwarm, line, MINUTE, NO_USAGE, READ, START, start, stubEngine, WRITE } from './engine'

const VISIBLE_PING = 'Keep-warm ping from the Cache Keep-Warm mod. Reply with exactly "ok" and nothing else. Use no tools.'

test('/keepwarm status before anything', async ($, on) => {
  stubEngine(on)
  await start($)
  expect(await keepwarm($, 'status')).toEqual('Keep-warm off: the cache expires normally.\nThis session\'s cache lasts 1-hour (subscription).')
})

test('/keepwarm on: the line names the next ping', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await keepwarm($, 'on')).toEqual([
    'Keep-warm on (stops itself after 20 pings in a row): about 8 min before the cache would expire, it re-reads the conversation from cache in the background. A cold cache is never pinged.',
    'This session\'s cache lasts 1-hour (subscription).',
  ].join('\n'))
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▰59 min left (11:00)·next ping 10:52·54k cachedStop')
})

test('/keepwarm with a stop time, until a clock time, and words it does not know', async ($, on) => {
  const { engine } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  expect((await keepwarm($, '3h')).split('\n')[0]).toStartWith('Keep-warm on until 13:00:')
  expect((await keepwarm($, 'on until 18:30')).split('\n')[0]).toStartWith('Keep-warm on until 18:30:')
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▰60 min left (11:00)·keep-warm stops 18:30·next ping 10:52·54k cachedStop')
  expect(await keepwarm($, 'later')).toEqual('Not understood. Try: /keepwarm on, /keepwarm 3h, /keepwarm until 18:00, /keepwarm off')
  expect((await keepwarm($, 'off')).split('\n')[0]).toEqual('Keep-warm off: the cache expires normally.')
})

test('the ping goes out 8 min before expiry and restarts the hour', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(51 * MINUTE)
  expect(engine.forks).toEqual(0)
  await clock.advance(MINUTE)
  expect(engine.forks).toEqual(1)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▰60 min left (11:52)·next ping 11:44·1 ping ✓·54k cachedStop')
  expect((await keepwarm($, 'status')).split('\n').at(-1)).toEqual('10:52 · read 50k from cache')
})

test('a failing API is retried after 30 s; a refused request stops with its status', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  engine.fork = { isAnswered: false, reason: 'api-error', status: 529 }
  await clock.advance(52 * MINUTE)
  expect(engine.forks).toEqual(1)
  await clock.advance(30_000)
  expect(engine.forks).toEqual(2)
  engine.fork = { isAnswered: false, reason: 'api-error', status: 400 }
  await clock.advance(30_000)
  expect(engine.toasts.at(-1)).toEqual('Keep-warm ping failed (HTTP 400); the cache will expire normally.')
  expect(await line($)).toEqual('◔▰▰▱▱▱▱▱▱▱▱7 min left (11:00)·ping failed: HTTP 400·after 11:00 your next message re-writes 54kStop')
})

test('keep-warm stops itself after 20 pings in a row', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  for (let i = 0; i < 21; i++) await clock.advance(52 * MINUTE)
  expect(engine.forks).toEqual(20)
  expect(engine.toasts.at(-1)).toEqual('Keep-warm stopped itself after 20 pings in a row; the cache will expire.')
  expect((await keepwarm($, 'status')).split('\n')[0]).toEqual('Keep-warm off: the cache expires normally.')
})

test('a real turn starts the pings in a row over', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(52 * MINUTE)
  expect(await line($)).toContain('1 ping ✓')
  await answer($, engine, READ)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▰60 min left (11:52)·next ping 11:44·54k cachedStop')
})

test('a stop time ends keep-warm', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, '30m')
  await clock.advance(31 * MINUTE)
  expect(engine.toasts.at(-1)).toEqual('Keep-warm stopped at 10:30 as asked; the cache will expire normally.')
  expect(engine.forks).toEqual(0)
})

test('/clear starts the countdown over', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  await $.classic.SessionStart({ session_id: 'S1', transcript_path: '/t', cwd: '/work', hook_event_name: 'SessionStart', source: 'clear' } as any)
  expect(await line($)).toEqual('○▱▱▱▱▱▱▱▱▱▱nothing cached yetKeep warm')
})

test('the main conversation\'s compaction starts over; a subagent\'s does not', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  await $.session.compact({ trigger: 'auto', agentId: 'sub-1', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as any)
  expect(await line($)).toStartWith('●▰▰▰▰▰▰▰▰▰▰59 min left')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as any)
  expect(await line($)).toEqual('○▱▱▱▱▱▱▱▱▱▱nothing cached yetKeep warm')
})

test('a reopened session carries the countdown on, and its first ping shows in the chat', async ($, on) => {
  const saved = { lastRequestAt: START - 10 * MINUTE, keepWarm: true, stopAt: 0, ttl: { ms: 60 * MINUTE, reason: 'subscription' }, savedAt: START - 10 * MINUTE }
  const { engine, clock } = stubEngine(on, { store: { 'session:S1': saved } })
  await start($)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▱50 min left (10:50)·next ping 10:42 (shows in chat)·54k cachedStop')
  await clock.advance(42 * MINUTE)
  expect(engine.submitted).toEqual([VISIBLE_PING])
  expect(engine.forks).toEqual(0)
})

test('a resume tells the time of the last answer', async ($, on) => {
  const { clock } = stubEngine(on)
  await start($)
  await $.classic.SessionStart({ session_id: 'S1', transcript_path: '/t', cwd: '/work', hook_event_name: 'SessionStart', source: 'resume', seconds_since_last_response: 600, context_tokens: 80_000 } as any)
  await clock.advance(15_000)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▱▱46 min left (10:47)·54k cachedKeep warm')
})

test('a conversation too full for the visible ping waits for the person', async ($, on) => {
  const saved = { lastRequestAt: START - 10 * MINUTE, keepWarm: true, stopAt: 0, ttl: { ms: 60 * MINUTE, reason: 'subscription' }, savedAt: START - 10 * MINUTE }
  const { engine, clock } = stubEngine(on, { store: { 'session:S1': saved } })
  engine.breakdown = { categories: [{ kind: 'free', tokens: 40_000 }], memoryFiles: [{ tokens: 20_000 }] }
  await start($)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▱50 min left (10:50)·conversation nearly full: keep-warm waits for you·54k cachedStop')
  await clock.advance(42 * MINUTE)
  expect(engine.submitted).toEqual([])
})

test('sessions untouched for a week are forgotten', async ($, on) => {
  const old = { lastRequestAt: 0, keepWarm: false, stopAt: 0, ttl: null, savedAt: START - 8 * 24 * 60 * MINUTE }
  const recent = { ...old, savedAt: START - 24 * 60 * MINUTE }
  const { engine } = stubEngine(on, { store: { 'session:old': old, 'session:recent': recent, 'plan-ttl': { ms: 60 * MINUTE, reason: 'subscription' } } })
  await start($)
  expect(Object.keys(engine.store).sort()).toEqual(['plan-ttl', 'session:S1', 'session:recent'])
})

// Claude Code 2.1.323 answers $.tool.call with { result }, while the mod reads the title from
// `text` at the top: it finds no title and leaves it as it is (ckw: the title mark looks broken).
test('the title mark: today the title stays as it is', async ($, on) => {
  const { engine } = stubEngine(on)
  engine.title = 'Refactor'
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await keepwarm($, 'off')
  expect(engine.titles).toEqual([])
})

test('while Claude\'s question waits, the line says so', async ($, on) => {
  const { engine } = stubEngine(on)
  let release = () => {}
  const answered = new Promise<void>(resolve => { release = resolve })
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    await answered
    return { result: { text: 'answer' } }
  })
  await start($)
  await answer($, engine, WRITE)
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  const shown = await line($)
  release()
  await asking
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▰60 min left (11:00)·54k cachedKeep warm')
  expect(shown).toEqual('●▰▰▰▰▰▰▰▰▰▰60 min left (11:00)·waiting for your answer·54k cachedKeep warm')
})

test('a zero-usage step is no answer', async ($, on) => {
  const { engine } = stubEngine(on)
  await start($)
  await answer($, engine, NO_USAGE)
  expect(await line($)).toEqual('○▱▱▱▱▱▱▱▱▱▱nothing cached yetKeep warm')
})
