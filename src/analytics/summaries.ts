import type { Thresholds } from "../config.js";
import { addDays, daysBetween } from "../domain/dates.js";
import type { BudgetAmounts, HealthStatus, ProjectSnapshot, Risk, WorkItem } from "../domain/types.js";
import { splitDeadlines, type DatedItem } from "./deadlines.js";
import { collectWorkItems, titled } from "./items.js";
import { countBySeverity, evaluateProjectRisks, evaluateTeamRisks, projectHealth, sortRisks } from "./risks.js";
import { buildTeamLoad, UNASSIGNED } from "./team.js";

export interface ProjectAnalysis {
  snapshot: ProjectSnapshot;
  items: WorkItem[];
  risks: Risk[];
  health: HealthStatus;
}

export function analyzeProject(s: ProjectSnapshot, today: string, th: Thresholds): ProjectAnalysis {
  const items = collectWorkItems(s);
  const risks = sortRisks([
    ...evaluateProjectRisks(s, today, th),
    ...evaluateTeamRisks(buildTeamLoad(items, today, th.upcomingDays), th).map((r) => ({
      ...r,
      projectId: s.project.id,
      projectName: s.project.name,
    })),
  ]);
  return { snapshot: s, items, risks, health: projectHealth(risks, th) };
}

// ---- compact output shapes (keep tool responses small for the LLM) ----

export function compactItem(item: WorkItem | DatedItem, today: string) {
  const daysLeft = item.dueDate ? daysBetween(today, item.dueDate) : undefined;
  return {
    type: item.type,
    project: item.projectName,
    title: item.title,
    status: item.status,
    due: item.dueDate,
    overdueDays: daysLeft !== undefined && daysLeft < 0 ? -daysLeft : undefined,
    daysLeft: daysLeft !== undefined && daysLeft >= 0 ? daysLeft : undefined,
    owners: item.owners.length ? item.owners.map((o) => o.name).join(", ") : UNASSIGNED,
    critical: item.critical || undefined,
    url: item.url,
  };
}

export function compactRisk(r: Risk) {
  return {
    severity: r.severity,
    code: r.code,
    project: r.projectName,
    message: r.message,
    owners: r.owners?.length ? r.owners.join(", ") : undefined,
    due: r.dueDate,
    url: r.url,
  };
}

function round(amounts: BudgetAmounts): BudgetAmounts {
  const r = (v?: number) => (v === undefined ? undefined : Math.round(v));
  return {
    originalBudget: r(amounts.originalBudget),
    revisedBudget: r(amounts.revisedBudget),
    committed: r(amounts.committed),
    projected: r(amounts.projected),
    variance: r(amounts.variance),
  };
}

function percentOf(part: number | undefined, whole: number | undefined): number | undefined {
  return part !== undefined && whole ? Math.round((part / whole) * 1000) / 10 : undefined;
}

// ---- budget ----

export function buildBudgetStatus(s: ProjectSnapshot, limit = 10) {
  const b = s.budget;
  const cos = s.changeOrders ?? [];
  const pending = cos.filter((c) => c.pending);
  const approved = cos.filter((c) => c.approved);
  const sumOf = (list: typeof cos) => Math.round(list.reduce((sum, c) => sum + c.amount, 0));
  const recognized = b && Object.values(b.totals).some((v) => v !== undefined);

  return {
    project: s.project.name,
    view: b?.viewName,
    currency: b?.currency,
    totals: b ? round(b.totals) : undefined,
    variancePercent: percentOf(b?.totals.variance, b?.totals.revisedBudget),
    topOverruns: (b?.lines ?? [])
      .filter((l) => (l.variance ?? 0) > 0)
      .sort((x, y) => (y.variance ?? 0) - (x.variance ?? 0))
      .slice(0, limit)
      .map((l) => ({ costCode: l.costCode, ...round(l), variancePercent: percentOf(l.variance, l.revisedBudget) })),
    changeOrders: s.changeOrders
      ? {
          pending: { count: pending.length, amount: sumOf(pending) },
          approved: { count: approved.length, amount: sumOf(approved) },
          topPending: [...pending]
            .sort((x, y) => y.amount - x.amount)
            .slice(0, 5)
            .map((c) => ({ title: titled(c.number, c.title), status: c.status, amount: Math.round(c.amount), url: c.url })),
        }
      : undefined,
    note: !b
      ? undefined
      : b.lines.length === 0
        ? "Budget view has no rows"
        : recognized
          ? undefined
          : "Budget columns not recognized; map them in thresholds.json → budget.columns",
    url: b?.url,
    warnings: s.warnings.length ? s.warnings : undefined,
  };
}

// ---- field activity ----

export function buildFieldActivity(s: ProjectSnapshot, today: string) {
  const logs = s.dailyLogs;
  const manpower = logs?.manpower ?? [];
  const totalWorkers = manpower.reduce((sum, d) => sum + d.workers, 0);
  const inspections = (s.inspections ?? []).filter((i) => i.open);
  const punch = (s.punchItems ?? []).filter((p) => p.open);

  return {
    project: s.project.name,
    period: logs ? { from: logs.from, to: logs.to } : undefined,
    dailyLogs: logs
      ? {
          lastLogDate: logs.lastLogDate,
          daysWithLogs: logs.daysWithLogs.length,
          avgWorkersPerLoggedDay: manpower.length ? Math.round(totalWorkers / manpower.length) : 0,
          totalManHours: Math.round(manpower.reduce((sum, d) => sum + d.manHours, 0)),
          byDay: manpower.map((d) => ({ date: d.date, workers: d.workers, companies: d.companies.length })),
          delays: logs.delays.slice(0, 10),
          notes: logs.notesCount,
          unavailable: logs.unavailable.length ? logs.unavailable : undefined,
          url: logs.url,
        }
      : undefined,
    inspections: s.inspections
      ? {
          open: inspections.length,
          overdue: inspections.filter((i) => i.dueDate && i.dueDate < today).length,
          withDeficiencies: inspections
            .filter((i) => i.deficientCount > 0)
            .slice(0, 10)
            .map((i) => ({
              title: titled(i.number, i.name),
              deficient: i.deficientCount,
              responsible: i.responsible?.name,
              url: i.url,
            })),
        }
      : undefined,
    punch: s.punchItems
      ? {
          open: punch.length,
          overdue: punch.filter((p) => p.dueDate && p.dueDate < today).length,
          highPriorityOpen: punch.filter((p) => p.priority?.toLowerCase() === "high").length,
        }
      : undefined,
    warnings: s.warnings.length ? s.warnings : undefined,
  };
}

// ---- project digest ----

export function buildProjectDigest(a: ProjectAnalysis, today: string, th: Thresholds) {
  const s = a.snapshot;
  const p = s.project;
  const leafTasks = (s.tasks ?? []).filter((t) => !t.isSummary);
  const overdueTasks = leafTasks.filter((t) => !t.complete && t.finish && t.finish < today);
  const openRfis = (s.rfis ?? []).filter((r) => r.open);
  const openSubs = (s.submittals ?? []).filter((x) => x.open && !x.approved);
  const openPunch = (s.punchItems ?? []).filter((x) => x.open);
  const openInspections = (s.inspections ?? []).filter((x) => x.open);
  const deadlines = splitDeadlines(a.items, today, th.upcomingDays);
  const isOverdue = (due?: string) => !!due && due < today;
  const weekAgo = addDays(today, -7);
  const recentManpower = (s.dailyLogs?.manpower ?? []).filter((d) => d.date >= weekAgo);
  const budget = buildBudgetStatus(s, 3);

  return {
    project: {
      id: p.id,
      name: p.name,
      number: p.number,
      stage: p.stage,
      start: p.startDate,
      completion: p.completionDate,
      daysToCompletion: p.completionDate ? daysBetween(today, p.completionDate) : undefined,
      url: p.url,
    },
    asOf: today,
    health: a.health,
    riskCounts: countBySeverity(a.risks),
    topRisks: a.risks.slice(0, 7).map(compactRisk),
    overdueItems: deadlines.overdue.length,
    nextDeadlines: deadlines.upcoming.slice(0, 5).map((i) => compactItem(i, today)),
    schedule: s.tasks && {
      tasks: leafTasks.length,
      complete: leafTasks.filter((t) => t.complete).length,
      avgPercent: leafTasks.length
        ? Math.round(leafTasks.reduce((sum, t) => sum + Math.min(t.percent, 100), 0) / leafTasks.length)
        : undefined,
      overdue: overdueTasks.length,
      criticalOverdue: overdueTasks.filter((t) => t.criticalPath).length,
    },
    rfis: s.rfis && { open: openRfis.length, overdue: openRfis.filter((r) => isOverdue(r.dueDate)).length },
    submittals: s.submittals && {
      open: openSubs.length,
      overdue: openSubs.filter((x) => isOverdue(x.dueDate)).length,
      requiredOnSiteSoon: openSubs.filter(
        (x) => x.requiredOnSiteDate && x.requiredOnSiteDate <= addDays(today, th.submittal.requiredOnSiteWindowDays),
      ).length,
    },
    punch: s.punchItems && { open: openPunch.length, overdue: openPunch.filter((x) => isOverdue(x.dueDate)).length },
    inspections: s.inspections && {
      open: openInspections.length,
      withDeficiencies: openInspections.filter((x) => x.deficientCount > 0).length,
    },
    budget: s.budget && {
      currency: budget.currency,
      revisedBudget: budget.totals?.revisedBudget,
      projected: budget.totals?.projected,
      variance: budget.totals?.variance,
      variancePercent: budget.variancePercent,
      pendingChangeOrders: budget.changeOrders?.pending,
      note: budget.note,
    },
    field: s.dailyLogs && {
      lastLogDate: s.dailyLogs.lastLogDate,
      avgWorkers7d: recentManpower.length
        ? Math.round(recentManpower.reduce((sum, d) => sum + d.workers, 0) / recentManpower.length)
        : 0,
      delays7d: s.dailyLogs.delays.filter((d) => d.date >= weekAgo).length,
    },
    warnings: s.warnings.length ? s.warnings : undefined,
  };
}

// ---- portfolio ----

const HEALTH_RANK: Record<HealthStatus, number> = { red: 0, yellow: 1, green: 2 };

export function buildPortfolioOverview(analyses: ProjectAnalysis[], today: string, th: Thresholds) {
  const projects = analyses
    .map((a) => {
      const counts = countBySeverity(a.risks);
      return {
        id: a.snapshot.project.id,
        name: a.snapshot.project.name,
        stage: a.snapshot.project.stage,
        completion: a.snapshot.project.completionDate,
        health: a.health,
        risks: counts,
        overdueItems: a.items.filter((i) => i.dueDate && i.dueDate < today).length,
        budgetVariancePercent: percentOf(
          a.snapshot.budget?.totals.variance,
          a.snapshot.budget?.totals.revisedBudget,
        ),
        topRisks: a.risks.slice(0, 3).map((r) => r.message),
        warnings: a.snapshot.warnings.length ? a.snapshot.warnings : undefined,
        url: a.snapshot.project.url,
      };
    })
    .sort((x, y) => HEALTH_RANK[x.health] - HEALTH_RANK[y.health] || y.risks.high - x.risks.high);

  const allItems = analyses.flatMap((a) => a.items);
  const overloaded = evaluateTeamRisks(buildTeamLoad(allItems, today, th.upcomingDays), th);

  return {
    asOf: today,
    totals: {
      projects: projects.length,
      red: projects.filter((p) => p.health === "red").length,
      yellow: projects.filter((p) => p.health === "yellow").length,
      green: projects.filter((p) => p.health === "green").length,
      highRisks: projects.reduce((sum, p) => sum + p.risks.high, 0),
      overdueItems: projects.reduce((sum, p) => sum + p.overdueItems, 0),
    },
    projects,
    overloadedPeople: overloaded.map((r) => r.message),
  };
}
