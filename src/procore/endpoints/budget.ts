import type { BudgetAmounts, BudgetLine, BudgetSummary } from "../../domain/types.js";
import type { ApiContext, BudgetColumn, BudgetOptions } from "../context.js";
import { column, num, str, type Raw } from "../raw.js";

/**
 * Budget view columns are configured per company, so amounts are matched by
 * column name. Override or extend these via thresholds.json → budget.columns.
 */
const DEFAULT_COLUMNS: Record<BudgetColumn, string[]> = {
  originalBudget: ["original_budget_amount", "original_budget"],
  budgetModifications: ["budget_modifications"],
  approvedChangeOrders: ["approved_cos", "approved_change_orders"],
  revisedBudget: ["revised_budget", "revised_budget_amount"],
  committed: ["committed_costs", "committed_cost", "commitments"],
  projected: ["estimated_cost_at_completion", "projected_costs", "projected_cost", "forecast_at_completion"],
  overUnder: ["projected_over_under", "over_under"],
};

export interface BudgetRaw {
  view?: Raw;
  rows: Raw[];
}

export async function fetchBudgetRaw(ctx: ApiContext, projectId: number): Promise<BudgetRaw> {
  const configuredId = ctx.budget.viewId;
  const view =
    configuredId !== undefined
      ? { id: configuredId }
      : (await ctx.client.getAll<Raw>("/rest/v1.0/budget_views", { project_id: projectId }))[0];
  if (!view) return { rows: [] };
  const rows = await ctx.client.getAll<Raw>(`/rest/v1.0/budget_views/${num(view.id)}/detail_rows`, {
    project_id: projectId,
  });
  return { view, rows };
}

function readLine(row: Raw, options: BudgetOptions): BudgetLine {
  const col = (name: BudgetColumn) => column(row, [...(options.columns[name] ?? []), ...DEFAULT_COLUMNS[name]]);
  const originalBudget = col("originalBudget");
  const revisedBudget =
    col("revisedBudget") ??
    (originalBudget !== undefined
      ? originalBudget + (col("budgetModifications") ?? 0) + (col("approvedChangeOrders") ?? 0)
      : undefined);
  const projected = col("projected");
  const overUnder = col("overUnder");
  const variance =
    projected !== undefined && revisedBudget !== undefined
      ? projected - revisedBudget
      : overUnder !== undefined
        ? -overUnder
        : undefined;
  const costCode =
    [str(row.cost_code) ?? str(row.cost_code?.full_code), str(row.category)].filter(Boolean).join(" / ") ||
    str(row.description) ||
    str(row.biller) ||
    "n/a";
  return { costCode, originalBudget, revisedBudget, committed: col("committed"), projected, variance };
}

function sum(lines: BudgetLine[], key: keyof BudgetAmounts): number | undefined {
  const values = lines.map((line) => line[key]).filter((v): v is number => v !== undefined);
  return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
}

export function normalizeBudget(raw: BudgetRaw, options: BudgetOptions, url: string): BudgetSummary {
  const lines = raw.rows.map((row) => readLine(row, options));
  return {
    viewName: str(raw.view?.name),
    currency: str(raw.rows[0]?.currency_configuration?.currency_iso_code),
    lines,
    totals: {
      originalBudget: sum(lines, "originalBudget"),
      revisedBudget: sum(lines, "revisedBudget"),
      committed: sum(lines, "committed"),
      projected: sum(lines, "projected"),
      variance: sum(lines, "variance"),
    },
    url,
  };
}

export async function fetchBudget(ctx: ApiContext, projectId: number): Promise<BudgetSummary> {
  return normalizeBudget(await fetchBudgetRaw(ctx, projectId), ctx.budget, ctx.links.budget(projectId));
}
