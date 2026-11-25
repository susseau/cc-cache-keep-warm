# Rekomendacja „likely idle: stop?” na linii keep-warm - plan implementacji (ckw-w72)

**Cel:** linia pokazuje musztardowy detal `󰔢 likely idle: stop?`, gdy żadna dalsza seria pingów się nie opłaca.

**Architektura:** czysty moduł `hooks/idle-advice.ts` liczy wartość serii pingów z krzywej powrotu, ciszy nocnej i limitu serii; `lineModel` woła go z czasem zapowiadanego pingu i oddaje detal w nowym polu `advice`, które `drawLine` rysuje w musztardzie. Limit serii i krzywa (domyślna albo z `$.store` `return-curve`, czytana w `openSessionStore`) trafiają do `SessionSnapshot` z `live`, jak `quiet`.

**Stack:** TypeScript, mod API Claude Code (`claude-code`, `claude-code/testing`), `claude plugin test`.

**Spec:** `docs/specs/2026-11-25-ckw-w72-rekomendacja-likely-idle.md`

## Global constraints

- Funkcja wartości i model linii zostają czyste (bez `$`, bez modułu stanu), jak `decide-ping.ts` i `line-model.ts`.
- Bez nowego wywołania modelu i bez nowego timera: przeliczenie przy istniejącym ticku, linia przerysowana najwyżej raz na minutę.
- Teksty linii, kod i komentarze po angielsku; ikony Nerd Font.
- Ceny z `savings.ts` (odczyt 0.1, zapis 1-godzinny 2), bez nowych kopii liczb.
- Odwołania `$.state` tylko w `state.ts`, literalne refy; `$.store` tylko w `session-store.ts`.
- `claude plugin test .` i `claude plugin validate --strict ./.claude-plugin/plugin.json` przechodzą.

## File Structure

- `hooks/idle-advice.ts` (nowy) — decyduje, czy dalsze pingi serii się opłacają; zależy od: `hooks/savings.ts`, `hooks/cache-timing.ts`, `hooks/ping/decide-ping.ts`, `hooks/quiet-hours.ts`
- `hooks/savings.ts` → bez kodu: eksport `READ_PRICE` i `HOUR_WRITE_PRICE`; zależy od: brak
- `hooks/session-snapshot.ts` — typ wartości sesji widzianych przez czyste decyzje; zależy od: `hooks/idle-advice.ts`
- `hooks/state.ts` — wartości sesji w `$.state` i zmienne modułu; zależy od: `hooks/idle-advice.ts`
- `hooks/session-store.ts` — wartości w store wspólnym dla sesji; zależy od: `hooks/idle-advice.ts`, `hooks/state.ts`
- `hooks/line/line-model.ts` — decyduje, co mówi linia; zależy od: `hooks/idle-advice.ts`, `hooks/session-snapshot.ts`
- `hooks/line/line-view.tsx` — rysuje linię z gotowego modelu; zależy od: `hooks/line/line-model.ts`
- `types/index.d.ts` → bez kodu: komentarz o kluczu return-curve w store; zależy od: brak
- `README.md` — dokumentacja użytkownika i polityka prywatności; zależy od: brak
- `tests/decisions.test.ts` — testy czystych decyzji; zależy od: `hooks/idle-advice.ts`, `hooks/line/line-model.ts`
- `tests/savings.test.ts` — testy rachunku keep-warm; helper `snapshot` z nowymi polami i import `DEFAULT_RETURN_CURVE`; zależy od: `hooks/session-snapshot.ts`, `hooks/idle-advice.ts`
- `tests/line.test.ts` — testy linii przez stub engine; zależy od: `tests/engine.ts`
- `tests/keep-warm.test.ts` — testy moda przez stub engine (store, `/clear`); zależy od: `tests/engine.ts`

---

## Task 1: Detal `likely idle` przy n = 3 bez ciszy, w musztardzie

**Pliki:**

- Utwórz: `hooks/idle-advice.ts`
- Zmodyfikuj: `hooks/savings.ts:9-10`
- Zmodyfikuj: `hooks/session-snapshot.ts:7-25`
- Zmodyfikuj: `hooks/state.ts:42-102`
- Zmodyfikuj: `hooks/line/line-model.ts:1-60`
- Zmodyfikuj: `hooks/line/line-view.tsx:22-47`
- Zmodyfikuj: `README.md:104-119`
- Test: `tests/decisions.test.ts`
- Test: `tests/savings.test.ts:16-20`
- Test: `tests/line.test.ts`

**Interfejsy:**

- Konsumuje: `PING_LEAD_MS`, `DEFAULT_MAX_PINGS` z `hooks/cache-timing.ts`; `isKeepingWarm` w `lineModel` (`hooks/line/line-model.ts:48-51`), który już zawiera `isLongEnoughToKeepWarm(ttl)`: cache krótszy niż 30 min (`API_TTL`) detalu nie ma bez osobnego warunku.
- Produkuje (`hooks/savings.ts`): `export const READ_PRICE = 0.1`, `export const HOUR_WRITE_PRICE = 2` (dziś stałe prywatne, wartości bez zmian).
- Produkuje (`hooks/idle-advice.ts`):
  - `export type ReturnCurve = readonly number[]`
  - `export const DEFAULT_RETURN_CURVE: ReturnCurve = [0.183, 0.110, 0.063, 0.040, 0.037, 0.023, 0.012, 0.002]`
  - `export type IdleCheck = { firstPingAt: number, ttlMs: number, pingsInRow: number, maxPings: number, curve: ReturnCurve }`
  - `export function seriesValues(check: IdleCheck): number[]` — `EV(1..K)`, `K = maxPings − pingsInRow` (pusta tablica, gdy `K ≤ 0`)
  - `export function isLikelyIdle(check: IdleCheck): boolean` — `K ≥ 1` i każda wartość `≤ 0`
- Produkuje (`hooks/session-snapshot.ts`): pola `maxPings: number` i `returnCurve: ReturnCurve` w `SessionSnapshot`.
- Produkuje (`hooks/state.ts`): `live.returnCurve: ReturnCurve` (domyślnie `DEFAULT_RETURN_CURVE`); `readSnapshot` wypełnia `maxPings: live.maxPings`, `returnCurve: live.returnCurve`.
- Produkuje (`hooks/line/line-model.ts`): pole `advice: string` w `LineModel` (`''` = brak detalu); stała tekstu `'󰔢 likely idle: stop?'`.

**Wzorce:**

- `hooks/ping/decide-ping.ts` - czysty moduł decyzji: eksportowane funkcje z jednym obiektem-argumentem, komentarz nad każdą, bez `$`.
- `hooks/state.ts:101` - `quiet: live.quiet`: wartość z `live` wpisana do snapshotu.
- `hooks/line/line-view.tsx:37-41` - detal jako osobny `Box flexShrink={0}`, po nim `dim('·')`.

**Reguły stosowalne:**

- `clean-code` — małe funkcje o jednej odpowiedzialności, nazwy mówiące, co liczą (`seriesValues`, `isLikelyIdle`).
- `tdd` — testy czystej funkcji i linii przed implementacją.

**Tryb wykonania (rekomendacja):** subagent-per-task — samodzielny pocisk przez rachunek, model i widok.

**Wykonawca (rekomendacja):** claude / standard — rachunek podany wzorem, reszta według wzorców repo.

- [ ] **Krok 1: Napisz failing test**

Plik `tests/decisions.test.ts`; helper `snapshot` (`tests/decisions.test.ts:169-173`) i helper w `tests/savings.test.ts:16-20` dostają `maxPings: DEFAULT_MAX_PINGS` (w `savings.test.ts` liczba `6`) i `returnCurve: DEFAULT_RETURN_CURVE` (w `savings.test.ts` z nowym importem `DEFAULT_RETURN_CURVE` z `../hooks/idle-advice`). Test `lineModel: keeping while on…` (`toEqual` całego modelu) dostaje `advice: ''`. `THREE = [1, 2, 3].map(i => ({ at: START + i * 52 * MINUTE, isHit: true, read: 54_000 }))`, nowy helper `idleCheck = (n, maxPings = 6) => ({ firstPingAt: START + 52 * MINUTE, ttlMs: HOUR, pingsInRow: n, maxPings, curve: DEFAULT_RETURN_CURVE })` (nie `check`: ta nazwa należy już do helpera `PingCheck` w `tests/decisions.test.ts:69`):

- `seriesValues: a ping that pays at n = 2` — `seriesValues(idleCheck(2))[0]` większe od 0 (≈ 0.0197).
- `isLikelyIdle: no series pays from n = 3 with the default curve` — `isLikelyIdle(idleCheck(3))` = `true`; każda wartość `seriesValues(idleCheck(3))` `≤ 0`.
- `isLikelyIdle: worth it at n = 0, 1, 2` — `false` dla każdego.
- `isLikelyIdle: no ping left` — `isLikelyIdle(idleCheck(6, 6))` = `false`, `seriesValues(idleCheck(6, 6))` = `[]`.
- `isLikelyIdle: past the table the last value` — `isLikelyIdle(idleCheck(10, 20))` = `true`.
- `lineModel: likely idle after 3 pings in a row` — `snapshot({ isOn: true, pings: THREE })`: `advice` = `'󰔢 likely idle: stop?'`, `tone` = `'keeping'`.
- `lineModel: no advice where the user decides or keep-warm cannot ping` — przy `pings: THREE` `advice` = `''` dla: `isOn: false`; `stopAt: START + 3 * HOUR`; `isWaiting: true`; `pingError: 'HTTP 400'`; `ttl: API_TTL`; `now: START + 61 * MINUTE` (zimny); `maxPings: 3`; `lastRequestAt: at(20, 38), now: at(20, 38)` (linia mówi „no ping: quiet hours”); `pings: THREE.slice(0, 2)`.

Plik `tests/line.test.ts` (import `keepwarm` z `./engine`):

- `likely idle after 3 pings in a row, until Stop` — `stubEngine`, `start`, `answer(WRITE)`, `keepwarm('on')`, 2× `clock.advance(52 * MINUTE)`: linia nie zawiera `likely idle`; trzeci `advance(52 * MINUTE)`: linia zawiera `'54k cached·󰔢 likely idle: stop?·'`; `advance(10 * MINUTE)`: nadal zawiera, `keepwarm('status')` zaczyna się od `Keep-warm on`; `pressToggle`: linia nie zawiera `likely idle`.

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany wynik: kod niezerowy, bo brak modułu `hooks/idle-advice.ts` i pola `advice`.

- [ ] **Krok 3: Zaimplementuj minimalnie**

- Rachunek `seriesValues` (spec, „Seria pingów i jej wartość”; cisza w Task 2):

```ts
// h[i] for the i-th ping in the row (1-based); past the table, its last value.
const hazard = (curve: ReturnCurve, i: number) => curve[Math.min(i, curve.length) - 1]
const RETURN_GAIN = HOUR_WRITE_PRICE - READ_PRICE

// EV(k) for k = 1..K: the gain of a return within the series, less a read for each ping sent before it.
let stayed = 1, cost = 0
for (let j = 1; j <= maxPings - pingsInRow; j++) {
  cost += READ_PRICE * stayed
  stayed *= 1 - hazard(curve, pingsInRow + j)
  values.push(RETURN_GAIN * (1 - stayed) - cost)
}
```

- `firstPingAt` i `ttlMs` są w `IdleCheck` dla Task 2 (czasy pingów `t_j = firstPingAt + (j−1)·(ttlMs − PING_LEAD_MS)`); w tym tasku rachunek ich nie używa, nie usuwaj ich z typu.
- `lineModel`: `advice` = tekst, gdy `isKeepingWarm`, `countdown.isWarm`, `stopAt === 0`, `outlook.kind === 'ping'`, `!isWaiting` i `isLikelyIdle({ firstPingAt: outlook.at, ttlMs: countdown.ttlMs, pingsInRow: pings.length, maxPings, curve: returnCurve })`; inaczej `''`. `details` bez zmian.
- `drawLine`: przy niepustym `advice` osobne elementy zewnętrznego Boxa między Boxem detali a `model.main`: `<Box flexShrink={0}><Text color={TONE_COLORS.stalled}>{advice}</Text></Box>` i `dim('·')`. Poza Boxem detali (`overflow="hidden"`, dzieci od lewej, nadmiar ucinany z prawej) detal nie ginie pierwszy: w wąskim oknie ucinają się zwykłe detale, a rada zostaje przy czasie i przycisku (spec: „ostatni ucinany w wąskim oknie”). Zaktualizuj komentarz nad `drawLine`.
- Komentarz nad `advice` w `LineModel`: rada, nie decyzja; mod sam nie wyłącza keep-warm.
- README (reguła `dok-ten-sam-commit`, wzorzec: wiersz `󰁔 no ping: quiet hours to 08:00`, `README.md:110`): w tabeli „Reading the line” po wierszu `**󰆼 saved 90k**` wstaw:

```markdown
| **󰔢 likely idle: stop?** | Advice, in mustard: no further ping is likely to pay for itself, either because after a break this long people seldom come back or because the pings ahead would fall in the quiet hours, so you may want to press **Stop**. Keep-warm never stops by itself because of it. It shows only while keep-warm is holding a warm cache with a ping announced: not with a stop time you gave, not while a question waits for your answer, and not while the line says **no ping: quiet hours**. |
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . && claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany wynik: kod 0, przechodzą przypadki z Kroku 1 i dotychczasowe testy.

- [ ] **Krok 5: Commit**

```bash
git add hooks/idle-advice.ts hooks/savings.ts hooks/session-snapshot.ts hooks/state.ts hooks/line/line-model.ts hooks/line/line-view.tsx tests/decisions.test.ts tests/savings.test.ts tests/line.test.ts README.md && git commit -m "ckw-w72: likely idle na linii po 3 pingach w serii"
```

## Task 2: Cisza nocna w wartości serii

**Pliki:**

- Zmodyfikuj: `hooks/idle-advice.ts`
- Zmodyfikuj: `hooks/line/line-model.ts:44-60`
- Test: `tests/decisions.test.ts`

**Interfejsy:**

- Konsumuje (`hooks/idle-advice.ts`, z Task 1): `IdleCheck = { firstPingAt, ttlMs, pingsInRow, maxPings, curve }`, `seriesValues(check: IdleCheck): number[]`, `isLikelyIdle(check: IdleCheck): boolean`.
- Konsumuje: `isQuiet(ms: number, quiet: QuietHours): boolean` z `hooks/ping/decide-ping.ts`; `PING_LEAD_MS`, `MINUTE_MS` z `hooks/cache-timing.ts`; `type QuietHours` z `hooks/quiet-hours.ts`.
- Produkuje: `IdleCheck` z dodatkowym polem `lastRequestAt: number` i `quiet: QuietHours`; sygnatury `seriesValues` i `isLikelyIdle` bez zmian.

**Wzorce:**

- `hooks/line/line-model.ts:85-94` - pętla po pełnych minutach (`MINUTE_MS`) z warunkiem z `decide-ping.ts`.

**Reguły stosowalne:**

- `tdd` — przypadek KA-3 i jego kontrast bez ciszy przed implementacją.

**Tryb wykonania (rekomendacja):** subagent-per-task — rozszerzenie jednej funkcji z własnymi testami.

**Wykonawca (rekomendacja):** claude / standard — rachunek z czasem lokalnym i granicami okien.

- [ ] **Krok 1: Napisz failing test**

Plik `tests/decisions.test.ts` (`at`, `QUIET`, `HOUR` jak w pliku); helper `idleCheck` z Task 1 dostaje `lastRequestAt: START, quiet: QUIET` (helper `check` od `PingCheck` bez zmian):

- `isLikelyIdle: a ping whose window is mostly quiet hours does not pay` — `{ lastRequestAt: at(20, 28), firstPingAt: at(21, 20), ttlMs: HOUR, pingsInRow: 0, maxPings: 6, curve: DEFAULT_RETURN_CURVE, quiet: QUIET }` → `true`; `seriesValues(...)` ma długość 1 (drugi ping 22:12 wypada w ciszy).
- `isLikelyIdle: the same ping without quiet hours pays` — to samo z `quiet: { kind: 'off' }` → `false`.
- `lineModel: likely idle before the first ping when its window is quiet hours` — `snapshot({ isOn: true, lastRequestAt: at(20, 28), now: at(20, 28) })`: `details` zawiera `'󰁔 ping 21:20'`, `advice` = `'󰔢 likely idle: stop?'`.

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany wynik: kod niezerowy, bo `isLikelyIdle` dla okna w ciszy zwraca `false` (cisza jeszcze nie liczona).

- [ ] **Krok 3: Zaimplementuj minimalnie**

- Pingi serii: `t_j = firstPingAt + (j−1)·(ttlMs − PING_LEAD_MS)`, `E_j = t_j + ttlMs`, `E_0 = lastRequestAt + ttlMs`.
- Seria kończy się przed pierwszym `t_j` (`j ≥ 2`), dla którego `isQuiet(t_j, quiet)`: wartości `EV` liczone tylko do `j − 1`. `t_1` to ping zapowiedziany przez linię, poza ciszą z założenia.
- Okno pingu `j` to `(E_{j−1}, E_j]` (spec, „Seria pingów i jej wartość”): minuty `m = E_{j−1} + i·MINUTE_MS` dla `i = 1..⌊(E_j − E_{j−1}) / MINUTE_MS⌋`, liczone od `E_{j−1}`, nie od pełnej minuty zegara. `f_j` = liczba tych `m` z `!isQuiet(m, quiet)` podzielona przez liczbę wszystkich `m`.
- `p_j = hazard(curve, pingsInRow + j) · f_j` zastępuje `hazard(...)` w rekurencji z Task 1, czyli w `stayed` i tym samym w koszcie kolejnych pingów (wzór specu `EV(k) = 1.9 · (1 − Π_{j≤k}(1 − p_j)) − 0.1 · Σ_{j≤k} Π_{i<j}(1 − p_i)`):

```ts
let stayed = 1, cost = 0
for (let j = 1; j <= maxPings - pingsInRow; j++) {
  const pingAt = firstPingAt + (j - 1) * (ttlMs - PING_LEAD_MS)
  if (j >= 2 && isQuiet(pingAt, quiet)) break
  const windowStart = j === 1 ? lastRequestAt + ttlMs : pingAt - (ttlMs - PING_LEAD_MS) + ttlMs
  cost += READ_PRICE * stayed
  stayed *= 1 - hazard(curve, pingsInRow + j) * awakeShare(windowStart, pingAt + ttlMs, quiet)
  values.push(RETURN_GAIN * (1 - stayed) - cost)
}
```

- `awakeShare(from, to, quiet)` — mała czysta funkcja modułu: udział minut `(from, to]` poza ciszą (wyżej); przy `quiet.kind === 'off'` zwraca 1, więc wyniki Task 1 się nie zmieniają.
- Cisza `invalid` liczy się jak cisza przez cały dzień (`isQuiet`), ale linia wtedy nie zapowiada pingu, więc detalu nie ma.
- `lineModel` przekazuje `lastRequestAt` i `quiet` ze snapshotu.

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test .
```

Oczekiwany wynik: kod 0, przechodzą przypadki z Kroku 1 i testy z Task 1.

- [ ] **Krok 5: Commit**

```bash
git add hooks/idle-advice.ts hooks/line/line-model.ts tests/decisions.test.ts && git commit -m "ckw-w72: cisza nocna w wartości serii pingów"
```

## Task 3: Krzywa nadpisana przez `return-curve`

**Pliki:**

- Zmodyfikuj: `hooks/idle-advice.ts`
- Zmodyfikuj: `hooks/session-store.ts:10-34`
- Zmodyfikuj: `types/index.d.ts:22-26`
- Zmodyfikuj: `README.md:220-232`
- Test: `tests/decisions.test.ts`
- Test: `tests/keep-warm.test.ts`

**Interfejsy:**

- Konsumuje: `ReturnCurve`, `DEFAULT_RETURN_CURVE` z `hooks/idle-advice.ts`; `live.returnCurve` z `hooks/state.ts`; `openSessionStore($)` w `hooks/session-store.ts:30`.
- Produkuje (`hooks/idle-advice.ts`): `export function parseReturnCurve(value: unknown): ReturnCurve` — tablica od 1 do 20 skończonych liczb od 0 do 1 (włącznie) zwraca się bez zmian, każda inna wartość daje `DEFAULT_RETURN_CURVE`; bez komunikatu i bez wyjątku.
- Produkuje (`hooks/session-store.ts`): stała `RETURN_CURVE_KEY = 'return-curve'`; `openSessionStore` ustawia `live.returnCurve = parseReturnCurve(await $.store.get(RETURN_CURVE_KEY))`.

**Wzorce:**

- `hooks/session-store.ts:15` i `hooks/session-store.ts:30-34` - klucz wspólny `plan-ttl` z komentarzem i jego odczyt do `live` w `openSessionStore`.
- `hooks/quiet-hours.ts:17-31` - czysty parser wartości z zewnątrz z odrzuceniem złych.

**Reguły stosowalne:**

- `tdd` — parser i odczyt ze stub engine przed implementacją.
- `clean-code` — walidacja w czystej funkcji, `session-store.ts` tylko czyta i przypisuje.

**Tryb wykonania (rekomendacja):** subagent-per-task — parser i jeden odczyt, odrębny od rachunku.

**Wykonawca (rekomendacja):** claude / cheap — mechaniczna zmiana według wzorca `plan-ttl`.

- [ ] **Krok 1: Napisz failing test**

Plik `tests/decisions.test.ts`:

- `parseReturnCurve: a list of 1 to 20 numbers from 0 to 1` — `[0.5]` → `[0.5]`; `[0, 1]` → `[0, 1]`; 20× `0.1` → ta sama tablica.
- `parseReturnCurve: anything else is the default curve` — `undefined`, `'x'`, `[]`, 21× `0.1`, `[0.2, 1.5]`, `[0.2, -0.1]`, `[NaN]`, `[0.2, '0.3']` → `DEFAULT_RETURN_CURVE`.
- `lineModel: a curve whose 4th ping pays keeps quiet at n = 3` — `snapshot({ isOn: true, pings: THREE, returnCurve: [0.183, 0.110, 0.063, 0.2] })`: `advice` = `''`.

Plik `tests/keep-warm.test.ts` (wzorzec: `/clear keeps keep-warm on: the next answer starts its countdown`):

- `return-curve in the store: the line follows it` — `stubEngine(on, { store: { 'return-curve': [0] } })`, `start`, `answer(WRITE)`, `keepwarm('on')`, `clock.advance(MINUTE)`: linia zawiera `'54k cached·󰔢 likely idle: stop?·59 min left'`.
- `a return-curve it cannot read: the default curve` — `store: { 'return-curve': 'nonsense' }`, te same kroki: linia nie zawiera `likely idle`.
- `/clear reads return-curve again` — `stubClearableEngine(on)`, `start`, `answer(WRITE)`, `keepwarm('on')`, potem `engine.store['return-curve'] = [0]`, `clear`, `answer(WRITE)`, `clock.advance(MINUTE)`: linia zawiera `'󰔢 likely idle: stop?'`.

- [ ] **Krok 2: Uruchom, potwierdź fail**

```bash
claude plugin test .
```

Oczekiwany wynik: kod niezerowy, bo brak eksportu `parseReturnCurve` z `hooks/idle-advice.ts`.

- [ ] **Krok 3: Zaimplementuj minimalnie**

- Komentarz nad `RETURN_CURVE_KEY`: wspólny dla sesji, zapisuje go kalibracja (ckw-4k7); nie zaczyna się od `session:`, więc tygodniowe sprzątanie go nie usuwa.
- Odczyt tylko w `openSessionStore`, bez zapisu: klucze store w istniejących testach się nie zmieniają.
- `types/index.d.ts`: w komentarzu nad `KeepWarmTtl` (obok zdania o `plan-ttl`) dopisz: `$.store` trzyma też `return-curve`, wspólny dla sesji: szanse powrotu w oknie każdego kolejnego pingu, 1 do 20 liczb od 0 do 1; inna wartość daje krzywą domyślną.
- README jest polityką prywatności (`privacyPolicyUrl`): nowy odczyt trafia do „What it reads” w tym samym commicie. Po punkcie **Its own settings** wstaw:

```markdown
- **Its own stored return curve**, if one is saved in the plugin's storage on your computer (`return-curve`): the chances of your return during each further ping, which the **likely idle** advice weighs. Without one it uses a built-in curve.
```

- [ ] **Krok 4: Uruchom, potwierdź pass**

```bash
claude plugin test . && claude plugin validate --strict ./.claude-plugin/plugin.json
```

Oczekiwany wynik: kod 0, przechodzą przypadki z Kroku 1; walidator listuje `store.get` jak dotąd.

- [ ] **Krok 5: Commit**

```bash
git add hooks/idle-advice.ts hooks/session-store.ts types/index.d.ts tests/decisions.test.ts tests/keep-warm.test.ts README.md && git commit -m "ckw-w72: krzywa powrotu z return-curve w store"
```

## Po wydaniu

- Sprawdź detal w prawdziwej linii aplikacji desktop: glif `󰔢` i musztarda `#b5a55f` (kit testów nie widzi kolorów ani glifów, `.claude/CLAUDE.md`, „Checking a change”).
