import { toIsoDate } from "../../domain/dates.js";
import type { PunchItem } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { lower, num, people, person, str, uniquePeople, type Raw } from "../raw.js";

export function fetchPunchItemsRaw(ctx: ApiContext, projectId: number): Promise<Raw[]> {
  return ctx.client.getAll<Raw>("/rest/v1.0/punch_items", { project_id: projectId });
}

export function normalizePunchItem(raw: Raw, projectId: number, links: ProcoreLinks): PunchItem {
  const id = num(raw.id) ?? 0;
  const status = lower(raw.status);
  const workflow = lower(raw.workflow_status);
  const assignees = uniquePeople([
    ...people(raw.assignees),
    ...people(Array.isArray(raw.assignments) ? raw.assignments : []),
  ]);
  return {
    id,
    number: str(raw.position),
    name: str(raw.name) ?? `Punch item ${id}`,
    status: workflow || status,
    open: status !== "closed" && workflow !== "closed" && workflow !== "draft",
    dueDate: toIsoDate(raw.due_date),
    priority: str(raw.priority),
    location: str(raw.location?.node_name) ?? str(raw.location?.name),
    assignees,
    ballInCourt: people(raw.ball_in_court),
    manager: person(raw.punch_item_manager),
    url: links.punchItem(projectId, id),
  };
}

export async function fetchPunchItems(ctx: ApiContext, projectId: number): Promise<PunchItem[]> {
  return (await fetchPunchItemsRaw(ctx, projectId)).map((raw) => normalizePunchItem(raw, projectId, ctx.links));
}
