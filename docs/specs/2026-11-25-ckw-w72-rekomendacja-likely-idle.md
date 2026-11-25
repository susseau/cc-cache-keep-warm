# Rekomendacja „likely idle: stop?” na linii keep-warm - spec (ckw-w72)

## Cel

Linia doradza, czy dalsze pingi keep-warm się opłacają, żeby użytkownik mógł kliknąć Stop zamiast
płacić za pingi do sesji, do której nie wróci. Decyzja zostaje przy użytkowniku: mod sam nie
wyłącza keep-warm.

## Zakres

- Musztardowy detal `󰔢 likely idle: stop?` na linii, gdy żadna dalsza seria pingów się nie opłaca.
- Czysta funkcja wartości serii pingów z krzywej powrotu, z ciszą nocną i limitem pingów w serii.
- Wbudowana domyślna krzywa powrotu z kalibracji 2026-11-16.
- Krzywa nadpisywalna wartością zapisaną w `$.store` (kontrakt dla ckw-4k7).
- Detal linii z własnym kolorem (dziś każdy detal jest dim).
- README: wiersz detalu w „Reading the line” i nowy odczyt w „What it runs, reads and sends”.

## Poza zakresem

- Automatyczne wyłączanie keep-warm — decyzja użytkownika (ticket).
- Skill kalibrujący krzywą i zapisujący ją do `$.store` — ckw-4k7.
- Zmiana domyślnego `max_pings` albo ciszy nocnej — osobne decyzje właściciela.
- Detal „worth it”, gdy pingi się opłacają — odrzucony przez użytkownika (szum na linii).
- Wzmianka o rekomendacji w `/keepwarm status` — ticket wymaga tylko linii.
- Krzywa zależna od pory dnia poza ciszą nocną — odrzucona przez użytkownika.

## Global constraints

- Funkcja wartości i model linii zostają czyste (bez `$`, bez modułu stanu), jak `decide-ping.ts` i `line-model.ts`.
- Bez nowego wywołania modelu i bez nowego timera: przeliczenie przy istniejącym ticku, linia przerysowana najwyżej raz na minutę.
- Teksty linii, kod i komentarze po angielsku; ikony Nerd Font.
- Ceny z `savings.ts` (odczyt 0.1, zapis 1-godzinny 2), bez nowych kopii liczb.
- Odwołania `$.state` tylko w `state.ts`, literalne refy; `$.store` tylko w `session-store.ts`.
- `claude plugin test .` i `claude plugin validate --strict ./.claude-plugin/plugin.json` przechodzą.

## Podejścia

**Wybrane:** tabela hazardu po numerze pingu w serii, pora dnia tylko przez ciszę nocną —
proste, zgodne z danymi (dzień i wieczór podobne, noc ~0 pokrywa się z ciszą), jedna tablica liczb
do nadpisania przez ckw-4k7.

**Odrzucone:**

- Osobne tabele dla dnia, wieczoru i nocy — cienkie dane na pasmo (229 przerw wieczorem), więcej parametrów, dubluje ciszę nocną.
- Funkcja wykładnicza długości przerwy — sztywny kształt, nie odda np. powrotów po obiedzie.
- EV tylko najbliższego pingu — przy nadpisanej krzywej, która nie maleje, zatrzymałaby serię, która się jeszcze opłaca.

## Projekt

### Krzywa powrotu

Krzywa to tablica `h[1..N]`: `h[i]` to prawdopodobieństwo powrotu użytkownika w oknie, które
dokłada i-ty ping serii, pod warunkiem braku powrotu wcześniej. Domyślna, z kalibracji
2026-11-16 (997 przerw dłuższych niż 52 min, 10,7 tygodnia):

| ping | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h | 0.183 | 0.110 | 0.063 | 0.040 | 0.037 | 0.023 | 0.012 | 0.002 |

Ping o numerze większym niż N dostaje `h[N]`.

Nadpisanie: `$.store` pod kluczem `return-curve`, wartość to tablica od 1 do 20 skończonych liczb
od 0 do 1. Mod czyta ją przy starcie sesji (`session.start`); brak klucza albo każda inna
wartość oznacza krzywą domyślną, bez komunikatu. Klucz nie należy do sesji, więc tygodniowe
sprzątanie `session:` go nie usuwa.

### Seria pingów i jej wartość

Dane: ostatni request `L`, długość cache `T`, pingi w serii `n` (`pings.length`), limit serii
`M` (`max_pings`), cisza nocna, czas pierwszego pingu `t₁` (ten sam, który linia zapowiada jako
`󰁔 ping HH:MM`).

- Kolejne pingi: `t_j = t₁ + (j−1)·(T − 8 min)`; ping `j` wydłuża cache do `E_j = t_j + T`,
  `E₀ = L + T`.
- Seria może mieć najwyżej `K = M − n` pingów i kończy się przed pierwszym pingiem `t_j`, który
  wypada w ciszy nocnej (wtedy nic nie wychodzi, a cache wygasa).
- Okno pingu `j` to `(E_{j−1}, E_j]`; `f_j` to udział tego okna poza ciszą nocną (z dokładnością
  do minuty). Hazard pingu: `p_j = h[n + j] · f_j`.
- Wartość serii `k` pingów, w jednostkach rozmiaru cache:
  `EV(k) = 1.9 · (1 − Π_{j≤k}(1 − p_j)) − 0.1 · Σ_{j≤k} Π_{i<j}(1 − p_i)`
  (zysk powrotu 2 − 0.1 razy szansa powrotu w serii, minus odczyt 0.1 za każdy ping wysłany przed
  powrotem).
- Rekomendacja „likely idle”, gdy `K ≥ 1` i `EV(k) ≤ 0` dla każdego `k = 1..K`.

Przykłady z domyślną krzywą, bez ciszy: `n = 0..2` → opłaca się (`EV(1)` dla `n = 2`: 1.9·0.063 − 0.1 > 0);
`n = 3` → likely idle. Przy ciszy od 21:30 ping o 21:20 do cache wygasającego 21:28 dokłada okno
z 2 minutami poza ciszą (`f₁ = 2/52`) → likely idle.

### Kiedy linia pokazuje detal

Detal `󰔢 likely idle: stop?` stoi na linii, gdy wszystkie warunki są spełnione:

- keep-warm włączony i trzyma cache (ton `keeping`), cache ciepły;
- brak stop time (`stopAt = 0`): użytkownik sam wyznaczył koniec;
- linia zapowiada ping (`󰁔 ping HH:MM`), nie „no ping: quiet hours” ani brak pingu;
- sesja nie czeka na odpowiedź użytkownika (`waiting for your answer`);
- `K ≥ 1` i rekomendacja z poprzedniej sekcji.

Detal jest ostatni przed czasem pozostałym, po nim `·` jak po każdym detalu, w kolorze musztardy
`#b5a55f` (kolor tonu `stalled`). Pasek, przycisk i pozostałe detale bez zmian. Po kliknięciu
Stop keep-warm jest wyłączony, więc detal znika. Linia przelicza go razem z resztą, przy ticku raz
na minutę; `max_pings` trafia do danych, z których liczy się linia.

### README

- „Reading the line”: wiersz `󰔢 likely idle: stop?` — co znaczy, że to tylko rada, kiedy się
  pojawia i że nie pojawia się przy stop time ani w oczekiwaniu na odpowiedź.
- „What it runs, reads and sends” / „What it reads”: odczyt `return-curve` z pamięci pluginu
  (lokalnie, nic nie wysyła).

### Testy

Funkcja wartości i model linii testowane jako czyste funkcje (`tests/decisions.test.ts`), widok
z kolorem detalu przez stub engine (`tests/line.test.ts`), odczyt krzywej ze `$.store` przez stub
engine.

## Kryteria akceptacji

- **KA-1:** gdy keep-warm trzyma ciepły cache w dzień, bez stop time, z domyślną krzywą i `n = 0, 1, 2` pingami w serii, to linia nie pokazuje `󰔢 likely idle: stop?`.
- **KA-2:** gdy w tych samych warunkach `n = 3` i limit 6, to linia pokazuje `󰔢 likely idle: stop?` jako ostatni detal przed czasem pozostałym, w kolorze `#b5a55f`.
- **KA-3:** gdy cisza 21:30–08:00, ostatni request 20:28 i zapowiedziany ping 21:20, to linia pokazuje `󰔢 likely idle: stop?` przy `n = 0`.
- **KA-4:** gdy krzywa ma wartość nadpisaną przez `return-curve` tak, że `h[4]` daje `EV(1) > 0`, to przy `n = 3` linia nie pokazuje detalu.
- **KA-5:** gdy `return-curve` ma złą wartość (nie tablica, pusta, ponad 20 liczb, liczba spoza 0–1), to linia liczy z krzywą domyślną.
- **KA-6:** gdy jest stop time, keep-warm wyłączony, ton `stalled`, cache krótszy niż 30 min, cache zimny, sesja czeka na odpowiedź, linia mówi „no ping: quiet hours” albo `n ≥ max_pings`, to detalu nie ma.
- **KA-7:** gdy linia pokazuje detal, to żaden tick nie wyłącza keep-warm z jego powodu; dopiero Stop wyłącza, a detal znika.
- **KA-8:** funkcja wartości dla domyślnej krzywej daje `EV(1) > 0` przy `n = 2` i `max_k EV(k) ≤ 0` przy `n = 3`, `M = 6`, bez ciszy.
- **KA-9:** README ma wiersz `󰔢 likely idle: stop?` w „Reading the line” i odczyt `return-curve` w „What it reads”.
- **KA-10:** `claude plugin test .` i `claude plugin validate --strict ./.claude-plugin/plugin.json` przechodzą.

## Decyzje autora

- Reguła z najlepszej kontynuacji serii, nie z jednego pingu — odporna na nadpisaną krzywą, która nie maleje.
- Koszt pingu 0.1 i zysk powrotu 1.9 rozmiaru cache, wejście i wyjście pingu pominięte — rozmiar skraca się w rachunku, a stałe są te same co w liczniku oszczędności.
- Numer pingu poza tabelą dostaje ostatnią wartość — ostrożnie, bez ekstrapolacji.
- Brak rekomendacji przy oczekiwaniu na odpowiedź — powrót jest wtedy prawie pewny (krytyka podejścia).
- Seria kończy się na pierwszym pingu w ciszy — tak działa `decidePing`, cache wtedy wygasa (krytyka podejścia).
- Bez progu rozmiaru kontekstu — decyzja jest względna, próg to parametr bez danych.
- Krzywa czytana raz przy starcie sesji, zła wartość cicho daje domyślną — jak `plan-ttl`; ckw-4k7 sprawdzi zapis.
- Detal ostatni przed czasem — najbliżej przycisku Stop i ostatni ucinany w wąskim oknie.

## Do rozstrzygnięcia w planie

- Kształt typu detalu z kolorem w `LineModel` i zmiana `line-view.tsx`.
- Nazwa modułu funkcji wartości i miejsce domyślnej krzywej.
- Jak `max_pings` i krzywa trafiają do `SessionSnapshot` (pole czy parametr `lineModel`).
