import { toIsoDate } from "../../domain/dates.js";
import type { Inspection } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { lower, num, people, person, str, type Raw } from "../raw.js";

export function fetchInspectionsRaw(ctx: ApiContext, projectId: number): Promise<Raw[]> {
  return ctx.client.getAll<Raw>(`/rest/v1.0/projects/${projectId}/checklist/lists`);
}

export function normalizeInspection(raw: Raw, projectId: number, links: ProcoreLinks): Inspection {
  const id = num(raw.id) ?? 0;
  const status = lower(raw.status);
  return {
    id,
    number: str(raw.number),
    name: str(raw.name) ?? `Inspection ${id}`,
    status,
    open: status !== "closed",
    dueDate: toIsoDate(raw.due_at ?? raw.due_date),
    inspectionDate: toIsoDate(raw.inspection_date),
    inspectors: people(raw.inspectors),
    responsible: person(raw.responsible_party) ?? person(raw.responsible_contractor),
    itemCount: num(raw.item_count ?? raw.item_total) ?? 0,
    deficientCount: num(raw.deficient_item_count) ?? 0,
    notInspectedCount: num(raw.not_inspected_item_count) ?? 0,
    url: links.inspection(projectId, id),
  };
}

export async function fetchInspections(ctx: ApiContext, projectId: number): Promise<Inspection[]> {
  return (await fetchInspectionsRaw(ctx, projectId)).map((raw) => normalizeInspection(raw, projectId, ctx.links));
}
