# /clear zachowuje keep-warm - plan implementacji (ckw-o6j)

**Cel:** po `/clear` keep-warm zostaje tak, jak był (włączony z tym samym stop time i rachunkiem),
a odliczanie startuje od nowa przy pierwszym requeście.

**Architektura:** Claude Code 2.1.332 robi z `/clear` nową sesję w tym samym procesie: nowe ID,
pusty `$.state`, bez `session.start`; zmienne modułu (`live.storeKey` dalej ze starym ID) zostają.
Handler `classic.SessionStart` `source: 'clear'` przejmuje wpis starej sesji ze `$.store`
(`carryOverCleared` w `hooks/session-store.ts`), przełącza klucz store na nowe ID, oznacza stan
jako odtworzony i dopiero potem zeruje odliczanie (`startOver`). Stub testów dostaje wariant
z `$.state` per sesja i helper `clear()`, który odtwarza tę sekwencję.

**Stack:** TypeScript, Claude Code mod API (`$.state`, `$.store`, `classic.SessionStart`),
test kit `claude plugin test` (`claude-code/testing`).

**Spec:** brak — plan-only z ticketu ckw-o6j

## Global constraints

- Po /clear włącznik keep-warm i jego ustawienia (stop time) zostają jak przed /clear.
- Odliczanie startuje od nowa przy pierwszym requeście po /clear (cold cache nie jest pingowany).
- Test w tests/ pokrywa /clear przy włączonym keep-warm.

## File Structure

- `hooks/session-store.ts` — utrwala wartości sesji w `$.store`; zależy od: `hooks/state.ts`,
  `hooks/savings.ts`, `types/index.d.ts`
- `hooks/state.ts` — trzyma stan sesji w `$.state`; zależy od: brak
- `hooks/events/session.ts` — prowadzi cykl życia sesji Claude Code; zależy od:
  `hooks/session-store.ts`
- `hooks/register.tsx` — kieruje zdarzenie `classic.SessionStart` do modułu sesji; zależy od:
  `hooks/events/session.ts`
- `tests/engine.ts` — odgrywa silnik Claude Code pod modem w testach; zależy od: brak
- `tests/keep-warm.test.ts` — dowodzi zachowania keep-warm przy `/clear`; zależy od:
  `tests/engine.ts`
- `README.md` — opisuje zdarzenia, które mod obsługuje; zależy od: brak
- `.claude/CLAUDE.md` — notuje lekcję API o `/clear` dla pracy nad modem; zależy od: brak

---

## Task 1: /clear przenosi keep-warm do nowej sesji

**Pliki:**

- Zmodyfikuj: `tests/engine.ts:20-31` (typ `Engine`), `tests/engine.ts:35-60` (`stubEngine`),
  `tests/engine.ts:124` (nowe helpery przed `start`)
- Zmodyfikuj: `tests/keep-warm.test.ts:5`, `tests/keep-warm.test.ts:189-196`,
  `tests/keep-warm.test.ts:258-277`
- Zmodyfikuj: `hooks/session-store.ts:24-25`, `hooks/session-store.ts:36-58`
- Zmodyfikuj: `hooks/state.ts:125`
- Zmodyfikuj: `hooks/events/session.ts:9`, `hooks/events/session.ts:53`
- Zmodyfikuj: `hooks/register.tsx:7`, `hooks/register.tsx:35`, `hooks/register.tsx:40`
- Zmodyfikuj: `README.md:239`
- Zmodyfikuj: `.claude/CLAUDE.md:12`, `.claude/CLAUDE.md:57`, `.claude/CLAUDE.md:68`, sekcja „Behaviour agreed with the
  owner”
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `openSessionStore($)`, `markRestored($)`, `readSnapshot($)`, `writeSession($, patch)`,
  `startOver($)` (istniejące).
- Produkuje: `carryOverCleared($: EngineInterface): Promise<void>` (`hooks/session-store.ts`),
  `startCleared($: EngineInterface): Promise<void>` (`hooks/events/session.ts`),
  w testach `stubClearableEngine(on)`, `clear($, engine)`, `CLEARED_ID`, pole `Engine.sessionId`.

**Wzorce:**

- `hooks/session-store.ts` `restoreSaved` — ten sam odczyt wpisu i zapis do `$.state`; wydziel go
  do `readSaved` / `applySaved` i użyj w obu miejscach.
- `tests/engine.ts` `stubEngine` — stub odpowiada na zdarzenia przez `on('<event>', ...)`,
  wartości dla wywołań na `$` jako `{ value: ... }`.
- `tests/keep-warm.test.ts` test `'/keepwarm on: the line names the next ping'` — `clock.advance(MINUTE)`
  przed odczytem linii, żeby tick wyliczył długość cache.

**Reguły stosowalne:**

- `tdd-test-na-blad` — Kroki 1-2 reprodukują błąd: 5 testów `/clear` failuje na obecnym kodzie.
- `pokayoke-przyczyna` — poprawka u źródła: nowa sesja po `/clear` dostaje klucz store i stan
  odtworzony, a nie łatka na samym włączniku w linii.
- `dry-drugie-wystapienie` — przejęcie wpisu ze store występuje drugi raz, więc `restoreSaved`
  i `carryOverCleared` dzielą `readSaved` / `applySaved`.
- `dok-ten-sam-commit` — README (tabela zdarzeń) i `.claude/CLAUDE.md` w tym samym commicie.
- `tdd-first` — `stubClearableEngine` tylko w testach `/clear`: stub `$.state` spowalnia każdy
  check i test „stops itself after 6 pings” przekracza limit 5 s kitu.

**Tryb wykonania (rekomendacja):** inline-batch — jeden task, kod zweryfikowany prototypem.

**Wykonawca (rekomendacja):** claude / standard — zmiana zachowania z nowym stubem testów.

- [ ] **Krok 1: Napisz failing test**

W `tests/engine.ts` dodaj do typu `Engine` (po `store: Record<string, unknown>`):

```ts
  sessionId: string
```

W `stubEngine` dodaj do obiektu `engine` (po `store: { ...store },`):

```ts
    sessionId: 'S1',
```

Zamień linię `on('session.id', () => ({ value: 'S1' }))` na:

```ts
  on('session.id', () => ({ value: engine.sessionId }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
```

Przed `export async function start($: any) {` wstaw:

```ts
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

```

W `tests/keep-warm.test.ts` zamień import z `./engine` na:

```ts
import { answer, clear, CLEARED_ID, keepwarm, line, MINUTE, NO_USAGE, READ, START, start, stubClearableEngine, stubEngine, WRITE } from './engine'
```

Zamień test `'/clear starts the countdown over'` na ten test i dwa nowe po nim:

```ts
test('/clear starts the countdown over', async ($, on) => {
  const { engine, clock } = stubClearableEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  await clear($, engine)
  expect(await line($)).toEqual('nothing cached yet······ 󰐊 Warm ')
})

test('/clear keeps keep-warm on: the next answer starts its countdown', async ($, on) => {
  const { engine, clock } = stubClearableEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clear($, engine)
  await answer($, engine, WRITE)
  await clock.advance(MINUTE)
  expect(await line($)).toEqual('󰁔 ping 10:52·54k cached·59 min left•••••• 󰓛 Stop ')
})

test('/clear carries the stop time over, under the new session\'s own store entry', async ($, on) => {
  const { engine } = stubClearableEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, '3h')
  await clear($, engine)
  await answer($, engine, WRITE)
  expect(engine.store[`session:${CLEARED_ID}`]).toMatchObject({ keepWarm: true, stopAt: START + 3 * 60 * MINUTE, lastRequestAt: START })
  expect(engine.store['session:S1']).toMatchObject({ keepWarm: true, lastRequestAt: START })
})

test('/clear with keep-warm on never pings the cleared, cold conversation', async ($, on) => {
  const { engine, clock } = stubClearableEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clear($, engine)
  await clock.advance(70 * MINUTE)
  expect(engine.forks).toBe(0)
  expect(engine.submitted).toEqual([])
  expect(await line($)).toEqual('nothing cached yet······ 󰓛 Stop ')
})
```

Zamień dwa istniejące testy rachunku po `/clear` na:

```ts
test('/clear keeps what keep-warm saved this session', async ($, on) => {
  const { engine, clock } = stubClearableEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(52 * MINUTE)
  await clear($, engine)
  expect(await line($)).toContain('󰆼 cost 5k')
})

test('a return after /clear is no saved return: the ping warmed the conversation before it', async ($, on) => {
  const { engine, clock } = stubClearableEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(70 * MINUTE)
  await clear($, engine)
  await answer($, engine, READ)
  expect(await line($)).toContain('󰆼 cost 5k')
})
```

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: `77 pass`, `5 fail`: `/clear keeps keep-warm on: ...` (linia
`󰔟 expires 11:00·54k cached·59 min left•••••• 󰐊 Warm` ze spacją na końcu), `/clear carries the stop time over, ...`
(`Received: undefined`), `/clear with keep-warm on never pings ...` (linia z `󰐊 Warm` zamiast
`󰓛 Stop`), `/clear keeps what keep-warm saved this session` i
`a return after /clear is no saved return: ...` (linia bez `󰆼 cost 5k`).

- [ ] **Krok 3: Zaimplementuj minimalnie**

W `hooks/session-store.ts` zamień ciało `restoreSaved` i dopisz pod nim trzy funkcje (komentarz nad
`restoreSaved` bez zmian):

```ts
export async function restoreSaved($: EngineInterface) {
  if (await isRestored($)) return false
  const saved = await readSaved($)
  if (saved) await applySaved($, saved)
  else live.isUnseen = true
  await markRestored($)
  await save($)
  return true
}

// /clear ends the session and opens a new one in the same process, under a new id and with an
// empty $.state (no session.start comes): the new one takes the cleared one's saved values over
// (the switch, its stop time, what keep-warm cost and saved) and keeps them under its own id.
export async function carryOverCleared($: EngineInterface) {
  const saved = await readSaved($)
  await openSessionStore($)
  if (saved) await applySaved($, saved)
  await markRestored($)
}

async function readSaved($: EngineInterface) {
  return (await $.store.get(live.storeKey)) as KeepWarmSaved | undefined
}

async function applySaved($: EngineInterface, saved: KeepWarmSaved) {
  if (saved.ttl && typeof saved.ttl.ms === 'number') live.savedTtl = saved.ttl
  const { lastRequestAt: last } = await readSnapshot($)
  if (saved.lastRequestAt > last) await writeSession($, { lastRequestAt: saved.lastRequestAt })
  await writeSession($, {
    isOn: saved.keepWarm,
    stopAt: saved.stopAt ?? 0,
    lastRealRequestAt: saved.lastRealRequestAt ?? 0,
    lastWarmPingAt: saved.lastWarmPingAt ?? 0,
    savings: saved.savings ?? NO_SAVINGS,
  })
}
```

W `hooks/events/session.ts` zamień import z `../session-store` na:

```ts
import { carryOverCleared, forgetOldSessions, openSessionStore, restoreSaved, saveIfRestored } from '../session-store'
```

i wstaw przed komentarzem `// The conversation starts over (cleared, ...` funkcję:

```ts
// After /clear: a new session, which keeps keep-warm as the cleared one had it, with a
// conversation that starts over.
export async function startCleared($: EngineInterface) {
  await carryOverCleared($)
  await startOver($)
}

```

`startOver` zapisuje przez `saveIfRestored`, więc wpis trafia pod nowy klucz dopiero po
`carryOverCleared` (który ustawia klucz i flagę `restored`).

Flagę `restored` ustawia teraz też `/clear`, więc popraw komentarze, które mówią tylko
o `session.start`. W `hooks/state.ts` komentarz nad `isRestored` na:

```ts
// Whether this session's saved values are restored (session.start, or carried over after /clear).
```

W `hooks/session-store.ts` dwie linie komentarza nad `saveIfRestored` na:

```ts
// Saves only once the session's values are restored: before that, it would write the defaults
// (keep-warm off) over the saved values.
```

W `hooks/register.tsx` zamień import z `./events/session` na:

```ts
import { carryOnResumed, markStartedNew, replacesConversation, startCleared, startOver, startSession } from './events/session'
```

pierwszą linię komentarza nad `on('classic.SessionStart', ...)`
(`// After /clear the conversation starts over: no cache to count down yet. Its 'compact' is not`) na
dwie:

```ts
  // After /clear, a new session, keep-warm carries over as it was and the conversation starts over:
  // no cache to count down yet. Its 'compact' is not
```

i linię `else if (e.source === 'clear') await startOver($)` na:

```ts
    else if (e.source === 'clear') await startCleared($)
```

W `README.md` (tabela „The events it hooks”) zamień wiersz `A session is reopened or cleared` na:

```markdown
| A session is reopened or cleared (Claude Code's `SessionStart` hook) | Reads how long ago the last answer came and the conversation's size, so the countdown carries on; after `/clear`, which Claude Code runs as a new session, keeps keep-warm on or off as it was (with its stop time) and starts the countdown over. Changes nothing. |
```

W `.claude/CLAUDE.md`:

- linia 12 (Code layout) na:

```markdown
- `session-store.ts`: `$.store`: save, restore after a relaunch, carry over after `/clear`, the weekly clean-up, `plan-ttl`.
```

- pod linią 57 (`` `$.state` is per session ...``) nowy punkt:

```markdown
- `/clear` is a new session (probe in the live app, 2026-11-25, Claude Code 2.1.332): `session.end` `reason: 'clear'` under the old id, then `classic.SessionStart` `source: 'clear'` under a new id with an empty `$.state`; no `session.start` comes, the module's variables and timers stay (`live.storeKey` still names the old session). Until ckw-o6j keep-warm read as off after it, and the new session saved over the old one's store entry. Since then `carryOverCleared` takes the old entry's switch, stop time, cache length and account over under the new id, then the countdown starts over. The tests model it with `stubClearableEngine` and `clear()` (`tests/engine.ts`); only the `/clear` tests use it: answering `$.state` in the stub slows every check, too much for the 6-pings test.
```

- w linii 68 (weekly store clean-up) ostatnie zdanie (zaczyna się od
  `The classic.SessionStart hook never saves before`) na:

```markdown
The classic.SessionStart hook never saves before the session's values are restored (by `session.start`, or carried over after `/clear`): it could write the defaults over the saved switch.
```

- na końcu sekcji „Behaviour agreed with the owner” nowy punkt:

```markdown
- `/clear` keeps keep-warm as it was: on or off, its stop time and the account (owner's request, ckw-o6j, 2026-11-25). The countdown and the pings in a row start over, as after a compaction.
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . &&
  claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: `82 pass`, `0 fail`; `✔ Validation passed`.

- [ ] **Krok 5: Commit**

```bash
git add hooks/session-store.ts hooks/state.ts hooks/events/session.ts hooks/register.tsx tests/engine.ts tests/keep-warm.test.ts README.md .claude/CLAUDE.md &&
  git commit -m "fix(ckw-o6j): /clear nie wyłącza keep-warm"
```
