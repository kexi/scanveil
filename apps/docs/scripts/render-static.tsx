import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToString } from "react-dom/server";

import { productMetadata } from "../../../packages/core/src/product";
import { scanveilConfigJsonSchema } from "../../../packages/core/src/schemas";
import { DocsPage, getPageTitle, pages } from "../src/App";

interface ViteManifestEntry {
  css?: string[];
  file: string;
}

const appRoot = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(appRoot, "..");
const distRoot = join(docsRoot, "dist");
const siteUrl = new URL("https://www.scanveil.kexi.dev");
const socialImageUrl = new URL("/og-image.png", siteUrl).toString();

const manifest = await readManifest();
const entry = manifest["index.html"];
const hasEntry = entry !== undefined;
if (!hasEntry) {
  throw new Error("Vite manifest did not include index.html");
}

await writeStaticPages(entry);
await writeSchema();

async function readManifest(): Promise<Record<string, ViteManifestEntry>> {
  const manifestPath = join(distRoot, ".vite", "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  return JSON.parse(manifestText) as Record<string, ViteManifestEntry>;
}

async function writeStaticPages(entry: ViteManifestEntry): Promise<void> {
  for (const page of pages) {
    const outputPath = getOutputPath(page.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderDocument(page, entry), "utf8");
  }
}

async function writeSchema(): Promise<void> {
  const schemaPath = join(distRoot, "schema", "scanveil.config.schema.json");
  await mkdir(dirname(schemaPath), { recursive: true });
  await writeFile(schemaPath, JSON.stringify(scanveilConfigJsonSchema, null, 2), "utf8");
}

function getOutputPath(pathname: string): string {
  const isRoot = pathname === "/";
  if (isRoot) {
    return join(distRoot, "index.html");
  }

  return join(distRoot, pathname, "index.html");
}

function renderDocument(page: (typeof pages)[number], entry: ViteManifestEntry): string {
  const pageTitle = getPageTitle(page);
  const pageUrl = new URL(page.path, siteUrl).toString();
  const markup = renderToString(<DocsPage page={page} />);
  const stylesheets = entry.css ?? [];
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeAttribute(page.description)}" />
    <meta name="color-scheme" content="light dark" />
    <meta property="og:site_name" content="${escapeAttribute(productMetadata.displayName)}" />
    <meta property="og:title" content="${escapeAttribute(pageTitle)}" />
    <meta property="og:description" content="${escapeAttribute(page.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeAttribute(pageUrl)}" />
    <meta property="og:image" content="${escapeAttribute(socialImageUrl)}" />
    <meta property="og:image:alt" content="${escapeAttribute(productMetadata.displayName)} GitHub App security scanner" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttribute(pageTitle)}" />
    <meta name="twitter:description" content="${escapeAttribute(page.description)}" />
    <meta name="twitter:image" content="${escapeAttribute(socialImageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeAttribute(productMetadata.displayName)} GitHub App security scanner" />
    <link rel="canonical" href="${escapeAttribute(pageUrl)}" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;700&family=Material+Symbols+Rounded:FILL@0..1&family=Roboto:wght@300;400;500;700" />
    <link rel="stylesheet" href="/styles/global.css" />
${stylesheets.map((href) => `    <link rel="stylesheet" href="/${escapeAttribute(href)}" />`).join("\n")}
    <title>${escapeHtml(pageTitle)}</title>
    <script type="module" crossorigin src="/${escapeAttribute(entry.file)}"></script>
  </head>
  <body>
    <div id="root">${markup}</div>
  </body>
</html>
`;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
