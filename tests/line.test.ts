// What the line above the prompt shows, from the first look to a cold cache.
// Run (from the repo root): claude plugin test
import { expect, test } from 'claude-code/testing'

import { answer, line, MINUTE, pressToggle, start, stubEngine, WRITE } from './engine'

test('before any answer: nothing cached yet', async ($, on) => {
  stubEngine(on)
  await start($)
  expect(await line($)).toEqual('nothing cached yet▱▱▱▱▱▱▱▱▱▱󰐊 Warm')
})

test('after an answer: the bar, the time left, the expiry and the size cached', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(2 * MINUTE)
  expect(await line($)).toEqual('󰔟 expires 11:00·54k cached·58 min left▰▰▰▰▰▰▰▰▰▰󰐊 Warm')
})

test('the bar empties with the cache life', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(20 * MINUTE)
  expect(await line($)).toEqual('󰔟 expires 11:00·54k cached·40 min left▰▰▰▰▰▰▰▱▱▱󰐊 Warm')
  await clock.advance(20 * MINUTE)
  expect(await line($)).toEqual('󰔟 expires 11:00·54k cached·20 min left▰▰▰▰▱▱▱▱▱▱󰐊 Warm')
  await clock.advance(15 * MINUTE)
  expect(await line($)).toEqual('after 11:00 your next message re-writes 54k·5 min left▰▱▱▱▱▱▱▱▱▱󰐊 Warm')
})

test('a cold cache says since when, and what the next message re-writes', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(61 * MINUTE)
  expect(await line($)).toEqual('your next message re-writes 54k·cold since 11:00▱▱▱▱▱▱▱▱▱▱󰐊 Warm')
})

test('an API key: a 5-minute cache, the button dim', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  engine.rateLimits = []
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('5-minute cache (API key)·keep-warm needs the 1-hour cache·after 10:05 your next message re-writes 54k·4 min left▰▰▰▰▰▰▰▰▱▱󰐊 Warm')
  await pressToggle($)
  expect(await line($)).toEndWith('󰐊 Warm')
})

test('over the plan limit: a 5-minute cache, keep-warm paused', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  engine.rateLimits = [{ kind: 'five_hour', percentUsed: 100 }]
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('5-minute cache while over your plan limit·keep-warm paused·after 10:05 your next message re-writes 54k·4 min left▰▰▰▰▰▰▰▰▱▱󰐊 Warm')
})

test('a cache length from the environment', async ($, on) => {
  const { engine, clock } = stubEngine(on, { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } })
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('5-minute cache (your settings)·keep-warm needs the 1-hour cache·after 10:05 your next message re-writes 54k·4 min left▰▰▰▰▰▰▰▰▱▱󰐊 Warm')
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
  expect(await line($)).toEqual('cache expired after 10 min, sooner than expected·keep-warm paused·after 10:25 your next message re-writes 54k·4 min left▰▰▰▰▰▰▰▰▱▱󰐊 Warm')
})

test('a request that never reached the model leaves the countdown where it was', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(10 * MINUTE)
  await answer($, engine, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('󰔟 expires 11:00·54k cached·49 min left▰▰▰▰▰▰▰▰▰▱󰐊 Warm')
})

test('a hidden survey takes the slot', async ($, on) => {
  stubEngine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'cache-keep-warm', viewport: { columns: 200, rows: 5 }, surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: true } } as any)
  expect((await ui.find({ type: 'Box' }))?.text ?? '').toEqual('')
})
