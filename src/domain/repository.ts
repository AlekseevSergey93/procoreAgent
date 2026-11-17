import type { ApiContext } from "../procore/context.js";
import { fetchBudget } from "../procore/endpoints/budget.js";
import { fetchChangeOrders } from "../procore/endpoints/changeOrders.js";
import { fetchDailyLogs } from "../procore/endpoints/dailyLogs.js";
import { fetchInspections } from "../procore/endpoints/inspections.js";
import { fetchProjects } from "../procore/endpoints/projects.js";
import { fetchPunchItems } from "../procore/endpoints/punch.js";
import { fetchRfis } from "../procore/endpoints/rfis.js";
import { fetchTasks } from "../procore/endpoints/schedule.js";
import { fetchSubmittals } from "../procore/endpoints/submittals.js";
import { describeError, UserError } from "../procore/errors.js";
import { addDays } from "./dates.js";
import { MODULES, type Module, type Project, type ProjectSnapshot } from "./types.js";

export interface RepositoryOptions {
  today: () => string;
  dailyLogLookbackDays: number;
  concurrency: number;
}

export interface SnapshotOptions {
  logsFrom?: string;
  logsTo?: string;
}

/** Loads normalized project data; a failing module becomes a warning, not an error. */
export class ProcoreRepository {
  constructor(
    private readonly ctx: ApiContext,
    private readonly options: RepositoryOptions,
  ) {}

  today(): string {
    return this.options.today();
  }

  async listProjects(includeInactive = false): Promise<Project[]> {
    const projects = await fetchProjects(this.ctx);
    return includeInactive ? projects : projects.filter((p) => p.active);
  }

  /** Accepts a project id, project number, or part of the name ("lenina 5"). */
  async resolveProject(query: string): Promise<Project> {
    const projects = await this.listProjects(true);
    const q = query.trim();
    const byId = projects.find((p) => String(p.id) === q || (p.number !== undefined && p.number === q));
    if (byId) return byId;

    const tokens = normalize(q).split(" ").filter(Boolean);
    if (!tokens.length) throw new UserError("Project name is empty.");
    const matches = projects.filter((p) => {
      const haystack = normalize([p.name, p.number, p.address].filter(Boolean).join(" "));
      return tokens.every((t) => haystack.includes(t));
    });
    const exact = matches.find((p) => normalize(p.name) === normalize(q));
    if (exact) return exact;
    const active = matches.filter((p) => p.active);
    if (active.length === 1) return active[0];
    if (matches.length === 1) return matches[0];

    const list = (candidates: Project[]) =>
      candidates
        .slice(0, 20)
        .map((p) => `${p.name} (id ${p.id})`)
        .join("; ");
    if (matches.length > 1) {
      throw new UserError(`Project "${q}" is ambiguous, matches: ${list(active.length ? active : matches)}.`);
    }
    throw new UserError(`Project "${q}" not found. Active projects: ${list(projects.filter((p) => p.active))}.`);
  }

  async loadSnapshot(
    project: Project,
    modules: readonly Module[] = MODULES,
    options: SnapshotOptions = {},
  ): Promise<ProjectSnapshot> {
    const snapshot: ProjectSnapshot = { project, warnings: [] };
    const today = this.today();
    const logsTo = options.logsTo ?? today;
    const logsFrom = options.logsFrom ?? addDays(logsTo, -this.options.dailyLogLookbackDays);
    const id = project.id;

    const loaders: Record<Module, () => Promise<void>> = {
      schedule: async () => void (snapshot.tasks = await fetchTasks(this.ctx, id)),
      rfis: async () => void (snapshot.rfis = await fetchRfis(this.ctx, id)),
      submittals: async () => void (snapshot.submittals = await fetchSubmittals(this.ctx, id)),
      punch: async () => void (snapshot.punchItems = await fetchPunchItems(this.ctx, id)),
      inspections: async () => void (snapshot.inspections = await fetchInspections(this.ctx, id)),
      budget: async () => void (snapshot.budget = await fetchBudget(this.ctx, id)),
      changeOrders: async () => void (snapshot.changeOrders = await fetchChangeOrders(this.ctx, id)),
      dailyLogs: async () => void (snapshot.dailyLogs = await fetchDailyLogs(this.ctx, id, logsFrom, logsTo)),
    };

    await Promise.all(
      modules.map((module) =>
        loaders[module]().catch((error) => {
          snapshot.warnings.push(`${module}: ${describeError(error)}`);
        }),
      ),
    );
    return snapshot;
  }

  /** One project when `projectQuery` is given, otherwise every active project. */
  async loadSnapshots(
    projectQuery: string | undefined,
    modules: readonly Module[] = MODULES,
    options: SnapshotOptions = {},
  ): Promise<ProjectSnapshot[]> {
    const projects = projectQuery ? [await this.resolveProject(projectQuery)] : await this.listProjects();
    return mapLimit(projects, this.options.concurrency, (p) => this.loadSnapshot(p, modules, options));
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
