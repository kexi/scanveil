export type GitHubInstallationAccountType = "Organization" | "User" | string;
export type GitHubRepositorySelection = "all" | "selected" | "unknown" | string;

export interface InstallationPolicy {
  accountLogin: string;
  accountType: GitHubInstallationAccountType;
  createdAt?: string;
  enabled: boolean;
  inviteCode?: string;
  inviteName?: string;
  invitedAt?: string;
  installationId: number;
  repositoryCount?: number;
  repositorySelection: GitHubRepositorySelection;
  updatedAt?: string;
  updatedBy?: string;
}

export interface InstallationPolicyInput {
  accountLogin?: unknown;
  accountType?: unknown;
  createdAt?: unknown;
  enabled?: unknown;
  inviteCode?: unknown;
  inviteName?: unknown;
  invitedAt?: unknown;
  installationId?: unknown;
  repositoryCount?: unknown;
  repositorySelection?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
}

export function normalizeInstallationPolicy(value: unknown): InstallationPolicy | undefined {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord) {
    return undefined;
  }

  const input = value as InstallationPolicyInput;
  const installationId = readPositiveInteger(input.installationId);
  const hasInstallationId = installationId !== undefined;
  if (!hasInstallationId) {
    return undefined;
  }

  const policy: InstallationPolicy = {
    accountLogin: readNonEmptyString(input.accountLogin) ?? "unknown",
    accountType: readNonEmptyString(input.accountType) ?? "unknown",
    enabled: input.enabled !== false,
    installationId,
    repositorySelection: readNonEmptyString(input.repositorySelection) ?? "unknown",
  };
  setOptionalPolicyString(policy, "inviteCode", input.inviteCode);
  setOptionalPolicyString(policy, "inviteName", input.inviteName);
  setOptionalPolicyString(policy, "invitedAt", input.invitedAt);
  setOptionalPolicyInteger(policy, "repositoryCount", input.repositoryCount);
  setOptionalPolicyString(policy, "createdAt", input.createdAt);
  setOptionalPolicyString(policy, "updatedAt", input.updatedAt);
  setOptionalPolicyString(policy, "updatedBy", input.updatedBy);
  return policy;
}

export function isInstallationPolicyEnabled(policy: InstallationPolicy | undefined): boolean {
  const hasPolicy = policy !== undefined;
  if (!hasPolicy) {
    return false;
  }

  const hasInvite = policy.inviteCode !== undefined;
  return policy.enabled !== false && hasInvite;
}

function setOptionalPolicyInteger(
  policy: InstallationPolicy,
  key: "repositoryCount",
  value: unknown,
): void {
  const numberValue = readNonNegativeInteger(value);
  const hasValue = numberValue !== undefined;
  if (!hasValue) {
    return;
  }

  policy[key] = numberValue;
}

function setOptionalPolicyString(
  policy: InstallationPolicy,
  key: "createdAt" | "inviteCode" | "inviteName" | "invitedAt" | "updatedAt" | "updatedBy",
  value: unknown,
): void {
  const stringValue = readNonEmptyString(value);
  const hasValue = stringValue !== undefined;
  if (!hasValue) {
    return;
  }

  policy[key] = stringValue;
}

function readNonEmptyString(value: unknown): string | undefined {
  const isString = typeof value === "string" && value.trim().length > 0;
  if (!isString) {
    return undefined;
  }

  return value.trim();
}

function readPositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  const isPositiveInteger = Number.isInteger(numberValue) && numberValue > 0;
  if (!isPositiveInteger) {
    return undefined;
  }

  return numberValue;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  const isNonNegativeInteger = Number.isInteger(numberValue) && numberValue >= 0;
  if (!isNonNegativeInteger) {
    return undefined;
  }

  return numberValue;
}
