import type { Severity } from "./severity.js";

export type CheckConclusionMode = "advisory" | "fail_on_threshold";
export type ScanScope = "pr_diff" | "changed_lockfiles";
export type FindingSource = "llm" | "osv";
export type LlmAgentRunner = "antigravity_experimental";

export interface SecurityAppConfig {
  version: 1;
  checks: {
    conclusionMode: CheckConclusionMode;
    failThreshold: {
      osv: Severity;
      llm: Severity;
    };
  };
  scan: {
    llm: {
      enabled: boolean;
      scope: "pr_diff";
      excludePaths: string[];
      agent: {
        runner: LlmAgentRunner;
        timeoutSeconds: number;
        skills: {
          enabled: boolean;
        };
        plugins: {
          enabled: boolean;
        };
        mcp: {
          enabled: boolean;
        };
      };
    };
    osv: {
      enabled: boolean;
      scope: "changed_lockfiles";
      lockfileGlobs: string[];
    };
  };
  suppression: {
    enabled: boolean;
    similarityThreshold: number;
    maxNearestNeighbors: number;
  };
  schedule: {
    enabled: boolean;
  };
}

export interface ConfigParseResult {
  config: SecurityAppConfig;
  warnings: string[];
}

export interface PullRequestRef {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  installationId: number;
  repositoryId: number;
}

export interface RepositoryRef {
  defaultBranch: string;
  headSha: string;
  installationId: number;
  owner: string;
  repo: string;
  repositoryId: number;
}

export interface PullRequestScanRequest extends PullRequestRef {
  configSourceOverride?: string;
  deliveryId: string;
  llmEnabled: boolean;
  llmModel?: string;
  osvEnabled: boolean;
  reason: "pull_request" | "manual";
  target: "pull_request";
}

export interface RepositoryScanRequest extends RepositoryRef {
  configSourceOverride?: string;
  deliveryId: string;
  llmEnabled: boolean;
  llmModel?: string;
  osvEnabled: boolean;
  reason: "scheduled" | "manual";
  target: "repository";
}

export type ScanRequest = PullRequestScanRequest | RepositoryScanRequest;

export interface FixPrRequest extends RepositoryRef {
  deliveryId: string;
  evidence: string;
  file: string;
  findingId: string;
  fixId: string;
  recommendation: string;
  severity: Severity;
  startLine: number;
  endLine: number;
  sveId: string;
  title: string;
  llmModel?: string;
}

export interface DiffFile {
  path: string;
  previousPath?: string;
  addedLines: number[];
  raw: string;
}

export interface SecurityFinding {
  id: string;
  sveId?: string;
  source: FindingSource;
  title: string;
  severity: Severity;
  file?: string;
  startLine?: number;
  endLine?: number;
  category: string;
  evidence: string;
  recommendation: string;
  confidence: number;
  aliases: string[];
  suppressedById?: string;
  normalizedText?: string;
  codeSpanFingerprint?: string;
  sveFingerprint?: string;
  embedding?: number[];
}

export interface CheckAnnotation {
  path: string;
  startLine: number;
  endLine: number;
  annotationLevel: "notice" | "warning" | "failure";
  message: string;
  title: string;
  rawDetails?: string;
}

export interface CheckRunResult {
  conclusion: "success" | "failure" | "neutral";
  title: string;
  summary: string;
  text?: string;
  detailsUrl?: string;
  annotations: CheckAnnotation[];
}
