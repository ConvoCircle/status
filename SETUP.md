# Publish ConvoCircle/status (one-time)

The cloud-agent GitHub App can push to `ConvoCircle/socialTrainer` only. It **cannot** `gh repo create ConvoCircle/status` (403 `createRepository`). An org owner (Deniz) does this once.

## Click-ops

1. Create the public repo (empty, no README):
   ```bash
   gh repo create ConvoCircle/status --public --description "ConvoCircle public status page"
   ```
   Or GitHub UI: org **ConvoCircle** → New repository → name `status` → **Public** → create (do not add a license/README if you will run the script below).
2. From a clone of `socialTrainer`:
   ```bash
   bash scripts/bootstrap-status-repo.sh
   ```
   That copies `status-page/` to `ConvoCircle/status` `main` and enables Pages (`build_type=workflow`).
3. **Actions** on `ConvoCircle/status`: allow GitHub Actions if the org prompts. Open **Status probe** → **Run workflow**.
4. **Settings → Pages**: Source must be **GitHub Actions**. Approve the first `github-pages` environment deployment if the org asks.
5. **Important:** after that first approval, turn **off** required reviewers on the `github-pages` environment (Settings → Environments). If reviewers stay on, the 15-minute cron cannot publish. History still commits even if Pages is waiting — probe and publish are separate jobs.
6. Bookmark **https://convocircle.github.io/status/** (project site; trailing slash matters).

Until those steps land, this tree is the complete site + workflow, ready to copy.

## After it is live

- Do not host this on App Runner / convocircle.ai (the status page would die with the app).
- Do not add `RESEND_API_KEY`, SMS numbers, or Linear keys here.
- Owner alerts remain CON-25 in `socialTrainer`.

## CON-27 — latest prod CI on the public page

The page shows hourly scenarios + nightly + health **Actions** conclusions as well as HTTP probes. Pick **one** of these (both is best):

1. **Status repo polls socialTrainer Actions** (recommended for “always latest”):
   - Create a fine-grained PAT with **Actions: Read** on `ConvoCircle/socialTrainer`.
   - Add it as secret `SOCIALTRAINER_ACTIONS_TOKEN` on `ConvoCircle/status`.
   - The existing 15-minute Status probe then reads the latest workflow runs.

2. **socialTrainer pushes a public feed** after each prod job:
   - Create a fine-grained PAT with **Contents: Write** and **Actions: Write** on `ConvoCircle/status`.
   - Add it as secret `STATUS_REPO_TOKEN` on `ConvoCircle/socialTrainer`.
   - Hourly / nightly / health jobs write `data/ci-feed.json` (no secrets) and dispatch **Status probe**.

Re-run `bash scripts/bootstrap-status-repo.sh` from socialTrainer after pulling CON-27 so `ci.mjs` and the Production CI section land on `ConvoCircle/status`. If OAuth lacks the `workflow` scope, push `.github/workflows/status.yml` over SSH from a Mac as before.

Until a token exists, HTTP health still updates; CI pills stay “No completed run yet” / last committed `ci-feed.json`.
