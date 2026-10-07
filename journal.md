# Project Journal

Working log for the currency dashboard: what I worked on, what I chose, and what
I parked. Newest session first. Complements `README.md` (the case study) — the
README explains *the project*; this file records *the work*.

---

## Session 4 — 2026-10-07 — Journal + a parity bug found by writing docs

### Worked on
- Wrote `README.md` as a case study (project, audience, decisions, changelog).
- While fact-checking the README against the source, audited `CURRENCIES`
  against `OFFLINE_RATES` with a throwaway script instead of trusting my own
  memory of what I'd written.

### Chose
- **To verify claims before writing them down.** The audit found two real
  defects the README would otherwise have documented as working:
  - `HRK` was selectable with no offline rate — and it's obsolete anyway
    (Croatia adopted the euro in 2023).
  - `RUB` was selectable with no offline rate.
  - 23 offline entries existed for currencies the UI never offers.
- Fixed all three: dropped `HRK`, added `RUB`, trimmed the rest, so both tables
  are exactly 47 entries. Re-ran the live and offline headless checks.

### Parked
- **A permanent test for this.** The audit ran as a one-off script in
  `%TEMP%` that I deleted. A `node test.js` asserting `CURRENCIES` and
  `OFFLINE_RATES` have identical key sets would cost ~15 lines and stop this
  class of bug recurring. Not written yet.
- Whether to grow the list past 47 fiat currencies (more ISO codes, or a
  dynamic list from the API with an exclusion filter).

---

## Session 3 — 2026-10-07 — First commit

### Worked on
- `git status` → *not a git repository*. Initialized one.

### Chose
- **Root commit `db35024`** covering `index.html`, `style.css`, `app.js`.
- Explicit single-purpose message: `Add currency conversion dashboard with
  localStorage persistence`.

### Mistake made and corrected
- I passed `-c user.name="opencode" -c user.email="opencode@localhost"` on the
  commit, overriding the identity already configured globally
  (`akunne emmanuel <ed.akunne@gmail.com>`). Unnecessary — I added the flags
  out of habit for environments with no git identity configured, but this one
  had one.
- Corrected immediately with `git commit --amend --reset-author --no-edit`
  (safe: nothing was pushed). New hash `db35024`.
- **Rule going forward:** check `git config --get user.name` before assuming
  an identity is needed; never blanket-override.

### Parked
- **No remote.** The repo is local only. I don't create remotes or push
  without being asked, so GitHub/GitLab hosting is untouched.
- `.gitignore` — nothing to exclude yet (no `node_modules`, no build output,
  no env files). Add one the moment a toolchain appears.
- Pre-commit hooks / CI / lint config. There is no linter in this project, so
  there is nothing to run — see Session 1 parking note.

---

## Session 2 — 2026-10-07 — "Why am I getting *Could not load rates*?"

### Worked on
- User reported every conversion showed `Could not load rates`.
- Diagnosed before touching code:
  - `GET https://open.er-api.com/v6/latest/USD` → HTTP 200, valid payload.
  - Response headers → `access-control-allow-origin: *`, so not a CORS problem.
  - Therefore the provider was fine; the failure was in the client or the
    user's environment (offline, proxy, privacy/ad-block extension, `file://`
    restrictions).
- Read our own fetch path and found the actual defects:
  1. **One source, one host.** Any single failure killed the app.
  2. **No timeout.** A hanging request hung forever.
  3. **No reason surfaced.** The catch block wrote a generic string — so the
     user couldn't tell me *why*, and I couldn't tell them.
  4. **No offline path.** First visit with no cache = unusable dashboard.
- Rewrote `app.js` accordingly (444 → 513 lines).

### Chose
- **Three independent providers, tried in sequence, first success wins:**
  1. `open.er-api.com`
  2. `api.exchangerate-api.com`
  3. `cdn.jsdelivr.net` (`fawazahmed0/currency-api`)
  Verified all three return 200 with usable USD-based payloads before wiring
  them in — I checked the alternates *before* committing to them rather than
  after.
- **12s `AbortController` timeout per attempt.** Long enough not to race a slow
  network, short enough that three sequential failures resolve in ~36s worst
  case rather than never.
- **Auto-fallback to built-in `OFFLINE_RATES`** when all sources fail and there
  is no cache. Changed my mind halfway: I first implemented
  `Could not load rates` with the errors inlined into the UI, then decided a
  converter that refuses to convert has failed at its only job. Now it converts,
  labels the numbers `approximate`, and puts the fetch error in the footer.
- **Error taxonomy:** `TypeError` → *"network blocked or offline"*, abort →
  *"timed out after 12s"*, HTTP non-200 → *"HTTP 404"*. The three most common
  failures need different fixes, so they shouldn't share a message.
- **`cache: "no-store"`** so a stale cache can't be mistaken for fresh data.
- Kept the amber status dot as the single "data freshness" signal rather than
  adding a banner — the footer already carries the detail.

### Bug I introduced and then fixed
- The detail line rendered `1 USD = 1.125 EUR` — backwards. Both cross-rate
  expressions used `rates[from] / rates[to]` where they need
  `rates[to] / rates[from]`. The converted amount itself was correct
  (`convert()` was right), so the math "worked" and only the *displayed* rate
  was wrong.
- Caught by dumping the rendered DOM in headless Edge and reading the output —
  not by the conversion logic. **Takeaway: verify displayed values against a
  known pair; correct internals don't imply correct rendering.**

### Chose (tooling)
- **Headless Edge as the test harness.** Edge was already installed at
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; no
  Playwright/Puppeteer install needed. Pattern used throughout:

  ```bash
  msedge --headless=new --virtual-time-budget=20000 --dump-dom index.html
  ```
  then regex the `status-text` / `result-value` / `result-rate` /
  `footer-info` ids out of the DOM.

- **Tested the failure path by copying the project to `%TEMP%` and rewriting
  every `https://…` URL to `https://invalid.invalid/x.json`** — deliberately
  never editing the real source to simulate an outage. Temp copy deleted
  afterwards.

### Parked
- **Automated tests.** Headless checks are a shell one-liner I remember to run,
  not something that runs on its own. See Session 4's parked item.
- **A linter / formatter (ESLint, Prettier).** The project has no `package.json`
  and I wanted to keep it that way — adding tooling to lint 513 lines of
  vanilla JS would break the "open the file and it runs" property that is the
  whole point. Revisit if the file grows past ~1000 lines.
- **Why the user's environment failed in the first place.** I could not
  reproduce it — the same `file://` URL works in headless Edge. The error
  surface I added means the *next* report will name the cause, but the original
  one went unexplained. Honest gap.

---

## Session 1 — 2026-10-07 — Initial build

### Worked on
- Directory was completely empty (`Get-ChildItem -Force` → no output). Built
  the whole thing from scratch: `index.html`, `style.css`, `app.js`.

### Chose
- **Stack: plain HTML + CSS + JS, no framework, no build step.** The brief said
  "html, css, js only" and the app is one form plus two lists — a framework
  would add a toolchain to save us from 500 lines of straightforward code.
- **Three files, one concern each**, no module bundler: `index.html` (structure),
  `style.css` (presentation), `app.js` (everything else, wrapped in a single
  IIFE with `"use strict"` so nothing leaks to global scope).
- **Dark single-column dashboard** with a mobile breakpoint at 520px (currency
  selects stack vertically below it). Colour-coded status dot
  (green/amber/red) as the one glanceable state indicator.
- **Feature set, scoped to the brief:**
  - amount + from/to + swap
  - pinned pairs (max 8), shown with live cross-rates
  - conversion history (max 12), deduped by amount+pair, with Load/× actions
  - preferences (last pair) restored on reload
  - manual "Refresh rates"
- **Persistence shape:** five `localStorage` keys (`fx.rates`, `fx.updated`,
  `fx.history`, `fx.pinned`, `fx.prefs`) — namespaced with `fx.` so keys don't
  collide with other apps on the same origin. All access wrapped in
  `readJSON`/`writeJSON` that catch exceptions, because private-browsing modes
  throw on `setItem` and a crash there would take the whole app down.
- **History limits:** 12 entries, deduped by exact amount+pair so re-converting
  the same thing moves the entry to the top instead of filling the list.
- **Debounced input:** 150ms for the rendered result, 700ms before committing a
  history entry — recording every keystroke would fill history with `1`, `12`,
  `123`.

### Choices made under the original constraints (kept since)
- **Fixed 47-currency dropdown list** rather than `Object.keys(rates)`. The APIs
  return 160+ codes including crypto; a fixed list keeps the UI predictable.
  Cost: adding a currency means editing `CURRENCIES` *and* `OFFLINE_RATES`
  (this bit me in Session 4).
- **USD as the pivot** for cross rates — every source is USD-based, so
  `A → USD → B` is one division and one multiplication, no rate matrix needed.
- **`localStorage` over IndexedDB / a backend.** Data is a few KB of JSON;
  IndexedDB's async API and a server's auth/hosting would both be solving
  problems this app doesn't have.

### Parked
- **No license.** Deliberately undecided — choosing one is the user's call, not
  mine. README says so explicitly rather than defaulting to MIT.
- **No automated test suite, no CI, no linter** — accepted at the time as
  proportionate for a from-scratch static page; already being reconsidered by
  Session 4.
- **`favicon`, `meta description`, Open Graph tags, PWA manifest.** Cosmetic/
  distribution concerns that don't affect the converter.
- **Decimal precision control** (e.g. "show me 4 decimal places") — the UI uses
  `Intl.NumberFormat` with `maximumFractionDigits: 2`, which is right for
  display but wrong for FX-adjacent work.
- **Rate history / sparkline**, and **storing the rate that was in effect when
  a history entry was created** (right now an old entry re-renders against
  today's rate).
- **Rate alerts / notifications.**
- **IndexedDB migration** if history ever grows past a few dozen entries.

---

## Recurring themes worth remembering

1. **Diagnose before editing.** Both real bugs this project had were found by
   inspecting behaviour (a curl, a DOM dump), not by reading the code and
   guessing.
2. **Failure paths are features.** The original app handled the happy path and
   nothing else; most of Session 2 was spent on what happens when the network
   is gone.
3. **Write the docs, then check the docs.** Session 4's bug only surfaced
   because writing the README forced an audit.
4. **Parked ≠ forgotten.** Every parking note above is still open; promote one
   to a session when it's next relevant.

---

## Entry template for future sessions

```markdown
## Session N — YYYY-MM-DD — <title>

### Worked on
- ...

### Chose
- <decision> — <why, and what it cost>

### Parked
- <item> — <why not now, and what would unblock it>
```
