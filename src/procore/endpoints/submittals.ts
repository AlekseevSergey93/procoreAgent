import { toIsoDate } from "../../domain/dates.js";
import type { Submittal } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { num, people, person, str, type Raw } from "../raw.js";

export function fetchSubmittalsRaw(ctx: ApiContext, projectId: number): Promise<Raw[]> {
  return ctx.client.getAll<Raw>(`/rest/v1.0/projects/${projectId}/submittals`);
}

export function normalizeSubmittal(raw: Raw, projectId: number, links: ProcoreLinks): Submittal {
  const id = num(raw.id) ?? 0;
  // status is an object {name: "Approved as Noted", status: "Closed"} or a plain string.
  const statusName = str(raw.status?.name) ?? str(raw.status) ?? "";
  const statusGroup = (str(raw.status?.status) ?? statusName).toLowerCase();
  return {
    id,
    number: str(raw.formatted_number ?? raw.number),
    title: str(raw.title) ?? `Submittal ${id}`,
    status: statusName.toLowerCase(),
    open: !/closed|draft|void/.test(statusGroup),
    approved: /approved/i.test(statusName) || statusGroup === "closed",
    dueDate: toIsoDate(raw.due_date),
    requiredOnSiteDate: toIsoDate(raw.required_on_site_date),
    ballInCourt: people(raw.ball_in_court),
    manager: person(raw.submittal_manager),
    url: links.submittal(projectId, id),
  };
}

export async function fetchSubmittals(ctx: ApiContext, projectId: number): Promise<Submittal[]> {
  return (await fetchSubmittalsRaw(ctx, projectId)).map((raw) => normalizeSubmittal(raw, projectId, ctx.links));
}
