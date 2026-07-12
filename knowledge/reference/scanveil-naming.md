---
type: Reference
title: Scanveil naming and domains
description: Canonical product names, app names, domains, tool names, and former names used in the Scanveil repository and deployment.
resource: ../../README.md
tags: [scanveil, naming, domains, glossary, tools]
timestamp: 2026-06-20T15:00:00Z
---

# Scanveil Naming and Domains

Use this file as the canonical naming reference for repository changes, docs, deployment notes, and agent work.

## Product Names

| Term                        | Use                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| Scanveil                    | Product name and public brand.                                                 |
| Scanveil Management Console | Formal name for the authenticated management UI.                               |
| Management Console          | Short UI/docs label for the authenticated management UI.                       |
| Scanveil Docs               | Public documentation site.                                                     |
| Scanveil GitHub App         | GitHub App installed into organizations or repositories.                       |
| SVE-ID                      | Repository-scoped finding identifier, similar in role to CVE/GHSA identifiers. |

## Former or Avoided Names

| Term            | Status                                      | Replacement                             |
| --------------- | ------------------------------------------- | --------------------------------------- |
| Tracevia        | Former product name.                        | Scanveil                                |
| Admin           | Legacy informal name for the management UI. | Management Console                      |
| Scanveil Admin  | Legacy browser/app label.                   | Scanveil or Scanveil Management Console |
| `apps/web`      | Former source directory.                    | `apps/console`                          |
| `@scanveil/web` | Former package name.                        | `@scanveil/console`                     |

## Domains

| Domain                                          | Purpose                                                  |
| ----------------------------------------------- | -------------------------------------------------------- |
| `https://www.scanveil.kexi.dev/`                | Public docs site on Firebase Hosting.                    |
| `https://admin.scanveil.kexi.dev/`              | Operator Admin site on a separate Firebase Hosting site. |
| `https://console.scanveil.kexi.dev/login`       | Management Console login on Cloud Run.                   |
| `https://www.scanveil.kexi.dev/webhooks/github` | GitHub webhook endpoint via Firebase Hosting rewrite.    |
| `https://kexi-380010.web.app/`                  | Firebase Hosting fallback URL.                           |

## Cloud and Runtime Names

| Name                | Type                            | Purpose                                                                                     |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `kexi-380010`       | Google Cloud / Firebase project | Production project for this PoC.                                                            |
| `scanveil-web`      | Cloud Run service               | Existing service name for the Management Console. Kept to avoid infrastructure replacement. |
| `scanveil-worker`   | Cloud Run job                   | Executes scan requests.                                                                     |
| `githubWebhook`     | Firebase Functions v2 function  | Receives GitHub webhook events.                                                             |
| `adminApi`          | Firebase Functions v2 function  | Operator Admin API for invite codes, usage history, and user access state.                  |
| `gcf-artifacts`     | Artifact Registry repository    | Stores container images.                                                                    |
| `scanveil-kexi-dev` | Cloud DNS managed zone          | DNS zone for `scanveil.kexi.dev`.                                                           |

## Repository Paths

| Path                | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `apps/console`      | Vite React Management Console and Node server.                                        |
| `apps/docs`         | Vite React static documentation site.                                                 |
| `apps/functions`    | Firebase Functions webhook implementation.                                            |
| `apps/worker`       | Cloud Run Job scan worker.                                                            |
| `packages/core`     | Shared types, config parsing, product metadata, severity helpers, and diff utilities. |
| `packages/github`   | GitHub App API and Checks integration.                                                |
| `packages/scanners` | LLM and OSV scanner adapters.                                                         |
| `packages/rag`      | Finding similarity and suppression helpers.                                           |
| `packages/auth`     | Session and OAuth helpers.                                                            |
| `knowledge`         | OKF-style project knowledge bundle.                                                   |
| `infra/terraform`   | GCP infrastructure definitions.                                                       |

## Commands and Tooling

| Command                   | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `just dev-console`        | Run the Management Console locally.                  |
| `just dev-docs`           | Run the docs site locally.                           |
| `just dev-api`            | Run the GitHub webhook API locally.                  |
| `just dev-firebase`       | Run Firebase Hosting and Functions emulators.        |
| `just ci`                 | Run the full local CI sequence.                      |
| `cloudbuild.console.yaml` | Cloud Build config for the Management Console image. |

## Naming Rules

- Prefer "Management Console" in user-facing docs.
- Prefer `console` in source paths and package names.
- Keep Cloud Run service name `scanveil-web` unless a deliberate infrastructure migration is planned.
- Use "Admin" only when referring to historical commits, legacy labels, or third-party terminology.

## Source vs Docs Terminology

| Meaning                    | Source code / package name                      | Docs / UI label         | Notes                                                                                               |
| -------------------------- | ----------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| Product                    | `scanveil`, `productMetadata.displayName`       | Scanveil                | Use lowercase only for slugs, package scopes, DNS, and resource IDs.                                |
| Management UI              | `console`, `@scanveil/console`, `apps/console`  | Management Console      | Use "Console" in source when naming app-level code. Use "Management Console" in user-facing text.   |
| Console authenticated user | `session`, `oauth`, `githubUser`                | signed-in user          | Avoid "admin user" unless the role model is implemented.                                            |
| GitHub App installation    | `installation`, `installationId`                | GitHub App installation | This is GitHub's term. Keep it unchanged in code and docs.                                          |
| Repository                 | `repository`, `repo`, `owner`                   | repository              | Use `repo` only for GitHub API-shaped fields and compact object properties.                         |
| Pull request               | `pullRequest`, `pullNumber`, `openPullRequests` | pull request / PR       | Use PR when space is tight; use pull request in explanatory docs.                                   |
| Manual scan                | `manual`, `startAllManualScans`                 | Scan                    | UI button can be "Scan"; implementation should be explicit about manual enqueueing.                 |
| Repository-wide scan       | `startAllManualScans`                           | repository-wide Scan    | Manual Console scan enqueues installed repositories at their default branch head SHA.               |
| Worker job                 | `worker`, `runWorkerJob`, `scanveil-worker`     | scan worker             | Use Cloud Run Job when describing infrastructure.                                                   |
| Finding                    | `SecurityFinding`, `finding`                    | finding                 | A scanner result before or after suppression.                                                       |
| Suppression                | `suppression`, `suppressedById`                 | duplicate suppression   | Use "RAG suppression" only when the embedding/similarity mechanism matters.                         |
| SVE-ID                     | `sveId`                                         | SVE-ID                  | Repository-scoped identifier for findings. Keep uppercase with hyphen in UI/docs.                   |
| Config file                | `.scanveil/config.yml`, `SecurityAppConfig`     | `.scanveil/config.yml`  | Config file name is literal and should not be translated. Legacy `.scanveil.yml` is migration-only. |
| Config schema              | `scanveil.config.schema.json`                   | JSON Schema             | Public schema for editor validation of `.scanveil/config.yml`.                                      |
| Docs site                  | `docs`, `@scanveil/docs`, `apps/docs`           | docs                    | Public documentation site.                                                                          |
| Webhook                    | `githubWebhook`, `webhook`                      | GitHub webhook          | Firebase Function receiving GitHub events.                                                          |

## Avoided Ambiguity

- Do not use "web app" when specifically referring to the Management Console source package; use `apps/console`.
- Do not use "Admin" for the current UI in new docs. Use "Management Console".
- Do not call repository-wide Scan a full source-code audit; it runs bounded default-branch source snapshots for LLM review and lockfile scanning for OSV.
- Do not use "database schema" for TypeScript-only shapes. Use "record schema" or "Zod schema" when runtime validation is involved.
- Do not use "issue" for scanner findings; GitHub Issues are a different product surface.
