# Contributing to Scanveil

Scanveil の開発者向け情報です。利用者向けの概要と公開 URL は [README.md](README.md) を参照してください。

## 構成

```text
apps/
  api/       Cloud Run service: GitHub webhook receiver
  worker/    Cloud Run job: scan executor
  console/   Vite React management console with a tsdown Node server
  docs/      Vite React static documentation site and operator admin SPA
  functions/ Firebase Functions webhook backend and operator admin API
packages/
  core/      shared types, config, severity, diff utilities
  github/    GitHub App auth, webhook, Checks API helpers
  scanners/  OSV Scanner adapter and shared LLM review types
  rag/       finding normalization and similarity suppression
  auth/      OAuth, session cookie, and token helpers
infra/
  terraform/ GCP resources
knowledge/
  repository-local project knowledge
```

## 開発

```fish
direnv allow
just install
just build
just test
```

主要タスクは `just` に集約しています。

```fish
just format-check
just lint
just typecheck
just supply-chain
just ci
```

## ローカル URL

用途ごとに次の URL を開きます。

| 用途                         | コマンド            | URL                                                                            |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| Firebase Hosting 経由の docs | `just dev-firebase` | [http://127.0.0.1:5002](http://127.0.0.1:5002)                                 |
| GitHub webhook の rewrite    | `just dev-firebase` | [http://127.0.0.1:5002/webhooks/github](http://127.0.0.1:5002/webhooks/github) |
| Emulator UI                  | `just dev-firebase` | [http://127.0.0.1:4000](http://127.0.0.1:4000)                                 |
| Docs 単体開発                | `just dev-docs`     | [http://127.0.0.1:4321](http://127.0.0.1:4321)                                 |
| Management Console 単体開発  | `just dev-console`  | [http://127.0.0.1:8080](http://127.0.0.1:8080)                                 |
| API 単体開発                 | `just dev-api`      | [http://127.0.0.1:8080/webhooks/github](http://127.0.0.1:8080/webhooks/github) |

`just dev-console` と `just dev-api` はどちらも既定で `8080` を使うため、同時に起動する場合は片方の `PORT` を変えてください。

## Firebase local development

Firebase Hosting と Cloud Functions for Firebase は Emulator Suite で確認します。

```fish
cp apps/functions/.secret.local.example apps/functions/.secret.local
just dev-firebase
```

- Hosting emulator: [http://127.0.0.1:5002](http://127.0.0.1:5002)
- Functions emulator: [http://127.0.0.1:5003](http://127.0.0.1:5003)
- Emulator UI: [http://127.0.0.1:4000](http://127.0.0.1:4000)

`/webhooks/github` は Firebase Hosting から `githubWebhook` Function に rewrite されます。

## 供給網対策

- `pnpm-workspace.yaml` で `minimumReleaseAge: 1440`
- CI は `just install` 経由で `pnpm install --frozen-lockfile`
- GitHub Actions は `pinact` で full SHA pin を検証
- `gitleaks` と OSV Scanner を CI/ローカルで実行

## GitHub App 設定

必要な最小権限:

- Contents: Read
- Pull requests: Read
- Checks: Write
- Metadata: Read

Webhook events:

- `pull_request`
- `installation`
- `installation_repositories`

関連する URL は次のとおりです。

- Homepage URL: `https://www.scanveil.kexi.dev/`
- Callback URL: `https://console.scanveil.kexi.dev/oauth/callback`
- Setup URL: `https://console.scanveil.kexi.dev/login`
- Webhook URL: `https://www.scanveil.kexi.dev/webhooks/github`

## Experimental Antigravity Runner

Issue #3 の評価用に、production worker とは別の Python runner を `apps/agy-runner` に置いています。
Python と `uv` は Nix devShell から使います。

```sh
nix develop --command uv run --script apps/agy-runner/test/test_runner.py
```

runner 本体は PEP 723 metadata を持つ script として起動します。

```sh
nix develop --command uv run --script apps/agy-runner/run.py
```
