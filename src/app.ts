import { existsSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_ROOT, type AppConfig } from "./config.js";
import { todayIn } from "./domain/dates.js";
import { ProcoreRepository } from "./domain/repository.js";
import { ClientCredentialsAuth } from "./procore/auth.js";
import { ProcoreClient } from "./procore/client.js";
import type { ApiContext } from "./procore/context.js";
import { ProcoreLinks } from "./procore/links.js";

/** Loads `<repo>/.env` if present; variables already set in the environment win. */
export function loadDotEnv(): void {
  const path = join(PACKAGE_ROOT, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

export function createApp(config: AppConfig): { ctx: ApiContext; repo: ProcoreRepository } {
  const auth = new ClientCredentialsAuth({
    loginBase: config.loginBase,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  const client = new ProcoreClient(
    { apiBase: config.apiBase, companyId: config.companyId, cacheTtlMs: config.cacheTtlMs },
    auth,
  );
  const ctx: ApiContext = {
    client,
    links: new ProcoreLinks(config.webBase),
    companyId: config.companyId,
    budget: { viewId: config.budgetViewId, columns: config.thresholds.budget.columns },
  };
  const repo = new ProcoreRepository(ctx, {
    today: () => todayIn(config.timeZone),
    dailyLogLookbackDays: config.thresholds.dailyLog.lookbackDays,
    concurrency: config.concurrency,
  });
  return { ctx, repo };
}
