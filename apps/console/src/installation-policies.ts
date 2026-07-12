import {
  hasValidInviteCodeCheckDigit,
  isInstallationPolicyEnabled,
  normalizeInstallationPolicy,
  normalizeInviteCode,
  type InstallationPolicy,
} from "@scanveil/core";
import { listGitHubAppInstallations, type GitHubAppInstallation } from "@scanveil/github";

import { readGitHubAppConfig } from "./github-installations.js";
import { getGoogleAccessToken } from "./scan-history.js";

type FirestoreValue =
  | { booleanValue: boolean }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
}

interface InviteCodeRecord {
  enabled?: boolean;
  name?: string;
}

export interface InstallationPolicyUpdateInput {
  enabled: boolean;
  inviteCode?: string;
}

export async function requireEnabledInstallationPolicy(
  installationId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const policy = await readInstallationPolicy(installationId, env);
  const isEnabled = isInstallationPolicyEnabled(policy);
  if (!isEnabled) {
    throw new Error("GitHub App installation requires an enabled invite-backed policy");
  }
}

export async function listInstallationPolicies(
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallationPolicy[]> {
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    return [];
  }

  const installations = await listGitHubAppInstallations(config);
  const policies = await Promise.all(
    installations.map(
      async (installation) =>
        [
          installation.installationId,
          await readInstallationPolicy(installation.installationId, env),
        ] as const,
    ),
  );
  const policyByInstallationId = new Map(policies);
  return installations
    .map((installation) => {
      const storedPolicy = policyByInstallationId.get(installation.installationId);
      return normalizeInstallationPolicy({
        ...toInstallationPolicyBase(installation),
        ...storedPolicy,
        enabled: storedPolicy?.enabled ?? false,
      });
    })
    .filter((policy): policy is InstallationPolicy => policy !== undefined);
}

export async function updateInstallationPolicy(
  installationId: number,
  input: InstallationPolicyUpdateInput,
  updatedBy: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallationPolicy[]> {
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App credentials are not configured");
  }

  const installations = await listGitHubAppInstallations(config);
  const installation = installations.find((item) => item.installationId === installationId);
  const hasInstallation = installation !== undefined;
  if (!hasInstallation) {
    throw new Error("GitHub App installation not found");
  }

  const existingPolicy = await readInstallationPolicy(installationId, env);
  const invite = await readInviteForPolicyUpdate(
    input.inviteCode,
    existingPolicy,
    input.enabled,
    env,
  );
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    ...toInstallationPolicyBase(installation),
    enabled: input.enabled,
    updatedAt: now,
    updatedBy,
  };
  const hasExistingPolicy = existingPolicy !== undefined;
  if (!hasExistingPolicy) {
    update.createdAt = now;
  }

  if (invite !== undefined) {
    update.inviteCode = invite.code;
    update.inviteName = invite.name;
    update.invitedAt = now;
  }

  await patchInstallationPolicyDocument(installationId, update, env);
  return listInstallationPolicies(env);
}

export async function filterRepositoriesByInstallationPolicy<T extends { installationId: number }>(
  repositories: T[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<T[]> {
  const policies = await Promise.all(
    [...new Set(repositories.map((repository) => repository.installationId))].map(
      async (installationId) =>
        [installationId, await readInstallationPolicy(installationId, env)] as const,
    ),
  );
  const policyByInstallationId = new Map(policies);
  return repositories.filter((repository) =>
    isInstallationPolicyEnabled(policyByInstallationId.get(repository.installationId)),
  );
}

async function readInstallationPolicy(
  installationId: number,
  env: NodeJS.ProcessEnv,
): Promise<InstallationPolicy | undefined> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(String(installationId));
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/installationPolicies/${document}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      method: "GET",
    },
  );
  const isNotFound = response.status === 404;
  if (isNotFound) {
    return undefined;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore installation policy read failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreDocument;
  return normalizeInstallationPolicy({
    installationId,
    ...fromFirestoreFields(body.fields ?? {}),
  });
}

async function readInviteForPolicyUpdate(
  rawInviteCode: string | undefined,
  existingPolicy: InstallationPolicy | undefined,
  enabled: boolean,
  env: NodeJS.ProcessEnv,
): Promise<{ code: string; name: string } | undefined> {
  const inviteCode = readOptionalInviteCode(rawInviteCode);
  const hasInviteCode = inviteCode !== undefined;
  if (hasInviteCode) {
    const invite = await readInviteCode(inviteCode, env);
    const hasInvite = invite !== undefined;
    if (!hasInvite) {
      throw new Error("Invite code was not found");
    }

    const isEnabled = invite.enabled !== false;
    if (!isEnabled) {
      throw new Error("Invite code is disabled");
    }

    return { code: inviteCode, name: invite.name ?? inviteCode };
  }

  const isMissingInvite = enabled && existingPolicy?.inviteCode === undefined;
  if (isMissingInvite) {
    throw new Error("Invite code is required to enable installation policy");
  }

  return undefined;
}

async function readInviteCode(
  code: string,
  env: NodeJS.ProcessEnv,
): Promise<InviteCodeRecord | undefined> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(code);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/inviteCodes/${document}`,
    {
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
    },
  );
  const isNotFound = response.status === 404;
  if (isNotFound) {
    return undefined;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore invite code read failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreDocument;
  const fields = fromFirestoreFields(body.fields ?? {});
  return {
    ...(typeof fields.enabled === "boolean" ? { enabled: fields.enabled } : {}),
    ...(typeof fields.name === "string" ? { name: fields.name } : {}),
  };
}

async function patchInstallationPolicyDocument(
  installationId: number,
  update: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(String(installationId));
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/installationPolicies/${document}`,
    {
      body: JSON.stringify({ fields: toFirestoreFields(update) }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "PATCH",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore installation policy update failed: ${response.status} ${await response.text()}`,
    );
  }
}

function fromFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const isBooleanValue = "booleanValue" in field;
    if (isBooleanValue) {
      value[key] = field.booleanValue;
      continue;
    }

    const isIntegerValue = "integerValue" in field;
    if (isIntegerValue) {
      value[key] = Number(field.integerValue);
      continue;
    }

    const isTimestampValue = "timestampValue" in field;
    if (isTimestampValue) {
      value[key] = field.timestampValue;
      continue;
    }

    const isStringValue = "stringValue" in field;
    if (isStringValue) {
      value[key] = field.stringValue;
    }
  }

  return value;
}

function toInstallationPolicyBase(installation: GitHubAppInstallation): InstallationPolicy {
  return {
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    enabled: false,
    installationId: installation.installationId,
    repositoryCount: installation.repositoryCount,
    repositorySelection: installation.repositorySelection,
  };
}

function toFirestoreFields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const isString = typeof item === "string";
    if (isString) {
      fields[key] = { stringValue: item };
      continue;
    }

    const isBoolean = typeof item === "boolean";
    if (isBoolean) {
      fields[key] = { booleanValue: item };
      continue;
    }

    const isNumber = typeof item === "number" && Number.isInteger(item);
    if (isNumber) {
      fields[key] = { integerValue: String(item) };
    }
  }

  return fields;
}

function readOptionalInviteCode(value: string | undefined): string | undefined {
  const hasValue = value !== undefined && value.trim().length > 0;
  if (!hasValue) {
    return undefined;
  }

  const code = normalizeInviteCode(value);
  const hasValidCode = hasValidInviteCodeCheckDigit(code);
  if (!hasValidCode) {
    throw new Error("Invalid invite code");
  }

  return code;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
