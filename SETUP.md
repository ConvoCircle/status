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
