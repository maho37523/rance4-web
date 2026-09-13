# Debugging this project: what worked, and what wasted time

This is a maintenance note, not a style guide. Everything below is grounded in
this repository's history: three AI sessions, roughly thirteen rounds, spent on
a black screen that turned out to be two independent defects. The tooling that
came out of it lives in [`tools/diag/`](tools/diag/README.md); this file is the
method behind it.

## The one-sentence version

Most of the cost was not in fixing the engine or the data — it was in
**establishing what we were actually looking at**. Once two facts were pinned
down (the PC convention, and the untranslated original data), the fixes took
minutes. Before that, whole rounds were built on wrong premises.

## Rules that would have saved the most time

**1. Pin the units before you reason with them.**
Whether an "address" means a file offset or a page-buffer index has to be an
established fact, verified by one small experiment against the running system,
before any conclusion uses it. Here the question was whether the engine's PC
was 8 bytes away from `file[entryOff+ptr+i]`. It was not — the offset is zero —
but the question stayed open across rounds, and two earlier diagnoses
("entry out of bounds", "8-byte contradiction") were invalidated by it.
`tools/diag/pc_verify.py` is that experiment, kept runnable.

**2. Check whether an anomaly is actually anomalous before using it as evidence.**
A page header field read `1140` on a page whose buffer was `1058` bytes, which
looked like proof of an out-of-range entry point. Scanning all 201 pages showed
that field is `32` everywhere — it was never an entry point. One `for` loop
would have prevented that round.

**3. A conclusion needs data that can distinguish it from its rival.**
Twice a "structural" story was inferred from an internal contradiction, and
both times a single authoritative artifact dissolved it:

- "routine 345 has no return" — wrong; the character tables simply do not need
  one, and the engine trace showed every return being taken.
- "page 69's tail was truncated" — wrong; the Japanese original's page 69 is
  the same 4489 bytes.

Both errors share a shape: explaining a contradiction with a story instead of
getting the reference data. So: **before proposing a structural defect, ask
whether an intact reference exists. If it does, get it first.**

**4. Only instructions the interpreter actually decodes are evidence.**
A raw scan for the `0x5c` near-call opcode finds it inside text and data on
almost every page. That produced a flood of phantom "out-of-page call"
findings in this very repo, twice. Either walk the control flow, or confirm
with a run that logs what executed — and say which of the two a number came
from.

**5. One change, one prediction, one run.**
Instrumentation, engine fixes and data patches were mixed in some rounds,
which made it impossible to attribute what changed. Write the prediction down
before running; if it is wrong, the premise is wrong, not the experiment.

**6. Keep raw evidence until the report is written.**
Deleted log dumps and screenshots were needed again later and had to be
regenerated. Dumping a 400 KB ring buffer is cheap; re-running a browser
playthrough is not.

## Practical constraints of this environment

These cost real time and are worth knowing up front:

- **A busy interpreter never answers.** When the engine spins, CDP
  `Runtime.evaluate` does not return for that page. Any diagnostic state must
  be **pushed**, not pulled. The beacon collector on port 4190 exists for this.
- **Beacon logs are quadratic.** Each posted line carries the full history, so
  one 40-second run produced 96–240 MB. The engine's current state is the
  *last* record of the *last* line; parse it that way.
- **Headless browser input timing is unreliable.** Clicks land only if the game
  is actually at a menu. Drive input from observed engine state, and keep a
  bypass state channel available, or you will spend whole runs staring at a
  title screen.
- **Stale servers hold ports.** 4173/4180/4190/9233 linger between sessions;
  check before assuming a fresh start.
- **The game data now lives in `../games/`.** `server.mjs` and
  `prepare-public-assets.mjs` resolve it relative to the checkout and accept
  `GAMES_DIR`. Nothing should hard-code a user path.
- **The native unit tests do not cover the scenario interpreter.** `src_tests`
  needs SDL2, which is not installed here. `tools/diag/check_scenario.py` is the
  substitute: small, Python, and it encodes the defects that actually happened.
- **Browser profiles are ~100 MB each.** Clean them up, or `tools/diag/` grows
  by hundreds of megabytes per session.

## Verification ladder

Cheapest first. Stop at the first rung that answers the question.

1. `python3 tools/diag/check_scenario.py` — data contracts (seconds).
2. `pc_verify.py` / `page69_audit.py` — a specific byte-level claim.
3. `harness.mjs` with an instrumented build — did the interpreter execute the
   path, reach a wait, overflow, or loop.
4. `playthrough.mjs` — does the game progress past the problem.
5. `livecheck.mjs` — does the **published** build do the same.

Rungs 1–2 need no browser and no build. Prefer them; they would have caught the
page-69 defect the day the file arrived.

## Rules for changing things

- Record the wasm hash with every result, so a conclusion names its binary.
  `dist/xsystem35.wasm` carries `__DATE__`/`__TIME__` through the build ID.
- Keep exactly one untouched copy of any game data before patching it
  (`patch_page69.py` leaves `婼抺墹SA.ALD.orig-backup` alone on purpose).
- Data repairs should be minimal and checkable. The page-69 fix is one 32-bit
  field; the reason it is safe is `check_scenario.py`, not confidence.
- Do not commit machinery you intend to delete. Instrumentation that is
  hand-copied between trees produced one round of untrustworthy results; if you
  need probes, add them explicitly, rebuild, and record the hash.
