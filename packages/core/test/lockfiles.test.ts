import { describe, expect, it } from "vitest";

import { isSupportedLockfile } from "../src/lockfiles.js";

describe("isSupportedLockfile", () => {
  it("uses configured lockfile globs as the only supported set", () => {
    const globs = ["**/package-lock.json"];

    expect(isSupportedLockfile("package-lock.json", globs)).toBe(true);
    expect(isSupportedLockfile("apps/web/package-lock.json", globs)).toBe(true);
    expect(isSupportedLockfile("pnpm-lock.yaml", globs)).toBe(false);
    expect(isSupportedLockfile("apps/api/Cargo.lock", globs)).toBe(false);
  });

  it("keeps default wildcard support for requirements lockfiles", () => {
    expect(isSupportedLockfile("requirements.txt")).toBe(true);
    expect(isSupportedLockfile("services/api/requirements-dev.txt")).toBe(true);
  });

  it("covers Bundler, uv, and legacy Bun lockfiles by default in any directory", () => {
    expect(isSupportedLockfile("Gemfile.lock")).toBe(true);
    expect(isSupportedLockfile("services/api/Gemfile.lock")).toBe(true);
    expect(isSupportedLockfile("uv.lock")).toBe(true);
    expect(isSupportedLockfile("packages/tool/uv.lock")).toBe(true);
    expect(isSupportedLockfile("apps/native/bun.lockb")).toBe(true);
  });
});
