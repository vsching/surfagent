# Multi-Tab & Multi-Window Targeting (Agent Guide)

How to drive the **correct** tab/window when several are open at once. Read this
before any task that touches more than one tab or more than one logged-in
account.

---

## TL;DR for agents

1. **Always `GET /tabs` first.** Never guess a tab.
2. **Label a tab once with `POST /label`, then drive it by that label forever.**
   Most robust handle — survives navigation AND daemon restarts.
3. Alternatively, open with `"keepTab": true`, save the returned `tabId`, drive
   by that exact `tabId`. Exact id never matches the wrong tab (but it churns on
   a daemon→Chrome reconnect; labels do not).
4. **If you get HTTP `409 AMBIGUOUS_TAB`, pick a candidate from `.matches` and
   retry with its exact `id` or `index`.** Do not retry the same substring.
5. **Separate accounts → separate daemons (ports), not separate tabs.**

---

## Labels — the durable handle (recommended)

`POST /label {tab, label}` tags a tab with a human-readable name, stored as the
page's `window.name`. It **survives navigation within the tab and survives a
daemon restart / CDP reconnect** (where raw tab ids churn). Resolve later calls
by the label.

```bash
# find the tab, label it once
curl -s localhost:3456/tabs | jq .
curl -X POST localhost:3456/label -d '{"tab":"0","label":"btc-chart"}'

# forever after, address it by label — unique, stable, survives reload
curl -X POST localhost:3456/read -d '{"tab":"btc-chart"}'
curl -X POST localhost:3456/eval -d '{"tab":"btc-chart","expression":"document.title"}'

# GET /tabs shows the label column
curl -s localhost:3456/tabs | jq '.tabs[] | {index,title,label}'

# clear a label
curl -X POST localhost:3456/label -d '{"tab":"btc-chart","label":""}'
```

Resolution order for the `tab` field: **index → exact id → label → substring.**
Label beats substring, so a labelled tab is never lost to ambiguity.

Notes:
- A label maps to exactly one tab; a tab carries at most one label. Re-labelling moves it.
- The label dies only when the tab closes (correct).
- Rare edge: some sites (mostly OAuth popups) overwrite `window.name` themselves
  and can clear the label. For those, fall back to exact `id`.

---

## How `tab` resolves

Every endpoint (except `/recon` by `url`) takes a `tab`. It resolves in this
order:

| Form | Example | Ambiguous? |
|---|---|---|
| numeric **index** | `"0"`, `"2"` | No — position in `GET /tabs` |
| exact **tab id** | `"E4A1...id"` | No — unique |
| **URL/title substring** | `"tradingview"`, `"login"` | **Yes if >1 tab matches** |

Index and id are exact and safe. Substring is convenient but **ambiguous when
two tabs share a domain or title** (e.g. two TradingView charts).

### Stability note
- **id** is unique and stable *within a session*, but can change if the daemon
  reconnects to Chrome (restart). After a restart, re-run `GET /tabs`.
- **substring** survives navigation and reconnect, but is ambiguous.
- **index** can shift as tabs open/close.

Best practice: open with `keepTab:true`, capture `tabId`, use it. Re-list
`/tabs` if you ever get a "Tab not found".

---

## The AMBIGUOUS_TAB error

If a substring `tab` matches more than one tab, the API **refuses to guess** and
returns:

```
HTTP 409
{
  "ok": false,
  "code": "AMBIGUOUS_TAB",
  "pattern": "tradingview",
  "error": "Ambiguous tab: \"tradingview\" matched 2 tabs. Re-target by exact index or id. Candidates: ...",
  "matches": [
    { "id": "A1", "index": 0, "title": "TradingView BTC", "url": "https://tradingview.com/chart/1" },
    { "id": "B2", "index": 1, "title": "TradingView ETH", "url": "https://tradingview.com/chart/2" }
  ]
}
```

**Agent recovery:** inspect `matches`, choose the one whose `title`/`url` is what
you want, and retry the call with its exact `id` (preferred) or `index`. Never
re-send the same ambiguous substring — you will loop.

This applies to all action endpoints (`/fill`, `/click`, `/read`, `/eval`,
`/type`, `/scroll`, `/navigate`, `/dispatch`, `/focus`, `/screenshot`).

---

## Worked example: two charts in one window

```bash
# 1. See what's open
curl -s localhost:3456/tabs | jq .

# 2. Open a chart and KEEP it; capture the id
TAB_A=$(curl -s -X POST localhost:3456/recon \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://tradingview.com/chart/1","keepTab":true}' | jq -r .tabId)

# 3. Drive it by exact id — never ambiguous
curl -s -X POST localhost:3456/read \
  -H 'Content-Type: application/json' \
  -d "{\"tab\":\"$TAB_A\"}"

# Driving by "tradingview" instead would 409 if a second TV tab exists.
```

---

## Parallel windows = parallel daemons

One daemon drives **one** Chrome window with **one** profile (one logged-in
session per domain). To run multiple accounts of the same site at the same time
(e.g. binance live + binance demo), start **separate daemons** on separate
ports, each with its own profile. Each daemon launches its **own Chrome
window**.

```bash
# Daemon 1 — binance live (defaults: api 3456, cdp 9222)
surfagent start --profile binance

# Daemon 2 — demo account, own ports + own window
surfagent start --profile demo --port 3457 --cdp-port 9223
```

Then the agent targets a **session by port**, and a **tab by label** within it:

```bash
curl -s localhost:3456/tabs   # binance-live window
curl -s localhost:3457/tabs   # demo window
```

Ports cannot cross wires — choosing the port chooses the account. This is the
robust way to "test multiple windows at the same time".

| Need | Use |
|---|---|
| Several pages, same login | one daemon, many tabs, target by **label** |
| Several pages, *different* logins of the same site | one daemon per account, target by **port** |

Your personal Chrome is never touched — each daemon's profile lives under
`~/.surfagent/profiles/<name>/`.

---

## Who drives: inline vs sub-agent vs separate daemon

Choosing *who* drives matters as much as *which* tool.

1. **Drive inline** (the agent curls endpoints directly). Default. Short flows
   (≤ a handful of steps) where you need the result in your own context — login
   check, read one value, fill one form, verify a deploy.
2. **Delegate to a sub-agent** (`Explore` / `general-purpose`). When the browsing
   is long/multi-step and would bloat context, or you only want the *conclusion*
   not the page dumps. Hand the sub-agent the **label** (or **port**) to target.
   Cap ≤15 min, no full test suites inside, monitor output, kill + audit if it
   stalls.
3. **Separate daemon (own port + profile).** For genuinely parallel sessions or
   multiple logins of the same site. **This — not sub-agents — is where
   parallelism comes from.**

**The trap:** spawning N sub-agents against **one** daemon does NOT parallelize.
One daemon = one Chrome, so they serialize and clobber each other's tabs. Labels
reduce accidental cross-talk, but it is still a single browser. For real
concurrency give each worker its **own daemon/port**.

Shortcut:
- short + need result here → **inline**
- long/noisy + just want the answer → **sub-agent** (one daemon, one task)
- truly concurrent / multi-account → **one daemon per worker** (`--port`/`--cdp-port`)

---

## Debugging "wrong tab / nothing happened"

1. `GET /tabs` — confirm the tab exists; read its `label` + `url`. Wrong url = wrong target.
2. `409 AMBIGUOUS_TAB` — substring hit >1 tab. Pick from `matches`, retry by exact `id`, or `/label` it.
3. Action ran, no visible effect — `/eval` the runtime state (JS globals / framework controller) instead of trusting DOM text; `/recon` to re-read selectors (SPA may have re-rendered).
4. `Tab not found` after it worked earlier — id churned on a CDP reconnect. Re-`GET /tabs`; address by **label** (survives reconnect), not id.
5. Everything fails → `surfagent health`; daemon down or on a different port.

---

## Decision checklist

- Same account, multiple pages? → one daemon, label each tab, drive by **label**.
- Different accounts of same site simultaneously? → one daemon **per account**
  on distinct `--port`/`--cdp-port`, drive by **port**.
- Long/noisy browsing, only want the answer? → **sub-agent** (one daemon).
- Got `409 AMBIGUOUS_TAB`? → pick from `.matches`, retry with exact `id`, or label it.
- Got `Tab not found`? → `GET /tabs`; id churned on reconnect — use the **label**.
