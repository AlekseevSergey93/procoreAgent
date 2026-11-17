import type { Thresholds } from "../config.js";
import { addDays, daysBetween, workdaysBetween } from "../domain/dates.js";
import type { HealthStatus, Person, ProjectSnapshot, Risk, Severity } from "../domain/types.js";
import { titled } from "./items.js";
import { UNASSIGNED, type PersonLoad } from "./team.js";

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const names = (people: Person[]) => people.map((p) => p.name);

export function formatMoney(amount: number, currency?: string): string {
  const rounded = Math.round(amount).toLocaleString("en-US");
  return currency ? `${rounded} ${currency}` : rounded;
}

/**
 * Deterministic risk rules. The LLM only interprets the output, so every risk
 * carries the evidence (dates, amounts, owners) needed to explain it.
 */
export function evaluateProjectRisks(s: ProjectSnapshot, today: string, th: Thresholds): Risk[] {
  const risks: Risk[] = [];
  const add = (risk: Omit<Risk, "projectId" | "projectName">) =>
    risks.push({ projectId: s.project.id, projectName: s.project.name, ...risk });

  if (s.project.active && s.project.completionDate && s.project.completionDate < today) {
    add({
      severity: "medium",
      code: "project_past_completion",
      message: `Project is active but planned completion (${s.project.completionDate}) has passed`,
      dueDate: s.project.completionDate,
      daysOverdue: daysBetween(s.project.completionDate, today),
      url: s.project.url,
    });
  }

  for (const t of s.tasks ?? []) {
    if (t.isSummary || t.complete || !t.finish) continue;
    const left = daysBetween(today, t.finish);
    const critical = t.criticalPath ? ", critical path" : "";
    const common = { owners: names(t.resources), dueDate: t.finish, url: t.url };
    if (left < 0) {
      add({
        ...common,
        severity: t.criticalPath ? "high" : "medium",
        code: "schedule_overdue",
        message: `Task "${t.name}" is ${-left}d past planned finish, ${t.percent}% complete${critical}`,
        daysOverdue: -left,
      });
    } else if (left <= th.schedule.criticalWindowDays && t.percent < th.schedule.lowProgressPercent) {
      add({
        ...common,
        severity: t.criticalPath ? "high" : "medium",
        code: "schedule_at_risk",
        message: `Task "${t.name}" finishes in ${left}d but is only ${t.percent}% complete${critical}`,
      });
    }
  }

  for (const r of s.rfis ?? []) {
    if (!r.open) continue;
    const owners = names(r.ballInCourt.length ? r.ballInCourt : r.assignees);
    const label = titled(r.number, r.subject);
    if (r.dueDate && r.dueDate < today) {
      const overdue = daysBetween(r.dueDate, today);
      add({
        severity: r.scheduleImpact || overdue >= th.rfi.highAfterOverdueDays ? "high" : "medium",
        code: "rfi_overdue",
        message: `RFI ${label} is ${overdue}d overdue${r.scheduleImpact ? ", has schedule impact" : ""}`,
        owners,
        dueDate: r.dueDate,
        daysOverdue: overdue,
        url: r.url,
      });
    } else if (r.createdAt && daysBetween(r.createdAt, today) > th.rfi.maxOpenDays) {
      add({
        severity: "low",
        code: "rfi_stale",
        message: `RFI ${label} has been open for ${daysBetween(r.createdAt, today)}d`,
        owners,
        dueDate: r.dueDate,
        url: r.url,
      });
    }
  }

  for (const sub of s.submittals ?? []) {
    if (!sub.open || sub.approved) continue;
    const label = titled(sub.number, sub.title);
    const owners = names(sub.ballInCourt.length ? sub.ballInCourt : sub.manager ? [sub.manager] : []);
    const onSite = sub.requiredOnSiteDate;
    if (onSite && daysBetween(today, onSite) <= th.submittal.requiredOnSiteWindowDays) {
      const left = daysBetween(today, onSite);
      add({
        severity: left < 0 ? "high" : "medium",
        code: left < 0 ? "submittal_late_for_site" : "submittal_needed_on_site",
        message:
          left < 0
            ? `Submittal ${label} is not approved but was required on site ${-left}d ago`
            : `Submittal ${label} is required on site in ${left}d and is not approved yet`,
        owners,
        dueDate: onSite,
        daysOverdue: left < 0 ? -left : undefined,
        url: sub.url,
      });
    } else if (sub.dueDate && sub.dueDate < today) {
      const overdue = daysBetween(sub.dueDate, today);
      add({
        severity: "medium",
        code: "submittal_overdue",
        message: `Submittal ${label} is ${overdue}d overdue`,
        owners,
        dueDate: sub.dueDate,
        daysOverdue: overdue,
        url: sub.url,
      });
    }
  }

  const overduePunch = (s.punchItems ?? []).filter((p) => p.open && p.dueDate && p.dueDate < today);
  if (overduePunch.length) {
    const oldest = Math.max(...overduePunch.map((p) => daysBetween(p.dueDate!, today)));
    add({
      severity: overduePunch.length >= th.punch.significantOverdueCount ? "medium" : "low",
      code: "punch_overdue",
      message: `${overduePunch.length} punch items overdue (oldest ${oldest}d)`,
      owners: topOwners(overduePunch.flatMap((p) => (p.ballInCourt.length ? p.ballInCourt : p.assignees))),
      daysOverdue: oldest,
    });
  }

  for (const i of s.inspections ?? []) {
    if (!i.open) continue;
    const owners = names(i.responsible ? [i.responsible] : i.inspectors);
    if (i.deficientCount > 0) {
      add({
        severity: "medium",
        code: "inspection_deficient",
        message: `Inspection ${titled(i.number, i.name)} has ${i.deficientCount} deficient items`,
        owners,
        dueDate: i.dueDate,
        url: i.url,
      });
    } else if (i.dueDate && i.dueDate < today) {
      add({
        severity: "low",
        code: "inspection_overdue",
        message: `Inspection ${titled(i.number, i.name)} is ${daysBetween(i.dueDate, today)}d overdue`,
        owners,
        dueDate: i.dueDate,
        daysOverdue: daysBetween(i.dueDate, today),
        url: i.url,
      });
    }
  }

  const budget = s.budget;
  const revisedTotal = budget?.totals.revisedBudget;
  if (budget) {
    const { variance } = budget.totals;
    if (revisedTotal && variance !== undefined && variance > 0) {
      const percent = (variance / revisedTotal) * 100;
      add({
        severity: percent >= th.budget.overrunPercent ? "high" : "medium",
        code: "budget_overrun",
        message: `Projected cost exceeds revised budget by ${formatMoney(variance, budget.currency)} (${percent.toFixed(1)}%)`,
        amount: Math.round(variance),
        url: budget.url,
      });
    }
    for (const line of budget.lines) {
      if (!line.revisedBudget || line.variance === undefined) continue;
      const percent = (line.variance / line.revisedBudget) * 100;
      if (percent > th.budget.overrunPercent) {
        add({
          severity: "medium",
          code: "budget_line_overrun",
          message: `Budget line ${line.costCode} projected over by ${formatMoney(line.variance, budget.currency)} (${percent.toFixed(1)}%)`,
          amount: Math.round(line.variance),
          url: budget.url,
        });
      }
    }
  }

  const pendingCos = (s.changeOrders ?? []).filter((co) => co.pending);
  const pendingTotal = pendingCos.reduce((sum, co) => sum + co.amount, 0);
  if (revisedTotal && pendingTotal > (revisedTotal * th.budget.pendingChangeOrdersPercent) / 100) {
    add({
      severity: "medium",
      code: "pending_change_orders",
      message: `${pendingCos.length} pending change orders total ${formatMoney(pendingTotal, budget?.currency)} (${((pendingTotal / revisedTotal) * 100).toFixed(1)}% of revised budget)`,
      amount: Math.round(pendingTotal),
      url: budget?.url,
    });
  }

  const logs = s.dailyLogs;
  const started = !s.project.startDate || s.project.startDate <= today;
  if (logs && s.project.active && started) {
    const silent = workdaysBetween(logs.lastLogDate ?? addDays(logs.from, -1), today);
    if (silent >= th.dailyLog.maxSilentWorkdays) {
      add({
        severity: "medium",
        code: "daily_log_gap",
        message: logs.lastLogDate
          ? `No daily log for ${silent} workdays (last on ${logs.lastLogDate})`
          : `No daily logs since ${logs.from}`,
        url: logs.url,
      });
    }
    const weekAgo = addDays(today, -7);
    const recentDelays = logs.delays.filter((d) => d.date >= weekAgo);
    if (recentDelays.length) {
      const types = [...new Set(recentDelays.map((d) => d.type).filter(Boolean))].join(", ");
      add({
        severity: "low",
        code: "site_delays",
        message: `${recentDelays.length} delays logged in the last 7 days${types ? ` (${types})` : ""}`,
        url: logs.url,
      });
    }
  }

  return sortRisks(risks);
}

export function evaluateTeamRisks(loads: PersonLoad[], th: Thresholds): Risk[] {
  return loads
    .filter((l) => l.name !== UNASSIGNED && l.overdue >= th.team.overloadOverdueItems)
    .map((l) => ({
      severity: "medium" as const,
      code: "person_overloaded",
      message: `${l.name} holds ${l.overdue} overdue items (${l.open} open) on ${l.projects.join(", ")}`,
      owners: [l.name],
      projectName: l.projects.length === 1 ? l.projects[0] : undefined,
      daysOverdue: l.maxDaysOverdue,
    }));
}

export function sortRisks(risks: Risk[]): Risk[] {
  return [...risks].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0) ||
      (b.amount ?? 0) - (a.amount ?? 0),
  );
}

export function atLeast(risks: Risk[], min: Severity): Risk[] {
  return risks.filter((r) => SEVERITY_RANK[r.severity] <= SEVERITY_RANK[min]);
}

export function countBySeverity(risks: Risk[]): Record<Severity, number> {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of risks) counts[r.severity]++;
  return counts;
}

export function projectHealth(risks: Risk[], th: Thresholds): HealthStatus {
  const { high, medium } = countBySeverity(risks);
  if (high >= th.health.redHighRisks) return "red";
  if (high > 0 || medium >= th.health.yellowMediumRisks) return "yellow";
  return "green";
}

function topOwners(people: Person[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const p of people) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}
