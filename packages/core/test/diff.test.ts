import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff.js";

describe("parseUnifiedDiff", () => {
  it("extracts files and added line numbers", () => {
    const files = parseUnifiedDiff(`diff --git a/src/app.ts b/src/app.ts
@@ -1,2 +1,3 @@
 const value = 1;
+const secret = "x";
 console.log(value);
`);

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/app.ts");
    expect(files[0]?.addedLines).toEqual([2]);
  });

  it("keeps added line numbers accurate when a no-newline marker follows a hunk", () => {
    const files = parseUnifiedDiff(`diff --git a/src/app.ts b/src/app.ts
@@ -1,2 +1,3 @@
 const value = 1;
-console.log(value);
\\ No newline at end of file
+console.log(value);
+const secret = "x";
\\ No newline at end of file
`);

    expect(files[0]?.addedLines).toEqual([2, 3]);
  });
});
