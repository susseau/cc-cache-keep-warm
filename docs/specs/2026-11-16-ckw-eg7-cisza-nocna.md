# ckw-eg7: cisza nocna (z ckw-x46: tick co minutę)

## Cel

Keep-warm nie pinguje w ustalonych godzinach (domyślnie 22:00–09:00, czas lokalny). Pingi w nocy
i w porzuconych sesjach to główna strata: kalibracja na transkryptach 1.09–16.11.2026 (377 sesji,
`tmp/ckw-model/simulate.py`) daje przy oknie 22–9 oszczędność 5,4 mln tokenów-ekwiwalentów/tydz.
przy 8 pingach w serii (2,2 mln bez okna) i 5,7 mln przy 6. Przy okazji (ckw-x46) sprawdzenie
stanu co minutę zamiast co 15 s: lżej, a testy limitu pingów mieszczą się w 5 s kitu.

Sukces: żaden ping w oknie ciszy bez jawnego czasu stopu; linia mówi o tym, zanim ping by
wypadł; rano keep-warm działa dalej bez ręcznego włączania.

## Zakres

- Dwie nowe opcje pluginu: przełącznik ciszy i zakres godzin z dokładnością do minuty.
- Decyzja o ciszy w czystej funkcji `decidePing`.
- Linia i `/keepwarm status` mówią o ciszy.
- Domyślne `max_pings` 8 → 6.
- ckw-x46: tick co 60 s wyrównany do pełnej minuty, ponowienie nieudanego pingu po 60 s,
  opis `$.clock` w `.claude/CLAUDE.md`.
- README: opis opcji; `.claude/CLAUDE.md`: uzgodnione zachowanie.

## Poza zakresem

- Pauza cache przez noc (niemożliwa: cache wygasa).
- Pingowanie po końcu ciszy (cache jest wtedy zimny; reguła „nigdy nie pinguj zimnego cache”).
- Jednorazowy timer na najbliższy termin zamiast ticku.
- Różne okna dla dni tygodnia.

## Global constraints

- Nigdy nie pinguj zimnego cache.
- Jedno lokalne sprawdzenie na tick, linia odrysowana najwyżej raz na minutę, żadnego wywołania
  modelu poza pingiem.
- `$.state` tylko przez `state.ts`; matcher i klucze opcji to literały (walidator).
- Decyzje w modułach czystych (bez `$`): `decide-ping.ts`, `line-model.ts`, `command.ts`
  (`statusText`), nowe parsowanie zakresu.
- `claude plugin validate --strict` (marketplace i plugin) przechodzi.

## Projekt

### Opcje (`.claude-plugin/plugin.json`, `userConfig`)

- `quiet_hours`: boolean, tytuł „Quiet hours”, domyślnie `true`. Opis: bez czasu stopu keep-warm
  nie pinguje w tych godzinach; cache wygasa, a po Twojej następnej wiadomości keep-warm działa dalej.
- `quiet_range`: string, tytuł „Quiet hours range”, domyślnie `"22:00-09:00"`, czas lokalny,
  `HH:MM-HH:MM`, może przechodzić przez północ.
- `max_pings`: domyślnie 6; opis „6 is about 5 hours”.

`register.tsx` czyta je do `live` (jak `max_pings`): `live.quiet` = zakres albo `null` (cisza
wyłączona). `DEFAULT_MAX_PINGS = 6` w `cache-timing.ts`.

### Zakres ciszy (nowy czysty moduł `hooks/quiet-hours.ts`)

- `quietRange(isOn: unknown, range: unknown): QuietRange | null`: `isOn === false` → `null`;
  `range` niebędący tekstem `H:MM-H:MM` / `HH:MM-HH:MM` z godzinami 0–23 i minutami 0–59 (spacje
  wokół myślnika dozwolone) albo z równym początkiem i końcem → domyślny 22:00–09:00.
  `QuietRange = { startMin, endMin }` (minuty od północy).
- `isQuiet(ms, range)`: lokalna minuta doby (`Date#getHours/getMinutes`, jak `clockTime`) w
  `[startMin, endMin)`; gdy `startMin > endMin`, okno przez północ: `≥ startMin || < endMin`.
- `quietLabel(range)`: `"22:00–09:00"` do linii i statusu; `quietEnd(range)`: `"09:00"`.

### Decyzja (`hooks/ping/decide-ping.ts`)

`PingCheck` dostaje `quiet: QuietRange | null`; `PingStep` dostaje `'quiet'`. Kolejność:

1. `stop-at-time` (bez zmian);
2. poza oknem pingu albo przed `pendingUntil` → `none` (bez zmian);
3. **`stopAt === 0` i `quiet` i `isQuiet(now, quiet)` → `quiet`**;
4. `stop-after-max`, `ping`, `visible-ping`, `blocked` (bez zmian).

Jawny czas stopu omija ciszę (decyzja właściciela). `schedule.ts` przy `quiet` nic nie robi:
keep-warm zostaje włączony, licznik serii bez zmian, okno nie jest trzymane (kolejne ticki w
oknie pingu też dadzą `quiet`). Cache wygasa; rano okno pingu nie wraca, dopóki nie przyjdzie
prawdziwy request, który zeruje serię i rusza odliczanie.

### Linia (`hooks/line/line-model.ts`)

`SessionSnapshot` dostaje `quiet: QuietRange | null` (z `live` w `readSnapshot`). Sesja „w ciszy”
dla linii: włączona, `stopAt === 0`, `quiet` ustawione, a termin następnego pingu
(`lastRequestAt + ttl − PING_LEAD_MS`) wypada w ciszy. Wtedy:

- zamiast `󰁔 ping HH:MM` detal `󰁔 no ping: quiet hours to 09:00`;
- `isKeepingWarm` jest fałszywe: pasek musztardowy (`stalled`), wraca `󰔟 expires HH:MM` i
  ostrzeżenie o ponownym zapisie przed końcem.

Linia pokazuje to od ostatniego requestu przed ciszą, więc zanim ping by wypadł. Zimny cache w
ciszy: bez detalu o pingu (jak dziś).

### `/keepwarm status` (`statusText` w `hooks/command.ts`)

Przy włączonej ciszy dodatkowa linia: `Quiet hours 22:00–09:00: no pings then (a stop time
overrides them).`; przy wyłączonej: `Quiet hours: off.`

### Tick (ckw-x46, `hooks/ping/schedule.ts`, `hooks/events/session.ts`, `hooks/ping/ping.ts`)

- `TICK_MS = 60_000`. Start sesji: `tick` od razu, potem `$.clock.after(ms do następnej pełnej
  minuty)`, w nim `tick` i `$.clock.every(TICK_MS, tick)`.
- `PING_RETRY_MS = 60_000` (toast „retrying in 60 s”).
- `$.clock` w 2.1.325 ma `now`, `sleep`, `after` (jednorazowy), `every`: opis w
  `.claude/CLAUDE.md` (Mod API lessons).

### Dokumentacja

- README: opisy `quiet_hours`, `quiet_range`, nowe domyślne `max_pings`; tick co minutę, jeśli
  README go wymienia. Sekcja „What it runs, reads and sends”: lokalny zegar już opisany, nic
  nowego nie jest czytane ani wysyłane; sprawdzić tylko wzmianki o 15 s.
- `.claude/CLAUDE.md`: „one local check every minute”, retry 60 s, 6 pingów, cisza nocna
  (zachowanie i decyzje właściciela 2026-11-16), `$.clock.after`.

### Testy

- `decisions.test.ts`: `quietRange` (domyślny, wyłączony, błędny tekst, start = koniec, minuty),
  `isQuiet` (zwykłe okno, przez północ, granice: start w ciszy, koniec poza), `decidePing`
  (`quiet` w ciszy; `stopAt` wygrywa; `stop-at-time` przed ciszą), `pingLimit` domyślnie 6,
  `lineModel` (detal ciszy, ton `stalled`, `expires`), `statusText` (linia ciszy, wyłączona).
- `keep-warm.test.ts`: stub startuje o 10:00 lokalnie; test „nie pinguje w ciszy”: request ok.
  21:30, ping wypadłby po 22:00 → brak pingu, keep-warm nadal włączony; po requeście rano znowu
  pinguje. Test „stops itself after N pings” na 6 (kit nie przekazuje opcji, więc obowiązują
  domyślne, także cisza; od 10:00 seria 6 × 52 min kończy się ok. 15:30, przed ciszą). Testy z krokami 15 s / 30 s dopasowane do 60 s.
- `claude plugin test .` zielone; każdy test < 5 s.

## Kryteria akceptacji

- Opcje `quiet_hours` (domyślnie włączona) i `quiet_range` (domyślnie `22:00-09:00`, minuty,
  przez północ) w `plugin.json`; błędny zakres → domyślny.
- Bez jawnego czasu stopu żaden ping (niewidoczny ani widoczny) nie leci w oknie; z jawnym stopem
  pingi lecą do niego.
- W ciszy keep-warm zostaje włączony; po prawdziwym requeście po ciszy pinguje znowu bez ręcznego
  włączania.
- Linia pokazuje `󰁔 no ping: quiet hours to HH:MM` (musztardowo, z czasem wygaśnięcia), zanim
  ping by wypadł.
- `/keepwarm status` mówi o ciszy.
- Domyślne `max_pings` = 6.
- Tick co 60 s wyrównany do minuty, retry 60 s; ping nadal w oknie 52–59 min.
- `.claude/CLAUDE.md` opisuje `$.clock` (after/every/sleep/now) i nowe zachowanie; README opisuje
  opcje.
- `claude plugin test .` zielone (każdy test < 5 s); `claude plugin validate --strict` dla
  marketplace i pluginu przechodzi.

## Otwarte pytania

Brak.
