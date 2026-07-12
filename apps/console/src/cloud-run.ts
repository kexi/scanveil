export interface CloudRunRunOperation {
  metadata?: {
    target?: string;
  };
  name?: string;
  response?: {
    name?: string;
  };
}

export function readCloudRunJobRunName(body: CloudRunRunOperation, jobPath: string): string {
  const metadataTarget = body.metadata?.target;
  const hasMetadataTarget = metadataTarget !== undefined && isCloudRunExecutionName(metadataTarget);
  if (hasMetadataTarget) {
    return metadataTarget;
  }

  const responseName = body.response?.name;
  const hasResponseName = responseName !== undefined && isCloudRunExecutionName(responseName);
  if (hasResponseName) {
    return responseName;
  }

  const operationName = body.name;
  const hasOperationName = operationName !== undefined && operationName.length > 0;
  if (hasOperationName) {
    return operationName;
  }

  return jobPath;
}

export function isCloudRunExecutionName(name: string): boolean {
  return /^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+\/executions\/[^/]+$/.test(name);
}

export interface CloudRunTerminalFailure {
  message: string;
}

interface CloudRunOperation {
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
  };
  metadata?: {
    target?: string;
  };
  response?: {
    name?: string;
  };
}

interface CloudRunExecution {
  conditions?: Array<{
    message?: string;
    reason?: string;
    status?: string;
    type?: string;
  }>;
}

export async function readCloudRunTerminalFailure(
  resourceName: string | undefined,
  accessToken: string,
): Promise<CloudRunTerminalFailure | undefined> {
  const hasResourceName = resourceName !== undefined && resourceName.length > 0;
  if (!hasResourceName) {
    return undefined;
  }

  const isOperationName = isCloudRunOperationName(resourceName);
  if (isOperationName) {
    return readCloudRunOperationTerminalFailure(resourceName, accessToken);
  }

  const isExecutionName = isCloudRunExecutionName(resourceName);
  if (isExecutionName) {
    return readCloudRunExecutionTerminalFailure(resourceName, accessToken);
  }

  return undefined;
}

async function readCloudRunOperationTerminalFailure(
  operationName: string,
  accessToken: string,
): Promise<CloudRunTerminalFailure | undefined> {
  const operation = await readCloudRunResource<CloudRunOperation>(operationName, accessToken);
  const isDone = operation.done === true;
  if (!isDone) {
    const target = operation.metadata?.target;
    const hasTargetExecution = target !== undefined && isCloudRunExecutionName(target);
    if (hasTargetExecution) {
      return readCloudRunExecutionTerminalFailure(target, accessToken);
    }

    return undefined;
  }

  const error = operation.error;
  const hasError = error !== undefined;
  if (hasError) {
    return {
      message: error.message ?? `Cloud Run operation failed with code ${error.code ?? "unknown"}`,
    };
  }

  const responseName = operation.response?.name;
  const hasResponseExecution = responseName !== undefined && isCloudRunExecutionName(responseName);
  if (hasResponseExecution) {
    return readCloudRunExecutionTerminalFailure(responseName, accessToken);
  }

  return undefined;
}

async function readCloudRunExecutionTerminalFailure(
  executionName: string,
  accessToken: string,
): Promise<CloudRunTerminalFailure | undefined> {
  const execution = await readCloudRunResource<CloudRunExecution>(executionName, accessToken);
  const completed = execution.conditions?.find((condition) => condition.type === "Completed");
  const hasCompletedCondition = completed !== undefined;
  if (!hasCompletedCondition) {
    return undefined;
  }

  const isFailed = completed.status === "False";
  if (!isFailed) {
    return undefined;
  }

  return {
    message: completed.message ?? completed.reason ?? "Cloud Run execution failed",
  };
}

async function readCloudRunResource<T>(resourceName: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://run.googleapis.com/v2/${resourceName}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });
  const isNotFound = response.status === 404;
  if (isNotFound) {
    throw new Error(`Cloud Run resource was not found: ${resourceName}`);
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Cloud Run resource read failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}

function isCloudRunOperationName(name: string): boolean {
  return /^projects\/[^/]+\/locations\/[^/]+\/operations\/[^/]+$/.test(name);
}
