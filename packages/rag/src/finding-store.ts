import type { SecurityFinding } from "@scanveil/core";

import { cosineSimilarity } from "./similarity.js";

export interface StoredFinding {
  finding: SecurityFinding;
  repoFullName: string;
  normalizedText: string;
  codeSpanFingerprint: string;
  sveFingerprint: string;
  embedding: number[];
}

export interface ExactFindingMatch {
  findingId: string;
  sveId: string;
}

export interface SimilarFinding {
  stored: StoredFinding;
  similarity: number;
}

export interface FindingStore {
  findByFingerprint(
    repoFullName: string,
    sveFingerprint: string,
  ): Promise<ExactFindingMatch | undefined>;
  saveFinding(record: StoredFinding): Promise<void>;
  findNearest(repoFullName: string, embedding: number[], limit: number): Promise<SimilarFinding[]>;
}

export class InMemoryFindingStore implements FindingStore {
  readonly #records: StoredFinding[] = [];
  readonly #fingerprints = new Map<string, ExactFindingMatch>();

  async findByFingerprint(
    repoFullName: string,
    sveFingerprint: string,
  ): Promise<ExactFindingMatch | undefined> {
    return this.#fingerprints.get(`${repoFullName}:${sveFingerprint}`);
  }

  async saveFinding(record: StoredFinding): Promise<void> {
    this.#records.push(record);
    const fingerprintKey = `${record.repoFullName}:${record.sveFingerprint}`;
    const hasFingerprint = this.#fingerprints.has(fingerprintKey);
    if (hasFingerprint) {
      return;
    }

    this.#fingerprints.set(fingerprintKey, {
      findingId: record.finding.id,
      sveId: record.finding.sveId ?? record.finding.id,
    });
  }

  async findNearest(
    repoFullName: string,
    embedding: number[],
    limit: number,
  ): Promise<SimilarFinding[]> {
    return this.#records
      .filter((record) => record.repoFullName === repoFullName)
      .map((record) => ({
        similarity: cosineSimilarity(record.embedding, embedding),
        stored: record,
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, limit);
  }
}
