# Currency Conversion Dashboard

A dependency-free currency converter that runs entirely in the browser: type an
amount, pick two currencies, get the converted value plus the live mid-market
rate. Pinned pairs, conversion history, and preferences persist across sessions
via `localStorage`.

> This README is maintained as a **case study** — what the project is, who it is
> for, the decisions behind it, and what changed and why. Update it when the
> project changes.

---

## What it is

A static, three-file dashboard:

| File | Lines | Role |
| --- | --- | --- |
| `index.html` | 73 | Structure: converter, pinned pairs, history |
| `style.css` | 274 | Dark dashboard styling, mobile breakpoint at 520px |
| `app.js` | 513 | Rates fetching, conversion math, persistence, rendering |

No build step, no framework, no npm install. Open `index.html` and it runs.

**Scope:** mid-market reference rates for personal/estimation use. Not a
trading tool, not a payments tool, and not suitable where a guaranteed rate
matters.

## Who it is for

- **Primary:** someone who needs a quick, remembered conversion — expats,
  freelancers invoicing in a second currency, travellers comparing prices.
- **Secondary:** a reader learning how a small front-end app handles network
  failure and persistence without a backend.

The interface is deliberately opinionated rather than exhaustive: a fixed set
of 47 commonly-traded fiat currencies instead of all 180+ ISO codes.

## Running it

```bash
# simplest — just open the file
start index.html

# or serve it (avoids any file:// quirks in stricter browsers)
npx serve .
# or: python -m http.server 8000
```

The page works over `file://` (verified in headless Edge), but serving over
HTTP is the more portable choice if a browser or extension blocks requests from
local files.

---

## How it works

```
open page
  ├─ read localStorage ──► cached rates? ──► render immediately (amber status)
  ├─ populate <select> from the fixed CURRENCIES list
  └─ fetchRates()
       ├─ source 1 (er-api)          ─┐
       ├─ source 2 (exchangerate-api) ─┼─► first success wins
       ├─ source 3 (jsdelivr)         ─┘
       └─ all failed + no cache ──► built-in OFFLINE_RATES (amber status)
```

Conversion is a two-step cross-rate through USD, since every source is
USD-based:

```js
converted = (amount / rates[from]) * rates[to];
```

`rates[code]` is always "how many `code` units buy 1 USD".

### Persistence (`localStorage`)

| Key | Shape | Purpose |
| --- | --- | --- |
| `fx.rates` | `{ rates, updated, source }` | Cached rates → instant first paint, offline use |
| `fx.updated` | `number` (epoch ms) | Timestamp of last good fetch |
| `fx.history` | `Entry[≤12]` | Recent conversions, deduped by amount+pair |
| `fx.pinned` | `{ from, to }[≤8]` | Pinned pairs shown as live mini-rates |
| `fx.prefs` | `{ from, to }` | Last selected currencies |

All reads/writes go through `readJSON` / `writeJSON`, which catch exceptions —
private-browsing modes that throw on `localStorage.setItem` degrade to
non-persistent instead of crashing.

### Rate sources

| # | Provider | URL | Notes |
| --- | --- | --- | --- |
| 1 | er-api.com | `open.er-api.com/v6/latest/USD` | Primary |
| 2 | exchangerate-api.com | `api.exchangerate-api.com/v4/latest/USD` | Fallback |
| 3 | fawazahmed0/currency-api | `cdn.jsdelivr.net/.../currencies/usd.json` | Fallback, same data different CDN |
| — | Built-in | `OFFLINE_RATES` in `app.js` | Last resort, approximate |

Each network attempt has a 12s `AbortController` timeout. Failures are logged
to the console as `[fx] <source> failed -> <reason>` and the first reason is
surfaced in the page footer.

---

## Decisions (and why)

**Vanilla HTML/CSS/JS, no framework.** The app is one form, two lists, and a
fetch. A framework would add a build step and a dependency tree to save us from
~500 lines of plain code. No bundler means the source you read is the code that
runs.

**`localStorage`, not IndexedDB or a backend.** Everything stored is small
JSON (rates ≈ a few KB, history ≤ 12 entries). `localStorage` is synchronous,
dead simple, and survives reloads — which was the whole persistence requirement.
IndexedDB would be the answer only if we stored hundreds of thousands of rows.

**Server-side persistence rejected.** No accounts, no history to sync across
devices, no secrets to protect. A backend would introduce hosting, auth, and a
rate-limit problem to solve a problem we don't have.

**Fixed currency list rather than `Object.keys(rates)`.** The APIs return 160+
codes including crypto and obsolete currencies. A fixed list keeps the dropdowns
predictable and lets `normalize()` filter junk. Trade-off: adding a currency
means editing `CURRENCIES` *and* `OFFLINE_RATES`.

**Three API sources, then built-in rates.** See [Changelog](#changelog) — this
was a direct response to a real failure report. The in-app result is a number,
not an error dialog; the status dot and footer carry the "how fresh / how real"
signal instead.

**Live fetch always over cached-only.** Cached rates render first for
instant feedback, then a background fetch replaces them. Users get both speed
and freshness.

**Debounced history writes (700ms).** Recording every keystroke would fill
history with `"1"`, `"12"`, `"123"`. Debounce plus dedupe-by-pair means the
history shows *decisions*, not keystrokes.

**Dark, single-column, no charting library.** The value being communicated is
one number. Charts would imply analytical depth the data (mid-market, ~hourly)
doesn't support.

---

## Changelog

### 2026-10-07 — Currency list parity fix

Audited `CURRENCIES` against `OFFLINE_RATES` and found two defects:

- **`HRK` was selectable but had no offline rate.** Croatia adopted the euro in
  2023, so `HRK` was stale anyway → removed from `CURRENCIES`.
- **`RUB` was selectable but had no offline rate** → added to `OFFLINE_RATES`.
- Trimmed 23 unused offline entries (regional/currency-bloc codes not offered
  in the UI) so the two tables now match exactly: **47 codes in, 47 rates out.**

Why it matters: any of these would have produced a dead `Unsupported currency`
result *only* when offline — the worst possible time for a silent failure.

### 2026-10-07 — "Could not load rates" report *(commit `db35024` for v1)*

**Reported symptom:** every attempt to convert showed *"Could not load rates"*.

**Diagnosis.** The primary API was healthy (HTTP 200,
`access-control-allow-origin: *`, confirmed with a direct request), so the
problem was not the provider. Two real defects in our code:

1. **Single source, no diagnostics.** One `fetch` to one host, and on any
   failure the catch block wrote a generic message with no reason. Network
   hiccup, proxy, privacy/ad-block extension, `file://` restrictions — all
   indistinguishable.
2. **No offline path.** With no cache from a previous visit, there was nothing
   to fall back to, so the dashboard was simply unusable.

**Changes:**

| Change | Why |
| --- | --- |
| Two additional independent providers, tried in order | One host failing can't take the app down |
| 12s `AbortController` timeout per request | A hanging request used to hang forever |
| Auto-fallback to built-in `OFFLINE_RATES` | Conversion always works; status reads `Offline — approximate rates` |
| Actual error reason logged (`[fx] …`) and shown in the footer | Next failure report comes with a cause, not a symptom |
| Distinguishing `TypeError` → *"network blocked or offline"* vs abort → *"timed out"* | The two most common failures have different fixes |
| `cache: "no-store"` on fetch | Don't let a stale CDN/browser cache masquerade as fresh data |

**Also fixed — an inverted rate display I had introduced.** The converted
amount was correct, but the detail line read `1 USD = 1.125 EUR` (backwards):
both cross-rate expressions used `rates[from] / rates[to]` where they needed
`rates[to] / rates[from]`. Caught by inspecting the rendered output in headless
Edge, not by the conversion math — a reminder that verifying the *displayed*
value against a known pair is its own test.

### 2026-10-07 — Initial release *(commit `db35024`)*

Converter, swap, pinned pairs, conversion history, `localStorage` persistence,
single live rate source.

---

## Verification

Manual checks run in headless Edge against the real network:

```bash
# live path
msedge --headless=new --virtual-time-budget=20000 --dump-dom index.html

# failure path: point every source at an invalid host, expect offline rates
```

| Scenario | Expected | Status |
| --- | --- | --- |
| Live fetch succeeds | `Live rates`, correct cross-rate | ✅ |
| All sources unreachable, no cache | `Offline — approximate rates`, still converts, reason in footer | ✅ |
| Source unreachable, cache present | `Showing cached rates`, then live on success | ✅ |
| Empty / invalid amount | `—`, no history entry | ✅ |
| Reload | Pairs, pins, history, cached rates restored | ✅ |

Known gap: there is no automated test suite. The checks above are manual.

---

## Limitations & possible next steps

- **Rates are mid-market and refreshed at most hourly** by the free tiers.
- **Built-in offline rates are hand-maintained approximations** and drift over
  time; they are labelled `approximate` in the UI for that reason.
- **History is not timestamped with the rate used**, so a reloaded entry shows
  the conversion but the current rate may differ.
- Candidates if this grows: a small automated test for cross-rate symmetry
  (`A→B→A ≈ original`), a service worker for true offline-first caching,
  a chart of recent rate movement, and a "copied to clipboard" affordance.

---

## License

No license file has been chosen yet — add one before publishing.
