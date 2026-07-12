export interface SelectableLlmModel {
  estimatedCostRank?: number;
  id: string;
}

const selectedLlmModelStorageKey = "scanveil:selectedLlmModel";

export function readSavedLlmModel(): string | undefined {
  try {
    const value = window.localStorage.getItem(selectedLlmModelStorageKey);
    const hasValue = value !== null && value.length > 0;
    if (!hasValue) {
      return undefined;
    }

    return value;
  } catch {
    return undefined;
  }
}

export function writeSavedLlmModel(modelId: string): void {
  try {
    const hasModelId = modelId.length > 0;
    if (!hasModelId) {
      window.localStorage.removeItem(selectedLlmModelStorageKey);
      return;
    }

    window.localStorage.setItem(selectedLlmModelStorageKey, modelId);
  } catch {
    return;
  }
}

export function chooseInitialLlmModel(
  models: SelectableLlmModel[],
  savedModelId = readSavedLlmModel(),
): string {
  const savedModel = models.find((model) => model.id === savedModelId);
  const hasSavedModel = savedModel !== undefined;
  if (hasSavedModel) {
    return savedModel.id;
  }

  const cheapestModel = [...models].sort(compareLlmModelCost)[0];
  const hasCheapestModel = cheapestModel !== undefined;
  if (!hasCheapestModel) {
    return "";
  }

  return cheapestModel.id;
}

function compareLlmModelCost(left: SelectableLlmModel, right: SelectableLlmModel): number {
  const leftRank = left.estimatedCostRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.estimatedCostRank ?? Number.MAX_SAFE_INTEGER;
  const rankDifference = leftRank - rightRank;
  const hasRankDifference = rankDifference !== 0;
  if (hasRankDifference) {
    return rankDifference;
  }

  return 0;
}
