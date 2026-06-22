// STUB — replaced by scripts/postinstall.ts on first install
export const SERVICE_ID = "com.herdr.service-template" as const;

export const SECRET_NAMES = ["api-key", "db-url"] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

export const SERVICE_META = {
  id: SERVICE_ID,
  domain: "com.herdr",
  app: "service-template",
  secretCount: SECRET_NAMES.length,
  createdAt: "1970-01-01T00:00:00.000Z",
} as const;
