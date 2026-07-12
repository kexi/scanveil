import {
  isInstallationPolicyEnabled,
  normalizeInstallationPolicy,
  type InstallationPolicy,
} from "@scanveil/core";

type FirestoreValue =
  | { booleanValue: boolean }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
}

export async function hasEnabledInstallationPolicy(installationId: number): Promise<boolean> {
  const policy = await readInstallationPolicy(installationId);
  return isInstallationPolicyEnabled(policy);
}

async function readInstallationPolicy(
  installationId: number,
): Promise<InstallationPolicy | undefined> {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken();
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

async function getGoogleAccessToken(): Promise<string> {
  const environmentToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const hasEnvironmentToken = typeof environmentToken === "string" && environmentToken.length > 0;
  if (hasEnvironmentToken) {
    return environmentToken;
  }

  const metadataResponse = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "metadata-flavor": "Google" } },
  );
  const isMetadataResponseOk = metadataResponse.ok;
  if (!isMetadataResponseOk) {
    throw new Error(
      `metadata token request failed: ${metadataResponse.status} ${await metadataResponse.text()}`,
    );
  }

  const token = (await metadataResponse.json()) as { access_token?: string };
  const accessToken = token.access_token;
  const hasAccessToken = typeof accessToken === "string" && accessToken.length > 0;
  if (!hasAccessToken) {
    throw new Error("metadata token response did not include access_token");
  }

  return accessToken;
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

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
