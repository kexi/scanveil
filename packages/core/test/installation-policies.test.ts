import { describe, expect, it } from "vitest";

import {
  isInstallationPolicyEnabled,
  normalizeInstallationPolicy,
} from "../src/installation-policies.js";

describe("normalizeInstallationPolicy", () => {
  it("normalizes organization and user installation policies", () => {
    expect(
      normalizeInstallationPolicy({
        accountLogin: "scanveil-org",
        accountType: "Organization",
        enabled: true,
        installationId: "123",
        inviteCode: "SV-INVITE",
        repositoryCount: "12",
        repositorySelection: "all",
      }),
    ).toEqual({
      accountLogin: "scanveil-org",
      accountType: "Organization",
      enabled: true,
      installationId: 123,
      inviteCode: "SV-INVITE",
      repositoryCount: 12,
      repositorySelection: "all",
    });

    expect(
      normalizeInstallationPolicy({
        accountLogin: "octocat",
        accountType: "User",
        enabled: false,
        installationId: 456,
        repositorySelection: "selected",
      }),
    ).toEqual({
      accountLogin: "octocat",
      accountType: "User",
      enabled: false,
      installationId: 456,
      repositorySelection: "selected",
    });
  });

  it("requires a positive installation id", () => {
    expect(normalizeInstallationPolicy({ installationId: 0 })).toBeUndefined();
  });
});

describe("isInstallationPolicyEnabled", () => {
  it("requires both enabled state and an invite code", () => {
    expect(
      isInstallationPolicyEnabled(
        normalizeInstallationPolicy({
          enabled: true,
          installationId: 123,
        }),
      ),
    ).toBe(false);
    expect(
      isInstallationPolicyEnabled(
        normalizeInstallationPolicy({
          enabled: true,
          installationId: 123,
          inviteCode: "SV-INVITE",
        }),
      ),
    ).toBe(true);
  });
});
