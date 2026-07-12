---
type: Work Summary
title: Admin-wide scan, Scanveil branding, social preview, and deploy
description: Implementation record for the Scanveil admin dashboard, repository-wide manual scans, branding assets, docs icons, configuration, and deployment.
resource: https://github.com/kexi/gcp-hackathon-poc
tags: [scanveil, admin, cloud-run, firebase-hosting, github-app, social-preview]
timestamp: 2026-06-20T14:46:50Z
---

# Admin-wide scan, Scanveil branding, social preview, and deploy

## Summary

The admin surface now shows real GitHub App installation data and provides one top-level Scan action. The action enqueues installed repositories at their default branch head SHA, rather than exposing a Scan button for each pull request.

The product surfaces were also tightened around the Scanveil name, with favicon, header icon, social preview metadata, docs icons, and repository-local `.scanveil.yml` configuration.

## Scope

- Admin app
- Docs site
- GitHub App repository listing
- Manual scan enqueue flow
- Cloud Run deployment
- Firebase Hosting deployment
- Repository-local project knowledge

## Admin Changes

- Migrated Admin from Astro to Vite React.
- Kept server entry in `apps/console/src/server.ts`, built with `tsdown`.
- Added MUI and `@mui/icons-material` to Admin.
- Displayed GitHub App repositories and open pull requests from live GitHub App installation data.
- Replaced per-PR Scan forms with a single top-level Scan button.
- Added `startAllManualScans()` in `apps/console/src/manual-scans.ts`.
- `POST /scans/start` now enqueues installed repositories for default-branch repository-wide scanning.
- Success redirects include `scan=queued` and `count=<number>`.

## Scan Semantics

Current repository-wide Management Console scan means:

- Fetch installed repositories visible to the GitHub App.
- Read each repository default branch head SHA.
- Enqueue one worker job per installed repository.

For repository-wide manual scans, the worker now runs bounded default-branch source snapshots through LLM review and lockfile-based OSV scanning on the default branch. Pull request webhook scans still run PR diff review.

## Branding and Social Preview

- Renamed Admin display from `Scanveil Admin` to `Scanveil`.
- Added SVG icon at:
  - `apps/console/public/icon.svg`
  - `apps/docs/public/icon.svg`
- Added 1200x630 preview PNG at:
  - `apps/console/public/og-image.png`
  - `apps/docs/public/og-image.png`
- Added `og:*` and `twitter:*` metadata for link previews.
- Added Material Symbols icons to docs navigation and CTA links.

## Repository Config

Added `.scanveil.yml` at the repository root.

The repository stays in advisory mode:

- `checks.conclusionMode: advisory`
- `scan.llm.enabled: true`
- `scan.osv.enabled: true`
- `suppression.enabled: true`
- `schedule.enabled: true`

## Deployment

Admin Cloud Build:

- Build ID: `d0b06d12-bc95-4a54-a4f8-5201cb41bf85`
- Image: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-web:manual`
- Digest: `sha256:23694f4f5e1388e3814578edf57882b534426025d6d401f261c80d1a2a0da1e6`

Cloud Run:

- Service: `scanveil-web`
- Region: `us-central1`
- Revision: `scanveil-web-00010-zpq`
- Traffic: `100%`
- Legacy Admin URL before the Management Console rename: `https://admin.scanveil.kexi.dev/login`

Management Console domain migration:

- New console URL: `https://console.scanveil.kexi.dev/login`
- Terraform local names were moved from `admin` wording to `console` wording.
- `SECURITY_APP_WEB_BASE_URL` is expected to point at `https://console.scanveil.kexi.dev` after Terraform apply.

Firebase Hosting:

- Project: `kexi-380010`
- Hosting URL: `https://kexi-380010.web.app`
- Public docs URL: `https://www.scanveil.kexi.dev/`
- Pinned function updated during deploy: `githubWebhook(us-central1)`

## Verification

Commands run during the work:

- `pnpm --filter @scanveil/console typecheck`
- `pnpm --filter @scanveil/console build`
- `pnpm --filter @scanveil/docs typecheck`
- `pnpm --filter @scanveil/docs build`
- `pnpm --filter @scanveil/core test`
- `just format-check`
- `just lint`
- `just typecheck`
- `just test`
- `just build`

## 2026-06-20 Scan Worker Verification

Follow-up deployment added the production scan worker path:

- Console image digest: `sha256:8b43c03b1e4d0d4c9f5b1edbc6cbafd7723328593ffd36acc7c0187f5fb51add`
- API image digest: `sha256:eebf19f81f815b54ef434267e4d73ba229f12eb7b1cf64f1f9d26f7cbaeef99a`
- Worker image digest: `sha256:bf4e68a4ba2a87b7f736251c28794db7c5728da3dd0ef47c1d5aedfc90941172`
- Firebase deploy updated Hosting and `githubWebhook(us-central1)`.
- Terraform apply added Cloud Scheduler, Functions Firestore/Run IAM, API worker env vars, and pinned Cloud Run services/jobs to image digests.
- Worker execution `scanveil-worker-qwpbk` completed successfully.
- Delivery `scheduled-7e52a40f-224e-4c9a-ba14-6e5310ef08b2` persisted `scanRuns.status: succeeded`, `findingCount: 3`, and 3 `scanFindings` documents.
- GitHub Check creation was skipped with `github_checks_permission_denied`; the GitHub App installation needs Checks read/write permission approval before Checks can be published.

## 2026-06-21 OSV Scanner Worker Verification

Follow-up deployment bundled the official OSV Scanner binary in the worker image:

- Worker image digest: `sha256:d8309a3dcbaedeebc03ed417a1831a4f225de4330af72bb449c055ae68084664`
- Terraform apply changed only `google_cloud_run_v2_job.worker[0]` from the previous worker digest to this digest.
- Cloud Run execution `scanveil-worker-247mz` completed successfully with the new image.
- Delivery `scheduled-bebe8f58-7253-4a81-9578-932f954a207c` persisted `scanRuns.status: succeeded`, `target: repository`, `findingCount: 3`, and 3 `scanFindings` documents.
- The execution log did not include `osv_scan_skipped`, confirming the deployed worker found the bundled `osv-scanner` binary.
- GitHub Check creation is still skipped with `github_checks_permission_denied` until the GitHub App installation approves Checks read/write permission.

## 2026-06-21 GitHub Check Publication Verification

Final verification after GitHub App installation approval:

- App and installation both include `checks: write`.
- Cloud Run execution `scanveil-worker-lwps6` completed successfully with worker image digest `sha256:d8309a3dcbaedeebc03ed417a1831a4f225de4330af72bb449c055ae68084664`.
- Logs contained `scan_finished` with `findingCount: 1` and did not contain `github_check_skipped`.
- Delivery `scheduled-4b071eed-714a-480e-83a3-4211ddb6a6d4` persisted `scanRuns.status: succeeded`, `target: repository`, `headSha: 956604f6ec3718ac5a4acbf8024d7b789a57dcd0`, `findingCount: 1`, and 1 `scanFindings` document.
- GitHub Check Run `Scanveil` was created by the `scandock` app for commit `956604f6ec3718ac5a4acbf8024d7b789a57dcd0`.
- Check Run URL: <https://github.com/kexi/gcp-hackathon-poc/runs/82517208366>

## Follow-up Ideas

- Add a detailed finding drilldown view with filtering and direct GitHub Check links.
- Add repository-scoped SVE-ID generation using DB-backed counters.
- Manage DB-facing record contracts with Zod schemas in `packages/core`.
- Add an OKF visualizer or index generation for `knowledge/`.
