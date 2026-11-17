import { toIsoDate } from "../../domain/dates.js";
import type { Project } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { num, str, type Raw } from "../raw.js";

export function fetchProjectsRaw(ctx: ApiContext): Promise<Raw[]> {
  return ctx.client.getAll<Raw>("/rest/v1.0/projects", { company_id: ctx.companyId });
}

export function normalizeProject(raw: Raw, links: ProcoreLinks): Project {
  const id = num(raw.id) ?? 0;
  const address = [str(raw.address), str(raw.city)].filter(Boolean).join(", ");
  return {
    id,
    name: str(raw.name) ?? str(raw.display_name) ?? `Project ${id}`,
    number: str(raw.project_number),
    stage: str(raw.project_stage?.name) ?? str(raw.stage),
    active: raw.active !== false,
    startDate: toIsoDate(raw.start_date),
    completionDate: toIsoDate(raw.completion_date ?? raw.projected_finish_date),
    address: address || undefined,
    url: links.project(id),
  };
}

export async function fetchProjects(ctx: ApiContext): Promise<Project[]> {
  return (await fetchProjectsRaw(ctx)).map((raw) => normalizeProject(raw, ctx.links));
}
