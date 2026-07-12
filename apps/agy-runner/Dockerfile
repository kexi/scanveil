FROM nixos/nix:2.34.5@sha256:4e211f6763c542b08e9cdba448381286a3638903359390b46eab5f43ce6a6ed1

WORKDIR /app
ENV PYTHONUNBUFFERED=1
RUN mkdir -p /etc/nix \
  && printf 'experimental-features = nix-command flakes\n' >> /etc/nix/nix.conf
COPY flake.nix flake.lock ./
RUN nix develop .#agy-runner --command uv --version \
  && nix develop .#agy-runner --command python --version
COPY apps/agy-runner ./apps/agy-runner
RUN nix develop .#agy-runner --command uv pip install \
  --target /app/.vendor \
  google-antigravity==0.1.4 \
  pydantic==2.12.5
# Why not require --help to exit 0: localharness prints usage but exits
# non-zero by design (Go flag package), so assert the usage banner instead
# and reject only exec failures (126/127).
RUN nix develop .#agy-runner --command bash -uc ' \
  harness=/app/.vendor/google/antigravity/bin/localharness; \
  test -x "$harness"; \
  patchelf --set-interpreter "$(cat "$NIX_CC/nix-support/dynamic-linker")" "$harness"; \
  patchelf --print-interpreter "$harness"; \
  timeout 5 "$harness" --help >/tmp/localharness-help.log 2>&1; \
  status="$?"; \
  cat /tmp/localharness-help.log; \
  test "$status" != "126"; \
  test "$status" != "127"; \
  grep -q "Usage of" /tmp/localharness-help.log \
'
ENV PYTHONPATH=/app/.vendor
RUN nix develop .#agy-runner --command env PYTHONPATH=/app/.vendor:/app/apps/agy-runner python apps/agy-runner/run.py >/tmp/scanveil-agy-runner-smoke.log 2>&1; \
  status="$?"; \
  cat /tmp/scanveil-agy-runner-smoke.log; \
  test "$status" = "1"; \
  grep -q "missing_payload" /tmp/scanveil-agy-runner-smoke.log
CMD ["nix", "develop", ".#agy-runner", "--command", "env", "PYTHONPATH=/app/.vendor:/app/apps/agy-runner", "python", "apps/agy-runner/run.py"]
