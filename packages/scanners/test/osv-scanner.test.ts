import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseOsvJson, runOsvScanner } from "../src/osv-scanner.js";

describe("parseOsvJson", () => {
  it("maps vulnerabilities to findings", () => {
    const findings = parseOsvJson(
      JSON.stringify({
        results: [
          {
            source: { path: "pnpm-lock.yaml" },
            packages: [
              {
                package: { name: "example" },
                vulnerabilities: [
                  {
                    id: "GHSA-test",
                    aliases: ["CVE-2026-0001"],
                    summary: "bad package",
                    database_specific: { severity: "CRITICAL" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(findings[0]?.id).toBe("GHSA-test");
    expect(findings[0]?.aliases).toContain("CVE-2026-0001");
    expect(findings[0]?.severity).toBe("critical");
  });

  it("maps GHSA MODERATE severity to medium instead of escalating to high", () => {
    const findings = parseOsvJson(
      JSON.stringify({
        results: [
          {
            source: { path: "pnpm-lock.yaml" },
            packages: [
              {
                package: { name: "example" },
                vulnerabilities: [
                  {
                    id: "GHSA-moderate",
                    database_specific: { severity: "MODERATE" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(findings[0]?.severity).toBe("medium");
  });

  it("treats the OSV vulnerability exit code as scanner output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanveil-osv-test-"));
    const binary = join(directory, "osv-scanner");
    const output = JSON.stringify({
      results: [
        {
          source: { path: "pnpm-lock.yaml" },
          packages: [
            {
              package: { name: "example" },
              vulnerabilities: [
                {
                  id: "GHSA-test",
                  summary: "bad package",
                },
              ],
            },
          ],
        },
      ],
    });
    await writeFile(binary, `#!/bin/sh\nprintf '%s' '${output}'\nexit 1\n`);
    await chmod(binary, 0o755);

    const findings = await runOsvScanner(["pnpm-lock.yaml"], { binary });

    expect(findings[0]?.id).toBe("GHSA-test");
    expect(findings[0]?.source).toBe("osv");
  });
});
