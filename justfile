set shell := ["bash", "-euc"]

export UV_CACHE_DIR := env_var_or_default("UV_CACHE_DIR", ".uv-cache")
export UV_PYTHON_INSTALL_DIR := env_var_or_default("UV_PYTHON_INSTALL_DIR", ".uv-python")

default:
    just --list

install:
    pnpm install --frozen-lockfile

ci-install:
    pnpm install --frozen-lockfile --store-dir .pnpm-store

update-lockfile:
    pnpm install --lockfile-only

format:
    pnpm format
    just format-python

format-check:
    pnpm format:check
    just format-python-check

lint:
    pnpm lint
    just lint-python

typecheck:
    pnpm typecheck

test:
    pnpm test
    just test-agy-runner

e2e:
    pnpm e2e

install-e2e-browsers:
    pnpm exec playwright install --with-deps chromium

test-agy-runner:
    uv run --script apps/agy-runner/test/test_runner.py

format-python:
    ruff format apps/agy-runner

format-python-check:
    ruff format --check apps/agy-runner

lint-python:
    ruff check apps/agy-runner
    just lint-python-pep723

lint-python-pep723:
    bash -uc 'uv run --script apps/agy-runner/run.py >/tmp/scanveil-agy-runner-pep723.log 2>&1; status="$?"; test "$status" = "1"; grep -q missing_payload /tmp/scanveil-agy-runner-pep723.log'

build:
    pnpm build

terraform-fmt-check:
    terraform -chdir=infra/terraform fmt -check -diff

terraform-validate:
    terraform -chdir=infra/terraform init -backend=false -input=false
    terraform -chdir=infra/terraform validate

terraform-check:
    just terraform-fmt-check
    just terraform-validate

gitleaks:
    pnpm supply-chain:gitleaks

osv:
    pnpm supply-chain:osv

pinact:
    pnpm supply-chain:pinact

supply-chain:
    just gitleaks
    just osv
    just pinact

ci:
    just install
    just format-check
    just lint
    just typecheck
    just test
    just build
    just e2e
    just terraform-check
    just supply-chain

dev-api:
    pnpm dev:api

dev-docs:
    pnpm dev:docs

dev-console:
    pnpm dev:console

dev-web:
    pnpm dev:console

dev-firebase:
    pnpm --filter @scanveil/docs build
    pnpm --filter @scanveil/functions build
    FIREBASE_CLI_DISABLE_UPDATE_CHECK=1 pnpm exec firebase emulators:start --only hosting,functions --project kexi-380010

build-docs:
    pnpm --filter @scanveil/docs build

build-firebase:
    pnpm --filter @scanveil/docs build
    pnpm --filter @scanveil/functions build

deploy-firebase:
    just build-firebase
    FIREBASE_CLI_DISABLE_UPDATE_CHECK=1 pnpm exec firebase deploy --only hosting,functions:githubWebhook,functions:adminApi --project kexi-380010 --force
