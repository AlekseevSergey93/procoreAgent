import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseThresholds } from "../../src/config.js";
import { ProcoreRepository } from "../../src/domain/repository.js";
import { ClientCredentialsAuth } from "../../src/procore/auth.js";
import { ProcoreClient } from "../../src/procore/client.js";
import type { ApiContext } from "../../src/procore/context.js";
import { ProcoreLinks } from "../../src/procore/links.js";
import type { Raw } from "../../src/procore/raw.js";

/** Tuesday; fixtures are written relative to this date. */
export const TODAY = "2026-10-27";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

export function fixture<T = Raw[]>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

export const links = new ProcoreLinks("https://sandbox.procore.com");

/**
 * Minimal stand-in for the Procore API: project 101 is fully populated,
 * project 102 is empty and denies access to the schedule.
 */
export function fakeProcore() {
  const calls: string[] = [];
  const budget = fixture<{ view: Raw; rows: Raw[] }>("project-101/budget.json");
  const daily = fixture<{ logs: Record<string, Raw[]> }>("project-101/daily_logs.json");

  const route = (url: URL): [number, unknown] => {
    const path = url.pathname;
    const pid = Number(url.searchParams.get("project_id") ?? /projects\/(\d+)/.exec(path)?.[1]);
    const full = pid === 101;
    const list = (name: string) => [200, full ? fixture(`project-101/${name}.json`) : []] as [number, unknown];

    if (path === "/rest/v1.0/projects") return [200, fixture("projects.json")];
    if (path === "/rest/v1.0/tasks") return pid === 102 ? [403, { errors: "forbidden" }] : list("tasks");
    if (/^\/rest\/v1\.0\/projects\/\d+\/rfis$/.test(path)) return list("rfis");
    if (/^\/rest\/v1\.0\/projects\/\d+\/submittals$/.test(path)) return list("submittals");
    if (/^\/rest\/v1\.0\/projects\/\d+\/checklist\/lists$/.test(path)) return list("inspections");
    if (path === "/rest/v1.0/punch_items") return list("punch_items");
    if (path === "/rest/v1.0/change_order_packages") return list("change_orders");
    if (path === "/rest/v1.0/budget_views") return [200, full ? [budget.view] : []];
    if (path === "/rest/v1.0/budget_views/900/detail_rows") return [200, budget.rows];
    const log = /^\/rest\/v1\.0\/projects\/\d+\/(manpower_logs|delay_logs|notes_logs)$/.exec(path);
    if (log) return [200, full ? (daily.logs[log[1]] ?? []) : []];
    return [404, { errors: "not found" }];
  };

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/oauth/token") return Response.json({ access_token: "test-token", expires_in: 5400 });
    const [status, body] = route(url);
    return Response.json(body, { status });
  };
  return { fetchImpl, calls };
}

export function createTestRepo(today = TODAY) {
  const fake = fakeProcore();
  const thresholds = parseThresholds({});
  const auth = new ClientCredentialsAuth(
    { loginBase: "https://login-sandbox.procore.com", clientId: "id", clientSecret: "secret" },
    fake.fetchImpl,
  );
  const client = new ProcoreClient(
    { apiBase: "https://sandbox.procore.com", companyId: 42, cacheTtlMs: 60_000, fetchImpl: fake.fetchImpl },
    auth,
  );
  const ctx: ApiContext = { client, links, companyId: 42, budget: { columns: {} } };
  const repo = new ProcoreRepository(ctx, { today: () => today, dailyLogLookbackDays: 14, concurrency: 2 });
  return { repo, ctx, thresholds, calls: fake.calls };
}
