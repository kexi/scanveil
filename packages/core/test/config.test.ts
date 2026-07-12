import { describe, expect, it } from "vitest";

import { parseSecurityAppConfig } from "../src/config.js";

describe("parseSecurityAppConfig", () => {
  it("uses advisory defaults without source", () => {
    const result = parseSecurityAppConfig(undefined);

    expect(result.config.checks.conclusionMode).toBe("advisory");
    expect(result.config.scan.llm.scope).toBe("pr_diff");
    expect(result.config.scan.llm.agent).toEqual({
      runner: "antigravity_experimental",
      timeoutSeconds: 900,
      skills: {
        enabled: true,
      },
      plugins: {
        enabled: false,
      },
      mcp: {
        enabled: false,
      },
    });
    expect(result.config.scan.osv.scope).toBe("changed_lockfiles");
  });

  it("overrides thresholds and suppression settings", () => {
    const result = parseSecurityAppConfig(`
version: 1
checks:
  conclusionMode: fail_on_threshold
  failThreshold:
    osv: high
    llm: medium
suppression:
  similarityThreshold: 0.91
`);

    expect(result.config.checks.conclusionMode).toBe("fail_on_threshold");
    expect(result.config.checks.failThreshold.osv).toBe("high");
    expect(result.config.checks.failThreshold.llm).toBe("medium");
    expect(result.config.suppression.similarityThreshold).toBe(0.91);
  });

  it("parses experimental Antigravity agent settings", () => {
    const result = parseSecurityAppConfig(`
version: 1
scan:
  llm:
    agent:
      runner: antigravity_experimental
      timeoutSeconds: 1200
      skills:
        enabled: true
      plugins:
        enabled: true
      mcp:
        enabled: true
`);

    expect(result.config.scan.llm.agent).toEqual({
      runner: "antigravity_experimental",
      timeoutSeconds: 1200,
      skills: {
        enabled: true,
      },
      plugins: {
        enabled: true,
      },
      mcp: {
        enabled: true,
      },
    });
  });

  it("keeps safe defaults for unsupported agent settings", () => {
    const result = parseSecurityAppConfig(`
version: 1
scan:
  llm:
    agent:
      runner: shell_everything
      timeoutSeconds: 3600
`);

    expect(result.config.scan.llm.agent.runner).toBe("antigravity_experimental");
    expect(result.config.scan.llm.agent.timeoutSeconds).toBe(900);
    expect(result.warnings).toContain("scan.llm.agent.runner is not supported. Default was used.");
  });
});
