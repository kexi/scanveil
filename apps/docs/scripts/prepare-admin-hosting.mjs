import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const adminDist = join(root, "dist-admin");

await rm(adminDist, { force: true, recursive: true });
await mkdir(adminDist, { recursive: true });
await cp(join(dist, "assets"), join(adminDist, "assets"), { recursive: true });
await cp(join(dist, "icon.svg"), join(adminDist, "icon.svg"));

const adminHtml = await readFile(join(dist, "admin.html"), "utf8");
await writeFile(join(adminDist, "index.html"), adminHtml);
await writeFile(join(adminDist, "robots.txt"), ["User-agent: *", "Disallow: /", ""].join("\n"));

// Why not leave admin.html on the main www site: that hosting site only rewrites
// /admin/api/**, while AdminApp calls /api/... — so an admin page served from www
// would 404 on every admin API call. The admin UI is served exclusively from the
// dedicated scanveil-admin site (dist-admin), so drop the admin entry from the
// main dist. Shared vendor chunks (e.g. Typography) stay because index.html needs
// them; only the admin-html entry chunk is admin-exclusive.
const manifest = JSON.parse(await readFile(join(dist, ".vite", "manifest.json"), "utf8"));
const adminEntry = manifest["admin.html"];
// Why also drop admin-exclusive imported chunks: the entry file alone leaves any
// admin-only code-split or CSS chunk (listed under the entry's imports/css) in the
// public dist, shipping admin logic on the www site. Collect every admin-referenced
// asset and remove the ones no other manifest entry references.
const adminAssetFiles = collectAdminAssetFiles(manifest, adminEntry);
const sharedAssetFiles = collectSharedAssetFiles(manifest);
for (const assetFile of adminAssetFiles) {
  const isSharedAsset = sharedAssetFiles.has(assetFile);
  if (isSharedAsset) {
    continue;
  }

  await rm(join(dist, assetFile), { force: true });
}

await rm(join(dist, "admin.html"), { force: true });

function collectAdminAssetFiles(manifestData, entry) {
  const files = new Set();
  const hasEntry = entry !== undefined && entry !== null;
  if (!hasEntry) {
    return files;
  }

  const addChunk = (chunkKey) => {
    const chunk = manifestData[chunkKey];
    const hasChunk = chunk !== undefined && chunk !== null;
    if (!hasChunk) {
      return;
    }

    const hasFile = typeof chunk.file === "string";
    if (hasFile) {
      files.add(chunk.file);
    }

    for (const cssFile of chunk.css ?? []) {
      files.add(cssFile);
    }

    for (const importedKey of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      addChunk(importedKey);
    }
  };

  const hasEntryFile = typeof entry.file === "string";
  if (hasEntryFile) {
    files.add(entry.file);
  }

  for (const cssFile of entry.css ?? []) {
    files.add(cssFile);
  }

  for (const importedKey of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
    addChunk(importedKey);
  }

  return files;
}

function collectSharedAssetFiles(manifestData) {
  const files = new Set();
  for (const [key, chunk] of Object.entries(manifestData)) {
    const isAdminEntry = key === "admin.html";
    if (isAdminEntry) {
      continue;
    }

    const hasFile = typeof chunk.file === "string";
    if (hasFile) {
      files.add(chunk.file);
    }

    for (const cssFile of chunk.css ?? []) {
      files.add(cssFile);
    }
  }

  return files;
}
