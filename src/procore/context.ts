import type { ProcoreClient } from "./client.js";
import type { ProcoreLinks } from "./links.js";

export interface BudgetOptions {
  viewId?: number;
  /** Extra column-name candidates per amount, tried before the built-in ones. */
  columns: Partial<Record<BudgetColumn, string[]>>;
}

export type BudgetColumn =
  | "originalBudget"
  | "budgetModifications"
  | "approvedChangeOrders"
  | "revisedBudget"
  | "committed"
  | "projected"
  | "overUnder";

export interface ApiContext {
  client: ProcoreClient;
  links: ProcoreLinks;
  companyId: number;
  budget: BudgetOptions;
}
