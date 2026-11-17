import { describe, expect, it } from "vitest";
import { loadConfig, parseThresholds } from "../src/config.js";
import { createTestRepo } from "./helpers/fakeProcore.js";

describe("ProcoreRepository.resolveProject", () => {
  const { repo } = createTestRepo();

  it.each([
    ["101", 101],
    ["L5", 101],
    ["lenina 5", 101],
    ["Ленина", null], // fixtures use Latin names
    ["harbor", 102],
    ["warehouse", 103],
  ])("%s → %s", async (query, id) => {
    if (id === null) {
      await expect(repo.resolveProject(query)).rejects.toThrow(/not found\. Active projects: Lenina 5/);
    } else {
      expect((await repo.resolveProject(query)).id).toBe(id);
    }
  });

  it("reports ambiguous names", async () => {
    await expect(repo.resolveProject("e")).rejects.toThrow(/ambiguous, matches: Lenina 5 .*; Harbor/);
  });

  it("prefers the only active match over inactive ones", async () => {
    expect((await repo.resolveProject("o")).id).toBe(102);
  });
});

describe("ProcoreRepository.loadSnapshot", () => {
  it("loads only requested modules", async () => {
    const { repo, calls } = createTestRepo();
    const project = await repo.resolveProject("101");
    const snapshot = await repo.loadSnapshot(project, ["rfis"]);
    expect(snapshot.rfis).toHaveLength(4);
    expect(snapshot.tasks).toBeUndefined();
    expect(calls.filter((c) => c.startsWith("/rest/v1.0/projects/101"))).toHaveLength(1);
  });

  it("passes the daily log window to Procore", async () => {
    const { repo, calls } = createTestRepo();
    await repo.loadSnapshot(await repo.resolveProject("101"), ["dailyLogs"]);
    expect(calls.find((c) => c.includes("manpower_logs"))).toContain("start_date=2026-10-13&end_date=2026-10-27");
  });

  it("only loads active projects for the portfolio", async () => {
    const { repo } = createTestRepo();
    const snapshots = await repo.loadSnapshots(undefined, ["rfis"]);
    expect(snapshots.map((s) => s.project.id)).toEqual([101, 102]);
  });
});

describe("config", () => {
  it("fills threshold defaults for partial files", () => {
    const th = parseThresholds({ rfi: { maxOpenDays: 30 } });
    expect(th.rfi).toEqual({ maxOpenDays: 30, highAfterOverdueDays: 7 });
    expect(th.budget.overrunPercent).toBe(5);
  });

  it("derives hosts from PROCORE_ENV and validates required vars", () => {
    const base = { PROCORE_CLIENT_ID: "a", PROCORE_CLIENT_SECRET: "b", PROCORE_COMPANY_ID: "5" };
    expect(loadConfig({ ...base, PROCORE_API_BASE: "" })).toMatchObject({
      apiBase: "https://sandbox.procore.com",
      loginBase: "https://login-sandbox.procore.com",
      companyId: 5,
    });
    expect(loadConfig({ ...base, PROCORE_ENV: "production" }).webBase).toBe("https://app.procore.com");
    expect(() => loadConfig({})).toThrow(/PROCORE_CLIENT_ID/);
  });
});
