import { describe, expect, it } from "vitest";

import { formatDate, isScanStreamTerminalError } from "../src/components/console-format.js";

describe("formatDate", () => {
  it("returns 'unknown' for an empty value", () => {
    expect(formatDate("")).toBe("unknown");
  });

  it("returns the original string when the value is not a parseable date", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("formats a valid ISO timestamp", () => {
    expect(formatDate("2026-06-21T00:00:00.000Z")).not.toBe("2026-06-21T00:00:00.000Z");
    expect(formatDate("2026-06-21T00:00:00.000Z").length).toBeGreaterThan(0);
  });
});

describe("isScanStreamTerminalError", () => {
  it("does not treat a native error without data as terminal", () => {
    expect(isScanStreamTerminalError(undefined)).toBe(false);
    expect(isScanStreamTerminalError("")).toBe(false);
  });

  it("does not treat a transient stream_unavailable server error as terminal", () => {
    expect(isScanStreamTerminalError(JSON.stringify({ error: "stream_unavailable" }))).toBe(false);
  });

  it("treats an explicit access_revoked server error as terminal", () => {
    expect(isScanStreamTerminalError(JSON.stringify({ error: "access_revoked" }))).toBe(true);
  });

  it("does not treat malformed data as terminal", () => {
    expect(isScanStreamTerminalError("{ not json")).toBe(false);
  });
});
