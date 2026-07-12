import {
  toStructuredLogError,
  writeStructuredLog,
  type ScanFindingRecord,
  type ScanRequest,
  type SecurityFinding,
} from "@scanveil/core";

type FirestoreValue =
  | { arrayValue: { values?: FirestoreValue[] } }
  | { doubleValue: number }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

export async function writeScanFindings(
  request: ScanRequest,
  findings: SecurityFinding[],
): Promise<void> {
  const hasFindings = findings.length > 0;
  if (!hasFindings) {
    return;
  }

  const now = new Date().toISOString();
  const records = findings.map((finding) => toScanFindingRecord(request, finding, now));
  for (const record of records) {
    await writeScanFindingRecord(record);
  }
}

function toScanFindingRecord(
  request: ScanRequest,
  finding: SecurityFinding,
  writtenAt: string,
): ScanFindingRecord {
  return {
    aliases: finding.aliases,
    category: finding.category,
    confidence: finding.confidence,
    deliveryId: request.deliveryId,
    endLine: finding.endLine,
    evidence: finding.evidence,
    file: finding.file,
    findingId: finding.id,
    sveId: finding.sveId,
    recommendation: finding.recommendation,
    repoFullName: `${request.owner}/${request.repo}`,
    repositoryId: request.repositoryId,
    severity: finding.severity,
    source: finding.source,
    startLine: finding.startLine,
    suppressedById: finding.suppressedById,
    title: finding.title,
    writtenAt,
    normalizedText: finding.normalizedText,
    codeSpanFingerprint: finding.codeSpanFingerprint,
    sveFingerprint: finding.sveFingerprint,
    embedding: finding.embedding,
  };
}

async function writeScanFindingRecord(record: ScanFindingRecord): Promise<void> {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken();
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(`${record.deliveryId}-${record.findingId}`);
  const fields = toFirestoreFields(record);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/scanFindings/${document}`,
    {
      body: JSON.stringify({ fields }),
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
      `Firestore scan finding write failed: ${response.status} ${await response.text()}`,
    );
  }

  try {
    await writeEmbeddingVector(record, projectId);
  } catch (error) {
    writeStructuredLog({
      deliveryId: record.deliveryId,
      error: toStructuredLogError(error),
      findingId: record.findingId,
      message: "scan_finding_vector_write_failed",
      severity: "WARNING",
    });
  }
}

function toFirestoreFields(record: ScanFindingRecord): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {
    aliases: { arrayValue: { values: record.aliases.map((alias) => ({ stringValue: alias })) } },
    category: { stringValue: record.category },
    confidence: { doubleValue: record.confidence },
    deliveryId: { stringValue: record.deliveryId },
    evidence: { stringValue: record.evidence },
    findingId: { stringValue: record.findingId },
    recommendation: { stringValue: record.recommendation },
    repoFullName: { stringValue: record.repoFullName },
    severity: { stringValue: record.severity },
    source: { stringValue: record.source },
    title: { stringValue: record.title },
    writtenAt: { timestampValue: record.writtenAt },
  };

  setOptionalInteger(fields, "endLine", record.endLine);
  setOptionalString(fields, "file", record.file);
  setOptionalInteger(fields, "repositoryId", record.repositoryId);
  setOptionalInteger(fields, "startLine", record.startLine);
  setOptionalString(fields, "suppressedById", record.suppressedById);
  setOptionalString(fields, "sveId", record.sveId);
  setOptionalString(fields, "normalizedText", record.normalizedText);
  setOptionalString(fields, "codeSpanFingerprint", record.codeSpanFingerprint);
  setOptionalString(fields, "sveFingerprint", record.sveFingerprint);
  setOptionalNumberArray(fields, "embedding", record.embedding);

  return fields;
}

function setOptionalString(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: string | undefined,
): void {
  const hasValue = value !== undefined && value.length > 0;
  if (!hasValue) {
    return;
  }

  fields[key] = { stringValue: value };
}

function setOptionalInteger(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: number | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  fields[key] = { integerValue: String(value) };
}

function setOptionalNumberArray(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: number[] | undefined,
): void {
  const hasValue = value !== undefined && value.length > 0;
  if (!hasValue) {
    return;
  }

  fields[key] = { arrayValue: { values: value.map((item) => ({ doubleValue: item })) } };
}

async function writeEmbeddingVector(record: ScanFindingRecord, projectId: string): Promise<void> {
  const embedding = record.embedding;
  const hasEmbedding = embedding !== undefined && embedding.length > 0;
  if (!hasEmbedding) {
    return;
  }

  const { FieldValue, Firestore } = await import("@google-cloud/firestore");
  const firestore = new Firestore({ projectId });
  const document = `${record.deliveryId}-${record.findingId}`;
  await firestore
    .collection("scanFindings")
    .doc(document)
    .update({
      embeddingVector: FieldValue.vector(embedding),
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

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
