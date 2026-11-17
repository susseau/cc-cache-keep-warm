# Cisza nocna i tick co minutę - plan implementacji (ckw-eg7)

**Cel:** Keep-warm nie pinguje w godzinach ciszy (domyślnie 21:30–08:00) bez jawnego czasu stopu,
mówi o tym w linii i statusie, sprawdza stan co pełną minutę, a domyślna seria to 6 pingów.

**Architektura:** Nowy czysty moduł `hooks/quiet-hours.ts` czyta opcje do typu `QuietHours`;
`isQuiet` w `decide-ping.ts` rozstrzyga, czy chwila wypada w ciszy; słowa stoją przy innych słowach
(`clockOfDay` w `format.ts`, `quietNotUnderstood` w `command.ts`). `decidePing` dostaje krok
`'quiet'`, `lineModel` i `statusText` czytają ciszę ze `SessionSnapshot` (z `live.quiet`). Tick
startuje (`hooks/ping/ticking.ts`) na pełnej minucie przez `$.clock.after`, potem
`$.clock.every(60 s)`.

**Stack:** TypeScript, mod Claude Code 2.1.325 (`$.clock`, `$.ui.toast`, `userConfig`), kit
`claude plugin test`.

**Spec:** `docs/specs/2026-11-16-ckw-eg7-cisza-nocna.md`

## Global constraints

- Nigdy nie pinguj zimnego cache.
- Jedno lokalne sprawdzenie na tick, linia odrysowana najwyżej raz na minutę, żadnego wywołania
  modelu poza pingiem.
- `$.state` tylko przez `state.ts`; matcher i klucze opcji to literały (walidator).
- Decyzje w modułach czystych (bez `$`): `decide-ping.ts`, `line-model.ts`, `command.ts`
  (`statusText`), nowe parsowanie zakresu.
- `claude plugin validate --strict` (marketplace i plugin) przechodzi.

## Odstępstwa

- **Podział modułu ciszy** — spec: `hooks/quiet-hours.ts` ma `parseQuietHours`, `isQuiet`,
  `formatQuietRange`, `formatQuietEnd` → plan: `quiet-hours.ts` ma tylko typy i
  `parseQuietHours`; `isQuiet` jest w `hooks/ping/decide-ping.ts`, godzinę z minut daje
  `clockOfDay` w `hooks/format.ts`, a zakres i koniec składają z niej `statusText` i linia.
  Powód: jedna odpowiedzialność na plik (decyzja właściciela 2026-11-17). Constraint: brak.
  Taski: 1, 2.
- **Która opcja jest błędna** — spec: `QuietInvalid = { kind: 'invalid', text }` → plan:
  `{ kind: 'invalid', setting: 'switch' | 'range', text }`; komunikat (`quietNotUnderstood` w
  `hooks/command.ts`) nazywa błędną opcję i jej format (`true or false` albo `HH:MM-HH:MM`).
  Powód: wskazówka formatu zakresu przy błędnym przełączniku prowadzi do złej opcji. Constraint:
  brak. Taski: 1, 2.
- **Cisza na minucie pingu** — spec: krok 3 `decidePing` sprawdza `isQuiet(now, quiet)` → plan:
  `isQuiet(fullMinuteFrom(now), quiet)`, a linia sprawdza tę samą pełną minutę. Powód: pierwszy
  tick po starcie (np. 21:29:40) nie może wysłać pingu, który linia zapowiada jako wstrzymany
  ciszą od 21:30. Constraint: brak. Taski: 1, 2.
- **Gdzie startują tick i toast** — spec: start ticku w `hooks/ping/schedule.ts` /
  `hooks/events/session.ts`, toast o błędnej opcji przy starcie sesji → plan: start ticku w nowym
  `hooks/ping/ticking.ts` (`startTicking`), toast w nowym `hooks/quiet-notice.ts`
  (`noticeUnreadQuiet`); `session.ts` tylko je woła. Powód: jedna odpowiedzialność na plik
  (decyzja właściciela 2026-11-17). Constraint: brak. Taski: 2, 3.

## File Structure

- `hooks/quiet-hours.ts` (nowy) — odczyt opcji ciszy do wartości: typ `QuietHours`,
  `parseQuietHours`; czysty; zależy od: brak
- `hooks/ping/decide-ping.ts` — `isQuiet`, `fullMinuteFrom` i krok `'quiet'` w `decidePing`;
  zależy od: `hooks/quiet-hours.ts`, `hooks/cache-timing.ts`
- `hooks/ping/schedule.ts` — `case 'quiet'` w `keepWarm`; traci `TICK_MS`; zależy od:
  `hooks/ping/decide-ping.ts`
- `hooks/ping/ping.ts` — ponowienie po 60 s; zależy od: brak
- `hooks/ping/ticking.ts` (nowy) — start ticku na pełnej minucie (`startTicking`, `TICK_MS`);
  zależy od: `hooks/cache-timing.ts`, `hooks/ping/schedule.ts`
- `hooks/quiet-notice.ts` (nowy) — toast o nieczytelnej opcji ciszy (`noticeUnreadQuiet`); zależy
  od: `hooks/command.ts`, `hooks/state.ts`
- `hooks/events/session.ts` — rola bez zmian (start sesji): woła `noticeUnreadQuiet` i
  `startTicking` zamiast własnego kodu; zależy od: `hooks/quiet-notice.ts`,
  `hooks/ping/ticking.ts`
- `hooks/register.tsx` — czyta opcje `quiet_hours` i `quiet_range` do `live.quiet`; zależy od:
  `hooks/quiet-hours.ts`
- `hooks/state.ts` — `live.quiet`, `quiet` w `readSnapshot`; zależy od: `hooks/quiet-hours.ts`
- `hooks/session-snapshot.ts` — pole `quiet: QuietHours`; zależy od: `hooks/quiet-hours.ts`
- `hooks/format.ts` — `clockOfDay` (godzina z minut od północy); zależy od: brak
- `hooks/line/line-model.ts` — detal ciszy, ton `stalled`, termin pingu na pełnej minucie; zależy
  od: `hooks/quiet-hours.ts`, `hooks/ping/decide-ping.ts`, `hooks/format.ts`,
  `hooks/cache-timing.ts`
- `hooks/command.ts` — linia ciszy w `statusText`, `quietNotUnderstood`; zależy od:
  `hooks/quiet-hours.ts`, `hooks/format.ts`
- `hooks/cache-timing.ts` — `DEFAULT_MAX_PINGS = 6`; zależy od: brak
- `.claude-plugin/plugin.json` — opcje `quiet_hours`, `quiet_range`; `max_pings` domyślnie 6;
  zależy od: brak
- `tests/decisions.test.ts` — parser, `isQuiet`, `decidePing`, `lineModel`, `statusText`,
  `pingLimit`; zależy od: `hooks/quiet-hours.ts`, `hooks/ping/decide-ping.ts`,
  `hooks/line/line-model.ts`, `hooks/command.ts`, `hooks/cache-timing.ts`
- `tests/savings.test.ts` — helper `snapshot()` dostaje `quiet`; zależy od:
  `hooks/session-snapshot.ts`
- `tests/keep-warm.test.ts` — cisza przez silnik-atrapę, tick na minucie, retry 60 s, 6 pingów;
  zależy od: `tests/engine.ts`
- `README.md` — opcje, linia, tick co minutę, 6 pingów, „What it reads”; zależy od: brak
- `.claude/CLAUDE.md` — układ kodu, `$.clock`, uzgodnione zachowanie; zależy od: brak

---

## Task 1: Cisza blokuje ping (pocisk)

Definicja trafienia: z domyślnymi opcjami sesja z requestem o 07:00 nie dostaje pingu o 07:52,
keep-warm zostaje włączony, a po requeście o 08:10 ping wychodzi o 09:02.

**Pliki:**

- Utwórz: `hooks/quiet-hours.ts`
- Zmodyfikuj: `hooks/ping/decide-ping.ts`
- Zmodyfikuj: `hooks/ping/schedule.ts`
- Zmodyfikuj: `hooks/session-snapshot.ts`
- Zmodyfikuj: `hooks/state.ts`
- Zmodyfikuj: `hooks/register.tsx`
- Zmodyfikuj: `.claude-plugin/plugin.json`
- Zmodyfikuj: `README.md`
- Zmodyfikuj: `.claude/CLAUDE.md`
- Test: `tests/decisions.test.ts`
- Test: `tests/savings.test.ts`
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `decidePing(check: PingCheck): PingStep` i `PingCheck` z
  `hooks/ping/decide-ping.ts`; `live`, `readSnapshot` z `hooks/state.ts`; `SessionSnapshot` z
  `hooks/session-snapshot.ts`.
- Produkuje (`hooks/quiet-hours.ts`):
  - `type QuietHours = QuietOff | QuietOn | QuietInvalid`, gdzie `QuietOff = { kind: 'off' }`,
    `QuietOn = { kind: 'on', startMin: number, endMin: number }`,
    `QuietInvalid = { kind: 'invalid', setting: 'switch' | 'range', text: string }`
    (`setting`: która opcja jest błędna);
  - `parseQuietHours(isOn: unknown, range: unknown): QuietHours`.
- Produkuje (`hooks/ping/decide-ping.ts`): `isQuiet(ms: number, quiet: QuietHours): boolean`,
  `fullMinuteFrom(ms: number): number` (pełna minuta, o której wyjdzie ping należny w `ms`).
- Produkuje też: `PingCheck.quiet: QuietHours`, `PingStep` z `'quiet'`,
  `SessionSnapshot.quiet: QuietHours`, `live.quiet: QuietHours`.

**Wzorce:**

- `hooks/command.ts` (`parseStop`) - czysta funkcja parsująca tekst opcji regexem, czas lokalny
  przez `Date#setHours`/`getHours`.
- `hooks/cache-timing.ts` (`pingLimit`) - opcja `unknown` z `register.tsx` zamieniana na wartość
  domenową w czystej funkcji.
- `hooks/register.tsx:17-24` - klucz opcji jako stała obok pozostałych, odczyt do `live`.
- `tests/decisions.test.ts` (`check()`, `snapshot()`) - helpery z polami domyślnymi i `...fields`.

**Reguły stosowalne:**

- `modul-odczyt-decyzja-render` — odczyt opcji w czystym `quiet-hours.ts`, decyzja `isQuiet` w
  `decide-ping.ts`; `register.tsx` tylko czyta opcje, `schedule.ts` tylko wykonuje krok.
- `pokayoke-walidacja-wejscia` — opcje walidowane na granicy (`register`), dalej płynie typ
  `QuietHours`, nie surowy tekst.
- `pokayoke-bledy-niemozliwe` — unia z `kind` zamiast flag; `invalid` niesie tekst do komunikatu.
- `bledy-bez-null` — parser zwraca `invalid` zamiast `null`/wyjątku.
- `nazwy-czesci-mowy` — predykat `isQuiet`, akcja `parse…`, typ rzeczownikiem.
- `tdd-test-najpierw` — Kroki 1-2 przed kodem.
- `dok-ten-sam-commit` — README (opcje, „What it reads”, FAQ) i `.claude/CLAUDE.md` w tym commicie.

**Tryb wykonania (rekomendacja):** subagent-per-task — samodzielny pionowy slice z własnym testem.

**Wykonawca (rekomendacja):** claude / standard — typowa implementacja z testami w znanym wzorcu.

- [ ] **Krok 1: Napisz failing test**

W `tests/decisions.test.ts` import z `../hooks/ping/decide-ping` zmień na poniższy i dopisz po nim
import z `../hooks/quiet-hours`:

```ts
import { decidePing, isQuiet, isTooFullForVisiblePing, type PingCheck } from '../hooks/ping/decide-ping'
import { parseQuietHours } from '../hooks/quiet-hours'
```

Po stałej `HOUR` (linia 13) dodaj:

```ts
// The quiet hours the kit runs with (it cannot pass options): 21:30–08:00.
const QUIET = parseQuietHours(undefined, undefined)
// A clock time on the stub's day, in local time like the quiet hours.
const at = (hours: number, mins = 0) => new Date(2026, 10, 13, hours, mins).getTime()
```

W helperze `check()` dopisz `quiet: QUIET,` przed `...fields`, w helperze `snapshot()` też
`quiet: QUIET,` przed `...fields`. Po teście `decidePing: the stops, and the visible ping` dodaj:

```ts
test('parseQuietHours: the default, off, a range to the minute, and what it cannot read', async () => {
  expect(QUIET).toEqual({ kind: 'on', startMin: 21 * 60 + 30, endMin: 8 * 60 })
  expect(parseQuietHours(true, '22:00-7:30')).toEqual({ kind: 'on', startMin: 22 * 60, endMin: 7 * 60 + 30 })
  expect(parseQuietHours(undefined, ' 1:05 - 6:45 ')).toEqual({ kind: 'on', startMin: 65, endMin: 6 * 60 + 45 })
  expect(parseQuietHours(false, 'nights')).toEqual({ kind: 'off' })
  expect(parseQuietHours(true, '24:00-08:00')).toEqual({ kind: 'invalid', setting: 'range', text: '24:00-08:00' })
  expect(parseQuietHours(true, '21:60-08:00')).toEqual({ kind: 'invalid', setting: 'range', text: '21:60-08:00' })
  expect(parseQuietHours(true, '08:00-08:00')).toEqual({ kind: 'invalid', setting: 'range', text: '08:00-08:00' })
  expect(parseQuietHours(true, 'nights')).toEqual({ kind: 'invalid', setting: 'range', text: 'nights' })
  expect(parseQuietHours(true, 2130)).toEqual({ kind: 'invalid', setting: 'range', text: '2130' })
  expect(parseQuietHours('yes', '21:30-08:00')).toEqual({ kind: 'invalid', setting: 'switch', text: 'yes' })
})

test('isQuiet: from the start, up to the end, across midnight or not; an unread setting is always quiet', async () => {
  expect(isQuiet(at(21, 29), QUIET)).toEqual(false)
  expect(isQuiet(at(21, 30), QUIET)).toEqual(true)
  expect(isQuiet(at(3), QUIET)).toEqual(true)
  expect(isQuiet(at(7, 59), QUIET)).toEqual(true)
  expect(isQuiet(at(8), QUIET)).toEqual(false)
  const lunch = parseQuietHours(true, '12:00-13:00')
  expect(isQuiet(at(12, 30), lunch)).toEqual(true)
  expect(isQuiet(at(13), lunch)).toEqual(false)
  expect(isQuiet(at(3), lunch)).toEqual(false)
  expect(isQuiet(at(3), { kind: 'off' })).toEqual(false)
  expect(isQuiet(at(12), { kind: 'invalid', setting: 'range', text: 'nights' })).toEqual(true)
})

test('decidePing: no ping in the quiet hours unless a stop time was given', async () => {
  const evening = { lastRequestAt: at(20, 38), now: at(21, 30) }
  expect(decidePing(check(evening))).toEqual('quiet')
  expect(decidePing(check({ ...evening, pingsInRow: 6 }))).toEqual('quiet')
  expect(decidePing(check({ ...evening, stopAt: at(23) }))).toEqual('ping')
  expect(decidePing(check({ ...evening, stopAt: at(21) }))).toEqual('stop-at-time')
  // 21:29:40, the first check after a start: the minute the line names, 21:30, is quiet.
  expect(decidePing(check({ lastRequestAt: at(20, 37) + 30_000, now: at(21, 29) + 40_000 }))).toEqual('quiet')
  expect(decidePing(check({ lastRequestAt: at(21), now: at(21, 30) }))).toEqual('none')
  expect(decidePing(check({ quiet: { kind: 'invalid', setting: 'range', text: 'nights' } }))).toEqual('quiet')
})
```

W `tests/savings.test.ts` dopisz import `import { parseQuietHours } from '../hooks/quiet-hours'`
i w helperze `snapshot()` pole `quiet: parseQuietHours(undefined, undefined),` przed `...fields`.

W `tests/keep-warm.test.ts` po teście `a real turn starts the pings in a row over` dodaj:

```ts
test('no ping in the quiet hours; keep-warm stays on and pings again after a morning request', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  // 07:00 the next day, before the session starts: no check runs yet.
  await clock.advance(21 * 60 * MINUTE)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  // The ping would have gone out at 07:52, inside the default quiet hours (21:30–08:00).
  await clock.advance(70 * MINUTE)
  expect(engine.forks).toEqual(0)
  expect((await keepwarm($, 'status')).split('\n')[0]).toContain('Keep-warm on')
  await answer($, engine, WRITE)
  await clock.advance(52 * MINUTE)
  expect(engine.forks).toEqual(1)
})
```

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — pliki `decisions.test.ts` i `savings.test.ts` nie ładują się
(`../hooks/quiet-hours` nie istnieje, `decide-ping` nie eksportuje `isQuiet`), test `no ping in
the quiet hours…` daje `expect(engine.forks).toEqual(0)` z wartością 1.

- [ ] **Krok 3: Zaimplementuj minimalnie**

Utwórz `hooks/quiet-hours.ts`:

```ts
// Quiet hours: the local times of day keep-warm sends no ping without a stop time, read from the
// plugin's options into a value. Pure: the options come in from register.tsx.
export type QuietOff = { kind: 'off' }
// Minutes since local midnight; the range runs across midnight when the start is later.
export type QuietOn = { kind: 'on', startMin: number, endMin: number }
// A setting that could not be read: no ping until it is fixed, never a silent fallback.
export type QuietInvalid = { kind: 'invalid', setting: 'switch' | 'range', text: string }
export type QuietHours = QuietOff | QuietOn | QuietInvalid

const DEFAULT_RANGE = '21:30-08:00'
const RANGE = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/
const HOUR_MIN = 60

// The `quiet_hours` switch and the `quiet_range` text as they come from the plugin's options.
export function parseQuietHours(isOn: unknown, range: unknown): QuietHours {
  if (isOn === false) return { kind: 'off' }
  if (isOn !== undefined && isOn !== true) return { kind: 'invalid', setting: 'switch', text: String(isOn) }
  return parseRange(range ?? DEFAULT_RANGE)
}

function parseRange(range: unknown): QuietHours {
  const invalid: QuietInvalid = { kind: 'invalid', setting: 'range', text: String(range) }
  const match = typeof range === 'string' ? RANGE.exec(range) : undefined
  if (!match) return invalid
  const startMin = minuteOfDay(match[1], match[2])
  const endMin = minuteOfDay(match[3], match[4])
  if (startMin < 0 || endMin < 0 || startMin === endMin) return invalid
  return { kind: 'on', startMin, endMin }
}

// Minutes since midnight; -1 for an hour or a minute past the clock's.
function minuteOfDay(hours: string, mins: string) {
  const [h, m] = [Number(hours), Number(mins)]
  return h <= 23 && m <= 59 ? h * HOUR_MIN + m : -1
}
```

W `hooks/ping/decide-ping.ts`:

```ts
import type { QuietHours } from '../quiet-hours'
```

do importu z `../cache-timing` dopisz `MINUTE_MS`, po importach dodaj stałą, a za
`isInPingWindow` dwie funkcje:

```ts
const HOUR_MIN = 60
```

```ts
// Whether a moment falls in the quiet hours, in local time; a setting that could not be read
// counts as quiet all day, so nothing goes out until it is fixed.
export function isQuiet(ms: number, quiet: QuietHours) {
  if (quiet.kind === 'off') return false
  if (quiet.kind === 'invalid') return true
  const at = new Date(ms)
  const minute = at.getHours() * HOUR_MIN + at.getMinutes()
  const { startMin, endMin } = quiet
  return startMin < endMin ? minute >= startMin && minute < endMin : minute >= startMin || minute < endMin
}

// The tick runs on the full minute: a ping due at this moment goes out at this full minute or the
// first one after it. The quiet check and the line both look at that minute, so they agree.
export function fullMinuteFrom(ms: number) {
  return Math.ceil(ms / MINUTE_MS) * MINUTE_MS
}
```

do `PingCheck` dopisz pole `quiet: QuietHours` (po `nearlyFull`), typ kroku i decyzję zmień na:

```ts
// `blocked`: the visible ping is due but would not fit; nothing goes out, the window is held.
// `quiet`: the ping is due in the quiet hours without a stop time; nothing goes out.
export type PingStep = 'none' | 'stop-at-time' | 'stop-after-max' | 'quiet' | 'ping' | 'visible-ping' | 'blocked'

// One check of a session with keep-warm on. A stop time overrides the quiet hours.
export function decidePing(check: PingCheck): PingStep {
  if (check.stopAt > 0 && check.now >= check.stopAt) return 'stop-at-time'
  if (!isInPingWindow(check) || check.now < check.pendingUntil) return 'none'
  if (check.stopAt === 0 && isQuiet(fullMinuteFrom(check.now), check.quiet)) return 'quiet'
  if (check.stopAt === 0 && check.pingsInRow >= check.maxPings) return 'stop-after-max'
  if (!check.needsVisible) return 'ping'
  return check.nearlyFull ? 'blocked' : 'visible-ping'
}
```

W `hooks/session-snapshot.ts` dopisz `import type { QuietHours } from './quiet-hours'` i pole
`quiet: QuietHours` na końcu typu `SessionSnapshot`.

W `hooks/state.ts`: import `import { parseQuietHours, type QuietHours } from './quiet-hours'`; w
komentarzu nad `live` zdanie o opcjach zmień na „…so it is read once in register(), like
`defaultOn` ("On in new sessions"), `maxPings` ("Pings in a row") and `quiet` (the quiet
hours).”; do typu `live` pole `quiet: QuietHours`, do wartości `quiet: parseQuietHours(undefined,
undefined),`; w `readSnapshot` po `savings: …` dopisz `quiet: live.quiet,`.

W `hooks/register.tsx`: komentarz nad stałymi zmień na „The userConfig keys in plugin.json: the
title mark, keep-warm on in every new session, how many pings in a row before keep-warm stops
itself, and the quiet hours (a switch and a range).”; dopisz stałe i odczyt:

```ts
import { parseQuietHours } from './quiet-hours'
```

```ts
const QUIET_HOURS_OPTION = 'quiet_hours'
const QUIET_RANGE_OPTION = 'quiet_range'
```

```ts
  live.quiet = parseQuietHours(options[QUIET_HOURS_OPTION], options[QUIET_RANGE_OPTION])
```

W `hooks/ping/schedule.ts` w `keepWarm` dopisz `quiet: session.quiet` do argumentu `decidePing`, a
w `switch` zamień `case 'none':` na:

```ts
    case 'none':
    case 'quiet':
      // In the quiet hours nothing goes out and nothing is held: keep-warm stays on, the cache
      // expires, and the next real request starts the countdown again.
      return
```

W `.claude-plugin/plugin.json` w `userConfig` po `max_pings` dopisz:

```json
    "quiet_hours": {
      "type": "boolean",
      "title": "Quiet hours",
      "description": "Without a stop time, keep-warm sends no ping in the quiet hours: the cache expires, and after your next message keep-warm carries on",
      "default": true
    },
    "quiet_range": {
      "type": "string",
      "title": "Quiet hours range",
      "description": "The quiet hours in your local time, HH:MM-HH:MM; they may run past midnight",
      "default": "21:30-08:00"
    }
```

W `README.md` w tabeli „Settings” po wierszu „Pings in a row” dopisz:

```markdown
| Quiet hours | On | Without a stop time, keep-warm sends no ping in the quiet hours: the cache expires, and after your next message keep-warm carries on. A stop time (`/keepwarm 3h`, `/keepwarm until 23:30`) overrides them |
| Quiet hours range | 21:30-08:00 | The quiet hours in your local time, `HH:MM-HH:MM`; they may run past midnight. A value keep-warm cannot read means no pings until you fix it |
```

W FAQ (linia 176) po zdaniu kończącym się „`/keepwarm until 18:00`.” dopisz: „It also sends no
ping in the quiet hours (21:30–08:00 by default) unless you gave it a stop time.” W sekcji „What
it reads” przed punktem „**The clock.**” dopisz punkt: „- **Its own settings**: the ones in the
table above, quiet hours included.”, a punkt „**The clock.**” zmień na „**The clock**, and its
local time of day for the quiet hours.”

W `.claude/CLAUDE.md`: w punkcie `register.tsx` zamień „the three userConfig options” na „the
five userConfig options”; w liście modułów czystych po `session-snapshot.ts` dopisz
`quiet-hours.ts`, a po punkcie `cache-timing.ts` punkt „- `quiet-hours.ts`: the quiet-hours
options read into a value (`parseQuietHours`).”; w punkcie `ping/` zamień „`decide-ping.ts`
decides when and which ping (pure)” na „`decide-ping.ts` decides when and which ping, quiet hours
included (`isQuiet`; pure)”; w sekcji „Behaviour agreed with the owner” po punkcie „In a row”
dopisz:

```markdown
- Quiet hours (ckw-eg7, owner's choices 2026-11-16): `quiet_hours` (on by default) and `quiet_range` (`21:30-08:00`, local time, to the minute, may cross midnight), parsed in `quiet-hours.ts`. Without a stop time no ping, invisible or visible, goes out in them (`decidePing` step `quiet`); keep-warm stays on, the cache expires, and the first real request after them starts the countdown again: a cold cache is never pinged. A stop time (`/keepwarm 3h`, `until 23:30`) overrides them. No margin before them: a ping just before or just after, to a warm cache, is fine. A setting it cannot read means no pings until it is fixed, never a silent fallback. The title dot stays (it marks the switch). Suggesting the range from the session history: ckw-hs6.
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . &&
  claude plugin validate --strict . &&
  claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: wszystkie testy `pass`, `0 fail`; obie walidacje bez błędów i ostrzeżeń.

- [ ] **Krok 5: Commit**

```bash
git add hooks/quiet-hours.ts hooks/ping/decide-ping.ts hooks/ping/schedule.ts hooks/session-snapshot.ts hooks/state.ts hooks/register.tsx .claude-plugin/plugin.json README.md .claude/CLAUDE.md tests/decisions.test.ts tests/savings.test.ts tests/keep-warm.test.ts &&
  git commit -m "ckw-eg7: cisza nocna blokuje ping bez jawnego stopu"
```

---

## Task 2: Linia, status i błędna opcja mówią o ciszy

Definicja trafienia: po requeście o 20:45 linia mówi `󰁔 no ping: quiet hours to 08:00` z czasem
wygaśnięcia; `/keepwarm status` podaje zakres; widoczny ping po relaunchu też nie wychodzi w
ciszy.

**Pliki:**

- Zmodyfikuj: `hooks/format.ts`
- Zmodyfikuj: `hooks/line/line-model.ts`
- Zmodyfikuj: `hooks/command.ts`
- Utwórz: `hooks/quiet-notice.ts`
- Zmodyfikuj: `hooks/events/session.ts`
- Zmodyfikuj: `README.md`
- Zmodyfikuj: `.claude/CLAUDE.md`
- Test: `tests/decisions.test.ts`
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: typy `QuietHours`, `QuietInvalid` z `hooks/quiet-hours.ts`; `isQuiet`,
  `fullMinuteFrom` z `hooks/ping/decide-ping.ts`; `SessionSnapshot.quiet`;
  `live.quiet` z `hooks/state.ts` (Task 1).
- Produkuje: `clockOfDay(minuteOfDay: number): string` w `hooks/format.ts` (`"08:00"`);
  `quietNotUnderstood(quiet: QuietInvalid): string` w `hooks/command.ts`;
  `noticeUnreadQuiet($: EngineInterface): void` w `hooks/quiet-notice.ts`; zmienia teksty
  `lineModel(...).details` i `statusText(session, maxPings)`.

**Wzorce:**

- `hooks/line/line-model.ts` (`isBlocked`, `nextPingDetails`) - stan „włączony, ale nie trzyma
  cache” jako predykat wpięty w `isKeepingWarm`, detal zwracany w `nextPingDetails`.
- `hooks/command.ts` (`savingsLine`) - prywatna funkcja składająca jedną linię statusu.
- `tests/keep-warm.test.ts` (`SAVED_ON`, `a reopened session carries the countdown on…`) - sesja
  zapisana w store przed startem.

**Reguły stosowalne:**

- `modul-odczyt-decyzja-render` — tekst i ton linii decyduje czysty `line-model.ts`; `quiet-notice.ts`
  tylko wyświetla toast z tekstem z `command.ts`.
- `funkcja-krotka` — termin pingu (`nextPingAt`) i warunek ciszy (`isHeldByQuiet`) jako osobne
  funkcje zamiast rozbudowy `nextPingDetails`.
- `tdd-jedna-intencja` — osobne testy: detal linii, status, widoczny ping.
- `dok-ten-sam-commit` — wiersze linii w README i zdanie w `.claude/CLAUDE.md` w tym commicie.

**Tryb wykonania (rekomendacja):** subagent-per-task — izolowana warstwa prezentacji z własnymi
testami.

**Wykonawca (rekomendacja):** claude / standard — rozbudowa istniejących czystych funkcji według
wzorca.

- [ ] **Krok 1: Napisz failing test**

W `tests/decisions.test.ts` dopisz `type QuietHours` do importu z `../hooks/quiet-hours` i po
teście `lineModel: keeping while on and able to ping, stalled while on and not, off while off`
dodaj:

```ts
test('lineModel: a ping that would fall in the quiet hours is named, from the full minute it would go out', async () => {
  // 20:37:30: the tick runs on full minutes, so the ping would go out at 21:30, not 21:29:30.
  const evening = at(20, 37) + 30_000
  const quiet = lineModel(snapshot({ isOn: true, lastRequestAt: evening, now: evening }))
  expect(quiet.tone).toEqual('stalled')
  expect(quiet.details).toEqual(['󰔟 expires 21:37', '󰁔 no ping: quiet hours to 08:00', '54k cached'])
  const earlier = evening - MINUTE
  expect(lineModel(snapshot({ isOn: true, lastRequestAt: earlier, now: earlier })).details).toEqual(['󰁔 ping 21:29', '54k cached'])
  const stopped = lineModel(snapshot({ isOn: true, lastRequestAt: evening, now: evening, stopAt: at(23) }))
  expect(stopped.details).toEqual(['keep-warm stops 23:00', '󰁔 ping 21:30', '54k cached'])
  const unread = lineModel(snapshot({ isOn: true, quiet: { kind: 'invalid', setting: 'range', text: 'nights' } }))
  expect(unread.details).toEqual(['󰔟 expires 11:00', 'quiet hours setting not understood', '54k cached'])
})

test('statusText: the quiet hours while keep-warm is on', async () => {
  const lines = (quiet: QuietHours) => statusText(snapshot({ isOn: true, quiet }), 6).split('\n')
  expect(lines(QUIET)[1]).toEqual('Quiet hours 21:30–08:00: no pings then (a stop time overrides them).')
  expect(lines({ kind: 'off' })[1]).toEqual('Quiet hours: off.')
  expect(lines({ kind: 'invalid', setting: 'range', text: 'nights' })[1]).toEqual('Quiet hours range "nights" not understood (use HH:MM-HH:MM); keep-warm will not ping until it is fixed.')
  expect(lines({ kind: 'invalid', setting: 'switch', text: 'yes' })[1]).toEqual('Quiet hours setting "yes" not understood (use true or false); keep-warm will not ping until it is fixed.')
  expect(statusText(snapshot({}), 6)).not.toContain('Quiet hours')
})
```

W `tests/keep-warm.test.ts` w teście `/keepwarm on: the line names the next ping` wstaw drugi
element oczekiwanej tablicy (między linią „Keep-warm on…” a „This session's cache lasts…”):

```ts
    'Quiet hours 21:30–08:00: no pings then (a stop time overrides them).',
```

Po teście `no ping in the quiet hours; keep-warm stays on and pings again after a morning request`
dodaj:

```ts
test('quiet hours: the line says so before the ping would fall in them', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  // 20:45, before the session starts: no check runs yet.
  await clock.advance(10 * 60 * MINUTE + 45 * MINUTE)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  expect(await line($)).toEqual('󰔟 expires 21:45·󰁔 no ping: quiet hours to 08:00·54k cached·60 min left•••••• 󰓛 Stop ')
  await clock.advance(60 * MINUTE)
  expect(engine.forks).toEqual(0)
})

test('quiet hours hold back the visible ping too', async ($, on) => {
  const evening = START + 10 * 60 * MINUTE + 45 * MINUTE
  const { engine, clock } = stubEngine(on, { store: { 'session:S1': { ...SAVED_ON, lastRequestAt: evening, savedAt: evening } } })
  // 20:50, reopened after a relaunch: the next ping would be the visible one.
  await clock.advance(10 * 60 * MINUTE + 50 * MINUTE)
  await start($)
  expect(await line($)).toContain('󰁔 no ping: quiet hours to 08:00')
  await clock.advance(60 * MINUTE)
  expect(engine.submitted).toEqual([])
  expect(engine.forks).toEqual(0)
})
```

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — `lineModel: a ping that would fall in the quiet hours…` (detal
`󰁔 ping 21:29` zamiast ciszy), `statusText: the quiet hours…` (brak linii ciszy),
`/keepwarm on: the line names the next ping` i `quiet hours: the line says so…` (inny tekst).

- [ ] **Krok 3: Zaimplementuj minimalnie**

W `hooks/format.ts` po `clockTime` dodaj:

```ts
// A time of day given as minutes since midnight, as the quiet hours keep it.
export function clockOfDay(minuteOfDay: number) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`
}
```

W `hooks/line/line-model.ts` import z `../format` zmień na pierwszą linię niżej i dopisz dwie
kolejne:

```ts
import { cacheLength, clockOfDay, clockTime, minutes, timeLeft, tokens } from '../format'
import { fullMinuteFrom, isQuiet } from '../ping/decide-ping'
import type { QuietHours } from '../quiet-hours'
```

Po `NEARLY_FULL_TEXT` dopisz:

```ts
const QUIET_NOT_UNDERSTOOD_TEXT = 'quiet hours setting not understood'
```

W `lineModel` zmień linię `isKeepingWarm` na:

```ts
  const isKeepingWarm = isOn && canKeepWarm && !session.pingError && !isBlocked(session) && !isHeldByQuiet(session, countdown)
```

Po `isBlocked` dodaj:

```ts
// The full minute the next ping goes out at: the first in its window, or the next one when the
// window is already open; `decidePing` checks the quiet hours at the same minute.
function nextPingAt({ lastRequestAt, now }: SessionSnapshot, { ttlMs }: Countdown) {
  return fullMinuteFrom(Math.max(lastRequestAt + ttlMs - PING_LEAD_MS, now))
}

// The next ping would fall in the quiet hours and no stop time overrides them: none goes out.
function isHeldByQuiet(session: SessionSnapshot, countdown: Countdown) {
  return session.stopAt === 0 && countdown.isWarm && isQuiet(nextPingAt(session, countdown), session.quiet)
}

function quietDetail(quiet: QuietHours) {
  return quiet.kind === 'on' ? `${NEXT_ICON} no ping: quiet hours to ${clockOfDay(quiet.endMin)}` : QUIET_NOT_UNDERSTOOD_TEXT
}
```

`nextPingDetails` zmień na:

```ts
// With the cache length unknown no ping can go out; before the conversation has answered in
// this run the next one is the visible ping.
function nextPingDetails(session: SessionSnapshot, countdown: Countdown) {
  if (session.pingError) return [`ping failed: ${session.pingError}`]
  if (!session.ttl) return [WAITS_TEXT]
  if (isBlocked(session)) return [NEARLY_FULL_TEXT]
  if (!countdown.isWarm) return []
  if (isHeldByQuiet(session, countdown)) return [quietDetail(session.quiet)]
  return [`${NEXT_ICON} ping ${clockTime(nextPingAt(session, countdown))}${needsVisiblePing(session) ? SHOWS_IN_CHAT : ''}`]
}
```

W `hooks/command.ts` import z `./format` zmień na pierwszą linię niżej i dopisz drugą:

```ts
import { cacheLength, clockOfDay, clockTime, minutes, tokens } from './format'
import type { QuietHours, QuietInvalid } from './quiet-hours'
```

W `statusText` po deklaracji `lines` (przed linią o `needsVisiblePing`) dopisz:

```ts
  if (isOn) lines.push(quietLine(session.quiet))
```

i po `statusText` dodaj:

```ts
function quietLine(quiet: QuietHours) {
  if (quiet.kind === 'off') return 'Quiet hours: off.'
  if (quiet.kind === 'invalid') return quietNotUnderstood(quiet)
  return `Quiet hours ${clockOfDay(quiet.startMin)}–${clockOfDay(quiet.endMin)}: no pings then (a stop time overrides them).`
}

// Names the option to fix and the form it takes; the status and the start notice say it.
export function quietNotUnderstood({ setting, text }: QuietInvalid) {
  const option = setting === 'switch' ? 'Quiet hours setting' : 'Quiet hours range'
  const form = setting === 'switch' ? 'true or false' : 'HH:MM-HH:MM'
  return `${option} "${text}" not understood (use ${form}); keep-warm will not ping until it is fixed.`
}
```

Utwórz `hooks/quiet-notice.ts`:

```ts
// At a session's start, a quiet-hours setting keep-warm cannot read is said once, with the fix.
import type { EngineInterface } from 'claude-code'

import { quietNotUnderstood } from './command'
import { live } from './state'

export function noticeUnreadQuiet($: EngineInterface) {
  if (live.quiet.kind === 'invalid') $.ui.toast(quietNotUnderstood(live.quiet))
}
```

W `hooks/events/session.ts` dopisz import `import { noticeUnreadQuiet } from '../quiet-notice'` i
w `startSession` po `await forgetOldSessions(...)` dodaj:

```ts
  noticeUnreadQuiet($)
```

W `README.md` w tabeli linii po wierszu `**󰁔 ping 14:07**` dopisz:

```markdown
| **󰁔 no ping: quiet hours to 08:00** | The next ping would fall in your quiet hours, so keep-warm sends none: the bar turns mustard and the line shows when the cache expires. After your next message keep-warm carries on. A stop time overrides the quiet hours. |
| **quiet hours setting not understood** | Keep-warm cannot read the **Quiet hours** or **Quiet hours range** setting, so it sends no ping until you fix it (`true` or `false`; `HH:MM-HH:MM`, for example `21:30-08:00`). A notice and `/keepwarm status` name the setting. |
```

W `.claude/CLAUDE.md` punkt `format.ts` zmień na „- `format.ts`: minutes, clock time (also of a
time of day, `clockOfDay`), token counts.”; w punkcie `command.ts` po „`parseStop` and
`statusText` are pure” dopisz „, like `quietNotUnderstood` (the status and the start notice)”. Po
punkcie `title.ts` dopisz „- `quiet-notice.ts`: the start notice for a quiet-hours setting it
cannot read.”. Na
końcu punktu „Quiet hours (ckw-eg7…)” dopisz zdanie: „The line says so
before the ping would fall in them: `󰁔 no ping: quiet hours to 08:00` in mustard, with the expiry
clock; the ping time on the line is the full minute the tick sends it at.”

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test .
```

Oczekiwany output: wszystkie testy `pass`, `0 fail`.

- [ ] **Krok 5: Commit**

```bash
git add hooks/format.ts hooks/line/line-model.ts hooks/command.ts hooks/quiet-notice.ts hooks/events/session.ts README.md .claude/CLAUDE.md tests/decisions.test.ts tests/keep-warm.test.ts &&
  git commit -m "ckw-eg7: linia, status i toast mówią o ciszy"
```

---

## Task 3: Tick co pełną minutę, ponowienie po 60 s (ckw-x46)

Definicja trafienia: sesja zaczęta o 10:00:30 pinguje o 10:53:00, nie o 10:52:30; nieudany ping
wraca po 60 s.

**Pliki:**

- Utwórz: `hooks/ping/ticking.ts`
- Zmodyfikuj: `hooks/ping/schedule.ts`
- Zmodyfikuj: `hooks/events/session.ts`
- Zmodyfikuj: `hooks/ping/ping.ts`
- Zmodyfikuj: `README.md`
- Zmodyfikuj: `.claude/CLAUDE.md`
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `tick($)` z `hooks/ping/schedule.ts`; `MINUTE_MS` z `hooks/cache-timing.ts`.
- Produkuje: `startTicking($: EngineInterface): Promise<void>` w `hooks/ping/ticking.ts`;
  `TICK_MS` przechodzi z `hooks/ping/schedule.ts` do `ticking.ts` (prywatny).

**Wzorce:**

- `hooks/events/session.ts:25-28` - `$.clock.every` bez `await`, wywołanie `void tick($)`.
- `tests/keep-warm.test.ts` (`the ping goes out 8 min before expiry and restarts the hour`) -
  sprawdzenie liczby forków po `clock.advance`.

**Reguły stosowalne:**

- `tdd-caly-suite` — zmiana ticku dotyka wszystkich testów z `clock.advance`; Krok 4 uruchamia
  cały kit.
- `dok-ten-sam-commit` — README (15 s → minuta) i lekcja `$.clock` w `.claude/CLAUDE.md` w tym
  commicie.

**Tryb wykonania (rekomendacja):** subagent-per-task — osobny mechanizm z własnym testem.

**Wykonawca (rekomendacja):** claude / standard — mała zmiana, ale wymaga uważnego dopasowania
testów do zegara.

- [ ] **Krok 1: Napisz failing test**

W `tests/keep-warm.test.ts`:

- Test `a failing API is retried after 30 s; a refused request stops with its status` zastąp:

```ts
test('a failing API is retried after 60 s; a refused request stops with its status', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  engine.fork = { isAnswered: false, reason: 'api-error', status: 529 }
  await clock.advance(52 * MINUTE)
  expect(engine.forks).toEqual(1)
  expect(engine.toasts.at(-1)).toEqual('Keep-warm ping failed (HTTP 529); retrying in 60 s.')
  await clock.advance(MINUTE)
  expect(engine.forks).toEqual(2)
  engine.fork = { isAnswered: false, reason: 'api-error', status: 400 }
  await clock.advance(MINUTE)
  expect(engine.toasts.at(-1)).toEqual('Keep-warm ping failed (HTTP 400); the cache will expire normally.')
  expect(await line($)).toEqual('ping failed: HTTP 400·after 11:00 your next message re-writes 54k·6 min left•····· 󰓛 Stop ')
})
```

- Po nim dodaj:

```ts
test('the check runs on the full minute: the ping goes out at the minute the line names', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await clock.advance(30_000)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  expect(await line($)).toContain('󰁔 ping 10:53')
  // 10:52:30: the window opened at 10:52:30, but the next check is at 10:53:00.
  await clock.advance(52 * MINUTE)
  expect(engine.forks).toEqual(0)
  await clock.advance(30_000)
  expect(engine.forks).toEqual(1)
})
```

- W teście `a paused keep-warm still shows what its pings cost` zamień
   `await clock.advance(52 * MINUTE + 15_000)` na `await clock.advance(53 * MINUTE)`.
- W testach `a ping that finds the cache cold pauses keep-warm` i
   `a resume tells the time of the last answer` zamień `await clock.advance(15_000)` na
   `await clock.advance(MINUTE)`.

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — `a failing API is retried after 60 s…` (toast „retrying in 30 s”, za
dużo forków) i `the check runs on the full minute…` (`expect(engine.forks).toEqual(0)` z
wartością 1: stary tick co 15 s od 10:00:30 trafia w 10:52:30).

- [ ] **Krok 3: Zaimplementuj minimalnie**

W `hooks/ping/schedule.ts` zmień komentarz pliku na „// The check each tick: refresh what the
line shows, then ping when it is time.”, usuń stałą `TICK_MS` z jej komentarzem i dopisz ten
komentarz nad `tick`:

```ts
// Local reads only (clock, session figures, settings), no model call. The line is redrawn only
// when its text changes, at most once a minute.
```

Utwórz `hooks/ping/ticking.ts`:

```ts
// When the check runs: once right away, then on every full minute.
import type { EngineInterface } from 'claude-code'

import { MINUTE_MS } from '../cache-timing'
import { tick } from './schedule'

// One check a minute, on the full minute, so the ping goes out at the minute the line names.
const TICK_MS = MINUTE_MS

// The repeat is set before the check runs: a slow check cannot delay it.
export async function startTicking($: EngineInterface) {
  await tick($)
  const now = await $.clock.now()
  $.clock.after(TICK_MS - (now % TICK_MS), () => {
    $.clock.every(TICK_MS, () => void tick($))
    void tick($)
  })
}
```

W `hooks/events/session.ts` import `import { tick, TICK_MS } from '../ping/schedule'` zmień na
`import { startTicking } from '../ping/ticking'`, a w `startSession` linie `await tick($)` i
`$.clock.every(TICK_MS, () => void tick($))` zastąp:

```ts
  await startTicking($)
```

W `hooks/ping/ping.ts`:

```ts
// After a failed ping, try again at the next check inside the window.
const PING_RETRY_MS = 60_000
```

W `README.md`: w punkcie „**It is light.**” zamień „one quick local check every 15 seconds” na
„one quick local check a minute”; zdanie „It checks these every 15 seconds, on your computer…”
zmień na „It checks these once a minute, on your computer…”; w tabeli zdarzeń „starts its
15-second local check” zamień na „starts its once-a-minute local check”.

W `.claude/CLAUDE.md`:

- w punkcie `ping/` zamień „`schedule.ts` is the 15-s tick” na „`schedule.ts` is the check each
  minute, `ticking.ts` starts it on the full minute”;
- w „Checking a change” zamień „runs ~1900 ticks (~3 s)” na „runs ~470 one-minute ticks (under
  1 s)”;
- w „Behaviour agreed with the owner” zamień „retry every 30 s on failure” na „retry after 60 s
  (the next check) on failure”, a „one local check every 15 s” na „one local check a minute, on
  the full minute (ckw-x46, 2026-11-16; was every 15 s)”;
- w „Mod API lessons” po punkcie o `$.state` / `$.store` dopisz:

```markdown
- `$.clock` (2.1.325) has `now()`, `sleep(ms)`, `after(ms, fn)` (once) and `every(ms, fn)`; the test kit's `mock.clock` drives `after` and `every` alike on `clock.advance`. The tick starts with `after` up to the next full minute and sets `every(60 s)` inside it, before its first check. A one-shot timer aimed at the next deadline was considered and left out: the minute tick is light enough.
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . &&
  claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: wszystkie testy `pass`, `0 fail`, żaden test nie przekracza 5 s; walidacja
bez błędów.

- [ ] **Krok 5: Commit**

```bash
git add hooks/ping/ticking.ts hooks/ping/schedule.ts hooks/events/session.ts hooks/ping/ping.ts README.md .claude/CLAUDE.md tests/keep-warm.test.ts &&
  git commit -m "ckw-x46: tick co pełną minutę, ponowienie po 60 s"
```

---

## Task 4: Domyślnie 6 pingów w serii

Definicja trafienia: bez opcji keep-warm zatrzymuje się po 6 pingach w serii; dokumentacja mówi
o 6 pingach (~5 h).

**Pliki:**

- Zmodyfikuj: `hooks/cache-timing.ts`
- Zmodyfikuj: `.claude-plugin/plugin.json`
- Zmodyfikuj: `README.md`
- Zmodyfikuj: `.claude/CLAUDE.md`
- Test: `tests/decisions.test.ts`
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `DEFAULT_MAX_PINGS`, `pingLimit` z `hooks/cache-timing.ts`.
- Produkuje: `DEFAULT_MAX_PINGS = 6`.

**Wzorce:**

- `tests/decisions.test.ts` (`pingLimit: …`) i `tests/keep-warm.test.ts`
  (`keep-warm stops itself after … pings in a row`) - istniejące asercje domyślnej wartości.

**Reguły stosowalne:**

- `dok-nieaktualne-od-razu` — wszystkie wzmianki o 8 pingach / 7 h (README, `plugin.json`,
  `.claude/CLAUDE.md`, komentarz `cache-timing.ts`) zmienione w tym tasku.
- `dok-w-planie` — miejsca dokumentacji wypisane w Kroku 3.

**Tryb wykonania (rekomendacja):** subagent-per-task — mechaniczna zmiana wartości z testami i
dokumentacją.

**Wykonawca (rekomendacja):** claude / cheap — zamiana liczb według listy miejsc.

- [ ] **Krok 1: Napisz failing test**

W `tests/decisions.test.ts`:

- w teście `decidePing: the stops, and the visible ping` zamień
  `check({ pingsInRow: 7 })` na `check({ pingsInRow: 5 })` i `check({ pingsInRow: 8 }))).toEqual('stop-after-max')`
  na `check({ pingsInRow: 6 }))).toEqual('stop-after-max')`;
- w teście `statusText: on, its ping history and a short cache` zamień każde `statusText(on, 8)` i
  `statusText(snapshot({ ttl: API_TTL }), 8)` na wersję z `6`, a
  „(stops itself after 8 pings in a row)” na „(stops itself after 6 pings in a row)”;
- test `pingLimit` zmień na:

```ts
test('pingLimit: the max_pings option brought into 1..20; not a number, 6', async () => {
  expect(pingLimit(undefined)).toEqual(6)
  expect(pingLimit(12)).toEqual(12)
  expect(pingLimit(3.7)).toEqual(3)
  expect(pingLimit(50)).toEqual(20)
  expect(pingLimit(0)).toEqual(1)
  expect(pingLimit(Number.NaN)).toEqual(6)
  expect(pingLimit('12')).toEqual(6)
})
```

W `tests/keep-warm.test.ts`:

- w teście `/keepwarm on: the line names the next ping` zamień „(stops itself after 8 pings in a
  row)” na „(stops itself after 6 pings in a row)”;
- test `keep-warm stops itself after 8 pings…` zastąp:

```ts
test('keep-warm stops itself after 6 pings in a row (the default; the kit cannot pass max_pings)', async ($, on) => {
  const { engine, clock } = stubEngine(on)
  await start($)
  await answer($, engine, WRITE)
  await keepwarm($, 'on')
  // From 10:00 the six pings end at 15:12, well before the default quiet hours.
  for (let i = 0; i < 7; i++) await clock.advance(52 * MINUTE)
  expect(engine.forks).toEqual(6)
  expect(engine.toasts.at(-1)).toEqual('Keep-warm stopped itself after 6 pings in a row; the cache will expire.')
  expect((await keepwarm($, 'status')).split('\n')[0]).toEqual('Keep-warm off: the cache expires normally.')
})
```

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany output: FAIL — `pingLimit…` (8 zamiast 6), `decidePing: the stops…`,
`/keepwarm on…` i `keep-warm stops itself after 6 pings…` (7 forków).

- [ ] **Krok 3: Zaimplementuj minimalnie**

W `hooks/cache-timing.ts` zmień `export const DEFAULT_MAX_PINGS = 8` na `= 6`, a w komentarzu
„`max_pings` option; 8 by default, ~7 h)” na „`max_pings` option; 6 by default, ~5 h)”.

W `.claude-plugin/plugin.json` w `max_pings`: `"default": 6`, a w opisie „8 is about 7 hours” →
„6 is about 5 hours”.

W `README.md`:

- wiersz kosztów „Keeping it warm through an 8-hour night (8 pings) | ≈ $0.80” →
  „Keeping it warm through a 5-hour break (6 pings) | ≈ $0.60”;
- linia 98: „after about 7 hours (8 pings in a row, …)” → „after about 5 hours (6 pings in a row,
  …)”;
- tabela „Settings”, wiersz „Pings in a row”: domyślnie `6`, „8 is about 7 hours” → „6 is about 5
  hours”;
- FAQ (linia 176): „after 8 pings in a row (about 7 hours; …)” → „after 6 pings in a row (about 5
  hours; …)”.

W `.claude/CLAUDE.md`:

- „Checking a change”: „"stops itself after 8 pings" runs ~470 one-minute ticks” → „"stops itself
  after 6 pings" runs ~370 one-minute ticks”;
- „Behaviour agreed with the owner”: „stop after 8 pings in a row (~7 h)” → „stop after 6 pings in
  a row (~5 h; 8 until ckw-eg7, owner's choice 2026-11-16)”.

Sprawdź, że nie zostały stare wzmianki:

```bash
rg -n -F -e '8 pings' -e '7 hours' -e '~7 h' -e '8 is about' README.md .claude/CLAUDE.md .claude-plugin/plugin.json hooks tests
```

Oczekiwany output: brak trafień.

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . &&
  claude plugin validate --strict . &&
  claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany output: wszystkie testy `pass`, `0 fail`; obie walidacje bez błędów.

- [ ] **Krok 5: Commit**

```bash
git add hooks/cache-timing.ts .claude-plugin/plugin.json README.md .claude/CLAUDE.md tests/decisions.test.ts tests/keep-warm.test.ts &&
  git commit -m "ckw-eg7: domyślnie 6 pingów w serii"
```
