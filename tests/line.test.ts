// What the line above the prompt shows, from the first look to a cold cache.
// Run (from the repo root): claude plugin test
import { expect, test } from 'claude-code/testing'

import { answer, line, MINUTE, start, stubEngine, WRITE } from './engine'

test('before any answer: nothing cached yet', async ($, on) => {
  stubEngine(on)
  await start($)
  expect(await line($)).toEqual('○▱▱▱▱▱▱▱▱▱▱nothing cached yetKeep warm')
})

test('after an answer: the full circle, the time left and the size cached', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(2 * MINUTE)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▰58 min left (11:00)·54k cachedKeep warm')
})

test('the desktop app gets the text-style full circle', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(2 * MINUTE)
  expect(await line($, 'desktop')).toEqual('⚫︎▰▰▰▰▰▰▰▰▰▰58 min left (11:00)·54k cachedKeep warm')
})

test('the circle and the bar empty with the cache life', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(20 * MINUTE)
  expect(await line($)).toEqual('◕▰▰▰▰▰▰▰▱▱▱40 min left (11:00)·54k cachedKeep warm')
  await clock.advance(20 * MINUTE)
  expect(await line($)).toEqual('◑▰▰▰▰▱▱▱▱▱▱20 min left (11:00)·54k cachedKeep warm')
  await clock.advance(15 * MINUTE)
  expect(await line($)).toEqual('◔▰▱▱▱▱▱▱▱▱▱5 min left (11:00)·after 11:00 your next message re-writes 54kKeep warm')
})

test('a cold cache says since when, and what the next message re-writes', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(61 * MINUTE)
  expect(await line($)).toEqual('○▱▱▱▱▱▱▱▱▱▱cold since 11:00·your next message re-writes 54kKeep warm')
})

test('an API key: a 5-minute cache, no toggle', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  engine.rateLimits = []
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▱▱4 min left (10:05)·5-minute cache (API key)·keep-warm needs the 1-hour cache·after 10:05 your next message re-writes 54k')
})

test('over the plan limit: a 5-minute cache, keep-warm paused', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  engine.rateLimits = [{ kind: 'five_hour', percentUsed: 100 }]
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▱▱4 min left (10:05)·5-minute cache while over your plan limit·keep-warm paused·after 10:05 your next message re-writes 54kKeep warm')
})

test('a cache length from the environment', async ($, on) => {
  const { engine, clock } = stubEngine(on, { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } })
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▱▱4 min left (10:05)·5-minute cache (your settings)·keep-warm needs the 1-hour cache·after 10:05 your next message re-writes 54k')
})

test('a cache that went cold sooner than its length pauses keep-warm', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(10 * MINUTE)
  await answer($, engine, WRITE)
  await clock.advance(10 * MINUTE)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▱▱4 min left (10:25)·cache expired after 10 min, sooner than expected·keep-warm paused·after 10:25 your next message re-writes 54kKeep warm')
})

test('a request that never reached the model leaves the countdown where it was', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(10 * MINUTE)
  await answer($, engine, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('●▰▰▰▰▰▰▰▰▰▱49 min left (11:00)·54k cachedKeep warm')
})

test('a hidden survey takes the slot', async ($, on) => {
  stubEngine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'cache-keep-warm', viewport: { columns: 200, rows: 5 }, surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true } } as any)
  expect((await ui.find({ type: 'Box' }))?.text ?? '').toEqual('')
})
