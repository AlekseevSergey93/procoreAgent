import { toIsoDate } from "../../domain/dates.js";
import type { Rfi } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { lower, num, people, person, str, type Raw } from "../raw.js";

export function fetchRfisRaw(ctx: ApiContext, projectId: number): Promise<Raw[]> {
  return ctx.client.getAll<Raw>(`/rest/v1.0/projects/${projectId}/rfis`);
}

/** Procore impact status values look like "yes_known", "yes_unknown", "no_impact", "tbd". */
function hasImpact(impact: unknown): boolean {
  const status = lower(impact && typeof impact === "object" ? (impact as Raw).status : impact);
  return status.startsWith("yes");
}

export function normalizeRfi(raw: Raw, projectId: number, links: ProcoreLinks): Rfi {
  const id = num(raw.id) ?? 0;
  const status = lower(raw.status);
  return {
    id,
    number: str(raw.full_number ?? raw.number),
    subject: str(raw.subject) ?? str(raw.title) ?? `RFI ${id}`,
    status,
    open: status === "open",
    dueDate: toIsoDate(raw.due_date),
    createdAt: toIsoDate(raw.initiated_at ?? raw.created_at),
    ballInCourt: people(raw.ball_in_court),
    assignees: people(raw.assignees ?? raw.assignee),
    manager: person(raw.rfi_manager),
    scheduleImpact: hasImpact(raw.schedule_impact),
    costImpact: hasImpact(raw.cost_impact),
    url: links.rfi(projectId, id),
  };
}

export async function fetchRfis(ctx: ApiContext, projectId: number): Promise<Rfi[]> {
  return (await fetchRfisRaw(ctx, projectId)).map((raw) => normalizeRfi(raw, projectId, ctx.links));
}
