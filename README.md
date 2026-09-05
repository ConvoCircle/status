# ConvoCircle Status

Public, $0 status page for [convocircle.ai](https://convocircle.ai).

**Live URL:** [https://convocircle.github.io/status/](https://convocircle.github.io/status/)

This is a tiny static site (HTML + CSS + JS, no SaaS, no npm dependencies). GitHub Actions probes production every ~15 minutes, commits a capped JSON history, and deploys to GitHub Pages. It does **not** email, SMS, or open Linear issues. Owner alerts stay on the private `socialTrainer` prod-smoke path (CON-25 / `prod-alert.sh`).

## What it checks

| Component | Probe | Healthy when |
|---|---|---|
| Web | `https://convocircle.ai` | HTTP 2xx, `<!doctype html`, hashed `/assets/index-*.js` bundle |
| Gemini | `https://aw5fewwcba.us-east-1.awsapprunner.com/health` | HTTP 200, body looks like health (`ok` / `true` / `healthy` / `status`) |
| ElevenLabs | `https://d3v6ck6pnt.us-east-1.awsapprunner.com/health` | same |
| Stripe | `https://xjmupy2vgu.us-east-1.awsapprunner.com/health` | same |
| OpenRouter | `https://x43vfkbj3d.us-east-1.awsapprunner.com/health` | same |
| Hourly scenarios | Latest `hourly-prod-scenarios.yml` on socialTrainer | Latest completed run succeeded |
| Nightly LLM probe | Latest `nightly-prod.yml` | Latest completed run succeeded |
| Health probe (Actions) | Latest `prod-health.yml` | Latest completed run succeeded |

User-Agent: `convocircle-status-probe`. One retry after 5s on failure. Slow 2xx (≥5s) is **Degraded**; failed fetch / bad body is **Down**.

Production CI is the **latest** socialTrainer Actions conclusion (not a live LLM replay on this repo). A failed hourly scenario job marks that component **Down** and the page is not all-green. Stale success (hourly older than 3h, nightly older than 36h, health older than 45m) is **Degraded**.

CI conclusions come from, in order: GitHub Actions API (when `SOCIALTRAINER_ACTIONS_TOKEN` is set) and `data/ci-feed.json` (public JSON written by socialTrainer after each prod run). No secrets are committed.

Hourly scenario pills and chips are **mechanical** (engine/proxy). Public chips show Passed / Failed per script — never invite, date, or come-on results. Scenario healthy ≠ she said yes.

The page never stores proxy response bodies (Stripe `/health` includes config flags we do not publish).

## How it works

1. `.github/workflows/status.yml` runs on `7,22,37,52 * * * *` UTC (and `workflow_dispatch`).
2. `node --test probe.test.mjs` then `node probe.mjs` writes `data/status.json` + `data/history.json` (last ~30 days of samples) and merges `data/ci-feed.json` / GitHub Actions conclusions into Production CI components.
3. The same job deploys those files to the `github-pages` environment.
4. The static page reads the JSON in the browser and shows overall status, per-component pills, 24h ticks, and 24h / 7d / 30d uptime.
5. An incident banner appears while any component is **Down**. Optional: a public GitHub Issue labeled `incident` is opened/closed in **this** repo (log only — not a page).

## Local

```bash
node --test probe.test.mjs
STATUS_PROBE_RETRY=0 node probe.mjs
python3 -m http.server 4173
# open http://127.0.0.1:4173/
```

## Cost

GitHub Free: public repo + Actions + Pages. No App Runner, no paid Statuspage, no uptime SaaS.

## Custom domain (optional, out of scope)

`status.convocircle.ai` can later CNAME to `convocircle.github.io` with a `CNAME` file in this repo. Not required for v1.

## First-time publish

If this directory still lives inside the private `socialTrainer` repo, see [SETUP.md](SETUP.md). Creating `ConvoCircle/status` needs an org owner token; the cloud agent App cannot create new org repos.
