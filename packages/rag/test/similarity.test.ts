import { describe, expect, it } from "vitest";

import { cosineSimilarity } from "../src/similarity.js";

describe("cosineSimilarity", () => {
  it("returns 1 for equal vectors", () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
  });

  it("returns 0 for vectors with different lengths", () => {
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});
