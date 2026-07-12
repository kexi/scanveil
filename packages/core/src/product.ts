export const productMetadata = {
  displayName: "Scanveil",
  slug: "scanveil",
  tagline: "GitHub App security scanner on GCP",
  configFileName: ".scanveil/config.yml",
  legacyConfigFileName: ".scanveil.yml",
} as const;

export const productConsoleDisplayName = productMetadata.displayName;
export const productSessionCookieName = `${productMetadata.slug}_session`;
export const productOAuthStateCookieName = `${productMetadata.slug}_oauth_state`;
