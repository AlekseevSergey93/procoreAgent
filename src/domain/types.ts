export interface Person {
  id?: number;
  name: string;
}

export interface Project {
  id: number;
  name: string;
  number?: string;
  stage?: string;
  active: boolean;
  startDate?: string;
  completionDate?: string;
  address?: string;
  url: string;
}

export interface ScheduleTask {
  id: number;
  name: string;
  number?: string;
  start?: string;
  finish?: string;
  percent: number;
  complete: boolean;
  criticalPath: boolean;
  parentId?: number;
  /** Has child tasks; excluded from item-level analytics to avoid double counting. */
  isSummary: boolean;
  resources: Person[];
  url: string;
}

export interface Rfi {
  id: number;
  number?: string;
  subject: string;
  status: string;
  open: boolean;
  dueDate?: string;
  createdAt?: string;
  ballInCourt: Person[];
  assignees: Person[];
  manager?: Person;
  scheduleImpact: boolean;
  costImpact: boolean;
  url: string;
}

export interface Submittal {
  id: number;
  number?: string;
  title: string;
  status: string;
  open: boolean;
  approved: boolean;
  dueDate?: string;
  requiredOnSiteDate?: string;
  ballInCourt: Person[];
  manager?: Person;
  url: string;
}

export interface PunchItem {
  id: number;
  number?: string;
  name: string;
  status: string;
  open: boolean;
  dueDate?: string;
  priority?: string;
  location?: string;
  assignees: Person[];
  ballInCourt: Person[];
  manager?: Person;
  url: string;
}

export interface Inspection {
  id: number;
  number?: string;
  name: string;
  status: string;
  open: boolean;
  dueDate?: string;
  inspectionDate?: string;
  inspectors: Person[];
  responsible?: Person;
  itemCount: number;
  deficientCount: number;
  notInspectedCount: number;
  url: string;
}

export interface BudgetAmounts {
  originalBudget?: number;
  revisedBudget?: number;
  committed?: number;
  projected?: number;
  /** projected - revisedBudget; positive means overrun. */
  variance?: number;
}

export interface BudgetLine extends BudgetAmounts {
  costCode: string;
}

export interface BudgetSummary {
  viewName?: string;
  currency?: string;
  lines: BudgetLine[];
  totals: BudgetAmounts;
  url: string;
}

export interface ChangeOrder {
  id: number;
  number?: string;
  title: string;
  status: string;
  pending: boolean;
  approved: boolean;
  amount: number;
  dueDate?: string;
  createdAt?: string;
  url: string;
}

export interface ManpowerDay {
  date: string;
  workers: number;
  manHours: number;
  companies: string[];
}

export interface DelayEntry {
  date: string;
  type?: string;
  description?: string;
}

export interface DailyLogSummary {
  from: string;
  to: string;
  lastLogDate?: string;
  daysWithLogs: string[];
  manpower: ManpowerDay[];
  delays: DelayEntry[];
  notesCount: number;
  /** Log types that could not be read (e.g. no permission). */
  unavailable: string[];
  url: string;
}

export const MODULES = [
  "schedule",
  "rfis",
  "submittals",
  "punch",
  "inspections",
  "budget",
  "changeOrders",
  "dailyLogs",
] as const;
export type Module = (typeof MODULES)[number];

export interface ProjectSnapshot {
  project: Project;
  tasks?: ScheduleTask[];
  rfis?: Rfi[];
  submittals?: Submittal[];
  punchItems?: PunchItem[];
  inspections?: Inspection[];
  budget?: BudgetSummary;
  changeOrders?: ChangeOrder[];
  dailyLogs?: DailyLogSummary;
  /** Modules that failed to load, with a human-readable reason. */
  warnings: string[];
}

export type ItemType = "task" | "rfi" | "submittal" | "punch" | "inspection";
export const ITEM_TYPES: readonly ItemType[] = ["task", "rfi", "submittal", "punch", "inspection"];

/** Anything with an owner and a due date, unified across Procore tools. */
export interface WorkItem {
  type: ItemType;
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  status: string;
  dueDate?: string;
  owners: Person[];
  critical: boolean;
  url: string;
}

export type Severity = "high" | "medium" | "low";

export interface Risk {
  severity: Severity;
  code: string;
  message: string;
  projectId?: number;
  projectName?: string;
  owners?: string[];
  dueDate?: string;
  daysOverdue?: number;
  amount?: number;
  url?: string;
}

export type HealthStatus = "green" | "yellow" | "red";
