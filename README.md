# Scanveil

Scanveil は、GCP 上で動く GitHub App 型のセキュリティ検査 PoC です。

## 目的

- GitHub App をリポジトリにインストールできるようにする
- PR ごとに LLM と Google OSV Scanner でセキュリティ検査する
- Management Console から repository-wide Scan を起動し、既定ブランチの source snapshot と lockfile を検査する
- LLM 指摘は RAG/類似度で重複抑制する
- GitHub Checks API に結果を表示する
- Vite React で利用者向け docs と Management Console を用意する

## どの URL を開くか

デプロイ後の利用者向け docs は [www.scanveil.kexi.dev](https://www.scanveil.kexi.dev/) を開きます。

- Docs: [https://www.scanveil.kexi.dev/](https://www.scanveil.kexi.dev/)
- Management Console: [https://console.scanveil.kexi.dev/login](https://console.scanveil.kexi.dev/login)
- GitHub webhook: [https://hooks.scanveil.kexi.dev/webhooks/github](https://hooks.scanveil.kexi.dev/webhooks/github)

Firebase Hosting の既定 URL もフォールバックとして使えます。

- Docs fallback: [https://kexi-380010.web.app/](https://kexi-380010.web.app/)

## GitHub installation policies

Operator Admin の `GitHub installations` で、GitHub App installation 単位のスキャン適用を管理します。Organization installation と User installation の両方に対応し、どちらも invite code を紐づけてから enabled にする必要があります。

- Organization installation: ORG 配下で GitHub App が許可された repositories に一括適用します。GitHub 側の `All repositories` / `Selected repositories` が対象範囲を決めます。
- User installation: 個人アカウント配下で GitHub App が許可された repositories に一括適用します。ORG 全体や ORG メンバー管理には使いません。
- 共通: invite code が無い、または disabled の installation は PR scan、scheduled scan、manual scan の対象外です。

## Repository Config

対象リポジトリのルートに `.scanveil/config.yml` を置くと挙動を変更できます。
旧 `.scanveil.yml` も移行互換として読み込みますが、両方ある場合は `.scanveil/config.yml` が優先されます。
JSON Schema は [https://www.scanveil.kexi.dev/schema/scanveil.config.schema.json](https://www.scanveil.kexi.dev/schema/scanveil.config.schema.json) で公開します。

```yaml
# yaml-language-server: $schema=https://www.scanveil.kexi.dev/schema/scanveil.config.schema.json
version: 1
checks:
  conclusionMode: advisory
  failThreshold:
    osv: critical
    llm: critical
scan:
  llm:
    enabled: true
    scope: pr_diff
    excludePaths:
      - "dist/**"
      - "vendor/**"
    agent:
      runner: antigravity_experimental
      timeoutSeconds: 900
      skills:
        enabled: true
      plugins:
        enabled: false
      mcp:
        enabled: false
  osv:
    enabled: true
    scope: changed_lockfiles
    lockfileGlobs:
      - "**/pnpm-lock.yaml"
      - "**/package-lock.json"
      - "**/yarn.lock"
      - "**/bun.lock"
      - "**/Cargo.lock"
      - "**/go.sum"
      - "**/requirements*.txt"
      - "**/poetry.lock"
      - "**/Pipfile.lock"
      - "**/composer.lock"
suppression:
  enabled: true
  similarityThreshold: 0.88
schedule:
  enabled: true
```
