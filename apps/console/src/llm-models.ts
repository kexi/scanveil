export interface AvailableLlmModel {
  displayName: string;
  estimatedCostRank: number;
  id: string;
  source: "configured";
}

export interface LlmModelsResponse {
  models: AvailableLlmModel[];
}

interface DefaultLlmModel {
  displayName: string;
  estimatedCostRank: number;
  id: string;
}

export const defaultLlmModelId = "gemini-3.1-flash-lite-preview";

const defaultLlmModels = [
  { displayName: "Gemini 3.5 Flash", estimatedCostRank: 20, id: "gemini-3.5-flash" },
  { displayName: "Gemini 3.1 Pro Preview", estimatedCostRank: 80, id: "gemini-3.1-pro-preview" },
  { displayName: "Gemini 3.1 Flash Lite", estimatedCostRank: 5, id: "gemini-3.1-flash-lite" },
  { displayName: "Gemini 3.1 Flash Lite Preview", estimatedCostRank: 0, id: defaultLlmModelId },
  { displayName: "Gemini 3 Pro Preview", estimatedCostRank: 90, id: "gemini-3-pro-preview" },
  { displayName: "Gemini 3 Flash Preview", estimatedCostRank: 25, id: "gemini-3-flash-preview" },
  { displayName: "Gemini 2.5 Pro", estimatedCostRank: 85, id: "gemini-2.5-pro" },
  { displayName: "Gemini 2.5 Flash", estimatedCostRank: 20, id: "gemini-2.5-flash" },
  { displayName: "Gemini 2.5 Flash Lite", estimatedCostRank: 5, id: "gemini-2.5-flash-lite" },
  {
    displayName: "Gemini 2.5 Flash Lite Preview 09-2025",
    estimatedCostRank: 5,
    id: "gemini-2.5-flash-lite-preview-09-2025",
  },
  {
    displayName: "Gemini 2.5 Flash Preview 09-2025",
    estimatedCostRank: 20,
    id: "gemini-2.5-flash-preview-09-2025",
  },
  { displayName: "Claude Opus 4.6", estimatedCostRank: 95, id: "claude-opus-4-6@default" },
  { displayName: "Claude Sonnet 4.6", estimatedCostRank: 70, id: "claude-sonnet-4-6@default" },
  { displayName: "Claude Haiku 4.5", estimatedCostRank: 15, id: "claude-haiku-4-5@20251001" },
  { displayName: "Gemma 4 31B", estimatedCostRank: 60, id: "google/gemma-4-31b-it" },
  { displayName: "Gemma 4 26B", estimatedCostRank: 55, id: "google/gemma-4-26b-it" },
  { displayName: "Gemma 4 E4B", estimatedCostRank: 15, id: "google/gemma-4-e4b-it" },
  { displayName: "Gemma 4 E2B", estimatedCostRank: 10, id: "google/gemma-4-e2b-it" },
] satisfies DefaultLlmModel[];

export async function listAvailableLlmModels(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AvailableLlmModel[]> {
  return readConfiguredLlmModels(env);
}

function readConfiguredLlmModels(env: NodeJS.ProcessEnv): AvailableLlmModel[] {
  const configuredModels = env.SECURITY_APP_LLM_MODELS;
  const hasConfiguredModels =
    typeof configuredModels === "string" && configuredModels.trim().length > 0;
  if (!hasConfiguredModels) {
    return defaultLlmModels.map(toAvailableLlmModel);
  }

  const models = configuredModels
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(readConfiguredLlmModelEntry);
  const dedupedModels = dedupeModels(models);
  const hasModels = dedupedModels.length > 0;
  if (!hasModels) {
    return defaultLlmModels.map(toAvailableLlmModel);
  }

  return dedupedModels;
}

function readConfiguredLlmModelEntry(entry: string): AvailableLlmModel {
  const [rawId, displayName, ...extraParts] = entry.split("|");
  const id = rawId?.trim() ?? "";
  const hasDisplayName = displayName !== undefined && displayName.trim().length > 0;
  const hasExtraParts = extraParts.length > 0;
  return {
    displayName: hasDisplayName && !hasExtraParts ? displayName.trim() : id,
    estimatedCostRank: Number.MAX_SAFE_INTEGER,
    id,
    source: "configured",
  };
}

function toAvailableLlmModel(model: DefaultLlmModel): AvailableLlmModel {
  return {
    displayName: model.displayName,
    estimatedCostRank: model.estimatedCostRank,
    id: model.id,
    source: "configured",
  };
}

function dedupeModels(models: AvailableLlmModel[]): AvailableLlmModel[] {
  const seen = new Set<string>();
  const deduped: AvailableLlmModel[] = [];
  for (const model of models) {
    const isDuplicate = seen.has(model.id);
    if (isDuplicate) {
      continue;
    }

    seen.add(model.id);
    deduped.push(model);
  }

  return deduped;
}
