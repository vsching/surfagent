# Phase 1 Trading-Essentials Fork — Changes

> Fork of [AllAboutAI-YT/surfagent](https://github.com/AllAboutAI-YT/surfagent) with four additions for trading-stack agent workflows:
>
> 1. `POST /screenshot` endpoint
> 2. Headless mode toggle
> 3. Named persistent profiles
> 4. Audit log (JSONL per UTC date)
>
> Upstream remains the source of truth for the core API. PRs for each feature filed separately upstream.

## 1. `POST /screenshot`

Captures a full PNG of any tab, returns base64. Pairs with LLM Vision pipelines (Phronex AI, Hermes Agent, any GPT-4V workflow). The underlying `takeScreenshot()` helper already existed in `src/chrome/content.ts` as a CLI command — this just wires it as an HTTP endpoint.

**Request:**
```bash
curl -s -X POST http://localhost:3456/screenshot \
  -H "Content-Type: application/json" \
  -d '{"tab": "tradingview"}'
```

**Response:**
```json
{
  "ok": true,
  "tab": { "id": "...", "title": "...", "url": "..." },
  "format": "png",
  "mimeType": "image/png",
  "base64": "iVBORw0KGgoAAAANS...",
  "sizeBytes": 247813,
  "_screenshotMs": 142
}
```

Tab matching follows existing surfagent conventions (index `"0"`, URL/title partial match `"github"`, cross-origin iframe `"stripe.com"`).

## 2. Headless mode toggle

For cron-scheduled SOPs (hourly liquidation scans, daily broker balance pulls) where a visible Chrome window is noise.

**CLI flag:**
```bash
surfagent start --headless
surfagent start --headless --profile binance
```

**Or env var:**
```bash
HEADLESS=1 surfagent start
```

Adds `--headless=new` plus `--no-first-run --no-default-browser-check --disable-gpu` to the Chrome launch args (cron-stability defaults). Default behavior unchanged (visible Chrome) so existing users see no surprise.

## 3. Named persistent profiles

Each broker / account / tool typically has its own session: Binance, cTrader, MT5, TraderToolsPro, ScalperPro, TradingView. Default behavior copies cookies from system Chrome on first run, which is fine for one-off use but causes cross-contamination when multiple sessions need to coexist.

Named profiles get isolated Chrome `--user-data-dir`s under `~/.surfagent/profiles/<name>/`, and skip the cookie-copy step (so the profile is genuinely its own session, not seeded from your daily browser).

**CLI flag:**
```bash
surfagent start --profile binance
surfagent start --profile tradingview
surfagent start --profile ttp-paper
```

**Or env var:**
```bash
SURFAGENT_PROFILE=binance surfagent start
```

**Precedence:** `CHROME_USER_DATA_DIR` (explicit override) > `--profile NAME` > `SURFAGENT_PROFILE` env > `"default"`.

**Profile root override:**
```bash
SURFAGENT_PROFILE_ROOT=/Volumes/external/surfagent-profiles surfagent start --profile binance
```

**Default profile name** = `"default"`. The legacy unnamed `/tmp/surfagent-chrome` ephemeral profile is no longer used; back-compat preserved via `CHROME_USER_DATA_DIR` override.

## 4. Audit log

Every API request is recorded as a JSONL line under `~/.surfagent/audit/YYYY-MM-DD.jsonl` (UTC date). Captures: timestamp, endpoint, HTTP method, response status, duration in ms, error message on failure. Body content is NOT logged (deliberate — selectors and form values can be sensitive).

**Disable:**
```bash
AUDIT_LOG=off surfagent start
```

**Override dir:**
```bash
SURFAGENT_AUDIT_DIR=/var/log/surfagent surfagent start
```

**Replay via API:**
```bash
# Today (UTC)
curl -s http://localhost:3456/audit | jq

# Specific date + last 50 entries
curl -s 'http://localhost:3456/audit?date=2026-05-25&limit=50' | jq
```

**Response:**
```json
{
  "date": "2026-05-25",
  "entries": [
    { "ts": "2026-05-25T11:14:32.412Z", "endpoint": "/recon", "method": "POST", "status": 200, "durationMs": 247 },
    { "ts": "2026-05-25T11:14:33.811Z", "endpoint": "/click", "method": "POST", "status": 200, "durationMs": 89 },
    { "ts": "2026-05-25T11:14:35.002Z", "endpoint": "/read",  "method": "POST", "status": 404, "durationMs": 14, "error": "Tab not found: stripe" }
  ],
  "total": 3,
  "returned": 3
}
```

**Implementation:** middleware via `res.on('finish')` capturing status via a `writeHead` wrapper. Zero overhead per request when `AUDIT_LOG=off`; one JSONL append when on.

## What this fork did NOT add (deferred to Phase 2+)

- File download capture (`/download`)
- Mobile emulation (`/viewport`)
- Proxy support (`--proxy`)
- Network / WebSocket frame interception
- Parallel session daemons
- Captcha hand-off webhook
- Local auth token + rate limiting
- Structured error code shapes
- `/wait` for element, `/sequence` batch runner
- Accessibility tree, console capture, video recording
- Windows support

See `~/.claude/rules/surfagent-fork-roadmap.md` (in this user's global Claude config) for the full prioritized roadmap.

## Tracking upstream

```bash
git remote add upstream https://github.com/AllAboutAI-YT/surfagent.git
git fetch upstream
git merge upstream/main         # periodic re-base
```

When the fork's features land upstream, drop them from this fork and re-base. Until then, this branch stays ahead.
