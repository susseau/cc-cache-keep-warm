# Bilans keep-warm w pasku - plan implementacji (ckw-0zj)

**Cel:** linia i `/keepwarm status` pokazują, ile keep-warm zaoszczędził albo kosztował w bieżącej
sesji.

**Architektura:** czysty moduł `hooks/savings.ts` liczy bilans: koszt requestu, rozpoznanie
uratowanego powrotu, netto. Nie zna tekstu: detal linii składa `line-model.ts`, a linię statusu
`command.ts`, jak resztę swoich tekstów. `state.ts` trzyma w `$.state` bilans, czas ostatniego
prawdziwego requestu (nie pingu) i czas ostatniego ciepłego pingu. Koszt każdego pingu dolicza
`appendPing`, a uratowany powrót `finishRequest` w `events/turn.ts`. `session-store.ts` przenosi
te trzy pola przez relaunch.

**Stack:** TypeScript, mod API Claude Code (`$.state`, `$.store`, `turn.step`), testy
`claude plugin test .` (`claude-code/testing`, stub engine `tests/engine.ts`).

**Spec:** brak — plan-only z ticketu ckw-0zj

## Global constraints

- Licznik netto w stanie sesji przetrwa reload i relaunch (store).
- Zysk liczony tylko, gdy przerwa od ostatniego prawdziwego requestu przekracza TTL.
- Detal w pasku.
- `/keepwarm status` pokazuje pingi, uratowane powroty, koszt i netto.
- Czysta funkcja z testami.
- README: wiersz w „Reading the line” i w „What it runs, reads and sends”.
- Uratowany powrót (przerwa > TTL, trafienie w ciepły cache dzięki pingom) zyskuje 1,9·X, gdzie
  X = cache_read; netto = zyski − koszty pingów.

## Odstępstwa

- **Pełny koszt pingu** — ticket: każdy ping kosztuje 0,1·read → plan: ping kosztuje cały swój
  request, w ekwiwalentach tokenu wejścia: input·1 + cache_read·0,1 + cache_creation·2 +
  output·5. Powód: decyzja właściciela 2026-11-16; widoczny ping zapisuje do cache własne
  wiadomości, a oba pingi mają wejście i wyjście. Constraint: brak. Taski: 1.

## File Structure

- `hooks/savings.ts` (nowy) — czysty rachunek bilansu keep-warm: koszt requestu, uratowany
  powrót, netto; zależy od: `hooks/cache-timing.ts`, `types/index.d.ts`
- `types/index.d.ts` — typ `KeepWarmSavings`; pola `lastRealRequestAt`, `lastWarmPingAt` i
  `savings` w `PluginState` i w `KeepWarmSaved`; zależy od: brak
- `hooks/session-snapshot.ts` — te same trzy pola w `SessionSnapshot`; zależy od:
  `types/index.d.ts`
- `hooks/state.ts` — refy trzech pól; `appendPing` dolicza koszt pingu i zapamiętuje ciepły ping;
  zależy od: `hooks/savings.ts`
- `hooks/events/turn.ts` — prawdziwy request zapisuje swój czas i dolicza uratowany powrót;
  zależy od: `hooks/savings.ts`, `hooks/state.ts`, `hooks/session-store.ts`
- `hooks/line/line-model.ts` — detal bilansu („saved 90k” / „cost 5k”) za liczbą pingów, tylko
  przy włączonym keep-warm; zależy od: `hooks/savings.ts`, `hooks/format.ts`
- `hooks/session-store.ts` — zapis i odtworzenie trzech pól; zależy od: `hooks/state.ts`,
  `hooks/savings.ts`
- `hooks/command.ts` — linia bilansu w `statusText`; zależy od: `hooks/savings.ts`,
  `hooks/format.ts`
- `tests/decisions.test.ts` — dowodzi rachunku bilansu, detalu linii i `statusText`; zależy od:
  `hooks/savings.ts`, `hooks/line/line-model.ts`, `hooks/command.ts`
- `tests/keep-warm.test.ts` — dowodzi bilansu na stub engine: ping, powrót, relaunch, `/clear`;
  zależy od: `tests/engine.ts`
- `README.md` — wiersz linii, `/keepwarm`, „What it reads”, „What it keeps”; zależy od: brak
- `.claude/CLAUDE.md` — `savings.ts` w układzie kodu, uzgodnione zachowanie bilansu; zależy od:
  brak

---

## Task 1: Pocisk - bilans pingów i uratowanych powrotów w linii

**Pliki:**

- Utwórz: `hooks/savings.ts`
- Zmodyfikuj: `types/index.d.ts:6-52`
- Zmodyfikuj: `hooks/session-snapshot.ts:3-20`
- Zmodyfikuj: `hooks/state.ts:1-125`
- Zmodyfikuj: `hooks/events/turn.ts:1-49`
- Zmodyfikuj: `hooks/line/line-model.ts` (import, `keepWarmDetails`, nowa `savingsDetails`)
- Zmodyfikuj: `README.md:100-115`, `README.md:202`, `README.md:218`
- Zmodyfikuj: `.claude/CLAUDE.md` (sekcje „Code layout” i „Behaviour agreed with the owner”)
- Test: `tests/decisions.test.ts`, `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `isCacheHit(usage)` z `hooks/cache-timing.ts`, `tokens(n)` z `hooks/format.ts`,
  `KeepWarmTtl` z `types/index.d.ts`.
- Produkuje:
  - typ `KeepWarmSavings = { pings: number; pingCost: number; returns: number; saved: number }`
    w `types/index.d.ts`;
  - w `hooks/savings.ts`: `NO_SAVINGS`, `requestCost(usage)`, `addPing(savings, usage)`,
    `isSavedReturn({ lastRealRequestAt, lastWarmPingAt, now, ttl, usage })`,
    `addSavedReturn(savings, usage)`, `netSaving(savings)`;
  - pola `lastRealRequestAt: number`, `lastWarmPingAt: number` i `savings: KeepWarmSavings` w
    `SessionSnapshot`, czytane przez `readSnapshot` i zapisywane przez `writeSession`.

**Wzorce:**

- `hooks/cache-timing.ts` — czysty moduł: stałe z komentarzem „dlaczego”, małe eksportowane
  funkcje, import typów z `../types`.
- `hooks/state.ts:10-23` — każdy ref `$.state` jako literał `{ plugin, key } as const` w tym
  pliku (walidator odrzuca ref importowany).
- `hooks/line/line-model.ts` (`pingCountDetails`) — detal linii jako mała funkcja zwracająca
  `[]` albo jeden tekst.
- `tests/decisions.test.ts:113-123` — test czystej funkcji przez helper `snapshot(...)`.
- `tests/keep-warm.test.ts:40-51` — test na stub engine: `answer`, `keepwarm`, `clock.advance`,
  pełna asercja `line($)`.

**Reguły stosowalne:**

- `modul-odczyt-decyzja-render` — rachunek (koszt, rozpoznanie powrotu, netto) w czystym
  `savings.ts` bez formatowania; tekst detalu w `line-model.ts`; `state.ts` i `turn.ts` tylko
  czytają i zapisują stan.
- `jedna-odpowiedzialnosc` — `savings.ts` tylko liczy; teksty bilansu zostają przy swoich
  widokach (`line-model.ts`, `command.ts`).
- `tdd-jedna-intencja` — osobny test na cenę requestu, naliczenie pingu, naliczenie powrotu,
  rozpoznanie powrotu i detal linii.
- `dok-ten-sam-commit` — README (wiersz linii, odczyty) i `.claude/CLAUDE.md` (układ kodu) w
  commicie tasku, bo task dodaje moduł i to, co mod czyta z requestu.
- `tdd-zachowanie-nie-implementacja` — testy stub engine asertują linię, nie wartości w `$.state`.

**Tryb wykonania (rekomendacja):** subagent-per-task — samodzielny pionowy slice z własnym
cyklem testów.

**Wykonawca (rekomendacja):** claude / standard — typowa implementacja z testami w znanym
wzorcu repo.

- [ ] **Krok 1: Napisz failing testy**

W `tests/decisions.test.ts` dopisz import pod importem `../hooks/command`:

```ts
import { addPing, addSavedReturn, isSavedReturn, NO_SAVINGS, requestCost } from '../hooks/savings'
```

Helper `snapshot` (linie 113-116) dostaje trzy nowe pola, bez nich typ się nie skompiluje:

```ts
const snapshot = (fields: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  lastRequestAt: START, now: START, isOn: false, stopAt: 0, pings: [], ttl: SUBSCRIPTION_TTL, contextTokens: 54_000,
  isWaiting: false, shortAfterMs: 0, waitsForMessage: false, sawResponse: true, pingError: '', nearlyFull: false,
  lastRealRequestAt: START, lastWarmPingAt: 0, savings: NO_SAVINGS, ...fields,
})
```

Dopisz na końcu pliku (`READ` = 10 wejścia, 5 wyjścia, 50k odczytu; `WRITE` = 10 wejścia,
5 wyjścia, 50k zapisu):

```ts
test('requestCost: input 1, cache read 0.1, 1-hour write 2, output 5', async () => {
  expect(requestCost(READ)).toEqual(5_035)
  expect(requestCost(WRITE)).toEqual(100_035)
})

test('addPing: counts the ping and adds its whole request', async () => {
  expect(addPing(NO_SAVINGS, READ)).toEqual({ pings: 1, pingCost: 5_035, returns: 0, saved: 0 })
})

test('addSavedReturn: a return saves re-writing what it read, less reading it', async () => {
  const pinged = { pings: 1, pingCost: 5_035, returns: 0, saved: 0 }
  expect(addSavedReturn(pinged, READ)).toEqual({ pings: 1, pingCost: 5_035, returns: 1, saved: 95_000 })
})

test('isSavedReturn: a warm cache after a break longer than the cache, with a warm ping in it', async () => {
  const back = { lastRealRequestAt: START, lastWarmPingAt: START + 52 * MINUTE, now: START + 70 * MINUTE, ttl: SUBSCRIPTION_TTL, usage: READ }
  expect(isSavedReturn(back)).toEqual(true)
  expect(isSavedReturn({ ...back, now: START + 50 * MINUTE })).toEqual(false)
  expect(isSavedReturn({ ...back, lastWarmPingAt: 0 })).toEqual(false)
  expect(isSavedReturn({ ...back, lastWarmPingAt: START - MINUTE })).toEqual(false)
  expect(isSavedReturn({ ...back, usage: WRITE })).toEqual(false)
  expect(isSavedReturn({ ...back, lastRealRequestAt: 0 })).toEqual(false)
  expect(isSavedReturn({ ...back, ttl: null })).toEqual(false)
})

test('lineModel: the net saving follows the ping count, only while keep-warm is on', async () => {
  const savings = { pings: 1, pingCost: 5_035, returns: 1, saved: 95_000 }
  expect(lineModel(snapshot({ isOn: true, savings })).details).toEqual(['󰁔 ping 10:52', 'saved 90k', '54k cached'])
  expect(lineModel(snapshot({ isOn: true, savings: { ...savings, returns: 0, saved: 0 } })).details).toContain('cost 5k')
  expect(lineModel(snapshot({ savings })).details).not.toContain('saved 90k')
  expect(lineModel(snapshot({ isOn: true })).details).toEqual(['󰁔 ping 10:52', '54k cached'])
})
```

W `tests/keep-warm.test.ts` zmień trzy istniejące asercje linii, bo ping ma teraz koszt
(`READ` → 5 035 → „cost 5k”):

- linia 49: `'󰁔 ping 11:44·1 ping ✓·cost 5k·54k cached·60 min left•••••••••• 󰓛 Stop '`
- linia 88: `'󰁔 ping 11:44·cost 5k·54k cached·60 min left•••••••••• 󰓛 Stop '` (powrót o 10:52, po
  52 min, krótszy niż cache: bez zysku)
- linia 135: `'󰁔 ping 11:34·1 ping ✓·cost 5k·54k cached·60 min left•••••••••• 󰓛 Stop '`

Dopisz po teście `'a real turn starts the pings in a row over'`:

```ts
test('a return the pings kept warm: the line shows what keep-warm saved', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(70 * MINUTE)
  await answer($, engine, READ)
  expect(await line($)).toEqual('󰁔 ping 12:02·saved 90k·54k cached·60 min left•••••••••• 󰓛 Stop ')
})
```

(Odpowiedź o 10:00, ping o 10:52, powrót o 11:10: 70 min od ostatniego prawdziwego requestu,
dłużej niż godzinny cache, a cache ciepły. Zysk 1,9 · 50k = 95k, minus 5 035 za ping, daje 90k.)

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — brak modułu `../hooks/savings`, a w `keep-warm.test.ts` linie bez
„cost 5k” i „saved 90k”.

- [ ] **Krok 3: Zaimplementuj minimalnie**

`types/index.d.ts` — pod typem `KeepWarmPing` dopisz:

```ts
/**
 * What keep-warm cost and saved in this session, in input-token equivalents (an input token 1, a
 * cache read 0.1, a 1-hour cache write 2, an output token 5). `pingCost`: every ping's whole
 * request; `returns`: real requests after a break longer than the cache that found it warm thanks
 * to the pings; `saved`: what re-writing their cache would have cost more than reading it.
 */
export type KeepWarmSavings = { pings: number; pingCost: number; returns: number; saved: number }
```

W `PluginState['cache-keep-warm']`, za polem `nearlyFull`:

```ts
      /** When the main conversation's last request that was not a ping started (ms since epoch); 0 = none yet. */
      lastRealRequestAt: number
      /** When the last ping that found the cache warm started (ms since epoch); 0 = none yet. */
      lastWarmPingAt: number
      /** What keep-warm cost and saved in this session; never reset while the session lives. */
      savings: KeepWarmSavings
```

`hooks/savings.ts` (nowy):

```ts
// What keep-warm cost and saved in this session, from the usage of its pings and of the returns
// they kept warm. Prices relative to one input token, from Anthropic's price list: a cache read
// costs 0.1x, a 1-hour cache write 2x, an output token 5x. Keep-warm only runs on the 1-hour cache.
import type { ModelUsage } from 'claude-code'

import type { KeepWarmSavings, KeepWarmTtl } from '../types'
import { isCacheHit } from './cache-timing'

const READ_PRICE = 0.1
const HOUR_WRITE_PRICE = 2
const OUTPUT_PRICE = 5

export const NO_SAVINGS: KeepWarmSavings = { pings: 0, pingCost: 0, returns: 0, saved: 0 }

export function requestCost(usage: ModelUsage) {
  return usage.input_tokens
    + READ_PRICE * usage.cache_read_input_tokens
    + HOUR_WRITE_PRICE * usage.cache_creation_input_tokens
    + OUTPUT_PRICE * usage.output_tokens
}

export function addPing(savings: KeepWarmSavings, usage: ModelUsage): KeepWarmSavings {
  return { ...savings, pings: savings.pings + 1, pingCost: savings.pingCost + requestCost(usage) }
}

export type RealRequest = { lastRealRequestAt: number, lastWarmPingAt: number, now: number, ttl: KeepWarmTtl, usage: ModelUsage }

// A real request after a break longer than the cache's life that still read the cache: only a
// warm ping since the last real request can have kept it.
export function isSavedReturn({ lastRealRequestAt, lastWarmPingAt, now, ttl, usage }: RealRequest) {
  if (ttl === null || lastRealRequestAt === 0) return false
  return lastWarmPingAt > lastRealRequestAt && now - lastRealRequestAt > ttl.ms && isCacheHit(usage)
}

// Without the pings this request would have re-written what it read.
export function addSavedReturn(savings: KeepWarmSavings, usage: ModelUsage): KeepWarmSavings {
  const read = usage.cache_read_input_tokens
  return { ...savings, returns: savings.returns + 1, saved: savings.saved + HOUR_WRITE_PRICE * read - READ_PRICE * read }
}

export function netSaving({ saved, pingCost }: KeepWarmSavings) {
  return saved - pingCost
}
```

`hooks/session-snapshot.ts` — import i trzy pola na końcu typu:

```ts
import type { KeepWarmPing, KeepWarmSavings, KeepWarmTtl } from '../types'
```

```ts
  nearlyFull: boolean
  lastRealRequestAt: number
  lastWarmPingAt: number
  savings: KeepWarmSavings
}
```

`hooks/state.ts`:

- import: `import { addPing, NO_SAVINGS } from './savings'`;
- refy pod `NEARLY_FULL`:

```ts
const LAST_REAL = { plugin: 'cache-keep-warm', key: 'lastRealRequestAt' } as const
const LAST_WARM_PING = { plugin: 'cache-keep-warm', key: 'lastWarmPingAt' } as const
const SAVINGS = { plugin: 'cache-keep-warm', key: 'savings' } as const
```

- `readSnapshot` czyta trzy nowe pola (zastąp destrukturyzację z `Promise.all` i dopisz pola
  wyniku):

```ts
  const [last, now, isOn, stopAt, pings, ttl, context, waiting, shortAfter, waits, sawResponse, pingError, nearlyFull, lastReal, lastWarmPing, savings] = await Promise.all([
    $.state.get(LAST), $.state.get(NOW), $.state.get(KEEP_WARM), $.state.get(STOP_AT), $.state.get(PINGS), $.state.get(TTL), $.state.get(CONTEXT),
    $.state.get(WAITING), $.state.get(SHORT_AFTER), $.state.get(WAITS), $.state.get(SAW_RESPONSE), $.state.get(PING_ERROR), $.state.get(NEARLY_FULL),
    $.state.get(LAST_REAL), $.state.get(LAST_WARM_PING), $.state.get(SAVINGS),
  ])
```

```ts
    nearlyFull: nearlyFull.value ?? false,
    lastRealRequestAt: lastReal.value ?? 0,
    lastWarmPingAt: lastWarmPing.value ?? 0,
    savings: savings.value ?? NO_SAVINGS,
```

- `writeSession`, na końcu:

```ts
  if (patch.lastRealRequestAt !== undefined) await $.state.set(LAST_REAL, patch.lastRealRequestAt)
  if (patch.lastWarmPingAt !== undefined) await $.state.set(LAST_WARM_PING, patch.lastWarmPingAt)
  if (patch.savings !== undefined) await $.state.set(SAVINGS, patch.savings)
```

- `appendPing` dolicza koszt i zapamiętuje ciepły ping (oba pingi przechodzą przez tę funkcję):

```ts
// A ping (invisible or visible), what its request found in the cache, and what it cost.
export async function appendPing($: EngineInterface, at: number, usage: ModelUsage) {
  const ping: KeepWarmPing = { at, isHit: isCacheHit(usage), read: usage.cache_read_input_tokens }
  const [{ value: pings = [] }, { value: savings = NO_SAVINGS }] = await Promise.all([$.state.get(PINGS), $.state.get(SAVINGS)])
  await $.state.set(PINGS, [...pings, ping].slice(-MAX_PINGS_CAP))
  await $.state.set(SAVINGS, addPing(savings, usage))
  if (ping.isHit) await $.state.set(LAST_WARM_PING, at)
}
```

`hooks/events/turn.ts`:

- import: `import { addSavedReturn, isSavedReturn } from '../savings'`;
- w `finishRequest` zastąp linię
  `if (live.visiblePingAt > 0) await recordVisiblePing($, turnId, usage)`:

```ts
  if (live.visiblePingAt > 0) await recordVisiblePing($, turnId, usage)
  else await recordRealRequest($, now, usage)
```

- pod `recordVisiblePing`:

```ts
// A request of yours or one the session ran by itself, not a ping: after a break longer than the
// cache, finding it warm is what the pings saved.
async function recordRealRequest($: EngineInterface, now: number, usage: ModelUsage) {
  const { lastRealRequestAt, lastWarmPingAt, ttl, savings } = await readSnapshot($)
  if (isSavedReturn({ lastRealRequestAt, lastWarmPingAt, now, ttl, usage })) await writeSession($, { savings: addSavedReturn(savings, usage) })
  await writeSession($, { lastRealRequestAt: now })
}
```

`hooks/line/line-model.ts`:

- import: `import { netSaving } from '../savings'` (`tokens` jest już importowany z `../format`);
- w `keepWarmDetails` po `...pingCountDetails(session),` dopisz `...savingsDetails(session),`;
- pod `pingCountDetails`:

```ts
// What keep-warm has saved in this session, once it has pinged; while no return has paid the
// pings back, what they cost.
function savingsDetails({ savings }: SessionSnapshot) {
  if (savings.pings === 0) return []
  const net = netSaving(savings)
  return [net >= 0 ? `saved ${tokens(net)}` : `cost ${tokens(-net)}`]
}
```

`README.md`:

- w tabeli „Reading the line”, pod wierszem `**3 pings ✓**`:

```markdown
| **saved 90k** | What keep-warm has saved in this session so far, once it has pinged: each time you came back after a break longer than the cache and found it warm, it saved re-writing your conversation (a re-write costs 2x, a cache read 0.1x), minus what every ping cost. In input-token equivalents. **cost 5k** while no return has paid the pings back yet. Shown while keep-warm is on. |
```

- linia 202: `(how many tokens were read from the cache or written to it)` →
  `(how many tokens were read from the cache, written to it, sent and answered)`;
- linia 218: `the cache tokens of each request` →
  `the cache, input and output tokens of each request (to count what keep-warm cost and saved)`.

`.claude/CLAUDE.md`:

- „Code layout”, zdanie o czystych modułach: dopisz `savings.ts` do listy
  (`` `format.ts`, `cache-timing.ts`, `savings.ts`; ``) i pod pozycją `format.ts` dodaj:

```markdown
- `savings.ts`: what keep-warm cost and saved this session (a request's cost, a saved return, the net); the line and `/keepwarm status` word it.
```

- „Behaviour agreed with the owner”, nowy punkt na końcu:

```markdown
- What keep-warm saved (ckw-0zj, owner's choices 2026-11-16): a ping costs its whole request (input 1, cache read 0.1, 1-hour write 2, output 5, in input-token equivalents); a real request after a break longer than the cache, with a warm ping since the last real one, that finds the cache warm saves 1.9x what it read. The line shows the net ("saved 90k", "cost 5k") after the ping count, only while keep-warm is on; `/keepwarm status` shows the whole account once keep-warm has pinged. The account lives for the whole session, through `/clear`, compactions and relaunches.
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . && claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: PASS wszystkich testów; walidacja bez błędów.

- [ ] **Krok 5: Commit**

```bash
git add hooks/savings.ts types/index.d.ts hooks/session-snapshot.ts hooks/state.ts hooks/events/turn.ts hooks/line/line-model.ts tests/decisions.test.ts tests/keep-warm.test.ts README.md .claude/CLAUDE.md && git commit -m "ckw-0zj: bilans keep-warm w pasku (koszt pingów, uratowane powroty)"
```

---

## Task 2: Bilans przetrwa relaunch i /clear

**Pliki:**

- Zmodyfikuj: `types/index.d.ts:1-6`
- Zmodyfikuj: `hooks/session-store.ts:16-51`
- Zmodyfikuj: `hooks/events/turn.ts` (`finishRequest`)
- Zmodyfikuj: `README.md:226`
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `NO_SAVINGS` z `hooks/savings.ts`; pola `lastRealRequestAt`, `lastWarmPingAt`,
  `savings` w `SessionSnapshot` i `writeSession` (Task 1).
- Produkuje: `KeepWarmSaved` z opcjonalnymi `lastRealRequestAt?: number`,
  `lastWarmPingAt?: number` i `savings?: KeepWarmSavings`; `save` zapisuje trzy pola,
  `restoreSaved` je odtwarza.

**Wzorce:**

- `hooks/session-store.ts:39-51` — odtwarzanie pól z `saved` z domyślną wartością dla wpisu
  sprzed nowej wersji (`saved.stopAt ?? 0`).
- `tests/keep-warm.test.ts:121-128` — sesja z zapisanym store (`SAVED_ON`) po relaunchu.

**Reguły stosowalne:**

- `pokayoke-migracja-bez-utraty` — wpis store sprzed tej wersji nie ma nowych pól: odtworzenie
  bierze `NO_SAVINGS` i `0`, nie gubi reszty wpisu.
- `dok-ten-sam-commit` — „What it keeps” w README w tym samym commicie, bo store trzyma nowe dane.

**Tryb wykonania (rekomendacja):** subagent-per-task — osobny przypadek (trwałość) z własnym
testem relaunchu.

**Wykonawca (rekomendacja):** claude / standard — rozszerzenie istniejącego zapisu i odczytu
store.

- [ ] **Krok 1: Napisz failing test**

W `tests/keep-warm.test.ts` dopisz po teście
`'a real answer after the visible ping starts the pings in a row over'`:

```ts
test('a ping before a relaunch and a return after it: the saving counts and is kept', async ($, on) => {
  const savings = { pings: 3, pingCost: 15_105, returns: 1, saved: 95_000 }
  const saved = { ...SAVED_ON, lastRealRequestAt: START - 70 * MINUTE, lastWarmPingAt: START - 10 * MINUTE, savings }
  const { engine } = stubEngine(on, { store: { 'session:S1': saved } })
  await start($)
  expect(await line($)).toEqual('󰁔 ping 10:42 (shows in chat)·saved 80k·54k cached·50 min left•••••••••· 󰓛 Stop ')
  await answer($, engine, READ)
  expect((engine.store['session:S1'] as { savings: unknown }).savings).toEqual({ pings: 3, pingCost: 15_105, returns: 2, saved: 190_000 })
})

test('/clear keeps what keep-warm saved this session', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(52 * MINUTE)
  await $.classic.SessionStart({ session_id: 'S1', transcript_path: '/t', cwd: '/work', hook_event_name: 'SessionStart', source: 'clear' } as any)
  expect(await line($)).toContain('cost 5k')
})
```

Przebieg pierwszego testu:

- przed relaunchem: prawdziwy request o 8:50, ciepły ping o 9:50 (`SAVED_ON.lastRequestAt`);
  bilans 95k − 15 105 ≈ 80k;
- o 10:00, po relaunchu i bez nowego pingu, wraca użytkownik: od 8:50 minęło 70 min, a ping
  był po tym requeście;
- wynik: +1 powrót (+95k).

Drugi test pilnuje decyzji „nigdy nie zeruj w sesji” i przechodzi już po Tasku 1.

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL w
`'a ping before a relaunch and a return after it: the saving counts and is kept'`: linia bez
„saved 80k”.

- [ ] **Krok 3: Zaimplementuj minimalnie**

`types/index.d.ts` — komentarz i typ `KeepWarmSaved`:

```ts
/**
 * What the mod remembers per session id in `$.store`, so a relaunch keeps it. `ttl` is the cache
 * length in effect when it was saved (absent before 1.0.3); `savedAt` when it was saved, which
 * ages the entry for the weekly clean-up (absent before 1.0.4); `lastRealRequestAt`,
 * `lastWarmPingAt` and `savings` keep what keep-warm cost and saved (absent before ckw-0zj).
 */
export type KeepWarmSaved = {
  lastRequestAt: number; keepWarm: boolean; stopAt: number; ttl?: KeepWarmTtl; savedAt?: number
  lastRealRequestAt?: number; lastWarmPingAt?: number; savings?: KeepWarmSavings
}
```

`hooks/session-store.ts`:

- import: `import { NO_SAVINGS } from './savings'`;
- `save`:

```ts
export async function save($: EngineInterface) {
  if (!live.storeKey) return
  const { lastRequestAt, isOn: keepWarm, stopAt, ttl, lastRealRequestAt, lastWarmPingAt, savings } = await readSnapshot($)
  const saved: KeepWarmSaved = { lastRequestAt, keepWarm, stopAt, ttl, lastRealRequestAt, lastWarmPingAt, savings, savedAt: await $.clock.now() }
  await $.store.set(live.storeKey, saved)
}
```

- w `restoreSaved` zastąp linię
  `await writeSession($, { isOn: saved.keepWarm, stopAt: saved.stopAt ?? 0 })`:

```ts
    await writeSession($, {
      isOn: saved.keepWarm,
      stopAt: saved.stopAt ?? 0,
      lastRealRequestAt: saved.lastRealRequestAt ?? 0,
      lastWarmPingAt: saved.lastWarmPingAt ?? 0,
      savings: saved.savings ?? NO_SAVINGS,
    })
```

`hooks/events/turn.ts` — na końcu `finishRequest` zapisz store, bo widoczny ping i prawdziwy
request zmieniają bilans po zapisie w `startRequest`:

```ts
  if (previous > 0 && !isFirst) await observeGap($, now - previous, usage)
  await save($)
}
```

`README.md:226` — `the time of the last request, whether keep-warm is on, and the stop time you
gave it.` → `the time of the last request (and of the last one that was not a ping, and of the
last ping that found the cache warm), whether keep-warm is on, the stop time you gave it, and what
keep-warm cost and saved in it (token counts only).`

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . && claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: PASS wszystkich testów; walidacja bez błędów.

- [ ] **Krok 5: Commit**

```bash
git add types/index.d.ts hooks/session-store.ts hooks/events/turn.ts tests/keep-warm.test.ts README.md && git commit -m "ckw-0zj: bilans keep-warm przetrwa relaunch i /clear"
```

---

## Task 3: /keepwarm status pokazuje bilans sesji

**Pliki:**

- Zmodyfikuj: `hooks/command.ts:1-61`
- Zmodyfikuj: `README.md:96`
- Test: `tests/decisions.test.ts`

**Interfejsy:**

- Konsumuje: `KeepWarmSavings` z `types/index.d.ts`, `netSaving` z `hooks/savings.ts`, `tokens`
  z `hooks/format.ts`; `savings` w `SessionSnapshot` (Task 1).
- Produkuje: linia bilansu w `statusText`, z prywatnej funkcji `savingsLine(savings)` w
  `hooks/command.ts`.

**Wzorce:**

- `hooks/command.ts:47-61` — `statusText` składa linie warunkowo przez `lines.push`; historia
  pingów zostaje ostatnia.

**Reguły stosowalne:**

- `modul-odczyt-decyzja-render` — netto liczy `savings.ts`, `command.ts` tylko składa tekst.
- `dok-ten-sam-commit` — wiersz `/keepwarm` w README w tym samym commicie.

**Tryb wykonania (rekomendacja):** inline-batch — drobna zmiana spleciona z `statusText` i jego
testem.

**Wykonawca (rekomendacja):** claude / cheap — mechaniczne dopisanie linii i testu.

- [ ] **Krok 1: Napisz failing test**

W `tests/decisions.test.ts` dopisz po teście `'statusText: on, its ping history and a short cache'`:

```ts
test('statusText: once keep-warm has pinged, its pings, saved returns, cost and net', async () => {
  const savings = { pings: 3, pingCost: 15_105, returns: 1, saved: 95_000 }
  expect(statusText(snapshot({ savings }), 8).split('\n')).toContain('This session: 3 pings cost 15k, 1 return to a warm cache saved 95k: 80k saved (input-token equivalents).')
  expect(statusText(snapshot({ savings: { pings: 1, pingCost: 5_035, returns: 0, saved: 0 } }), 8).split('\n')).toContain('This session: 1 ping cost 5k, 0 returns to a warm cache saved 0k: 5k spent (input-token equivalents).')
  expect(statusText(snapshot({}), 8)).not.toContain('This session:')
})
```

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — brak linii `This session: …`.

- [ ] **Krok 3: Zaimplementuj minimalnie**

`hooks/command.ts`:

- importy: `import type { KeepWarmSavings } from '../types'` i
  `import { netSaving } from './savings'` (`tokens` jest już importowany z `./format`);
- w `statusText` destrukturyzacja `const { isOn, stopAt, ttl, pings, savings } = session`, a
  przed pętlą historii pingów:

```ts
  if (savings.pings > 0) lines.push(savingsLine(savings))
```

- pod `statusText`:

```ts
// The session's whole account: what the pings cost, what the returns they kept warm saved, the net.
function savingsLine(savings: KeepWarmSavings) {
  const net = netSaving(savings)
  const pings = `${savings.pings} ping${savings.pings === 1 ? '' : 's'} cost ${tokens(savings.pingCost)}`
  const returns = `${savings.returns} return${savings.returns === 1 ? '' : 's'} to a warm cache saved ${tokens(savings.saved)}`
  const result = net >= 0 ? `${tokens(net)} saved` : `${tokens(-net)} spent`
  return `This session: ${pings}, ${returns}: ${result} (input-token equivalents).`
}
```

`README.md:96` — wiersz `/keepwarm` w tabeli komend zastąp tym:

```markdown
| `/keepwarm` | Show the state, the last pings and what keep-warm cost and saved in this session |
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test .
```

Oczekiwany output: PASS wszystkich testów.

- [ ] **Krok 5: Commit**

```bash
git add hooks/command.ts tests/decisions.test.ts README.md && git commit -m "ckw-0zj: /keepwarm status pokazuje bilans sesji"
```
