---
type: Change Log
title: Scanveil knowledge log
description: Chronological history of notable Scanveil repository changes captured as project knowledge.
resource: ./index.md
tags: [scanveil, log, deployment]
timestamp: 2026-06-20T14:46:50Z
---

# Scanveil knowledge log

## 2026-10-26

- Updated the Nix flake inputs; nixpkgs now ships pinact v5, which only accepts long flags with two dashes, so `supply-chain:pinact` uses `--check --verify-comment --verify-min-age --min-age 1`.
- Cleared the OSV Scanner CI gate by bumping catalog packages (firebase-tools 15.34.1, firebase 12.19.0, firebase-functions 7.4.0, @google/genai 2.31.0, vite 8.3.5, vitest 4.1.12, zod 4.6.7, dompurify override 3.4.17), refreshing vulnerable transitive packages with `pnpm update -r`, and overriding `@grpc/grpc-js` to 1.14.6 because `@firebase/firestore` pins `~1.9.0` with no patched 1.9.x release. Verified with local `osv-scanner scan pnpm-lock.yaml` (exit 0) plus format, lint, typecheck, test, build, e2e, terraform-check, gitleaks, and pinact.

## 2026-07-12

- Deployed `main` at `7567d06` to Firebase (docs, admin, functions), `scanveil-web` (revision 00062), and `scanveil-worker` (generation 38); details in `knowledge/work/2026-07-12-full-deploy-7567d06.md`.
- Fixed the scheduled-scan settings 403 by granting the console runtime `roles/iam.serviceAccountUser` on the scheduler service account (Terraform codification in PR #88).
- Added the judge-facing system architecture diagram (`knowledge/architecture/scanveil-architecture-judges.drawio`) and the demo video slide deck (`knowledge/slides/scanveil-demo-slides.html`) to the repository.
- Reworded presentation materials: "embeddings" is now 「ベクトル化」 for a Japanese audience, and the AI review is described as an Antigravity SDK agent with Gemini as the default model instead of "Gemini (Antigravity SDK)", since the SDK itself is multi-model.

## 2026-07-03

- Restored the `scanveil-worker` Cloud Run Job after executions failed before startup because the configured Artifact Registry image tag `scanveil-worker:a1ba159` did not exist.
- Built and pushed `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker:96f5884` with Cloud Build, then updated `scanveil-worker` generation 23 to use that image.

## 2026-06-28

- Added default-off Terraform switches for a future shared HTTPS Load Balancer edge and shared Cloud Armor policy, plus the Cloud Armor edge rollout plan under `knowledge/reference/`.
- Deployed Fix PR run queue improvements to `scanveil-web` revision `scanveil-web-00043-bhx` and updated `scanveil-agy-runner` generation 8 so AGY fix proposals using `replacementContent` are normalized to the expected `content` schema.

## 2026-06-20

- Renamed product surfaces from Tracevia to Scanveil.
- Documented active URLs for docs, admin, and GitHub webhook.
- Replaced the mock admin dashboard with real GitHub App repository and open pull request data.
- Migrated the admin app from Astro to Vite React with `tsdown` for the server bundle.
- Added repository-wide manual Scan action in Admin, enqueueing installed repositories instead of showing per-PR Scan buttons.
- Added MUI Material Icons to Admin actions and external links.
- Added Scanveil SVG icon, favicon wiring, and social preview images for Admin and docs.
- Added Open Graph and Twitter card metadata for link previews.
- Added `.scanveil.yml` for this repository.
- Added Material Symbols icons to docs navigation and primary links.
- Deployed Admin to Cloud Run revision `scanveil-web-00010-zpq`.
- Deployed docs to Firebase Hosting project `kexi-380010`.
- Prepared Management Console domain migration from `admin.scanveil.kexi.dev` to `console.scanveil.kexi.dev`.
- Renamed the management app directory from `apps/web` to `apps/console`.
- Added public JSON Schema for `.scanveil.yml` under docs static assets.
- Updated repository-wide manual Scan to work even when no open pull requests exist.
- Added a Mermaid infrastructure diagram under `knowledge/architecture/`.
- Added naming, domain, and tool terminology reference under `knowledge/reference/`.
- Added GitHub App settings reference under `knowledge/reference/`.
- Added Firestore-backed Scan execution history design and default-deny Firestore rules.

## 2026-06-21

- Updated Scanveil product banner (`og-image.png` in docs and console) with a newly generated premium 3D design matching the SVG logo.
- Added a system overview knowledge file covering product surfaces, runtime flow, data flow, persistent data, and repository boundaries.
- Started migrating docs from Astro to Vite React and updated knowledge references for the new docs runtime.
- Added the Scanveil AI scan agent reference, documenting Vertex AI requirements, diff scope, output validation, and structured logs.
- Added the experimental Antigravity runner evaluation, including the separate PEP 723/uv runner, `.scanveil/config.yml` migration, timeout boundaries, and no-npx MCP policy.
- Added repository-wide LLM source snapshot review, Firestore `scanFindings` persistence, and Management Console finding summaries in Scan history.
- Deployed the worker with a bundled OSV Scanner binary and verified a repository-wide scan persisted 3 findings to Firestore.
- Verified the live GitHub App and repository installation still lack Checks write permission, blocking GitHub Check publication while Firestore persistence succeeds.
- Verified GitHub App installation Checks write permission, reran the worker, and confirmed GitHub Check Run publication plus Firestore persistence.
- Deployed the experimental Antigravity runner Cloud Run Job with Nix-provided Python/uv, patched the vendored `localharness` binary for the NixOS image, and verified execution `scanveil-agy-runner-p4lqs` completed successfully.
- Implemented repository-scoped SVE-ID assignment, Firestore-backed duplicate lookup, SVE detail history in the Management Console, and LLM model/token usage persistence for scan runs.
- Documented that the current Firestore duplicate lookup does not require a vector index because the worker filters by repository and computes cosine similarity locally.
- Deployed the SVE-ID/LLM usage update to `scanveil-web` revision `scanveil-web-00014-2f5` and `scanveil-worker`, then verified execution `scanveil-worker-mz7rt` persisted 4 SVE-backed findings and LLM usage to Firestore.
- Added scan cost visibility for Vertex AI-backed LLM review by persisting provider, model, token counts, estimated USD cost, Vertex AI location, and Cloud Run runner region to `scanRuns`; the experimental agy-runner now emits provider/location usage metadata with cost marked unavailable.
- Deployed scan cost and execution-region visibility to `scanveil-web` revision `scanveil-web-00015-gpp`, `scanveil-worker`, and `scanveil-agy-runner`; verified worker execution `scanveil-worker-h4p6t` persisted Vertex AI cost `0.00890725`, `llmLocation: global`, and `runnerRegion: us-central1` to Firestore.
- Added LLM output streaming for active scans: scanner uses `generateContentStream`, worker stores short UI chunks in Firestore `scanStreamChunks`, full LLM output in Cloud Storage, and Console renders SSE chunks with TanStack Query `experimental_streamedQuery`.
- Updated the infrastructure architecture knowledge for the current admin and scan runtime: Firebase Hosting `/admin`, Firebase Auth guarded `adminApi`, invite code collections, disabled users, same-worker OSV plus LLM execution, Firestore `scanStreamChunks`, Cloud Storage full LLM output, Scan Details OSV/LLM display, Scan History `new` badges, and SVE copy workflow.
- Added hackathon requirements fit reference, documenting that Scanveil satisfies the required runtime category with Cloud Run, the required AI category with Gemini API through Vertex AI, and the optional category with Firebase.
- Split Operator Admin onto the `scanveil-admin` Firebase Hosting site at `admin.scanveil.kexi.dev`, with `/api/**` rewriting to `adminApi`, domain-wide `robots.txt` crawl denial, Cloud DNS records, and Firebase Auth Google sign-in configuration for the admin domain.
- Added GitHub Issue creation from Scan Detail findings, requiring an enabled Console user and using the scan run GitHub App installation token for the target repository.
- Deployed the Issue creation update to `scanveil-web` revision `scanveil-web-00022-pxs` with image digest `sha256:7881877f36c6a082114f6c0a42dbf04b5a45ee3e0de0fa0da2d408a6480ae9d6`.
- Deployed the Operator Admin `Action` to `Access` label update to the `scanveil-admin` Firebase Hosting site; full `deploy-firebase` failed because Firebase Functions attempted Secret IAM setup for a missing `scanveil-functions-webhook` service account, so `hosting:scanveil-admin` was deployed separately.

## 2026-06-22

- Added deterministic SVE fingerprints and a Firestore `sveFingerprints` index so exact same-location, same-content findings reuse the canonical SVE before vector similarity is considered.
- Updated the Management Console Scan History first column to show the linked Scan ID directly instead of a generic Details text link.
- Added Firestore Vector Search support for SVE semantic deduplication by writing `embeddingVector` on new `scanFindings` and querying nearest neighbors before falling back to local cosine similarity.
- Changed repository scan actions so the Console opens a Basic/Advanced dialog: Basic runs with repository/default config, while Advanced edits YAML and scans with that temporary override.
- Added admin-managed global LLM policies stored in Firestore `llmPolicies`, with a built-in Node.js `minimumReleaseAge >= 1440` supply-chain policy applied across scans.
- Added invite-backed GitHub installation policies for both organization and user installations, so only enabled installations with an invite code can enqueue PR, scheduled, or manual scans.
- Added SVE resolution verification in the Management Console: SVE status is derived from the latest successful repository scan, with Dashboard and SVE detail actions to enqueue verification scans for unresolved SVE repositories.

## 2026-06-24

- Added Console repository access filtering based on signed-in GitHub user login and OAuth `read:org` organization memberships. Console dashboard data, scan history, scan details, SVE details, streams, LLM output, issue creation, cancel actions, installation policy settings, repository config reads, branch reads, Scan All, direct scans, and SVE verification now hide or reject repositories outside the user's account and organizations.

## 2026-06-25

- Tightened Console repository access from organization membership to signed-in user repository visibility. Login now requests GitHub OAuth `repo`, reads `/user/repos`, stores repository IDs and GitHub repository `owner/repo` values in Firestore `inviteUsers`, and keeps the signed cookie small by storing only user identity.
- Added `repositoryId` to scan requests, `scanRuns`, `scanFindings`, and `scanStreamChunks` so history, Scan Detail, and SVE filtering use GitHub repository IDs and tolerate repository rename/transfer better.

## 2026-06-26

- Removed the old-record compatibility fallback for repository identity fields while the Firestore data model is still disposable. New scan runs, findings, and stream chunks require GitHub repository IDs, and old Firestore documents without these fields should be deleted before using the updated Console.
- Added server-side manual scan repository re-resolution and worker-side `SCAN_REQUEST_JSON` repository validation so client-supplied repository tuples cannot pair an accessible repository ID with another owner/repository or installation.
- Made Console repository access snapshots expire by default, denying repository access when the Firestore login snapshot is missing or stale until the user signs in again.

## 2026-06-27

- Re-audited Console repository access with subagents and tightened the remaining repo information boundaries: history/SVE finding grouping now verifies each finding against the authorized scan run repository, live scan streams filter chunks by run repository before sending SSE events, repository config/branch APIs require `repositoryId`, and installation policy responses expose only the signed-in user's visible repository count for that owner.
- Added public Privacy and Terms documentation for the Beta / PoC service, including necessary-cookie usage, code and LLM data handling, contact email, deletion request path, and initial retention targets for scan runs, findings, stream chunks, LLM output objects, repository access snapshots, and invite users.
- Added Agy runner repository asset staging for audit-specific `.scanveil/skills`, `.scanveil/plugins`, and `.scanveil/mcp`, keeping developer-local Antigravity skills/plugins/MCP/custom agent assets out of scans.

## 2026-06-28

- Added a Console-to-worker fix PR design: SVE detail can enqueue a single repository-scan finding for Agy runner fix proposal generation, while the worker keeps GitHub writes outside the runner and creates a draft PR through the Git Data API.

## 2026-06-29

- Tightened the API GitHub webhook entry point to only accept `POST /webhooks/github`, require signed GitHub delivery/event headers, and return explicit 400 responses for malformed webhook JSON before enqueueing scans.

## 2026-06-30

- Fixed CI/test stability issues found by agent review: package GitHub tests now alias workspace core sources instead of depending on prebuilt `dist`, Console scan detail e2e fixtures mock `readScanRunRecord`, signed malformed webhook payloads fail closed without 500s, malformed encoded Console routes no longer throw, and Firebase Functions now declares its workspace package dependencies.

## Related Commits

- `53aabc3` - `refactor: rename Tracevia to Scanveil`
- `4bcf8b4` - `docs: document active Scanveil URLs`
- `e3a0fcf` - `feat: show GitHub App repositories in admin dashboard`
- `018c441` - `feat: migrate admin dashboard to Vite React`
- `6fc6558` - `feat: add admin-wide scan and Scanveil branding`
- `70415b2` - `feat: add Material Symbols to docs`
