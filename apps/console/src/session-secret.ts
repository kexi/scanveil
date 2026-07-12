export function readSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const explicitSecret = env.SECURITY_APP_SESSION_SECRET;
  const fallbackSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  const secret = readFirstNonEmptyString(explicitSecret, fallbackSecret);
  const hasSecret = secret !== undefined;
  if (!hasSecret) {
    throw new Error("Missing SECURITY_APP_SESSION_SECRET or GITHUB_OAUTH_CLIENT_SECRET");
  }

  return secret;
}

function readFirstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const isString = typeof value === "string";
    if (!isString) {
      continue;
    }

    const hasValue = value.length > 0;
    if (hasValue) {
      return value;
    }
  }

  return undefined;
}
