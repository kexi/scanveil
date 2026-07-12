# Repository Guidelines

## Project Structure & Module Organization

Scanveil is a pnpm workspace. Application entry points live in `apps/`: `api` is the Cloud Run webhook service, `functions` is the Firebase Functions webhook backend, `worker` executes scans, `console` is the Vite React Management Console, and `docs` is the Vite React static documentation site. Shared code lives in `packages/`: `core`, `github`, `scanners`, `rag`, and `auth`. Terraform for GCP resources is under `infra/terraform`. Tests are colocated in each package under `test/`.

## Build, Test, and Development Commands

Use `direnv allow` once, then run tasks through `just`.

- `just install`: install dependencies with `pnpm install --frozen-lockfile`.
- `just dev-api`, `just dev-console`, `just dev-docs`: run local development servers.
- `just format-check`: verify formatting with `oxfmt`.
- `just lint`: run `oxlint`.
- `just typecheck`: run TypeScript checks.
- `just test`: run Vitest and app checks.
- `just build`: build all workspace packages and apps.
- `just supply-chain`: run gitleaks, OSV Scanner, and pinact.
- `just ci`: run the full local CI sequence.

## Coding Style & Naming Conventions

Use TypeScript ESM and keep imports explicit. Prefer early returns. Name conditions before `if` statements, for example `const hasToken = token.length > 0; if (!hasToken) return;`. Formatting is managed by `oxfmt`; linting is managed by `oxlint`. Keep package names under the `@scanveil/*` scope and app folders lowercase.

## Testing Guidelines

Vitest is used for package tests. Put tests in `test/*.test.ts` near the package being tested. Vite React apps use TypeScript typechecking as their app-level validation. Add focused tests for config parsing, webhook validation, scanner parsing, and RAG suppression behavior when changing those areas.

## Commit & Pull Request Guidelines

Use Semantic Commit Messages, as in `feat: scaffold Scanveil security scanner`. Prefer small, reviewable commits. Pull requests should include a short summary, verification commands such as `just ci`, linked issues when relevant, and screenshots for visible docs or web UI changes.

## Knowledge Management

Use `knowledge/` as a repository-local OKF-style knowledge bundle. When implementation, deployment, architecture, operations, or product decisions create reusable context, add or update Markdown files with YAML frontmatter fields such as `type`, `title`, `description`, `resource`, `tags`, and `timestamp`. Keep `knowledge/index.md` discoverable and update `knowledge/log.md` for notable chronological changes.

## Security & Configuration Tips

Do not commit secrets. Use `.env.example` for required variable names only. Keep GitHub Actions pinned to full SHAs and verify them with `just pinact`. Dependency changes must respect `pnpm-workspace.yaml` supply-chain settings, including `minimumReleaseAge: 1440`.
