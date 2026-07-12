---
type: Reference
title: Scanveil GitHub App settings
description: Required GitHub App settings for Scanveil installation, webhooks, OAuth callback URLs, and Console repository access boundaries.
resource: ../../README.md
tags: [scanveil, github-app, permissions, webhook, oauth]
timestamp: 2026-06-27T04:59:45+09:00
---

# Scanveil GitHub App Settings

Use these settings when creating or updating the Scanveil GitHub App.

## URLs

| Setting      | Value                                              |
| ------------ | -------------------------------------------------- |
| Homepage URL | `https://www.scanveil.kexi.dev/`                   |
| Callback URL | `https://console.scanveil.kexi.dev/oauth/callback` |
| Setup URL    | `https://console.scanveil.kexi.dev/login`          |
| Webhook URL  | `https://hooks.scanveil.kexi.dev/webhooks/github`  |

## Repository Permissions

| Permission    | Access         | Why                                                      |
| ------------- | -------------- | -------------------------------------------------------- |
| Metadata      | Read-only      | Required by GitHub Apps for repository metadata.         |
| Contents      | Read and write | Read scan inputs and create fix PR commits from Console. |
| Pull requests | Read and write | Read PR metadata/diffs and create Console fix draft PRs. |
| Checks        | Read and write | Publish Scanveil check runs.                             |
| Issues        | Read and write | Create GitHub Issues from Console scan findings.         |

## Webhook Events

Enable these webhook events:

- `pull_request`
- `installation`
- `installation_repositories`

## Secrets and Environment

| Secret / env                 | Purpose                                           |
| ---------------------------- | ------------------------------------------------- |
| `GITHUB_APP_ID`              | GitHub App numeric app ID.                        |
| `GITHUB_APP_PRIVATE_KEY`     | GitHub App private key, stored in Secret Manager. |
| `GITHUB_WEBHOOK_SECRET`      | Webhook signature validation secret.              |
| `GITHUB_OAUTH_CLIENT_ID`     | OAuth app client ID for Console login.            |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth app client secret for Console login.        |

## Console OAuth Scopes

| Scope       | Why                                                                       |
| ----------- | ------------------------------------------------------------------------- |
| `read:user` | Identify the signed-in GitHub user for invite-backed Console access.      |
| `read:org`  | Read the user's organization memberships for repository access filtering. |
| `repo`      | Read the signed-in user's visible repositories, including private repos.  |

## Operational Notes

- 2026-07-11: the GitHub App was renamed; the current slug is `scanveil-app` (install URL `https://github.com/apps/scanveil-app/installations/new`). Mentions of the earlier `ScanDock` / `scandock` name in dated verification sections below are historical records. The app ID `4099256` and installation IDs are unchanged by the rename.
- The webhook endpoint is the `githubWebhook` Cloud Function, reached through a Cloud Run domain mapping on `hooks.scanveil.kexi.dev` (Terraform `google_cloud_run_domain_mapping.hooks`). The legacy `https://www.scanveil.kexi.dev/webhooks/github` Firebase Hosting rewrite was removed on 2026-07-12 after the GitHub App webhook URL switched to the hooks domain; only the hooks URL works now.
- When the Console domain changes, update the GitHub App callback URL before testing login.
- When OAuth scopes change, users must sign in again so Scanveil refreshes the server-side repository access snapshot.
- When permissions change, repository owners must approve the updated installation permissions.
- The Management Console reads installed repositories through the GitHub App installation token.
- Organization and user installations both require an Operator Admin invite code before Scanveil scans repositories from that installation. The Admin `GitHub installations` panel stores the invite-backed policy in Firestore `installationPolicies`.
- Organization installations apply to repositories allowed by the GitHub App under that organization. User installations apply only to repositories allowed by the GitHub App under that user account.
- Console users can view and scan only repositories returned by the signed-in user's GitHub OAuth `/user/repos` response. Scanveil intersects that user-visible repository set with the GitHub App installation repositories and uses GitHub repository IDs as the required access key for scan requests, scan runs, findings, and stream chunks.
- The repository access snapshot is stored server-side in Firestore `inviteUsers`; the signed session cookie carries only user identity to avoid large repository lists in cookies. Missing or stale repository access snapshots deny repository access until the user signs in again.
- Manual scan requests are re-resolved server-side from the GitHub App installation repository list before enqueueing, so the Console does not trust a client-supplied `owner`, `repo`, `installationId`, and `repositoryId` tuple on its own.
- Repository config and branch APIs require `repositoryId` and re-resolve the requested repository against the GitHub App installation repository list before reading GitHub contents.
- Scan history, Scan Detail, SVE detail, and live scan streams only group findings or stream chunks when their `repositoryId` and GitHub `owner/repo` match the authorized scan run.
- Direct worker `SCAN_REQUEST_JSON` payloads are validated against the GitHub App installation repository list before a scan can run.
- If scan logs contain `github_check_skipped` with `github_checks_permission_denied`, the GitHub App installation has not approved Checks read/write access for that repository yet. Update the GitHub App permissions and have the repository owner approve the changed installation permissions.
- If Issue creation returns `Resource not accessible by integration`, the GitHub App installation has not approved Issues read/write access for that repository yet. Update the GitHub App permissions and approve the changed installation permissions.
- If fix PR creation returns `Resource not accessible by integration`, the GitHub App installation has not approved Contents read/write or Pull requests read/write access for that repository yet. Update the GitHub App permissions and approve the changed installation permissions.

## 2026-06-21 Permission Verification

GitHub API verification for app ID `4099256` showed the live GitHub App is currently named `ScanDock` with slug `scandock`:

- App URL: <https://github.com/apps/scandock>
- Repository installation ID for `kexi/gcp-hackathon-poc`: `141459718`
- App permissions observed from `/app`: `contents: read`, `metadata: read`, `pull_requests: read`
- Installation permissions observed from `/repos/kexi/gcp-hackathon-poc/installation`: `contents: read`, `metadata: read`, `pull_requests: read`

The live app and installation do not currently include `checks: write`. GitHub Check publication will continue to emit `github_check_skipped` with `github_checks_permission_denied` until the GitHub App settings add Checks read/write and the `kexi/gcp-hackathon-poc` installation approves the changed permissions.

Follow-up verification after a permission change attempt showed the app and installation changed `pull_requests` from `read` to `write`, but still did not include `checks: write`. Scanveil does not require Pull requests write access for the current scan flow; keep Pull requests at read-only unless a future feature explicitly needs to modify pull requests. The missing permission for GitHub Check publication remains Checks read/write.

Final verification after installation approval showed both the app and installation include `checks: write`. Cloud Run execution `scanveil-worker-lwps6` created GitHub Check Run `82517208366` for commit `956604f6ec3718ac5a4acbf8024d7b789a57dcd0`.

2026-06-22 follow-up: Issue creation from SVE/scan findings requires `issues: write`. After the GitHub App permission and installation approval were updated, Console Issue creation succeeded.
