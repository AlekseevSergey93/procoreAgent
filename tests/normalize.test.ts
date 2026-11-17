import { describe, expect, it } from "vitest";
import { normalizeBudget } from "../src/procore/endpoints/budget.js";
import { normalizeChangeOrder } from "../src/procore/endpoints/changeOrders.js";
import { normalizeDailyLogs } from "../src/procore/endpoints/dailyLogs.js";
import { normalizeInspection } from "../src/procore/endpoints/inspections.js";
import { normalizeProject } from "../src/procore/endpoints/projects.js";
import { normalizePunchItem } from "../src/procore/endpoints/punch.js";
import { normalizeRfi } from "../src/procore/endpoints/rfis.js";
import { normalizeTasks } from "../src/procore/endpoints/schedule.js";
import { normalizeSubmittal } from "../src/procore/endpoints/submittals.js";
import type { Raw } from "../src/procore/raw.js";
import { fixture, links } from "./helpers/fakeProcore.js";

describe("normalizers", () => {
  it("projects: stage object or string, inactive flag", () => {
    const [a, b, c] = fixture("projects.json").map((r) => normalizeProject(r, links));
    expect(a).toMatchObject({ id: 101, name: "Lenina 5 Residential", number: "L5", stage: "Course of Construction" });
    expect(a.address).toBe("Lenina st. 5, Kazan");
    expect(b.stage).toBe("Course of Construction");
    expect(c.active).toBe(false);
  });

  it("tasks: detects summary tasks, completion, resources", () => {
    const tasks = normalizeTasks(fixture("project-101/tasks.json"), 101, links);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get(1)!.isSummary).toBe(true);
    expect(byId.get(2)).toMatchObject({ isSummary: false, finish: "2026-10-20", percent: 60, criticalPath: true });
    expect(byId.get(3)!.resources.map((r) => r.name)).toEqual(["Anna Smirnova", "Glass Co"]);
    expect(byId.get(5)!.complete).toBe(true);
    expect(byId.get(1)!.resources).toEqual([]);
  });

  it("rfis: open status, ball in court, schedule impact", () => {
    const [first, , , closed] = fixture("project-101/rfis.json").map((r) => normalizeRfi(r, 101, links));
    expect(first).toMatchObject({
      number: "12",
      open: true,
      dueDate: "2026-10-15",
      createdAt: "2026-10-01",
      scheduleImpact: true,
      costImpact: false,
      ballInCourt: [{ id: 501, name: "John Architect" }],
    });
    expect(first.url).toBe("https://sandbox.procore.com/101/project/rfi/show/11");
    expect(closed.open).toBe(false);
  });

  it("submittals: status object drives open/approved", () => {
    const subs = fixture("project-101/submittals.json").map((r) => normalizeSubmittal(r, 101, links));
    expect(subs.map((s) => [s.open, s.approved])).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [true, false],
    ]);
    expect(subs[0]).toMatchObject({ number: "08-100-1", requiredOnSiteDate: "2026-10-20" });
    expect(normalizeSubmittal({ id: 1, status: "Draft" }, 1, links).open).toBe(false);
  });

  it("punch items: merges assignees and assignments, workflow status", () => {
    const [a, b, c] = fixture("project-101/punch_items.json").map((r) => normalizePunchItem(r, 101, links));
    expect(a).toMatchObject({ open: true, status: "work_required", location: "Building A > L2" });
    expect(a.assignees).toEqual([{ id: 701, name: "Paint Sub" }]);
    expect(b.assignees).toEqual([{ id: 702, name: "Tile Sub" }]);
    expect(c.open).toBe(false);
  });

  it("inspections: counts and due date from due_at", () => {
    const [a, , c] = fixture("project-101/inspections.json").map((r) => normalizeInspection(r, 101, links));
    expect(a).toMatchObject({ open: true, dueDate: "2026-10-30", deficientCount: 3, responsible: { name: "Fire Sub" } });
    expect(c.open).toBe(false);
  });

  it("budget: matches display-name columns and derives revised budget", () => {
    const budget = normalizeBudget(fixture("project-101/budget.json"), { columns: {} }, "u");
    expect(budget.currency).toBe("USD");
    expect(budget.lines[0]).toMatchObject({
      costCode: "03-300 / Concrete",
      revisedBudget: 110_000,
      committed: 95_000,
      projected: 125_000,
      variance: 15_000,
    });
    expect(budget.lines[1].variance).toBe(-5_000);
    expect(budget.totals).toMatchObject({ revisedBudget: 310_000, projected: 320_000, variance: 10_000 });
  });

  it("budget: configured column names take precedence, over/under fallback", () => {
    const raw = { rows: [{ cost_code: "1", "My Budget": "100", "Over Under": "-20" }] as Raw[] };
    const budget = normalizeBudget(raw, { columns: { revisedBudget: ["My Budget"] } }, "u");
    expect(budget.lines[0]).toMatchObject({ revisedBudget: 100, variance: 20 });
  });

  it("budget: empty view has no totals", () => {
    const budget = normalizeBudget({ rows: [] }, { columns: {} }, "u");
    expect(budget.totals.revisedBudget).toBeUndefined();
  });

  it("change orders: pending variants and amounts", () => {
    const cos = fixture("project-101/change_orders.json").map((r) => normalizeChangeOrder(r, 101, links));
    expect(cos.map((c) => [c.status, c.pending, c.approved, c.amount])).toEqual([
      ["pending_in_review", true, false, 9000],
      ["pending", true, false, 4000],
      ["approved", false, true, 10000],
      ["draft", false, false, 50000],
    ]);
  });

  it("daily logs: aggregates manpower by day", () => {
    const raw = fixture<{ logs: Record<string, Raw[]>; unavailable: string[] }>("project-101/daily_logs.json");
    const logs = normalizeDailyLogs(raw, "2026-10-13", "2026-10-27", "u");
    expect(logs.manpower).toEqual([
      { date: "2026-10-21", workers: 17, manHours: 136, companies: ["Concrete Co", "Steel Co"] },
      { date: "2026-10-22", workers: 10, manHours: 80, companies: ["Concrete Co"] },
    ]);
    expect(logs.lastLogDate).toBe("2026-10-22");
    expect(logs.delays).toEqual([{ date: "2026-10-22", type: "Weather", description: "Heavy rain, pour postponed" }]);
    expect(logs.notesCount).toBe(1);
  });
});
