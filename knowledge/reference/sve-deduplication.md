---
type: Reference
title: Scanveil SVE deduplication
description: How Scanveil assigns stable SVE IDs and prevents exact duplicate findings from becoming new vulnerabilities.
resource: ../../packages/rag/src/suppression.ts
tags: [scanveil, sve, firestore, deduplication, findings]
timestamp: 2026-06-21T16:35:00Z
---

# Scanveil SVE deduplication

Scanveil assigns stable SVE IDs in two layers.

1. Exact fingerprint match: `repoFullName`, normalized finding text, and code span are hashed into `sveFingerprint`. If the fingerprint already exists, the worker reuses the canonical `sveId` before running vector similarity.
2. Semantic match: when no exact fingerprint exists, the worker embeds normalized finding text and queries Firestore Vector Search against prior findings from the same repository. Matches above the configured threshold reuse the prior `sveId`.

The Firestore-backed worker stores exact matches in the `sveFingerprints` collection. It also writes `embeddingVector` on new `scanFindings` documents so Firestore can perform cosine nearest-neighbor search. Existing `scanFindings` are still read to rebuild the fingerprint map, so historical findings without an index document can still be used as canonical SVE records.

If the vector index is missing or a historical finding does not have `embeddingVector`, the worker falls back to the older repository-scoped Firestore scan and local cosine similarity. This keeps scans available while vector indexes are being deployed or backfilled.

The Management Console `new` badge should only consider unsuppressed findings as first appearances. Findings with `suppressedById` are known duplicates and must not be shown as new even if the original occurrence is outside the currently loaded scan history window.

## Resolution verification

The Management Console treats SVE resolution as derived state rather than a stored mutable flag. For each SVE, it compares the latest detection with the latest successful repository-wide scan for the same repository.

- `active`: the latest successful repository scan still contains the SVE.
- `resolved`: a newer successful repository scan completed after the latest detection and no longer contains the SVE.
- `unverified`: there is no successful repository scan after the latest detection, so the fix has not been checked yet.

The Dashboard `SVE verification` panel can enqueue repository-wide scans for all `active` and `unverified` SVE repositories. The SVE detail page can enqueue the same verification scan for a single SVE. Multiple SVE targets in the same repository are de-duplicated into one repository scan.
