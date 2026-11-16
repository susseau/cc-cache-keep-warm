# Bilans keep-warm w pasku - plan implementacji (ckw-0zj)

**Cel:** linia i `/keepwarm status` pokazują, ile keep-warm zaoszczędził albo kosztował w bieżącej
sesji; pasek linii skraca się do 6 kropek.

**Architektura:** czysty moduł `hooks/savings.ts` liczy bilans: koszt requestu, rozpoznanie
uratowanego powrotu, netto. Nie zna tekstu: detal linii składa `line-model.ts`, a linię statusu
`command.ts`, jak resztę swoich tekstów. `state.ts` trzyma w `$.state` bilans, czas ostatniego
prawdziwego requestu (nie pingu) i czas ostatniego ciepłego pingu. Koszt każdego pingu dolicza
`accountPing` (`ping/ping-account.ts`), a uratowany powrót `finishRequest` w `events/turn.ts`.
`session-store.ts` przenosi te trzy pola przez relaunch.

**Stack:** TypeScript, mod API Claude Code (`$.state`, `$.store`, `turn.step`), testy
`claude plugin test .` (`claude-code/testing`, stub engine `tests/engine.ts`).

**Spec:** brak — plan-only z ticketu ckw-0zj

**Śledzony ticket ckw-4h7** (konfiguracja markdownlint dla gate-check) jest zrobiony przed
taskami, commitem `0bdfc87`: `.markdownlint.jsonc` wyłącza MD013, MD033, MD034 i MD041 (README.md i
`.claude/CLAUDE.md` piszą akapit w jednej linii, z HTML i gołymi URL-ami), a
`docs/.markdownlint.jsonc` trzyma 100 kolumn dla planów. Sprawdzenie:
`aby gate-check --lint . README.md .claude/CLAUDE.md` → 0 problemów.

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
- **Krótszy pasek** — ticket: brak → plan: pasek 6 kropek zamiast 10. Powód: prośba właściciela
  2026-11-16 przy okazji tego ticketu; detal bilansu wydłuża linię. Constraint: brak. Taski: 4.

## File Structure

- `hooks/savings.ts` (nowy) — czysty rachunek bilansu keep-warm: koszt requestu, uratowany
  powrót, netto; zależy od: `hooks/cache-timing.ts`, `types/index.d.ts`
- `types/index.d.ts` — typ `KeepWarmSavings`; pola `lastRealRequestAt`, `lastWarmPingAt` i
  `savings` w `PluginState` i w `KeepWarmSaved`; zależy od: brak
- `hooks/session-snapshot.ts` — te same trzy pola w `SessionSnapshot`; zależy od:
  `types/index.d.ts`
- `hooks/state.ts` — odczyt i zapis wartości sesji w `$.state`; dochodzą refy trzech pól; zależy
  od: `hooks/savings.ts` (`NO_SAVINGS`)
- `hooks/ping/ping-account.ts` (nowy) — zapis pingu w rachunku sesji: historia, koszt, czas
  ciepłego pingu; zależy od: `hooks/state.ts`, `hooks/savings.ts`, `hooks/cache-timing.ts`
- `hooks/ping/ping.ts` — niewidoczny ping zapisuje się przez `accountPing`; zależy od:
  `hooks/ping/ping-account.ts`
- `hooks/events/turn.ts` — prawdziwy request zapisuje swój czas i dolicza uratowany powrót;
  widoczny ping zapisuje się przez `accountPing`; zależy od: `hooks/savings.ts`,
  `hooks/state.ts`, `hooks/session-store.ts`, `hooks/ping/ping-account.ts`
- `hooks/events/session.ts` — `/clear` i kompakcja zerują znaczniki powrotu, nie bilans; zależy
  od: `hooks/state.ts`
- `hooks/line/bar-model.ts` (nowy) — pasek linii (czysty): liczba kropek i ile z nich wypełnia
  pozostały czas cache; zależy od: brak
- `hooks/line/line-model.ts` — treść linii (czysta): detale, czas, ton, przycisk; dochodzi detal
  bilansu za liczbą pingów; zależy od: `hooks/savings.ts`, `hooks/format.ts`,
  `hooks/line/bar-model.ts`
- `hooks/session-store.ts` — zapis i odtworzenie trzech pól; zależy od: `hooks/state.ts`,
  `hooks/savings.ts`
- `hooks/command.ts` — linia bilansu w `statusText`; zależy od: `hooks/savings.ts`,
  `hooks/format.ts`
- `tests/decisions.test.ts` — dowodzi rachunku bilansu, detalu linii i `statusText`; zależy od:
  `hooks/savings.ts`, `hooks/line/line-model.ts`, `hooks/command.ts`
- `tests/keep-warm.test.ts` — dowodzi bilansu na stub engine: ping, powrót, pauza, relaunch,
  `/clear`; zależy od: `tests/engine.ts`
- `tests/line.test.ts` — asercje linii z paskiem 6 kropek; zależy od: `tests/engine.ts`
- `README.md` — wiersz linii, `/keepwarm`, „What it reads”, „What it keeps”, przykład paska;
  zależy od: brak
- `.claude/CLAUDE.md` — `savings.ts` w układzie kodu, uzgodnione zachowanie bilansu, 6 kropek;
  zależy od: brak

---

## Task 1: Pocisk - bilans pingów i uratowanych powrotów w linii

**Pliki:**

- Utwórz: `hooks/line/bar-model.ts`
- Utwórz: `hooks/savings.ts`
- Utwórz: `hooks/ping/ping-account.ts`
- Zmodyfikuj: `hooks/line/line-view.tsx:4`
- Zmodyfikuj: `hooks/ping/ping.ts` (import, `recordPing`)
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
  - `BAR_CELLS` i `filledCells({ isWarm, remaining, ttlMs })` w `hooks/line/bar-model.ts`;
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

- [ ] **Krok 1: Wydziel pasek do `hooks/line/bar-model.ts` (refactor bez zmiany zachowania)**

`line-model.ts` decyduje o treści linii, a liczba kropek paska to osobna decyzja; wydziel ją,
zanim plik dostanie detal bilansu.

`hooks/line/bar-model.ts` (nowy):

```ts
// The line's bar: blocks that empty over the cache's life, the one gauge of the time left;
// filled blocks in the line's tone, outlined blocks for the time already gone.
export const BAR_CELLS = 10

export type BarTime = { isWarm: boolean, remaining: number, ttlMs: number }

// At least one block while the cache is warm, none once it is cold.
export function filledCells({ isWarm, remaining, ttlMs }: BarTime) {
  return isWarm ? Math.max(1, Math.ceil((remaining / ttlMs) * BAR_CELLS)) : 0
}
```

`hooks/line/line-model.ts`:

- usuń komentarz i stałą `BAR_CELLS` (linie 6-8);
- import: `import { filledCells } from './bar-model'`;
- w `lineModel` zastąp pole `filledCells` (wyrażenie z `BAR_CELLS`) linią:

```ts
    filledCells: filledCells(countdown),
```

`hooks/line/line-view.tsx:4` — zastąp
`import { BAR_CELLS, type LineModel, type LineTone } from './line-model'` dwoma importami:

```ts
import { BAR_CELLS } from './bar-model'
import type { LineModel, LineTone } from './line-model'
```

`.claude/CLAUDE.md`, „Code layout”: w liście czystych modułów dopisz `bar-model.ts` za
`line-model.ts`, a punkt `line/` zmień na:

```markdown
- `line/`: `line-model.ts` decides what the line says (pure), `bar-model.ts` how full its bar is (pure), `line-view.tsx` draws it.
```

- [ ] **Krok 2: Uruchom testy, zacommituj refactor**

```bash
claude plugin test . && git add hooks/line/bar-model.ts hooks/line/line-model.ts hooks/line/line-view.tsx .claude/CLAUDE.md && git commit -m "refactor: pasek linii w osobnym module bar-model.ts (ckw-0zj)"
```

Oczekiwany output: PASS wszystkich testów bez zmiany asercji; commit refactoru.

- [ ] **Krok 3: Napisz failing testy**

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

const PAID_BACK = { pings: 1, pingCost: 5_035, returns: 1, saved: 95_000 }
const NOT_PAID_BACK = { pings: 1, pingCost: 5_035, returns: 0, saved: 0 }
const OBSERVED_TTL = { ms: 10 * MINUTE, reason: 'observed' } as const

test('lineModel: a net saving reads "saved", after the ping count', async () => {
  expect(lineModel(snapshot({ isOn: true, savings: PAID_BACK })).details).toEqual(['󰁔 ping 10:52', 'saved 90k', '54k cached'])
})

test('lineModel: pings not paid back yet read "cost"', async () => {
  expect(lineModel(snapshot({ isOn: true, savings: NOT_PAID_BACK })).details).toContain('cost 5k')
})

test('lineModel: the account stays while keep-warm is paused', async () => {
  expect(lineModel(snapshot({ isOn: true, ttl: OBSERVED_TTL, shortAfterMs: 10 * MINUTE, savings: NOT_PAID_BACK })).details).toContain('cost 5k')
})

test('lineModel: no account while keep-warm is off', async () => {
  expect(lineModel(snapshot({ savings: PAID_BACK })).details).not.toContain('saved 90k')
})

test('lineModel: no account before the first ping', async () => {
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

test('a paused keep-warm still shows what its pings cost', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  engine.fork = { isAnswered: true, usage: WRITE }
  await clock.advance(52 * MINUTE + 15_000)
  expect(await line($)).toContain('keep-warm paused·cost 100k')
})
```

(Zimny ping zapisuje 50k na nowo: 100 035 → „cost 100k”. Kolejny tick przyjmuje krótszy cache i
wstrzymuje keep-warm, a koszt zostaje w linii.)

(Odpowiedź o 10:00, ping o 10:52, powrót o 11:10: 70 min od ostatniego prawdziwego requestu,
dłużej niż godzinny cache, a cache ciepły. Zysk 1,9 · 50k = 95k, minus 5 035 za ping, daje 90k.)

- [ ] **Krok 4: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — brak modułu `../hooks/savings`, a w `keep-warm.test.ts` linie bez
„cost 5k” i „saved 90k”.

- [ ] **Krok 5: Zaimplementuj minimalnie**

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

- import: `import { NO_SAVINGS } from './savings'`;
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

`appendPing` zostaje bez zmian (tylko historia pingów).

`hooks/ping/ping-account.ts` (nowy):

```ts
// A ping (invisible or visible) on the session's account: its place in the ping history, what it
// cost, and, when it found the cache warm, its time, which later tells a saved return.
import type { EngineInterface, ModelUsage } from 'claude-code'

import { isCacheHit } from '../cache-timing'
import { addPing } from '../savings'
import { appendPing, readSnapshot, writeSession } from '../state'

export async function accountPing($: EngineInterface, at: number, usage: ModelUsage) {
  await appendPing($, at, usage)
  const { savings } = await readSnapshot($)
  await writeSession($, { savings: addPing(savings, usage) })
  if (isCacheHit(usage)) await writeSession($, { lastWarmPingAt: at })
}
```

`hooks/ping/ping.ts`:

- import: usuń `appendPing` z importu `../state` i dopisz
  `import { accountPing } from './ping-account'`;
- w `recordPing` zastąp `await appendPing($, startedAt, usage)` linią
  `await accountPing($, startedAt, usage)`.

`hooks/events/turn.ts`:

- importy: `import { addSavedReturn, isSavedReturn } from '../savings'` i
  `import { accountPing } from '../ping/ping-account'`; usuń `appendPing` z importu `../state`;
- w `recordVisiblePing` zastąp `await appendPing($, live.visiblePingAt, usage)` linią
  `await accountPing($, live.visiblePingAt, usage)`;
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
- w `lineModel`, w tablicy `details`, wstaw `...savingsDetails(session),` między
  `...keepWarmDetails(session, countdown),` a `...cachedDetails(...)`. Nie w `keepWarmDetails`:
  ta funkcja wychodzi wcześniej przy wstrzymanym keep-warm (za krótki cache), a koszt pingów
  ma być widoczny także wtedy. Za liczbą pingów stoi więc nadal, bo `keepWarmDetails` kończy się
  na `pingCountDetails`;
- pod `pingCountDetails`:

```ts
// What keep-warm has saved in this session, once it has pinged; while no return has paid the
// pings back, what they cost. Shown while keep-warm is on, paused included.
function savingsDetails({ isOn, savings }: SessionSnapshot) {
  if (!isOn || savings.pings === 0) return []
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

  a w punkcie `ping/` za opisem `ping.ts` dopisz
  `` `ping-account.ts` puts a ping on the session's account (history, cost, last warm ping). ``

- „Behaviour agreed with the owner”, nowy punkt na końcu:

```markdown
- What keep-warm saved (ckw-0zj, owner's choices 2026-11-16): a ping costs its whole request (input 1, cache read 0.1, 1-hour write 2, output 5, in input-token equivalents); a real request after a break longer than the cache, with a warm ping since the last real one, that finds the cache warm saves 1.9x what it read. The line shows the net ("saved 90k", "cost 5k") after the ping count, while keep-warm is on (paused included); `/keepwarm status` shows the whole account once keep-warm has pinged. The account lives for the whole session, through `/clear`, compactions and relaunches.
```

- [ ] **Krok 6: Uruchom, potwierdź pass**

```bash
claude plugin test . && claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: PASS wszystkich testów; walidacja bez błędów.

- [ ] **Krok 7: Commit**

```bash
git add hooks/savings.ts hooks/ping/ping-account.ts hooks/ping/ping.ts types/index.d.ts hooks/session-snapshot.ts hooks/state.ts hooks/events/turn.ts hooks/line/line-model.ts tests/decisions.test.ts tests/keep-warm.test.ts README.md .claude/CLAUDE.md && git commit -m "ckw-0zj: bilans keep-warm w pasku (koszt pingów, uratowane powroty)"
```

---

## Task 2: Bilans przetrwa relaunch i /clear

**Pliki:**

- Zmodyfikuj: `types/index.d.ts:1-6`
- Zmodyfikuj: `hooks/session-store.ts:16-51`
- Zmodyfikuj: `hooks/events/turn.ts` (`finishRequest`)
- Zmodyfikuj: `hooks/events/session.ts:52-58` (`startOver`)
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

test('a return after /clear is no saved return: the ping warmed the conversation before it', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  await clock.advance(70 * MINUTE)
  await $.classic.SessionStart({ session_id: 'S1', transcript_path: '/t', cwd: '/work', hook_event_name: 'SessionStart', source: 'clear' } as any)
  await answer($, engine, READ)
  expect(await line($)).toContain('cost 5k')
})
```

Przebieg pierwszego testu:

- przed relaunchem: prawdziwy request o 8:50, ciepły ping o 9:50 (`SAVED_ON.lastRequestAt`);
  bilans 95k − 15 105 ≈ 80k;
- o 10:00, po relaunchu i bez nowego pingu, wraca użytkownik: od 8:50 minęło 70 min, a ping
  był po tym requeście;
- wynik: +1 powrót (+95k).

Drugi test pilnuje decyzji „nigdy nie zeruj w sesji” i przechodzi już po Tasku 1. Trzeci: ping
o 10:52 ogrzał rozmowę sprzed `/clear` (11:10), więc odczyt cache po nim nie jest uratowanym
powrotem.

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL w
`'a ping before a relaunch and a return after it: the saving counts and is kept'` (linia bez
„saved 80k”) i w `'a return after /clear is no saved return: …'` (linia z „saved 90k”).

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

`hooks/events/session.ts` — `startOver` zeruje też znaczniki powrotu (bilans zostaje):

```ts
// The conversation starts over (cleared, or replaced by its summary): nothing of it is cached
// until the next request writes it, and no ping has kept the new one warm yet. What keep-warm
// cost and saved stays for the session.
export async function startOver($: EngineInterface) {
  await writeSession($, {
    lastRequestAt: 0, pings: [], sawResponse: false, contextTokens: 0, pingError: '', now: await $.clock.now(),
    lastRealRequestAt: 0, lastWarmPingAt: 0,
  })
  live.roomChecked = false
  await saveIfRestored($)
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
git add types/index.d.ts hooks/session-store.ts hooks/events/turn.ts hooks/events/session.ts tests/keep-warm.test.ts README.md && git commit -m "ckw-0zj: bilans keep-warm przetrwa relaunch i /clear"
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
test('statusText: pings, saved returns, cost and a net saving', async () => {
  const savings = { pings: 3, pingCost: 15_105, returns: 1, saved: 95_000 }
  expect(statusText(snapshot({ savings }), 8).split('\n')).toContain('This session: 3 pings cost 15k, 1 return to a warm cache saved 95k: 80k saved (input-token equivalents).')
})

test('statusText: pings not paid back yet are spent', async () => {
  const savings = { pings: 1, pingCost: 5_035, returns: 0, saved: 0 }
  expect(statusText(snapshot({ savings }), 8).split('\n')).toContain('This session: 1 ping cost 5k, 0 returns to a warm cache saved 0k: 5k spent (input-token equivalents).')
})

test('statusText: no account before the first ping', async () => {
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

---

## Task 4: Krótszy pasek - 6 kropek zamiast 10

**Pliki:**

- Zmodyfikuj: `hooks/line/bar-model.ts` (`BAR_CELLS`)
- Zmodyfikuj: `README.md:106`
- Zmodyfikuj: `.claude/CLAUDE.md` (sekcja „Behaviour agreed with the owner”, punkt „The line”)
- Test: `tests/line.test.ts`, `tests/keep-warm.test.ts`, `tests/decisions.test.ts`

**Interfejsy:**

- Konsumuje: `BAR_CELLS` w `hooks/line/line-view.tsx` (rysuje `filledCells` pełnych i
  `BAR_CELLS - filledCells` pustych kropek; bez zmian).
- Produkuje: `BAR_CELLS = 6`.

**Wzorce:**

- `hooks/line/bar-model.ts` (`filledCells`, Task 1) — `max(1, ceil(pozostało / TTL · BAR_CELLS))` przy
  ciepłym cache, 0 przy zimnym.

**Reguły stosowalne:**

- `dok-ten-sam-commit` — przykład paska w README i opis linii w `.claude/CLAUDE.md` w commicie
  tasku.

**Tryb wykonania (rekomendacja):** inline-batch — zmiana jednej stałej i mechaniczna wymiana
asercji.

**Wykonawca (rekomendacja):** claude / cheap — podmiana ciągów według tabeli.

- [ ] **Krok 1: Napisz failing testy**

Każdy pasek w asercjach `tests/line.test.ts` i `tests/keep-warm.test.ts` (także w testach
dopisanych w Taskach 1-2) zamień według tabeli. Wartości wynikają ze wzoru `filledCells` przy
6 kropkach: 60, 59, 58 min z 60 → 6; 50, 49, 46 min z 60 i 4 min z 5 → 5; 40 min → 4;
20 min → 2; 7 i 5 min → 1; zimny lub pusty cache → 0.

| 10 kropek    | 6 kropek |
| ------------ | -------- |
| `••••••••••` | `••••••` |
| `•••••••••·` | `•••••·` |
| `••••••••··` | `•••••·` |
| `•••••••···` | `••••··` |
| `••••······` | `••····` |
| `••········` | `•·····` |
| `•·········` | `•·····` |
| `··········` | `······` |

```bash
bun -e 'const m={"••••••••••":"••••••","•••••••••·":"•••••·","••••••••··":"•••••·","•••••••···":"••••··","••••······":"••····","••········":"•·····","•·········":"•·····","··········":"······"};for(const f of ["tests/line.test.ts","tests/keep-warm.test.ts"]){const t=await Bun.file(f).text();await Bun.write(f,t.replace(/[•·]{10}/g,s=>m[s]??s))}'
```

W `tests/decisions.test.ts:127` zmień `filledCells: 10` na `filledCells: 6`.

Sprawdź, że nie został żaden 10-kropkowy pasek (oczekiwany pusty wynik):

```bash
rg -n '[•·]{10}' tests/
```

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — linie mają jeszcze 10 kropek, `filledCells` wynosi 10.

- [ ] **Krok 3: Zaimplementuj minimalnie**

`hooks/line/bar-model.ts`: `export const BAR_CELLS = 10` → `export const BAR_CELLS = 6`.

`README.md:106`: `**40 min left •••••••···**` → `**40 min left ••••··**`.

`.claude/CLAUDE.md`, punkt „The line”: `the 10 dots` → `the 6 dots (10 until ckw-0zj, owner's
choice 2026-11-16: shorter)`.

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test .
```

Oczekiwany output: PASS wszystkich testów.

- [ ] **Krok 5: Commit**

```bash
git add hooks/line/bar-model.ts tests/line.test.ts tests/keep-warm.test.ts tests/decisions.test.ts README.md .claude/CLAUDE.md && git commit -m "ckw-0zj: krótszy pasek, 6 kropek"
```
