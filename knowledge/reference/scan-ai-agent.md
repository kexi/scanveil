---
type: Reference
title: Scanveil AI scan agent
description: Runtime behavior, streaming output, persistence, input scope, output validation, and Vertex AI requirements for the Scanveil AI scan agent.
resource: ../../apps/agy-runner/scanveil_agy_runner/runner.py
tags: [scanveil, ai-agent, vertex-ai, gemini, scanner, streaming]
timestamp: 2026-06-21T01:40:00Z
---

# Scanveil AI Scan Agent

The Scanveil AI scan agent is implemented in `apps/agy-runner/scanveil_agy_runner/runner.py` and runs as a Python subprocess of the worker through the Antigravity SDK (`google-antigravity` with `LocalAgentConfig(vertex=True, ...)`). The earlier TypeScript `ScanAiAgent` in `packages/scanners/src/llm-reviewer.ts` was removed once `antigravity_experimental` became the only supported `scan.llm.agent.runner`; the shared LLM review types now live in `packages/scanners/src/llm-review.ts`. GitHub pull request webhooks and Management Console manual scans both enqueue the worker Cloud Run Job with `SCAN_REQUEST_JSON`. Scheduled worker runs without `SCAN_REQUEST_JSON` enumerate installed repositories and create repository-wide scan requests, continuing across repositories even when one scan fails. The worker calls the agent for pull request scans after reading the GitHub pull request diff, and for repository-wide scans after preparing bounded default-branch source snapshots.

## Runtime

- Provider: Vertex AI through the Antigravity SDK (`google-antigravity` localharness).
- Model: the Antigravity default unless the scan request carries `llmModel` (selectable per manual scan in the Console).
- Default embedding model: `gemini-embedding-2` (RAG duplicate suppression, via `@google/genai` in `packages/rag`).
- Required environment: `GOOGLE_CLOUD_PROJECT`.
- Optional environment: `GOOGLE_CLOUD_LOCATION`, defaulting to `global`.
- Optional environment: `GOOGLE_CLOUD_REGION`, used to persist the Cloud Run runner region in scan history.
- Optional environment: `SECURITY_APP_SCAN_ARTIFACT_BUCKET`, used by the worker to persist full LLM output in Cloud Storage and short streaming chunks in Firestore.
- Optional cost estimation (historical; the Antigravity runner reports cost as `unavailable` because the SDK does not expose token usage):
  - `SECURITY_APP_LLM_INPUT_USD_PER_1M_TOKENS`
  - `SECURITY_APP_LLM_OUTPUT_USD_PER_1M_TOKENS`

The agent and RAG embedding path do not fall back to Gemini API key mode. If no Vertex AI project is configured, the scan fails early with `Missing GOOGLE_CLOUD_PROJECT for Vertex AI Gemini scan` for LLM review or `Missing GOOGLE_CLOUD_PROJECT for Vertex AI embedding` for RAG embeddings.

## Input Scope

The agent receives parsed pull request diff files or synthetic repository snapshot diffs. It filters out:

- files with no added lines
- files matching `scan.llm.excludePaths` from `.scanveil/config.yml`
- audit-specific agent assets under `.scanveil/skills`, `.scanveil/plugins`, and `.scanveil/mcp` when the corresponding Agy runner options are enabled; developer-local Antigravity skills are not loaded into scans

For pull request scans, the worker passes parsed PR diff files. For repository-wide scans, the worker lists default-branch files, keeps supported source/config paths, applies `scan.llm.excludePaths`, caps the number of files with `SECURITY_APP_REPOSITORY_LLM_FILE_LIMIT` (default `20`), caps file content with `SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES` (default `20000`), and converts each snapshot into annotation-eligible synthetic diff lines.

The prompt includes an `ADDED_LINES` allowlist for each file. Findings are accepted only when their `file` matches a reviewed diff or snapshot file and every line from `startLine` to `endLine` is one of the allowed lines.

## Output Contract

LLM review streams agent tokens from the Antigravity runner: the Python subprocess emits `agy_stream_chunk` structured logs on stderr, and the worker forwards them through `onStreamChunk` while the runner concatenates the full response for final JSON parsing. The UI-visible stream is therefore the agent's raw response as it arrives; accepted findings still come only from the validated final JSON (last fenced JSON block preferred, with a brace-scan fallback).

The model is requested to return JSON with:

- `title`
- `severity`
- `file`
- `startLine`
- `endLine`
- `category`
- `evidence`
- `recommendation`
- `confidence`

The scanner validates the JSON with Zod before converting it to `SecurityFinding`. Location fields are required so every accepted finding can become a GitHub Check annotation. Findings outside the reviewed added-line scope are dropped before GitHub Check annotations are produced.

## Persistence

The worker writes scan execution state to the `scanRuns` Firestore collection and writes finding details to the `scanFindings` collection. Scan run records include the LLM provider, model, Vertex AI location, Cloud Run runner region, input/output/total token counts, and estimated USD cost when Vertex AI returns usage metadata and token price env vars are configured. Finding records include `deliveryId`, `findingId`, `sveId`, source, severity, location, evidence, recommendation, aliases, suppression state, normalized text, code span fingerprint, optional embedding, and write timestamp. The Management Console reads recent scan runs and queries `scanFindings` by `deliveryId` in chunks, so Scan history can show both counts, cost, execution location, and finding summaries without depending on a global "latest findings" window. The SVE detail page queries `scanFindings` by `sveId` and joins recent scan runs by `deliveryId` to show where the finding was detected.

LLM stream persistence uses a split-store model:

- Firestore `scanStreamChunks` stores short, ordered UI chunks keyed by `deliveryId` and `sequence`.
- Cloud Storage stores the full LLM output at `scan-runs/{deliveryId}/llm-output.txt`.
- `scanRuns.llmOutputObjectPath` stores the `gs://` path for later authenticated retrieval through the Management Console.
- `scanRuns.streamChunkCount` stores how many Firestore stream chunks were written.

Firestore is intentionally not the source of truth for full LLM output because Firestore documents have a 1 MiB limit. It is used for small indexed metadata and near-real-time UI chunks. Cloud Storage is the durable store for complete LLM output.

The Management Console exposes per-run streaming through `GET /api/scans/:deliveryId/stream` as SSE. The React client wraps that `EventSource` as an `AsyncIterable` and feeds it into TanStack Query `experimental_streamedQuery`, which keeps streamed chunks in the query cache. Completed full output is read through `GET /api/scans/:deliveryId/llm-output`, which fetches the GCS object server-side and returns it only through the authenticated Console session.

Duplicate matching is repository-scoped. In Cloud Run, the worker first checks deterministic SVE fingerprints for exact same-location, same-content matches. When no exact match exists, it queries Firestore Vector Search against `scanFindings.embeddingVector` and uses cosine distance to find semantically similar findings in the same repository. If the vector index is unavailable, the worker falls back to reading repository findings and computing cosine similarity in-process so scans can continue.

GitHub Check creation happens before persistence, but a GitHub Checks 403 is treated as a permission/configuration problem instead of a scan failure. In that case the worker emits `github_check_skipped` and still writes `scanRuns` and `scanFindings`, so the Management Console can show the scan result while the GitHub App installation permissions are fixed.

## Logs

The agent emits structured logs:

- `llm_usage`: token counts and optional estimated cost
- `agy_usage`: experimental Antigravity runner provider/location metadata; cost is currently `unavailable` unless the SDK exposes token usage
- `llm_scan_skipped`: no reviewable diff files
- `llm_scan_finished`: input, dropped, and output finding counts
- `osv_scan_skipped`: OSV scanner binary is not present in the worker image; absence of this event means the worker found and invoked the bundled `osv-scanner`
- `github_check_skipped`: GitHub Checks API rejected Check creation, usually because the installation has not approved Checks read/write permission
- `repository_llm_snapshot_prepared`: repository-wide source snapshot selection counts

## 2026-06-20 Deployment Verification

The deployed worker image `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker@sha256:bf4e68a4ba2a87b7f736251c28794db7c5728da3dd0ef47c1d5aedfc90941172` successfully ran Cloud Run execution `scanveil-worker-qwpbk`.

Observed runtime evidence:

- `scheduled_scan_started` with `repositoryCount: 1`
- `scan_started` for `kexi/gcp-hackathon-poc`
- `repository_llm_snapshot_prepared` with `candidateFileCount: 20` and `reviewedFileCount: 20`
- `llm_usage`
- `llm_scan_finished`
- `osv_scan_skipped` with `missing_osv_scanner_binary`
- `github_check_skipped` with `github_checks_permission_denied`
- `scan_finished` with `findingCount: 3`
- `scheduled_scan_finished` with `failedCount: 0`

Firestore verification for delivery `scheduled-7e52a40f-224e-4c9a-ba14-6e5310ef08b2` showed `scanRuns.status: succeeded`, `scanRuns.findingCount: 3`, and 3 `scanFindings` documents.

## 2026-06-21 OSV Scanner Deployment Verification

The worker image now bundles `osv-scanner` directly from the official GitHub release artifact and verifies the binary SHA-256 during the Docker build.

Deployed worker image:

- `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker@sha256:d8309a3dcbaedeebc03ed417a1831a4f225de4330af72bb449c055ae68084664`

Cloud Run execution `scanveil-worker-247mz` completed successfully in 2m10s with this image.

Observed runtime evidence:

- `scheduled_scan_started` with `repositoryCount: 1`
- `scan_started` for `kexi/gcp-hackathon-poc`
- `repository_llm_snapshot_prepared` with `candidateFileCount: 20` and `reviewedFileCount: 20`
- `llm_usage`
- `llm_scan_finished`
- no `osv_scan_skipped` event
- `github_check_skipped` with `github_checks_permission_denied`
- `scan_finished` with `findingCount: 3`
- `scheduled_scan_finished` with `failedCount: 0`

Firestore verification for delivery `scheduled-bebe8f58-7253-4a81-9578-932f954a207c` showed `scanRuns.status: succeeded`, `scanRuns.target: repository`, `scanRuns.findingCount: 3`, and 3 `scanFindings` documents:

- `AIVULN-202606-CE8854E5-0001`: Use of unsafe shell execution with nix develop
- `AIVULN-202606-CE8854E5-0002`: Exposure of sensitive Google Metadata API
- `AIVULN-202606-CE8854E5-0003`: Potential SSRF vulnerability in internal API requests

GitHub Check publication still depends on the GitHub App and its repository installation having Checks read/write permission. API verification on 2026-06-21 showed app ID `4099256` and installation `141459718` only have `contents: read`, `metadata: read`, and `pull_requests: read`. Until Checks read/write is added to the app and approved by the installation, scans succeed and persist to Firestore, but the worker emits `github_check_skipped`.

## 2026-06-21 GitHub Check Publication Verification

GitHub App permission verification showed both the app and repository installation have `checks: write`:

- App ID: `4099256`
- App slug: `scandock`
- Repository installation ID: `141459718`
- App permissions: `checks: write`, `contents: read`, `metadata: read`, `pull_requests: write`
- Installation permissions: `checks: write`, `contents: read`, `metadata: read`, `pull_requests: write`

Cloud Run execution `scanveil-worker-lwps6` completed successfully in 1m27s with worker image `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker@sha256:d8309a3dcbaedeebc03ed417a1831a4f225de4330af72bb449c055ae68084664`.

Observed runtime evidence:

- `scheduled_scan_started` with `repositoryCount: 1`
- `scan_started` for `kexi/gcp-hackathon-poc`
- `repository_llm_snapshot_prepared` with `candidateFileCount: 20` and `reviewedFileCount: 20`
- `llm_usage`
- `llm_scan_finished`
- no `github_check_skipped` event
- `scan_finished` with `findingCount: 1`
- `scheduled_scan_finished` with `failedCount: 0`

Firestore verification for delivery `scheduled-4b071eed-714a-480e-83a3-4211ddb6a6d4` showed `scanRuns.status: succeeded`, `scanRuns.target: repository`, `scanRuns.headSha: 956604f6ec3718ac5a4acbf8024d7b789a57dcd0`, `scanRuns.findingCount: 1`, and 1 `scanFindings` document:

- `AIVULN-202606-CE8854E5-0001`: Use of unsafe path normalization in static file serving

GitHub Check verification for commit `956604f6ec3718ac5a4acbf8024d7b789a57dcd0` showed Check Run `Scanveil` was created by the `scandock` app:

- Check Run ID: `82517208366`
- Status: `completed`
- Conclusion: `success`
- URL: <https://github.com/kexi/gcp-hackathon-poc/runs/82517208366>

## 2026-06-21 SVE-ID and LLM Usage Deployment Verification

The Management Console and worker were deployed with SVE-ID detail/history support and scan-run LLM usage persistence.

Deployed images:

- Console: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-web@sha256:ccccc9788ebf7a0eac205d2d216f45999eabd3721867e5fb57f127d45069cdb7`
- Worker: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker@sha256:5e728d9ccf4dfd19a41c9b2cfc41972cbc466de1fc9971826809c823fe713dc1`

Cloud Run updates:

- `scanveil-web` revision `scanveil-web-00014-2f5` serves 100% traffic.
- `scanveil-worker` job generation 8 uses the new worker image digest.
- Console login URL `https://console.scanveil.kexi.dev/login` returned HTTP 200.

Cloud Run execution `scanveil-worker-mz7rt` completed successfully in 1m56s.

Observed runtime evidence:

- `scheduled_scan_started` with `repositoryCount: 1`
- `scan_started` for `kexi/gcp-hackathon-poc`
- `repository_llm_snapshot_prepared` with `candidateFileCount: 20` and `reviewedFileCount: 20`
- `llm_usage` with model `gemini-3.1-flash-lite-preview`, `inputTokens: 32011`, `outputTokens: 628`, `totalTokens: 32639`
- `llm_scan_finished` with `outputFindingCount: 4`
- `scan_finished` with `findingCount: 4`
- `scheduled_scan_finished` with `failedCount: 0`

Firestore verification for delivery `scheduled-42d62c1c-8c19-4733-b0d0-e55f2d34e006` showed `scanRuns.status: succeeded`, `scanRuns.findingCount: 4`, `llmModel: gemini-3.1-flash-lite-preview`, `llmInputTokens: 32011`, `llmOutputTokens: 628`, and `llmTotalTokens: 32639`. The 4 `scanFindings` documents each had an `sveId` and a 768-dimensional embedding:

- `SVE-202606-CE8854E5-249D720F`: Use of unsafe node HTTP module without explicit timeout configuration
- `SVE-202606-CE8854E5-14D01E8F`: Insecure temporary directory traversal potential
- `SVE-202606-CE8854E5-CADAD928`: Potential information leakage via insecure error handling
- `SVE-202606-CE8854E5-C8DAE227`: Sensitive credential handling in manual scan job trigger

## 2026-06-21 Scan Cost and Region Deployment Verification

The Management Console, worker, and experimental agy-runner were deployed with scan cost and execution-region metadata.

Deployed images:

- Console: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-web@sha256:a1faf24717effa094314edcf159d66988041775068386680a4f514f1cb94c755`
- Worker: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker@sha256:242ca8c22a1455e237cf6c51e6d4cb224126abd7f3a91649f523ee7e99916840`
- agy-runner: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-agy-runner@sha256:55b7d9c743221a2b9714cb50b374ad2f37fa2605262ed772803fd2923b0caa2b`

Cloud Run updates:

- `scanveil-web` revision `scanveil-web-00015-gpp` serves 100% traffic.
- `scanveil-worker` job generation 9 uses `GOOGLE_CLOUD_REGION=us-central1`, `SECURITY_APP_LLM_INPUT_USD_PER_1M_TOKENS=0.25`, and `SECURITY_APP_LLM_OUTPUT_USD_PER_1M_TOKENS=1.50`.
- `scanveil-agy-runner` job generation 4 uses the same region and token price environment variables.
- Console login URL `https://console.scanveil.kexi.dev/login` returned HTTP 200.

Cloud Run execution `scanveil-worker-h4p6t` completed successfully in 2m1s.

Observed runtime evidence:

- `scheduled_scan_started` with `repositoryCount: 1`
- `scan_started` for `kexi/gcp-hackathon-poc`
- `repository_llm_snapshot_prepared` with `candidateFileCount: 20` and `reviewedFileCount: 20`
- `llm_usage` with `provider: vertex_ai`, model `gemini-3.1-flash-lite-preview`, `location: global`, `inputTokens: 32011`, `outputTokens: 603`, `totalTokens: 32614`, `costStatus: estimated`, and `estimatedCostUsd: 0.00890725`
- `llm_scan_finished` with `outputFindingCount: 4`
- `scan_finished` with `findingCount: 4`
- `scheduled_scan_finished` with `failedCount: 0`

Firestore verification for delivery `scheduled-26e9138a-7aef-4092-8fbb-7716121e41da` showed `scanRuns.status: succeeded`, `scanRuns.findingCount: 4`, `llmProvider: vertex_ai`, `llmModel: gemini-3.1-flash-lite-preview`, `llmInputTokens: 32011`, `llmOutputTokens: 603`, `llmTotalTokens: 32614`, `llmEstimatedCostUsd: 0.00890725`, `llmLocation: global`, and `runnerRegion: us-central1`.

The experimental agy-runner job is deployed with the same provider/location/runner-region environment, but the Antigravity SDK runner currently marks cost as `unavailable` because the runner wrapper does not receive token usage from the SDK.

## 2026-06-21 Scan Finding Issue Creation Deployment

The Management Console can create a GitHub Issue from each Scan Detail finding. The authenticated Console route `POST /api/scans/:deliveryId/issues` loads the scan run and finding from Firestore, creates an installation token for the scan run's `installationId`, and posts the Issue to the scanned repository. The Issue payload includes severity, source, SVE-ID, finding ID, repository, target, scan URL, location, evidence, and recommendation.

User gating remains the same as the rest of the Console: the route sits behind the signed session plus invite/user enabled checks. This prevents disabled invited users from creating Issues even if they still have an old browser session.

Deployed image:

- Console: `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-web@sha256:7881877f36c6a082114f6c0a42dbf04b5a45ee3e0de0fa0da2d408a6480ae9d6`

Cloud Run update:

- `scanveil-web` revision `scanveil-web-00022-pxs` serves 100% traffic.
- Console login URL `https://console.scanveil.kexi.dev/login` returned HTTP 200.

Operator Admin update:

- The `scanveil-admin` Firebase Hosting site was deployed separately with table action columns renamed to `Access`.
- Full `just deploy-firebase` failed because Firebase Functions attempted to set Secret Manager IAM for missing service account `scanveil-functions-webhook@kexi-380010.iam.gserviceaccount.com`. For admin-only static updates, use `firebase deploy --only hosting:scanveil-admin --project kexi-380010 --force`.

## Antigravity SDK Evaluation

References:

- <https://antigravity.google/docs/sdk-overview>
- <https://github.com/google-antigravity/antigravity-sdk-python>
- <https://github.com/kexi/gcp-hackathon-poc/issues/3>

The Antigravity SDK is a Python framework for autonomous agents. It provides a built-in toolset for file I/O, code editing, shell execution, directory search, custom Python callables, MCP servers, reusable agent skills, declarative safety policies, lifecycle hooks, streaming, multimodal input, sub-agents, Pydantic structured output, human-in-the-loop flows, and token observability.

The GitHub README describes the SDK as a Python SDK powered by Antigravity and Gemini. Its quickstart uses `GEMINI_API_KEY`, but it also supports Gemini Enterprise Agent Platform / Vertex AI by configuring `LocalAgentConfig(vertex=True, project, location)` and relying on Application Default Credentials. The SDK defaults to read-only mode unless `CapabilitiesConfig()` enables broader tools.

The package must be installed from PyPI because platform-specific wheels include a compiled runtime binary. The repository alone is not enough to run it. Any future adoption must respect Scanveil's no-`npx` policy; the README's MCP stdio example uses `npx`, so production MCP integrations need pinned, non-`npx` commands.

The Antigravity runner has since become the production scan path: `antigravity_experimental` is the default and only supported `scan.llm.agent.runner`, and the direct `@google/genai` reviewer (`ScanAiAgent` in `packages/scanners/src/llm-reviewer.ts`) was removed. `@google/genai` remains only for RAG embeddings in `packages/rag`.

The runner lives under `apps/agy-runner` as a PEP 723 script executed with `uv` from the Nix devShell. It uses `google-antigravity==0.1.4`, `LocalAgentConfig(vertex=True, project, location)`, Pydantic finding validation, added-line allowlist filtering, and `asyncio.wait_for` timeout control. The worker invokes it as a subprocess via `SECURITY_APP_AGY_RUNNER_COMMAND`; a standalone Cloud Run Job also exists for experiments.

The production GitHub Check annotation path stays deterministic: fetch GitHub diff, pass only allowed diff context, validate structured output, and emit Scanveil findings through the existing worker contract.
