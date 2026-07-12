import {
  normalizeInstallationScanPolicy,
  scanPolicyNameMaxLength,
  scanPolicyRuleMaxLength,
  type InstallationScanPolicy,
} from "@scanveil/core";

import { getGoogleAccessToken } from "./scan-history.js";

type FirestoreValue =
  | { booleanValue: boolean }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
  name?: string;
}

interface FirestoreQueryResult {
  document?: {
    fields?: Record<string, FirestoreValue>;
    name: string;
  };
}

export interface ScanPolicyCreateInput {
  enabled: boolean;
  installationId: number;
  name: string;
  rule: string;
}

export interface ScanPolicyUpdateInput {
  enabled?: boolean;
  name?: string;
  rule?: string;
}

export async function listScanPolicies(
  installationIds: number[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallationScanPolicy[]> {
  const policiesByInstallation = await Promise.all(
    [...new Set(installationIds)].map((installationId) => queryScanPolicies(installationId, env)),
  );
  return policiesByInstallation
    .flat()
    .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
}

export async function readScanPolicy(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallationScanPolicy | undefined> {
  const response = await fetch(await scanPolicyDocumentUrl(id, env), {
    headers: { authorization: `Bearer ${await getGoogleAccessToken(env)}` },
    method: "GET",
  });
  const isNotFound = response.status === 404;
  if (isNotFound) {
    return undefined;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan policy read failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreDocument;
  return toScanPolicy(body);
}

export async function createScanPolicy(
  input: ScanPolicyCreateInput,
  updatedBy: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallationScanPolicy> {
  validateScanPolicyText(input.name, input.rule);
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const now = new Date().toISOString();
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/scanPolicies`,
    {
      body: JSON.stringify({
        fields: toFirestoreFields({
          createdAt: now,
          enabled: input.enabled,
          installationId: input.installationId,
          name: input.name.trim(),
          rule: input.rule.trim(),
          updatedAt: now,
          updatedBy,
        }),
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan policy create failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreDocument;
  const policy = toScanPolicy(body);
  const hasPolicy = policy !== undefined;
  if (!hasPolicy) {
    throw new Error("Firestore scan policy create returned an invalid document");
  }

  return policy;
}

export async function updateScanPolicy(
  id: string,
  input: ScanPolicyUpdateInput,
  updatedBy: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallationScanPolicy | undefined> {
  const existing = await readScanPolicy(id, env);
  const hasExisting = existing !== undefined;
  if (!hasExisting) {
    return undefined;
  }

  const name = input.name ?? existing.name;
  const rule = input.rule ?? existing.rule;
  validateScanPolicyText(name, rule);
  const response = await fetch(await scanPolicyDocumentUrl(id, env), {
    body: JSON.stringify({
      fields: toFirestoreFields({
        ...(existing.createdAt === undefined ? {} : { createdAt: existing.createdAt }),
        enabled: input.enabled ?? existing.enabled,
        installationId: existing.installationId,
        name: name.trim(),
        rule: rule.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy,
      }),
    }),
    headers: {
      authorization: `Bearer ${await getGoogleAccessToken(env)}`,
      "content-type": "application/json",
    },
    method: "PATCH",
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan policy update failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreDocument;
  return toScanPolicy(body);
}

export async function deleteScanPolicy(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const response = await fetch(await scanPolicyDocumentUrl(id, env), {
    headers: { authorization: `Bearer ${await getGoogleAccessToken(env)}` },
    method: "DELETE",
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan policy delete failed: ${response.status} ${await response.text()}`,
    );
  }
}

async function queryScanPolicies(
  installationId: number,
  env: NodeJS.ProcessEnv,
): Promise<InstallationScanPolicy[]> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
    {
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "scanPolicies" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "installationId" },
              op: "EQUAL",
              value: { integerValue: String(installationId) },
            },
          },
        },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan policy query failed: ${response.status} ${await response.text()}`,
    );
  }

  const results = (await response.json()) as FirestoreQueryResult[];
  return results
    .map((result) => result.document)
    .filter((document) => document !== undefined)
    .map((document) => toScanPolicy(document))
    .filter((policy): policy is InstallationScanPolicy => policy !== undefined);
}

function validateScanPolicyText(name: string, rule: string): void {
  const isNameValid = name.trim().length > 0 && name.trim().length <= scanPolicyNameMaxLength;
  if (!isNameValid) {
    throw new Error(`Policy name must be 1-${scanPolicyNameMaxLength} characters`);
  }

  const isRuleValid = rule.trim().length > 0 && rule.trim().length <= scanPolicyRuleMaxLength;
  if (!isRuleValid) {
    throw new Error(`Policy rule must be 1-${scanPolicyRuleMaxLength} characters`);
  }
}

async function scanPolicyDocumentUrl(id: string, env: NodeJS.ProcessEnv): Promise<string> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const database = encodeURIComponent("(default)");
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/scanPolicies/${encodeURIComponent(id)}`;
}

function toScanPolicy(document: FirestoreDocument): InstallationScanPolicy | undefined {
  const name = document.name;
  const hasName = typeof name === "string" && name.length > 0;
  if (!hasName) {
    return undefined;
  }

  return normalizeInstallationScanPolicy({
    id: name.split("/").at(-1),
    ...fromFirestoreFields(document.fields ?? {}),
  });
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

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
