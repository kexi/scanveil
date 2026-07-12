import type { DiffFile } from "./types.js";

const diffHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/;
const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | undefined;
  let currentNewLine = 0;

  for (const line of diff.split("\n")) {
    const headerMatch = diffHeaderPattern.exec(line);
    const hasHeader = headerMatch !== null;
    if (hasHeader) {
      const path = headerMatch[2] ?? "";
      currentFile = { path, addedLines: [], raw: line };
      files.push(currentFile);
      currentNewLine = 0;
      continue;
    }

    const file = currentFile;
    const isMissingCurrentFile = file === undefined;
    if (isMissingCurrentFile) {
      continue;
    }

    file.raw += `\n${line}`;
    const hunkMatch = hunkPattern.exec(line);
    const hasHunk = hunkMatch !== null;
    if (hasHunk) {
      currentNewLine = Number(hunkMatch[1]);
      continue;
    }

    const isRemovedLine = line.startsWith("-") && !line.startsWith("---");
    if (isRemovedLine) {
      continue;
    }

    // The "\ No newline at end of file" marker annotates the preceding line and consumes no
    // new-file line number, so it must not fall through to the context-line branch below.
    const isNoNewlineMarker = line.startsWith("\\");
    if (isNoNewlineMarker) {
      continue;
    }

    const isAddedLine = line.startsWith("+") && !line.startsWith("+++");
    if (isAddedLine) {
      file.addedLines.push(currentNewLine);
      currentNewLine += 1;
      continue;
    }

    const isContextLine = currentNewLine > 0;
    if (isContextLine) {
      currentNewLine += 1;
    }
  }

  return files;
}
