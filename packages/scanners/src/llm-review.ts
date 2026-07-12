import type { ScanPolicyPromptEntry } from "@scanveil/core";

export type LlmReviewScope = "pull_request" | "repository";

export interface LlmReviewerOptions {
  excludePaths?: string[];
  model?: string;
  onStreamChunk?(chunk: LlmStreamChunk): void | Promise<void>;
  onUsage?(usage: LlmUsage): void;
  repoFullName: string;
  reviewScope?: LlmReviewScope;
  scanPolicies?: ScanPolicyPromptEntry[];
}

export interface LlmUsage {
  costCurrency: "USD";
  costStatus: "estimated" | "unavailable";
  estimatedCostUsd?: number;
  inputUsdPerMillionTokens?: number;
  inputTokens?: number;
  location: string;
  model: string;
  outputUsdPerMillionTokens?: number;
  outputTokens?: number;
  provider: "vertex_ai";
  totalTokens?: number;
}

export interface LlmStreamChunk {
  text: string;
}
