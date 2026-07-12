---
type: Reference
title: Hackathon technology requirements fit
description: Maps Scanveil's implemented Google Cloud services to the hackathon required and optional technology categories.
resource: ../../infra/terraform/main.tf
tags: [scanveil, hackathon, google-cloud, cloud-run, gemini, firebase]
timestamp: 2026-06-21T03:25:00Z
---

# Hackathon technology requirements fit

Scanveil satisfies both required hackathon technology categories.

## Required application runtime

Requirement: use at least one Google Cloud application execution product.

Scanveil satisfies this with Cloud Run:

- `scanveil-api`: Cloud Run service for GitHub webhook/API handling.
- `scanveil-web`: Cloud Run service for the Management Console.
- `scanveil-worker`: Cloud Run job for scan execution.
- `scanveil-agy-runner`: Cloud Run job for the experimental Antigravity runner.

Primary evidence:

- `infra/terraform/main.tf` defines `google_cloud_run_v2_service.api`.
- `infra/terraform/main.tf` defines `google_cloud_run_v2_service.web`.
- `infra/terraform/main.tf` defines `google_cloud_run_v2_job.worker`.
- `infra/terraform/main.tf` defines `google_cloud_run_v2_job.agy_runner`.

## Required Google Cloud AI technology

Requirement: use at least one listed Google Cloud AI technology.

Scanveil satisfies this with Gemini API through Vertex AI / Gemini Enterprise Agent Platform:

- The TypeScript scanner uses `@google/genai` and creates `GoogleGenAI({ vertexai: { project, location } })`.
- Terraform enables `aiplatform.googleapis.com` when worker or Antigravity runner is enabled.
- The runtime service account has `roles/aiplatform.user`.
- Cloud Run worker and Antigravity runner set `GOOGLE_GENAI_USE_VERTEXAI=true`.
- The experimental Antigravity runner uses `google-antigravity` with Vertex AI configuration.

Primary evidence:

- `apps/agy-runner/scanveil_agy_runner/runner.py` calls Vertex AI through the Antigravity SDK, and `packages/rag/src/embeddings.ts` creates the Vertex AI Gemini embeddings client.
- `infra/terraform/main.tf` includes `aiplatform.googleapis.com` in required services.
- `infra/terraform/main.tf` grants `roles/aiplatform.user`.
- `apps/agy-runner/scanveil_agy_runner/runner.py` creates the Antigravity agent.

## Optional technologies

Scanveil also uses Firebase:

- Firestore stores `scanRuns`, `scanFindings`, and `scanStreamChunks`.
- Firebase Hosting is used for the public docs domain.
- The repository contains a Firebase Functions webhook backend.

Primary evidence:

- `infra/terraform/main.tf` defines the Firestore Native database.
- `apps/console/src/scan-history.ts` reads Firestore scan history and finding data.
- `apps/functions/src/index.ts` defines a Firebase Functions HTTPS handler.

## Hackathon reference

- <https://findy.notion.site/devops-ai-agent-hackathon-2026>

## Submission method

Submission deadline: 2026-07-10 23:59 JST.

Submit in three steps:

1. Apply for the hackathon from Findy Conference.
2. Register the work on Proto Pedia.
3. Submit the final application through the Google Form.

Proto Pedia registration requirements:

- Work status.
- Work title.
- Summary.
- Video URL uploaded to YouTube or Vimeo.
- System architecture diagram.
- Development tools used.
- Tags, including `findy_hackathon`.
- Story covering the problem/background, target users, and product features.

Final Google Form requires:

- Public GitHub repository URL.
- Deployed project URL that reviewers can access and verify.
- Proto Pedia work URL.

Notes:

- A Proto Pedia account is required before project submission.
- Re-submission is allowed; the latest final application timestamp is used for judging.
- A solo participant can submit multiple works, but each work must be submitted separately.
