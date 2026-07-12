export const scanPolicyNameMaxLength = 120;
export const scanPolicyRuleMaxLength = 4000;

export interface InstallationScanPolicy {
  createdAt?: string;
  enabled: boolean;
  id: string;
  installationId: number;
  name: string;
  rule: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface InstallationScanPolicyInput {
  createdAt?: unknown;
  enabled?: unknown;
  id?: unknown;
  installationId?: unknown;
  name?: unknown;
  rule?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
}

export interface ScanPolicyPromptEntry {
  name: string;
  rule: string;
}

export function normalizeInstallationScanPolicy(
  value: unknown,
): InstallationScanPolicy | undefined {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord) {
    return undefined;
  }

  const input = value as InstallationScanPolicyInput;
  const id = readNonEmptyString(input.id);
  const installationId = readPositiveInteger(input.installationId);
  const name = readBoundedString(input.name, scanPolicyNameMaxLength);
  const rule = readBoundedString(input.rule, scanPolicyRuleMaxLength);
  const hasRequiredFields =
    id !== undefined && installationId !== undefined && name !== undefined && rule !== undefined;
  if (!hasRequiredFields) {
    return undefined;
  }

  const policy: InstallationScanPolicy = {
    enabled: input.enabled !== false,
    id,
    installationId,
    name,
    rule,
  };
  setOptionalString(policy, "createdAt", input.createdAt);
  setOptionalString(policy, "updatedAt", input.updatedAt);
  setOptionalString(policy, "updatedBy", input.updatedBy);
  return policy;
}

export function toScanPolicyPromptEntries(
  policies: InstallationScanPolicy[],
): ScanPolicyPromptEntry[] {
  return policies
    .filter((policy) => policy.enabled)
    .map((policy) => ({ name: policy.name, rule: policy.rule }));
}

function setOptionalString(
  policy: InstallationScanPolicy,
  key: "createdAt" | "updatedAt" | "updatedBy",
  value: unknown,
): void {
  const stringValue = readNonEmptyString(value);
  const hasValue = stringValue !== undefined;
  if (!hasValue) {
    return;
  }

  policy[key] = stringValue;
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  const stringValue = readNonEmptyString(value);
  const isWithinLimit = stringValue !== undefined && stringValue.length <= maxLength;
  if (!isWithinLimit) {
    return undefined;
  }

  return stringValue;
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
