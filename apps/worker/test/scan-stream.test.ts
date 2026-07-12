import { describe, expect, it } from "vitest";

import { toStreamChunkExpireAt } from "../src/scan-stream.js";

describe("toStreamChunkExpireAt", () => {
  it("expires stream chunks 30 days after the chunk timestamp", () => {
    expect(toStreamChunkExpireAt("2026-07-09T00:00:00.000Z")).toBe("2026-08-08T00:00:00.000Z");
  });
});
