# Diagnostic toolkit

Everything here exists because this project twice spent multiple sessions on the
same class of problem: the engine appeared to hang or corrupt memory on the
Chinese `SA.ALD`, and the answer was found by measuring the running interpreter
rather than by reasoning about the bytes. The tools below are the ones that
actually produced results.

See [`../../DEBUGGING.md`](../../DEBUGGING.md) for the method these tools
support; this file is the reference for running them.

## First: where the data is

Game data lives in the `games/` folder beside the application checkout. The
tools resolve it automatically and accept `GAMES_DIR` as an override:

```sh
GAMES_DIR=/path/to/games python3 tools/diag/check_scenario.py
```

## Regression checks — run these first

```sh
python3 tools/diag/check_scenario.py            # exit 0 = contracts hold
```

Pins the page-69 defect: `C1` every near-call operand inside page 69 must stay
inside the page, `C2` its ALD entry size must equal the header length (4733),
`C3` records that page 7 ends inside a text run (why the engine needs a
page-end path). Running it against the untouched backup fails `C1`/`C2` with
the exact 213 bad operands, so the check is known to discriminate.

Design note: general rules over all 201 pages do **not** hold. "Entry size >=
header dword@8" flags 163 pages that have always worked, and a raw `0x5c` scan
finds non-instruction bytes inside text on most pages. The checks are therefore
explicit per-page contracts rather than sweeping invariants.

## Static analysis

| Tool | Purpose |
| --- | --- |
| `pc_verify.py` | Nails the PC convention: proves `sl_sco[i] == file[entryOff+ptr+i]` with no offset, against the engine's own trace bytes. |
| `audit_pages.py` | Decodes every page and reports out-of-page branch targets. Noisy — several pages contain data that decodes as addresses. |
| `page69_audit.py` | Focused: proves page 69's broken targets all sat in the truncated tail region. |
| `dis_page.py` | Focused System 3.5 disassembler (page 11 menu loop). Handles only the opcodes it needs; do not treat it as a complete disassembler. |
| `patch_page69.py` | Applies the page-69 repair (entry size 4489 → 4733) to a **copy**. Refuses if the enlarged page would overlap the next entry. |

## Reading the engine's tracing

`analyze_beacon.py` parses the beacon log the instrumented build POSTs to
`127.0.0.1:4190`:

```sh
python3 tools/diag/analyze_beacon.py run/beacon.log --markers
python3 tools/diag/analyze_beacon.py run/beacon.log --from-frame 47240 --limit 60
python3 tools/diag/analyze_beacon.py run/beacon.log --dump-keys
```

It exists because each posted line carries the whole event history, so the log
is quadratic and the *newest* record of each line is the engine's current
state. Reading the ring buffer as a time sequence produced a wrong diagnosis
once; the parser deduplicates to the last record per line for that reason.

## Browser harnesses

All three start a local server on 4173 and a beacon collector on 4190, then
drive Brave over CDP.

| Tool | Purpose |
| --- | --- |
| `harness.mjs` | General driver: load, screenshot, timed click/key actions (`--actions "50000:click:0.585:0.735"`). |
| `playthrough.mjs` | Plays until it can confirm a page was passed; clicks on a timer, turns on message skip, reports pages entered and `BADJMP` count. |
| `livecheck.mjs` | Loads the **published** Pages URL to confirm the deployed build runs. |
| `prepare-testdata.mjs` | Creates/removes `dist/games/ranceking-test/` and the `?game=rkt` launcher route so the harness can load local data. |
| `probe_click.mjs`, `probe_mouse.mjs` | Isolated checks: does a CDP click reach the canvas, and does the engine see it. |
| `verify-cheats.mjs` | Serves `dist/` only (no beacon collector) and verifies the trainer bridge against a running game. |

`verify-cheats.mjs` is the regression for the walkthrough/trainer work:

```sh
node tools/diag/verify-cheats.mjs --game rance4     # or rance41 / rance42
```

It checks the `cheat_*` exports against evidence that does not come from the
same code path: `cheat_page()` versus the pre-existing `_nact_current_page()`,
`cheat_var_name()` versus an offline decode of `System39.ain`, the bulk
pointer view versus the scalar getter, and a write/read/restore round trip.
It also drives the trainer and guide dialogs and writes screenshots to
`run/`. Results and hashes are recorded in `NOTES-cheats.md`.

Typical loop:

```sh
node tools/diag/prepare-testdata.mjs      # local test data + launcher route
node tools/diag/harness.mjs --wait-ms 90000 --shot demo --auto-advance \
  --url "http://127.0.0.1:4173/index.html?game=rkt&fast=1"
node tools/diag/prepare-testdata.mjs --clean
```

`?fast=1` turns on message skipping so cutscenes do not require input.

## Fixtures

`testdata/` holds:

- `SA-page69-repaired.ALD` — page 69 after the one-field size fix; the
  committed fixture the checks are calibrated against.
- The *unfixed* input is not committed: it is byte-identical to the untouched
  `婼抺墹SA.ALD.orig-backup` that `patch_page69.py` leaves beside the game data.
  Point `check_scenario.py` at that file to watch C1/C2 fail.
- reference screenshots: title screen, past-page-69 gameplay, published site.

The full Japanese original ALDs live in `ja/` (gitignored, 51 MB). They were
extracted from the official freeware archive `KICHIKU_WIN.RAR` using
`iso_extract.mjs`-style MODE1/2352 parsing; they are what made the page-69
diagnosis possible.

## Instrumented builds

The harnesses read `PAGE` / `BADJMP` beacons that only an instrumented build
emits. That instrumentation is intentionally **not** committed: `nact_diag.c`
was hand-copied between source trees and produced at least one round of
results that could not be trusted because the tested binary was not the
binary that had been edited. If you need probes, add them to the engine
explicitly, rebuild, and record the resulting `dist/xsystem35.wasm` hash, so
every conclusion can name the binary it came from.
