import { parse as parseYaml } from "yaml";

import { defaultLockfileGlobs } from "./lockfiles.js";
import { normalizeSeverity } from "./severity.js";
import type {
  CheckConclusionMode,
  ConfigParseResult,
  LlmAgentRunner,
  SecurityAppConfig,
} from "./types.js";

export const defaultSecurityAppConfig: SecurityAppConfig = {
  version: 1,
  checks: {
    conclusionMode: "advisory",
    failThreshold: {
      osv: "critical",
      llm: "critical",
    },
  },
  scan: {
    llm: {
      enabled: true,
      scope: "pr_diff",
      excludePaths: ["dist/**", "vendor/**"],
      agent: {
        runner: "antigravity_experimental",
        timeoutSeconds: 900,
        skills: {
          enabled: true,
        },
        plugins: {
          enabled: false,
        },
        mcp: {
          enabled: false,
        },
      },
    },
    osv: {
      enabled: true,
      scope: "changed_lockfiles",
      lockfileGlobs: defaultLockfileGlobs,
    },
  },
  suppression: {
    enabled: true,
    similarityThreshold: 0.7,
    maxNearestNeighbors: 10,
  },
  schedule: {
    enabled: true,
  },
};

export function parseSecurityAppConfig(source: string | undefined): ConfigParseResult {
  const warnings: string[] = [];
  const hasSource = source !== undefined && source.trim().length > 0;
  if (!hasSource) {
    return { config: structuredClone(defaultSecurityAppConfig), warnings };
  }

  const parsed = parseYaml(source) as unknown;
  const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isObject) {
    return {
      config: structuredClone(defaultSecurityAppConfig),
      warnings: ["Configuration file is not a YAML object. Defaults were used."],
    };
  }

  const raw = parsed as Record<string, unknown>;
  const config = structuredClone(defaultSecurityAppConfig);

  applyChecksConfig(config, raw);
  applyScanConfig(config, raw, warnings);
  applySuppressionConfig(config, raw, warnings);
  applyScheduleConfig(config, raw);

  return { config, warnings };
}

function applyChecksConfig(config: SecurityAppConfig, raw: Record<string, unknown>): void {
  const checks = readObject(raw.checks);
  const hasChecks = checks !== undefined;
  if (!hasChecks) {
    return;
  }

  const conclusionMode = checks.conclusionMode;
  const isKnownMode = conclusionMode === "advisory" || conclusionMode === "fail_on_threshold";
  if (isKnownMode) {
    config.checks.conclusionMode = conclusionMode as CheckConclusionMode;
  }

  const failThreshold = readObject(checks.failThreshold);
  const hasFailThreshold = failThreshold !== undefined;
  if (!hasFailThreshold) {
    return;
  }

  config.checks.failThreshold.osv = normalizeSeverity(
    failThreshold.osv,
    config.checks.failThreshold.osv,
  );
  config.checks.failThreshold.llm = normalizeSeverity(
    failThreshold.llm,
    config.checks.failThreshold.llm,
  );
}

function applyScanConfig(
  config: SecurityAppConfig,
  raw: Record<string, unknown>,
  warnings: string[],
): void {
  const scan = readObject(raw.scan);
  const hasScan = scan !== undefined;
  if (!hasScan) {
    return;
  }

  const llm = readObject(scan.llm);
  const hasLlm = llm !== undefined;
  if (hasLlm) {
    config.scan.llm.enabled = readBoolean(llm.enabled, config.scan.llm.enabled);
    config.scan.llm.excludePaths = readStringArray(llm.excludePaths, config.scan.llm.excludePaths);
    applyLlmAgentConfig(config, llm, warnings);
  }

  const osv = readObject(scan.osv);
  const hasOsv = osv !== undefined;
  if (!hasOsv) {
    return;
  }

  config.scan.osv.enabled = readBoolean(osv.enabled, config.scan.osv.enabled);
  config.scan.osv.lockfileGlobs = readStringArray(osv.lockfileGlobs, config.scan.osv.lockfileGlobs);

  const hasChangedLockfilesScope = osv.scope === undefined || osv.scope === "changed_lockfiles";
  if (!hasChangedLockfilesScope) {
    warnings.push(
      "scan.osv.scope supports only changed_lockfiles in this PoC. Defaults were used.",
    );
  }
}

function applyLlmAgentConfig(
  config: SecurityAppConfig,
  llm: Record<string, unknown>,
  warnings: string[],
): void {
  const agent = readObject(llm.agent);
  const hasAgent = agent !== undefined;
  if (!hasAgent) {
    return;
  }

  const runner = agent.runner;
  const isKnownRunner = runner === "antigravity_experimental";
  if (isKnownRunner) {
    config.scan.llm.agent.runner = runner as LlmAgentRunner;
  }

  const timeoutSeconds = readInteger(
    agent.timeoutSeconds,
    config.scan.llm.agent.timeoutSeconds,
    1,
    1_800,
  );
  config.scan.llm.agent.timeoutSeconds = timeoutSeconds;

  const skills = readObject(agent.skills);
  const hasSkills = skills !== undefined;
  if (hasSkills) {
    config.scan.llm.agent.skills.enabled = readBoolean(
      skills.enabled,
      config.scan.llm.agent.skills.enabled,
    );
  }

  const plugins = readObject(agent.plugins);
  const hasPlugins = plugins !== undefined;
  if (hasPlugins) {
    config.scan.llm.agent.plugins.enabled = readBoolean(
      plugins.enabled,
      config.scan.llm.agent.plugins.enabled,
    );
  }

  const mcp = readObject(agent.mcp);
  const hasMcp = mcp !== undefined;
  if (hasMcp) {
    config.scan.llm.agent.mcp.enabled = readBoolean(mcp.enabled, config.scan.llm.agent.mcp.enabled);
  }

  const hasInvalidRunner = runner !== undefined && !isKnownRunner;
  if (hasInvalidRunner) {
    warnings.push("scan.llm.agent.runner is not supported. Default was used.");
  }
}

function applySuppressionConfig(
  config: SecurityAppConfig,
  raw: Record<string, unknown>,
  warnings: string[],
): void {
  const suppression = readObject(raw.suppression);
  const hasSuppression = suppression !== undefined;
  if (!hasSuppression) {
    return;
  }

  config.suppression.enabled = readBoolean(suppression.enabled, config.suppression.enabled);
  config.suppression.maxNearestNeighbors = readInteger(
    suppression.maxNearestNeighbors,
    config.suppression.maxNearestNeighbors,
    1,
    50,
  );

  const threshold = readNumber(
    suppression.similarityThreshold,
    config.suppression.similarityThreshold,
  );
  const isThresholdInRange = threshold >= 0 && threshold <= 1;
  if (isThresholdInRange) {
    config.suppression.similarityThreshold = threshold;
    return;
  }

  warnings.push("suppression.similarityThreshold must be between 0 and 1. Default was used.");
}

function applyScheduleConfig(config: SecurityAppConfig, raw: Record<string, unknown>): void {
  const schedule = readObject(raw.schedule);
  const hasSchedule = schedule !== undefined;
  if (!hasSchedule) {
    return;
  }

  config.schedule.enabled = readBoolean(schedule.enabled, config.schedule.enabled);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  const isBoolean = typeof value === "boolean";
  if (!isBoolean) {
    return fallback;
  }

  return value;
}

function readNumber(value: unknown, fallback: number): number {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  if (!isNumber) {
    return fallback;
  }

  return value;
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = readNumber(value, fallback);
  const isIntegerInRange =
    Number.isInteger(numberValue) && numberValue >= min && numberValue <= max;
  if (!isIntegerInRange) {
    return fallback;
  }

  return numberValue;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  const isArray = Array.isArray(value);
  if (!isArray) {
    return fallback;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  const hasStrings = strings.length > 0;
  if (!hasStrings) {
    return fallback;
  }

  return strings;
}
