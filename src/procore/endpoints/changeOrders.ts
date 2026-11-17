import { toIsoDate } from "../../domain/dates.js";
import type { ChangeOrder } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import type { ProcoreLinks } from "../links.js";
import { lower, num, str, type Raw } from "../raw.js";

export function fetchChangeOrdersRaw(ctx: ApiContext, projectId: number): Promise<Raw[]> {
  return ctx.client.getAll<Raw>("/rest/v1.0/change_order_packages", { project_id: projectId });
}

export function normalizeChangeOrder(raw: Raw, projectId: number, links: ProcoreLinks): ChangeOrder {
  const id = num(raw.id) ?? 0;
  const status = lower(raw.status);
  return {
    id,
    number: str(raw.number),
    title: str(raw.title) ?? `Change order ${id}`,
    status,
    // Procore uses several pending_* variants (pending_in_review, pending_pricing, ...).
    pending: status.startsWith("pending") || status === "under_review",
    approved: status === "approved",
    amount: num(raw.grand_total ?? raw.amount ?? raw.total) ?? 0,
    dueDate: toIsoDate(raw.due_date),
    createdAt: toIsoDate(raw.created_at),
    url: links.changeOrder(projectId, id),
  };
}

export async function fetchChangeOrders(ctx: ApiContext, projectId: number): Promise<ChangeOrder[]> {
  return (await fetchChangeOrdersRaw(ctx, projectId)).map((raw) => normalizeChangeOrder(raw, projectId, ctx.links));
}
