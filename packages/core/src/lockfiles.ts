export const defaultLockfileGlobs = [
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/go.sum",
  "**/requirements*.txt",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/uv.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
];

export function isSupportedLockfile(path: string, globs: string[] = defaultLockfileGlobs): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

const compiledGlobCache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = compiledGlobCache.get(glob);
  const hasCached = cached !== undefined;
  if (hasCached) {
    return cached;
  }

  const compiled = compileGlobToRegExp(glob);
  compiledGlobCache.set(glob, compiled);
  return compiled;
}

function compileGlobToRegExp(glob: string): RegExp {
  let source = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const nextChar = glob[index + 1];
    const charAfterNext = glob[index + 2];
    const isGlobstarDirectory = char === "*" && nextChar === "*" && charAfterNext === "/";
    if (isGlobstarDirectory) {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    const isGlobstar = char === "*" && nextChar === "*";
    if (isGlobstar) {
      source += ".*";
      index += 1;
      continue;
    }

    const isWildcard = char === "*";
    if (isWildcard) {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char ?? "");
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
