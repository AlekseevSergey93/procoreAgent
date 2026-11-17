import { beforeAll, describe, expect, it } from "vitest";
import { parseThresholds } from "../src/config.js";
import { workdaysBetween } from "../src/domain/dates.js";
import { splitDeadlines } from "../src/analytics/deadlines.js";
import { collectWorkItems } from "../src/analytics/items.js";
import { evaluateProjectRisks, evaluateTeamRisks, projectHealth } from "../src/analytics/risks.js";
import {
  analyzeProject,
  buildBudgetStatus,
  buildFieldActivity,
  buildPortfolioOverview,
  buildProjectDigest,
} from "../src/analytics/summaries.js";
import { buildTeamLoad, UNASSIGNED } from "../src/analytics/team.js";
import type { ProjectSnapshot, Risk } from "../src/domain/types.js";
import { createTestRepo, TODAY } from "./helpers/fakeProcore.js";

const th = parseThresholds({});
let lenina: ProjectSnapshot;
let harbor: ProjectSnapshot;

beforeAll(async () => {
  const { repo } = createTestRepo();
  [lenina, harbor] = await repo.loadSnapshots(undefined);
});

const codes = (risks: Risk[]) => risks.map((r) => `${r.severity}:${r.code}`);

describe("dates", () => {
  it("counts workdays strictly between dates", () => {
    expect(workdaysBetween("2026-10-22", "2026-10-27")).toBe(2); // Fri, Mon
    expect(workdaysBetween("2026-10-23", "2026-10-26")).toBe(0); // weekend only
  });
});

describe("risks", () => {
  it("evaluates every rule on the populated project", () => {
    expect(codes(evaluateProjectRisks(lenina, TODAY, th))).toEqual([
      "high:rfi_overdue",
      "high:schedule_overdue",
      "high:submittal_late_for_site",
      // within a severity: most overdue first, then largest amount
      "medium:submittal_overdue",
      "medium:rfi_overdue",
      "medium:budget_line_overrun",
      "medium:pending_change_orders",
      "medium:budget_overrun",
      "medium:schedule_at_risk",
      "medium:submittal_needed_on_site",
      "medium:inspection_deficient",
      "medium:daily_log_gap",
      "low:inspection_overdue",
      "low:punch_overdue",
      "low:rfi_stale",
      "low:site_delays",
    ]);
  });

  it("carries evidence on each risk", () => {
    const risks = evaluateProjectRisks(lenina, TODAY, th);
    const rfi = risks.find((r) => r.code === "rfi_overdue" && r.severity === "high")!;
    expect(rfi).toMatchObject({ daysOverdue: 12, owners: ["John Architect"], projectName: "Lenina 5 Residential" });
    expect(rfi.message).toContain("schedule impact");
    const task = risks.find((r) => r.code === "schedule_overdue")!;
    expect(task.message).toBe('Task "Pour slab level 3" is 7d past planned finish, 60% complete, critical path');
    const co = risks.find((r) => r.code === "pending_change_orders")!;
    expect(co.amount).toBe(13_000);
    expect(risks.find((r) => r.code === "budget_overrun")!.message).toContain("3.2%");
  });

  it("budget overrun becomes high at the configured percent", () => {
    const strict = parseThresholds({ budget: { overrunPercent: 3 } });
    const overrun = evaluateProjectRisks(lenina, TODAY, strict).find((r) => r.code === "budget_overrun");
    expect(overrun?.severity).toBe("high");
  });

  it("handles an empty project and reports failed modules", () => {
    expect(harbor.warnings).toEqual(["schedule: no permission or tool not enabled on this project"]);
    expect(codes(evaluateProjectRisks(harbor, TODAY, th))).toEqual(["medium:daily_log_gap"]);
  });

  it("flags overloaded people", () => {
    const loads = buildTeamLoad(collectWorkItems(lenina), TODAY, 14);
    expect(evaluateTeamRisks(loads, th)).toEqual([]);
    const risks = evaluateTeamRisks(loads, parseThresholds({ team: { overloadOverdueItems: 2 } }));
    expect(risks.map((r) => r.owners)).toEqual([["Paint Sub"], ["Ivan Petrov"]]);
  });

  it("derives health from risk counts", () => {
    const risk = (severity: Risk["severity"]): Risk => ({ severity, code: "x", message: "x" });
    expect(projectHealth([], th)).toBe("green");
    expect(projectHealth([risk("medium"), risk("medium")], th)).toBe("green");
    expect(projectHealth([risk("medium"), risk("medium"), risk("medium")], th)).toBe("yellow");
    expect(projectHealth([risk("high")], th)).toBe("yellow");
    expect(projectHealth([risk("high"), risk("high")], th)).toBe("red");
  });
});

describe("deadlines and team", () => {
  it("splits overdue and upcoming items, skipping closed and summary items", () => {
    const { overdue, upcoming, noDueDate } = splitDeadlines(collectWorkItems(lenina), TODAY, 14);
    expect(overdue.map((i) => `${i.type}:${i.id}`)).toEqual([
      "submittal:24",
      "inspection:42",
      "submittal:21",
      "punch:31",
      "rfi:11",
      "task:2",
      "rfi:12",
      "punch:32",
    ]);
    expect(upcoming.map((i) => `${i.type}:${i.id}:${i.daysLeft}`)).toEqual([
      "inspection:41:3",
      "task:3:5",
      "submittal:22:5",
    ]);
    expect(noDueDate).toBe(0);
  });

  it("submittal without due date falls back to required-on-site date", () => {
    const items = collectWorkItems(lenina);
    expect(items.find((i) => i.type === "submittal" && i.id === 21)!.dueDate).toBe("2026-10-10");
  });

  it("aggregates load per person by name", () => {
    const loads = buildTeamLoad(collectWorkItems(lenina), TODAY, 14);
    const ivan = loads.find((l) => l.name === "Ivan Petrov")!;
    expect(ivan).toMatchObject({ open: 2, overdue: 2, byType: { task: 1, rfi: 1 }, maxDaysOverdue: 7 });
    const paint = loads.find((l) => l.name === "Paint Sub")!;
    expect(paint).toMatchObject({ open: 3, overdue: 3, byType: { submittal: 1, punch: 2 } });
    expect(loads[0].overdue).toBeGreaterThanOrEqual(loads.at(-1)!.overdue);
    expect(loads.some((l) => l.name === UNASSIGNED)).toBe(false);
  });
});

describe("summaries", () => {
  it("project digest is compact and complete", () => {
    const digest = buildProjectDigest(analyzeProject(lenina, TODAY, th), TODAY, th);
    expect(digest.health).toBe("red");
    expect(digest.riskCounts).toEqual({ high: 3, medium: 9, low: 4 });
    expect(digest.topRisks).toHaveLength(7);
    expect(digest.schedule).toEqual({ tasks: 4, complete: 1, avgPercent: 45, overdue: 1, criticalOverdue: 1 });
    expect(digest.rfis).toEqual({ open: 3, overdue: 2 });
    expect(digest.submittals).toEqual({ open: 3, overdue: 2, requiredOnSiteSoon: 2 });
    expect(digest.budget).toMatchObject({ variance: 10_000, variancePercent: 3.2, pendingChangeOrders: { count: 2, amount: 13_000 } });
    expect(digest.field).toEqual({ lastLogDate: "2026-10-22", avgWorkers7d: 14, delays7d: 1 });
    expect(digest.project.daysToCompletion).toBe(125);
  });

  it("budget status lists overrunning lines", () => {
    const status = buildBudgetStatus(lenina);
    expect(status.topOverruns).toEqual([
      expect.objectContaining({ costCode: "03-300 / Concrete", variance: 15_000, variancePercent: 13.6 }),
    ]);
    expect(status.changeOrders?.topPending[0]).toMatchObject({ title: "#5 Extra rebar", amount: 9000 });
    expect(status.note).toBeUndefined();
    expect(buildBudgetStatus(harbor).note).toBe("Budget view has no rows");
  });

  it("field activity summarizes logs, inspections and punch", () => {
    const field = buildFieldActivity(lenina, TODAY);
    expect(field.dailyLogs).toMatchObject({ daysWithLogs: 2, avgWorkersPerLoggedDay: 14, totalManHours: 216 });
    expect(field.inspections).toMatchObject({ open: 2, overdue: 1 });
    expect(field.punch).toEqual({ open: 2, overdue: 2, highPriorityOpen: 1 });
  });

  it("portfolio puts red projects first", () => {
    const overview = buildPortfolioOverview(
      [harbor, lenina].map((s) => analyzeProject(s, TODAY, th)),
      TODAY,
      th,
    );
    expect(overview.projects.map((p) => `${p.name}:${p.health}`)).toEqual([
      "Lenina 5 Residential:red",
      "Harbor Office Tower:green",
    ]);
    expect(overview.totals).toMatchObject({ projects: 2, red: 1, green: 1, highRisks: 3 });
    expect(overview.projects[1].warnings).toHaveLength(1);
  });
});
