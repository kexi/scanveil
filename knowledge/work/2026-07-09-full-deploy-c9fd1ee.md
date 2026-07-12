# 2026-07-09 Full Deploy at c9fd1ee

Deployed commit: `c9fd1ee` "Codex/restrict console repository access (#49)" (squash of the prior 12 local commits plus console access restrictions, scan runtime fixes, Cloud Armor scaffolding). Local main was reset to `origin/main` before deploying; CI was green on this commit and local `pnpm build && pnpm test` passed.

## Cloud Build (project kexi-380010)

Images now live in the new `scanveil-apps` Artifact Registry repo (moved off `gcf-artifacts`, whose Firebase cleanup policy had deleted a worker image). The repo pre-existed in GCP and was imported into Terraform state.

- API: build `335bcd4b-49a8-4204-bb88-2c84c4d2ae19` → `scanveil-api@sha256:1474e9a2e2e6dd18514939e382e94fd7e476fb4d74b20b1962a3e2cbd1074feb`
- Console: build `00bd1bbd-3551-4ca7-9a10-5d7e2f8d8a8d` → `scanveil-web@sha256:272dbd50c511a9e4e644feef10ce42bf44b3182a6d617ca9cf7733fbc2a59740`
- Worker: build `53157c7b-bd15-43e3-8aa3-d4f27a2f01e8` → `scanveil-worker@sha256:3947f505843a028aef7eabe3c1a3b985ac786defd080c1e53ad9f8ffa8d4969a`
- Agy runner: build `66886e50-b64d-478a-9434-6d9c9e1c4f59` → `scanveil-agy-runner@sha256:4e53f5a03763096f78e9c55f2f48d9c86922b603bc42813a09a84fd69a76f10a`

## Terraform (infra/terraform, local state)

Final result: 26 add / 5 change / 16 destroy across three applies, converging to "No changes". Highlights:

- Image repins for `scanveil-api`, `scanveil-web` (revision `scanveil-web-00054-8fs`, API `scanveil-api-00010-rjb`), `scanveil-worker`, `scanveil-agy-runner`.
- Shared `scanveil-runtime` SA replaced by per-service SAs (`scanveil-web-runtime`, `scanveil-api-runtime`, `scanveil-worker-runtime`, `scanveil-functions-webhook`, `scanveil-functions-admin`) with scoped IAM.
- Pub/Sub topic/subscription `scanveil-scan-requests` destroyed (API now triggers worker via `run.jobs.runWithOverrides` custom role).
- Cloud Armor / shared edge left off (`enable_shared_edge=false` default).

Vars used (no tfvars file; passed via CLI): `project_id=kexi-380010`, `github_app_id=4099256`, `github_oauth_client_id` (read it from Terraform state or the GitHub App settings; not written here so the note passes gitleaks), `enable_api/worker/agy_runner=true`, plus the four image digests above.

Fixes needed during apply:

1. Imported pre-existing resources into state: `google_artifact_registry_repository.apps`, `google_service_account.functions_admin_runtime`, `google_service_account.functions_webhook_runtime` (all created out-of-band earlier; applies 409'd otherwise).
2. `main.tf` bug: custom role `scanveilWebSchedulerManager` listed nonexistent permission `cloudscheduler.jobs.resume`; the valid permission is `cloudscheduler.jobs.enable`. Fixed in working tree (needs commit).

## Firebase (project kexi-380010)

- Hosting: docs (`kexi-380010` site) and admin SPA (`scanveil-admin` site) deployed via `just deploy-firebase`.
- Functions `githubWebhook` + `adminApi`: first deploy failed twice:
  1. Non-interactive deploys need a dotenv for the new `defineString("GITHUB_APP_ID")` param → created gitignored `apps/functions/.env` with `GITHUB_APP_ID=4099256`. Keep this file for future deploys.
  2. GCF npm chokes on `workspace:*` devDependencies (`@scanveil/core`, `@scanveil/github` added in c9fd1ee): `EUNSUPPORTEDPROTOCOL`. Workaround: temporarily stripped the two workspace entries from `apps/functions/package.json`, deployed, restored. Needs a durable fix (e.g. predeploy script that stages a pruned package.json, since tsdown bundles `@scanveil/*` into `dist/index.mjs` anyway).
- Function URLs: `https://adminapi-pzxfl7f2sa-uc.a.run.app`, `https://githubwebhook-pzxfl7f2sa-uc.a.run.app`.

## Verification

- `scanveil-web` and `scanveil-api` latest revisions Ready=True on the new digests; web runs as `scanveil-web-runtime` SA.
- `https://console.scanveil.kexi.dev` → 302 (login redirect), docs and admin SPA → 200, `adminApi` → 401 unauthenticated (expected).
- Worker execution `scanveil-worker-xr5bt` on the new image completed: logs show `scheduled_scan_started → scan_started → scan_finished → scheduled_scan_finished`, no errors or skip events.
