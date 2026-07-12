import {
  createCodeSpanFingerprint,
  createSveFingerprint,
  normalizeFindingText,
  type FindingSource,
  type SecurityFinding,
} from "@scanveil/core";
import {
  cosineSimilarity,
  type ExactFindingMatch,
  type FindingStore,
  type SimilarFinding,
  type StoredFinding,
} from "@scanveil/rag";

type FirestoreValue =
  | { arrayValue: { values?: FirestoreValue[] } }
  | { doubleValue: number | string }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreRunQueryResult {
  document?: FirestoreDocument;
}

type PlainFindingData = Record<string, unknown>;

interface StoredExactFindingMatch extends ExactFindingMatch {
  writtenAt?: string;
}

export class FirestoreFindingStore implements FindingStore {
  readonly #records: StoredFinding[] = [];
  readonly #fingerprints = new Map<string, StoredExactFindingMatch>();
  readonly #loadedRepos = new Set<string>();

  async saveFinding(record: StoredFinding): Promise<void> {
    this.#records.push(record);
    this.#registerFingerprint(record.repoFullName, record.sveFingerprint, {
      findingId: record.finding.id,
      sveId: record.finding.sveId ?? record.finding.id,
      writtenAt: new Date().toISOString(),
    });
    await this.#writeFingerprint(record);
  }

  async findByFingerprint(
    repoFullName: string,
    sveFingerprint: string,
  ): Promise<ExactFindingMatch | undefined> {
    const fingerprintKey = toFingerprintKey(repoFullName, sveFingerprint);
    const cached = this.#fingerprints.get(fingerprintKey);
    const hasCached = cached !== undefined;
    if (hasCached) {
      return toExactFindingMatch(cached);
    }

    const indexed = await this.#readFingerprint(repoFullName, sveFingerprint);
    const hasIndexed = indexed !== undefined;
    if (hasIndexed) {
      this.#registerFingerprint(repoFullName, sveFingerprint, indexed);
      return toExactFindingMatch(indexed);
    }

    await this.#loadRepoFindings(repoFullName);
    const loaded = this.#fingerprints.get(fingerprintKey);
    return loaded === undefined ? undefined : toExactFindingMatch(loaded);
  }

  async findNearest(
    repoFullName: string,
    embedding: number[],
    limit: number,
  ): Promise<SimilarFinding[]> {
    const vectorFindings = await this.#findNearestWithVectorSearch(repoFullName, embedding, limit);
    const hasVectorFindings = vectorFindings !== undefined;
    if (hasVectorFindings) {
      return vectorFindings;
    }

    await this.#loadRepoFindings(repoFullName);
    return this.#records
      .filter((record) => record.repoFullName === repoFullName)
      .map((record) => ({
        similarity: cosineSimilarity(record.embedding, embedding),
        stored: record,
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }

  async #findNearestWithVectorSearch(
    repoFullName: string,
    embedding: number[],
    limit: number,
  ): Promise<SimilarFinding[] | undefined> {
    try {
      const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
      const { Firestore } = await import("@google-cloud/firestore");
      const firestore = new Firestore({ projectId });
      const snapshot = await firestore
        .collection("scanFindings")
        .where("repoFullName", "==", repoFullName)
        .findNearest({
          distanceMeasure: "COSINE",
          distanceResultField: "vectorDistance",
          limit,
          queryVector: embedding,
          vectorField: "embeddingVector",
        })
        .get();
      return snapshot.docs.flatMap((document) => {
        const data = document.data() as PlainFindingData;
        const record = toStoredFindingFromPlainData(data);
        const hasRecord = record !== undefined;
        if (!hasRecord) {
          return [];
        }

        const distance = readPlainNumber(data.vectorDistance);
        const similarity =
          distance === undefined ? cosineSimilarity(record.embedding, embedding) : 1 - distance;
        return [{ similarity, stored: record }];
      });
    } catch {
      return undefined;
    }
  }

  async #loadRepoFindings(repoFullName: string): Promise<void> {
    const isLoaded = this.#loadedRepos.has(repoFullName);
    if (isLoaded) {
      return;
    }

    const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
    const token = await getGoogleAccessToken();
    const database = encodeURIComponent("(default)");
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const response = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
        {
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: "scanFindings" }],
              limit: pageSize,
              offset,
              where: {
                fieldFilter: {
                  field: { fieldPath: "repoFullName" },
                  op: "EQUAL",
                  value: { stringValue: repoFullName },
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
          `Firestore finding query failed: ${response.status} ${await response.text()}`,
        );
      }

      const body = (await response.json()) as FirestoreRunQueryResult[];
      const fieldsList = body.flatMap((item) => {
        const fields = item.document?.fields;
        const hasFields = fields !== undefined;
        if (!hasFields) {
          return [];
        }

        return [fields];
      });
      for (const fields of fieldsList) {
        this.#registerFingerprintFromFields(fields);
        const record = toStoredFinding(fields);
        const hasRecord = record !== undefined;
        if (!hasRecord) {
          continue;
        }

        this.#records.push(record);
      }

      const hasMorePages = fieldsList.length === pageSize;
      if (!hasMorePages) {
        break;
      }

      offset += pageSize;
    }

    this.#loadedRepos.add(repoFullName);
  }

  async #readFingerprint(
    repoFullName: string,
    sveFingerprint: string,
  ): Promise<StoredExactFindingMatch | undefined> {
    const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
    const token = await getGoogleAccessToken();
    const database = encodeURIComponent("(default)");
    const document = encodeURIComponent(sveFingerprint);
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/sveFingerprints/${document}`,
      {
        headers: { authorization: `Bearer ${token}` },
        method: "GET",
      },
    );
    const isMissing = response.status === 404;
    if (isMissing) {
      return undefined;
    }

    const isOk = response.ok;
    if (!isOk) {
      throw new Error(
        `Firestore SVE fingerprint read failed: ${response.status} ${await response.text()}`,
      );
    }

    const body = (await response.json()) as FirestoreDocument;
    const fields = body.fields;
    const hasFields = fields !== undefined;
    if (!hasFields) {
      return undefined;
    }

    const indexedRepoFullName = readString(fields.repoFullName);
    const isSameRepo = indexedRepoFullName === repoFullName;
    if (!isSameRepo) {
      return undefined;
    }

    return {
      findingId: readString(fields.findingId),
      sveId: readString(fields.sveId),
      ...toOptionalWrittenAt(readOptionalString(fields.firstSeenAt)),
    };
  }

  async #writeFingerprint(record: StoredFinding): Promise<void> {
    const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
    const token = await getGoogleAccessToken();
    const database = encodeURIComponent("(default)");
    const document = encodeURIComponent(record.sveFingerprint);
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/sveFingerprints/${document}`,
      {
        body: JSON.stringify({
          fields: {
            fingerprint: { stringValue: record.sveFingerprint },
            findingId: { stringValue: record.finding.id },
            firstSeenAt: { timestampValue: new Date().toISOString() },
            repoFullName: { stringValue: record.repoFullName },
            sveId: { stringValue: record.finding.sveId ?? record.finding.id },
          },
        }),
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
        `Firestore SVE fingerprint write failed: ${response.status} ${await response.text()}`,
      );
    }
  }

  #registerFingerprintFromFields(fields: Record<string, FirestoreValue>): void {
    const repoFullName = readString(fields.repoFullName);
    const finding = toSecurityFinding(fields);
    const normalizedText =
      readOptionalString(fields.normalizedText) ?? normalizeFindingText(finding);
    const codeSpanFingerprint =
      readOptionalString(fields.codeSpanFingerprint) ??
      createCodeSpanFingerprint(finding.file, finding.startLine, finding.endLine);
    const sveFingerprint =
      readOptionalString(fields.sveFingerprint) ??
      createSveFingerprint(repoFullName, normalizedText, codeSpanFingerprint);
    this.#registerFingerprint(repoFullName, sveFingerprint, {
      findingId: finding.id,
      sveId: finding.sveId ?? finding.id,
      ...toOptionalWrittenAt(readOptionalString(fields.writtenAt)),
    });
  }

  #registerFingerprint(
    repoFullName: string,
    sveFingerprint: string,
    match: StoredExactFindingMatch,
  ): void {
    const fingerprintKey = toFingerprintKey(repoFullName, sveFingerprint);
    const existing = this.#fingerprints.get(fingerprintKey);
    const shouldReplace =
      existing === undefined ||
      (match.writtenAt !== undefined &&
        (existing.writtenAt === undefined || match.writtenAt < existing.writtenAt));
    if (!shouldReplace) {
      return;
    }

    this.#fingerprints.set(fingerprintKey, match);
  }
}

function toStoredFinding(fields: Record<string, FirestoreValue>): StoredFinding | undefined {
  const embedding = readNumberArray(fields.embedding);
  const hasEmbedding = embedding !== undefined && embedding.length > 0;
  if (!hasEmbedding) {
    return undefined;
  }

  const repoFullName = readString(fields.repoFullName);
  const finding = toSecurityFinding(fields);
  const normalizedText = readOptionalString(fields.normalizedText) ?? normalizeFindingText(finding);
  const codeSpanFingerprint =
    readOptionalString(fields.codeSpanFingerprint) ??
    createCodeSpanFingerprint(finding.file, finding.startLine, finding.endLine);
  const sveFingerprint =
    readOptionalString(fields.sveFingerprint) ??
    createSveFingerprint(repoFullName, normalizedText, codeSpanFingerprint);
  return {
    codeSpanFingerprint,
    embedding,
    finding,
    normalizedText,
    repoFullName,
    sveFingerprint,
  };
}

function toStoredFindingFromPlainData(data: PlainFindingData): StoredFinding | undefined {
  const embedding = readPlainNumberArray(data.embedding);
  const hasEmbedding = embedding !== undefined && embedding.length > 0;
  if (!hasEmbedding) {
    return undefined;
  }

  const repoFullName = readPlainString(data.repoFullName);
  const finding = toSecurityFindingFromPlainData(data);
  const normalizedText =
    readPlainOptionalString(data.normalizedText) ?? normalizeFindingText(finding);
  const codeSpanFingerprint =
    readPlainOptionalString(data.codeSpanFingerprint) ??
    createCodeSpanFingerprint(finding.file, finding.startLine, finding.endLine);
  const sveFingerprint =
    readPlainOptionalString(data.sveFingerprint) ??
    createSveFingerprint(repoFullName, normalizedText, codeSpanFingerprint);
  return {
    codeSpanFingerprint,
    embedding,
    finding,
    normalizedText,
    repoFullName,
    sveFingerprint,
  };
}

function toSecurityFinding(fields: Record<string, FirestoreValue>): SecurityFinding {
  const findingId = readString(fields.findingId);
  const finding: SecurityFinding = {
    aliases: readStringArray(fields.aliases),
    category: readString(fields.category),
    confidence: readNumber(fields.confidence),
    evidence: readString(fields.evidence),
    id: findingId,
    recommendation: readString(fields.recommendation),
    severity: readString(fields.severity) as SecurityFinding["severity"],
    source: readString(fields.source) as FindingSource,
    title: readString(fields.title),
  };
  setOptionalString(finding, "codeSpanFingerprint", readOptionalString(fields.codeSpanFingerprint));
  setOptionalNumberArray(finding, "embedding", readNumberArray(fields.embedding));
  setOptionalNumber(finding, "endLine", readOptionalInteger(fields.endLine));
  setOptionalString(finding, "file", readOptionalString(fields.file));
  setOptionalString(finding, "normalizedText", readOptionalString(fields.normalizedText));
  setOptionalNumber(finding, "startLine", readOptionalInteger(fields.startLine));
  setOptionalString(finding, "suppressedById", readOptionalString(fields.suppressedById));
  setOptionalString(finding, "sveFingerprint", readOptionalString(fields.sveFingerprint));
  setOptionalString(finding, "sveId", readOptionalString(fields.sveId) ?? findingId);
  return finding;
}

function toSecurityFindingFromPlainData(data: PlainFindingData): SecurityFinding {
  const findingId = readPlainString(data.findingId);
  const finding: SecurityFinding = {
    aliases: readPlainStringArray(data.aliases),
    category: readPlainString(data.category),
    confidence: readPlainNumber(data.confidence) ?? 0,
    evidence: readPlainString(data.evidence),
    id: findingId,
    recommendation: readPlainString(data.recommendation),
    severity: readPlainString(data.severity) as SecurityFinding["severity"],
    source: readPlainString(data.source) as FindingSource,
    title: readPlainString(data.title),
  };
  setOptionalString(
    finding,
    "codeSpanFingerprint",
    readPlainOptionalString(data.codeSpanFingerprint),
  );
  setOptionalNumberArray(finding, "embedding", readPlainNumberArray(data.embedding));
  setOptionalNumber(finding, "endLine", readPlainInteger(data.endLine));
  setOptionalString(finding, "file", readPlainOptionalString(data.file));
  setOptionalString(finding, "normalizedText", readPlainOptionalString(data.normalizedText));
  setOptionalNumber(finding, "startLine", readPlainInteger(data.startLine));
  setOptionalString(finding, "suppressedById", readPlainOptionalString(data.suppressedById));
  setOptionalString(finding, "sveFingerprint", readPlainOptionalString(data.sveFingerprint));
  setOptionalString(finding, "sveId", readPlainOptionalString(data.sveId) ?? findingId);
  return finding;
}

function setOptionalString(
  finding: SecurityFinding,
  key:
    | "codeSpanFingerprint"
    | "file"
    | "normalizedText"
    | "suppressedById"
    | "sveFingerprint"
    | "sveId",
  value: string | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  finding[key] = value;
}

function toFingerprintKey(repoFullName: string, sveFingerprint: string): string {
  return `${repoFullName}:${sveFingerprint}`;
}

function toExactFindingMatch(match: StoredExactFindingMatch): ExactFindingMatch {
  return {
    findingId: match.findingId,
    sveId: match.sveId,
  };
}

function toOptionalWrittenAt(writtenAt: string | undefined): { writtenAt?: string } {
  const hasWrittenAt = writtenAt !== undefined;
  if (!hasWrittenAt) {
    return {};
  }

  return { writtenAt };
}

function setOptionalNumber(
  finding: SecurityFinding,
  key: "endLine" | "startLine",
  value: number | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  finding[key] = value;
}

function setOptionalNumberArray(
  finding: SecurityFinding,
  key: "embedding",
  value: number[] | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  finding[key] = value;
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

function readString(value: FirestoreValue | undefined): string {
  const stringValue = readOptionalString(value);
  return stringValue ?? "";
}

function readOptionalString(value: FirestoreValue | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if ("stringValue" in value) {
    return value.stringValue;
  }

  if ("timestampValue" in value) {
    return value.timestampValue;
  }

  return undefined;
}

function readOptionalInteger(value: FirestoreValue | undefined): number | undefined {
  const hasInteger = value !== undefined && "integerValue" in value;
  if (!hasInteger) {
    return undefined;
  }

  return Number(value.integerValue);
}

function readNumber(value: FirestoreValue | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  return 0;
}

function readNumberArray(value: FirestoreValue | undefined): number[] | undefined {
  const hasArray = value !== undefined && "arrayValue" in value;
  if (!hasArray) {
    return undefined;
  }

  const values = (value.arrayValue.values ?? []).flatMap((item) => {
    const numberValue = readOptionalNumber(item);
    const hasNumberValue = numberValue !== undefined;
    if (!hasNumberValue) {
      return [];
    }

    return [numberValue];
  });
  return values.length > 0 ? values : undefined;
}

function readOptionalNumber(value: FirestoreValue | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  return undefined;
}

function readStringArray(value: FirestoreValue | undefined): string[] {
  const hasArray = value !== undefined && "arrayValue" in value;
  if (!hasArray) {
    return [];
  }

  return (value.arrayValue.values ?? []).flatMap((item) => {
    const stringValue = readOptionalString(item);
    const hasStringValue = stringValue !== undefined;
    if (!hasStringValue) {
      return [];
    }

    return [stringValue];
  });
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readPlainString(value: unknown): string {
  return readPlainOptionalString(value) ?? "";
}

function readPlainOptionalString(value: unknown): string | undefined {
  const isString = typeof value === "string";
  if (isString) {
    return value;
  }

  const isDate = value instanceof Date;
  if (isDate) {
    return value.toISOString();
  }

  const hasToDate =
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function";
  if (hasToDate) {
    const timestamp = value as { toDate(): Date };
    return timestamp.toDate().toISOString();
  }

  return undefined;
}

function readPlainInteger(value: unknown): number | undefined {
  const numberValue = readPlainNumber(value);
  const isInteger = numberValue !== undefined && Number.isInteger(numberValue);
  if (!isInteger) {
    return undefined;
  }

  return numberValue;
}

function readPlainNumber(value: unknown): number | undefined {
  const isNumber = typeof value === "number";
  if (isNumber) {
    return value;
  }

  return undefined;
}

function readPlainNumberArray(value: unknown): number[] | undefined {
  const isArray = Array.isArray(value);
  if (!isArray) {
    return undefined;
  }

  const values = value.filter((item): item is number => typeof item === "number");
  return values.length > 0 ? values : undefined;
}

function readPlainStringArray(value: unknown): string[] {
  const isArray = Array.isArray(value);
  if (!isArray) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
