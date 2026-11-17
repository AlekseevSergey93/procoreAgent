import type { Person, ProjectSnapshot, WorkItem } from "../domain/types.js";

export function titled(number: string | undefined, text: string): string {
  return number ? `#${number} ${text}` : text;
}

/** First non-empty owner list: ball-in-court beats assignees beats manager. */
function owners(...candidates: (Person[] | Person | undefined)[]): Person[] {
  for (const c of candidates) {
    const list = Array.isArray(c) ? c : c ? [c] : [];
    if (list.length) return list;
  }
  return [];
}

/** All open, owned, dated work across Procore tools, in one shape. */
export function collectWorkItems(s: ProjectSnapshot): WorkItem[] {
  const base = { projectId: s.project.id, projectName: s.project.name };
  const items: WorkItem[] = [];

  for (const t of s.tasks ?? []) {
    if (t.isSummary || t.complete) continue;
    items.push({
      ...base,
      type: "task",
      id: t.id,
      title: titled(t.number, t.name),
      status: `${t.percent}% complete`,
      dueDate: t.finish,
      owners: t.resources,
      critical: t.criticalPath,
      url: t.url,
    });
  }
  for (const r of s.rfis ?? []) {
    if (!r.open) continue;
    items.push({
      ...base,
      type: "rfi",
      id: r.id,
      title: titled(r.number, r.subject),
      status: r.status,
      dueDate: r.dueDate,
      owners: owners(r.ballInCourt, r.assignees, r.manager),
      critical: r.scheduleImpact,
      url: r.url,
    });
  }
  for (const sub of s.submittals ?? []) {
    if (!sub.open || sub.approved) continue;
    items.push({
      ...base,
      type: "submittal",
      id: sub.id,
      title: titled(sub.number, sub.title),
      status: sub.status,
      dueDate: sub.dueDate ?? sub.requiredOnSiteDate,
      owners: owners(sub.ballInCourt, sub.manager),
      critical: false,
      url: sub.url,
    });
  }
  for (const p of s.punchItems ?? []) {
    if (!p.open) continue;
    items.push({
      ...base,
      type: "punch",
      id: p.id,
      title: titled(p.number, p.name),
      status: p.status,
      dueDate: p.dueDate,
      owners: owners(p.ballInCourt, p.assignees, p.manager),
      critical: false,
      url: p.url,
    });
  }
  for (const i of s.inspections ?? []) {
    if (!i.open) continue;
    items.push({
      ...base,
      type: "inspection",
      id: i.id,
      title: titled(i.number, i.name),
      status: i.deficientCount ? `${i.status}, ${i.deficientCount} deficient` : i.status,
      dueDate: i.dueDate,
      owners: owners(i.inspectors, i.responsible),
      critical: false,
      url: i.url,
    });
  }
  return items;
}
