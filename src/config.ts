import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repository root; resolves the same from src/ (tests) and dist/ (build). */
export const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

const BUDGET_COLUMNS = [
  "originalBudget",
  "budgetModifications",
  "approvedChangeOrders",
  "revisedBudget",
  "committed",
  "projected",
  "overUnder",
] as const;

export const ThresholdsSchema = z.object({
  upcomingDays: z.number().int().positive().default(14),
  schedule: z
    .object({
      criticalWindowDays: z.number().int().nonnegative().default(7),
      lowProgressPercent: z.number().min(0).max(100).default(50),
    })
    .prefault({}),
  rfi: z
    .object({
      maxOpenDays: z.number().int().positive().default(14),
      highAfterOverdueDays: z.number().int().nonnegative().default(7),
    })
    .prefault({}),
  submittal: z.object({ requiredOnSiteWindowDays: z.number().int().nonnegative().default(14) }).prefault({}),
  punch: z.object({ significantOverdueCount: z.number().int().positive().default(10) }).prefault({}),
  budget: z
    .object({
      overrunPercent: z.number().nonnegative().default(5),
      pendingChangeOrdersPercent: z.number().nonnegative().default(3),
      columns: z.partialRecord(z.enum(BUDGET_COLUMNS), z.array(z.string())).default({}),
    })
    .prefault({}),
  dailyLog: z
    .object({
      maxSilentWorkdays: z.number().int().positive().default(2),
      lookbackDays: z.number().int().positive().default(14),
    })
    .prefault({}),
  team: z.object({ overloadOverdueItems: z.number().int().positive().default(5) }).prefault({}),
  health: z
    .object({
      redHighRisks: z.number().int().positive().default(2),
      yellowMediumRisks: z.number().int().positive().default(3),
    })
    .prefault({}),
});

export type Thresholds = z.infer<typeof ThresholdsSchema>;

export function parseThresholds(input: unknown): Thresholds {
  return ThresholdsSchema.parse(input ?? {});
}

const HOSTS = {
  sandbox: {
    api: "https://sandbox.procore.com",
    login: "https://login-sandbox.procore.com",
    web: "https://sandbox.procore.com",
  },
  production: {
    api: "https://api.procore.com",
    login: "https://login.procore.com",
    web: "https://app.procore.com",
  },
};

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EnvSchema = z.object({
  PROCORE_CLIENT_ID: z.string().min(1),
  PROCORE_CLIENT_SECRET: z.string().min(1),
  PROCORE_COMPANY_ID: z.coerce.number().int().positive(),
  PROCORE_ENV: optional(z.enum(["sandbox", "production"])),
  PROCORE_API_BASE: optional(z.url()),
  PROCORE_LOGIN_BASE: optional(z.url()),
  PROCORE_WEB_BASE: optional(z.url()),
  PROCORE_TIMEZONE: optional(z.string()),
  PROCORE_CACHE_TTL_SECONDS: optional(z.coerce.number().nonnegative()),
  PROCORE_CONCURRENCY: optional(z.coerce.number().int().positive()),
  PROCORE_BUDGET_VIEW_ID: optional(z.coerce.number().int().positive()),
  PROCORE_THRESHOLDS_PATH: optional(z.string()),
});

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  companyId: number;
  apiBase: string;
  loginBase: string;
  webBase: string;
  timeZone?: string;
  cacheTtlMs: number;
  concurrency: number;
  budgetViewId?: number;
  thresholds: Thresholds;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ConfigError(`Invalid Procore configuration (see .env.example):\n${details}`);
  }
  const e = parsed.data;
  const hosts = HOSTS[e.PROCORE_ENV ?? "sandbox"];
  const thresholdsPath = e.PROCORE_THRESHOLDS_PATH ?? join(PACKAGE_ROOT, "config", "thresholds.json");
  let thresholds: Thresholds;
  try {
    thresholds = parseThresholds(existsSync(thresholdsPath) ? JSON.parse(readFileSync(thresholdsPath, "utf8")) : {});
  } catch (error) {
    throw new ConfigError(`Invalid thresholds file ${thresholdsPath}: ${(error as Error).message}`);
  }
  return {
    clientId: e.PROCORE_CLIENT_ID,
    clientSecret: e.PROCORE_CLIENT_SECRET,
    companyId: e.PROCORE_COMPANY_ID,
    apiBase: e.PROCORE_API_BASE ?? hosts.api,
    loginBase: e.PROCORE_LOGIN_BASE ?? hosts.login,
    webBase: e.PROCORE_WEB_BASE ?? hosts.web,
    timeZone: e.PROCORE_TIMEZONE,
    cacheTtlMs: (e.PROCORE_CACHE_TTL_SECONDS ?? 600) * 1000,
    concurrency: e.PROCORE_CONCURRENCY ?? 3,
    budgetViewId: e.PROCORE_BUDGET_VIEW_ID,
    thresholds,
  };
}
