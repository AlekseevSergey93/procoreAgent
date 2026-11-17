#!/usr/bin/env node
/**
 * Dumps raw Procore responses for one project so field names can be checked
 * against the normalizers and turned into test fixtures.
 *
 *   npm run probe                 # list projects
 *   npm run probe -- "Lenina 5"   # dump every endpoint for that project
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, loadDotEnv } from "../app.js";
import { ConfigError, loadConfig, PACKAGE_ROOT } from "../config.js";
import { addDays } from "../domain/dates.js";
import { fetchBudgetRaw } from "../procore/endpoints/budget.js";
import { fetchChangeOrdersRaw } from "../procore/endpoints/changeOrders.js";
import { fetchDailyLogsRaw } from "../procore/endpoints/dailyLogs.js";
import { fetchInspectionsRaw } from "../procore/endpoints/inspections.js";
import { fetchProjectsRaw } from "../procore/endpoints/projects.js";
import { fetchPunchItemsRaw } from "../procore/endpoints/punch.js";
import { fetchRfisRaw } from "../procore/endpoints/rfis.js";
import { fetchTasksRaw } from "../procore/endpoints/schedule.js";
import { fetchSubmittalsRaw } from "../procore/endpoints/submittals.js";
import { describeError } from "../procore/errors.js";

function describe(data: unknown): string {
  const list = Array.isArray(data) ? data : [data];
  const keys = list[0] && typeof list[0] === "object" ? Object.keys(list[0]).join(", ") : "-";
  return `${Array.isArray(data) ? `${data.length} rows` : "object"}; keys: ${keys}`;
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const { ctx, repo } = createApp(config);
  const query = process.argv[2];

  if (!query) {
    const projects = await fetchProjectsRaw(ctx);
    console.log(describe(projects));
    for (const p of await repo.listProjects(true)) {
      console.log(`${p.id}\t${p.active ? "active" : "inactive"}\t${p.name}`);
    }
    return;
  }

  const project = await repo.resolveProject(query);
  const today = repo.today();
  const dir = join(PACKAGE_ROOT, "fixtures", "sandbox", String(project.id));
  mkdirSync(dir, { recursive: true });
  console.log(`Project ${project.name} (${project.id}) → ${dir}`);

  const endpoints: Record<string, () => Promise<unknown>> = {
    tasks: () => fetchTasksRaw(ctx, project.id),
    rfis: () => fetchRfisRaw(ctx, project.id),
    submittals: () => fetchSubmittalsRaw(ctx, project.id),
    punch_items: () => fetchPunchItemsRaw(ctx, project.id),
    inspections: () => fetchInspectionsRaw(ctx, project.id),
    budget: () => fetchBudgetRaw(ctx, project.id),
    change_orders: () => fetchChangeOrdersRaw(ctx, project.id),
    daily_logs: () => fetchDailyLogsRaw(ctx, project.id, addDays(today, -14), today),
  };
  for (const [name, load] of Object.entries(endpoints)) {
    try {
      const data = await load();
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2));
      const sample = name === "budget" ? (data as { rows: unknown[] }).rows : data;
      console.log(`✔ ${name}: ${describe(sample)}`);
    } catch (error) {
      console.log(`✘ ${name}: ${describeError(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
