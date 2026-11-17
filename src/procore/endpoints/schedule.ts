import { toIsoDate } from "../../domain/dates.js";
import type { ScheduleTask } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { num, str, type Raw } from "../raw.js";

export function fetchTasksRaw(ctx: ApiContext, projectId: number): Promise<Raw[]> {
  return ctx.client.getAll<Raw>("/rest/v1.0/tasks", { project_id: projectId });
}

export function normalizeTasks(raws: Raw[], projectId: number, links: ProcoreLinks): ScheduleTask[] {
  const parentIds = new Set(raws.map((r) => num(r.parent_id ?? r.parent_task_id)).filter((id) => id !== undefined));
  return raws.map((raw) => {
    const id = num(raw.id) ?? 0;
    const percent = num(raw.percentage ?? raw.percent_complete) ?? 0;
    const actualFinish = toIsoDate(raw.actual_finish);
    return {
      id,
      name: str(raw.name) ?? `Task ${id}`,
      number: str(raw.task_number ?? raw.row_number),
      start: toIsoDate(raw.start_datetime ?? raw.start),
      finish: toIsoDate(raw.finish_datetime ?? raw.finish),
      percent,
      complete: percent >= 100 || actualFinish !== undefined,
      criticalPath: raw.critical_path === true,
      parentId: num(raw.parent_id ?? raw.parent_task_id),
      isSummary: parentIds.has(id),
      resources: (str(raw.resource_name) ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      url: links.schedule(projectId),
    };
  });
}

export async function fetchTasks(ctx: ApiContext, projectId: number): Promise<ScheduleTask[]> {
  return normalizeTasks(await fetchTasksRaw(ctx, projectId), projectId, ctx.links);
}
