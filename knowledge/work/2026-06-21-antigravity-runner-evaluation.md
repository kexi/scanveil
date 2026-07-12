---
type: Work
title: Antigravity runner evaluation
description: Experimental Scanveil Antigravity SDK runner implementation notes, safety boundaries, and adoption decision.
resource: ../../apps/agy-runner
tags: [scanveil, antigravity, vertex-ai, cloud-run, security]
timestamp: 2026-06-21T00:00:00Z
---

# Antigravity Runner Evaluation

Issue: <https://github.com/kexi/gcp-hackathon-poc/issues/3>

Scanveil keeps the production webhook-driven scan path on the TypeScript worker. The Antigravity SDK evaluation is implemented as a separate experimental Python runner under `apps/agy-runner`, packaged as a PEP 723 script and executed with `uv` from the Nix devShell.

## Runtime Decision

- Vertex AI is the only supported model backend for this evaluation.
- The runner uses `LocalAgentConfig(vertex=True, project, location)` and ADC through the Cloud Run service account.
- The runner requires `GOOGLE_CLOUD_PROJECT`; `GOOGLE_CLOUD_LOCATION` defaults to `global`.
- `google-antigravity==0.1.4` is pinned in the PEP 723 metadata. PyPI lists 0.1.4 as released on 2026-06-18, which is older than the repository minimum release age.
- Cloud Run packages the runner with Nix-provided Python and `uv`. The Antigravity `localharness` binary is vendored during image build and patched with Nix's glibc dynamic linker so it can execute inside the NixOS-based image.

## Contract

- Input is a JSON payload containing Scanveil diff files with `path`, `addedLines`, and `raw`.
- Output is normalized to the Scanveil finding contract fields needed for GitHub Check annotations.
- Pydantic validates structured findings before conversion.
- Findings outside the added-line allowlist are dropped.

## Safety Boundary

- `.scanveil/config.yml` is the primary repository config path. Legacy `.scanveil.yml` is read only as a migration fallback.
- Audit-specific `.scanveil/skills` can be loaded by the experimental runner when enabled.
- Audit-specific `.scanveil/plugins` and `.scanveil/mcp` are default-disabled.
- Developer-local Antigravity skills, plugins, MCP servers, and any future custom agent assets should not be loaded into scans; scan-impacting assets must live under the repository-owned `.scanveil` namespace.
- MCP stdio definitions under `.scanveil/mcp/*.json` reject `npx` commands to preserve Scanveil's no-npx policy.
- Cloud Run Job timeout and application-level `asyncio.wait_for` timeout both cap execution at no more than 30 minutes.

## Adoption Status

The Antigravity runner is not adopted for production webhook scans yet. It is suitable for isolated evaluation of skills, MCP, policy hooks, and token/tool observability, but production adoption still requires a hardened sandbox for untrusted repository-provided MCP/plugins.

## Deployment Verification

- Built image `us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-agy-runner@sha256:73ce1668ca64132dbf08992aeccd3dcda3837ab1a0f41f45a94f6ccbbb9a33e3`.
- Updated Cloud Run Job `scanveil-agy-runner` in `us-central1`.
- Verified execution `scanveil-agy-runner-p4lqs` completed successfully with `exit(0)`.
- Logs showed `agy_runner_started`, `agy_policy_configured`, and `agy_runner_finished` with zero findings for the minimal synthetic payload.
