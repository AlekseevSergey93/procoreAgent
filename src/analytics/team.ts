import { addDays, daysBetween } from "../domain/dates.js";
import type { ItemType, WorkItem } from "../domain/types.js";

export const UNASSIGNED = "Unassigned";

export interface PersonLoad {
  name: string;
  open: number;
  overdue: number;
  dueSoon: number;
  maxDaysOverdue: number;
  byType: Partial<Record<ItemType, number>>;
  projects: string[];
  items: WorkItem[];
}

/**
 * Who currently holds what. People are keyed by name because schedule
 * resources carry no user id while RFIs/submittals do.
 */
export function buildTeamLoad(items: WorkItem[], today: string, dueSoonDays: number): PersonLoad[] {
  const horizon = addDays(today, dueSoonDays);
  const loads = new Map<string, PersonLoad>();
  for (const item of items) {
    const names = item.owners.length ? item.owners.map((o) => o.name) : [UNASSIGNED];
    for (const name of new Set(names)) {
      const key = name.toLowerCase();
      const load = loads.get(key) ?? {
        name,
        open: 0,
        overdue: 0,
        dueSoon: 0,
        maxDaysOverdue: 0,
        byType: {},
        projects: [],
        items: [],
      };
      load.open++;
      load.byType[item.type] = (load.byType[item.type] ?? 0) + 1;
      if (!load.projects.includes(item.projectName)) load.projects.push(item.projectName);
      if (item.dueDate && item.dueDate < today) {
        load.overdue++;
        load.maxDaysOverdue = Math.max(load.maxDaysOverdue, daysBetween(item.dueDate, today));
      } else if (item.dueDate && item.dueDate <= horizon) {
        load.dueSoon++;
      }
      load.items.push(item);
      loads.set(key, load);
    }
  }
  return [...loads.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

export function matchesPerson(load: PersonLoad, query: string): boolean {
  const tokens = query.toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean);
  const name = load.name.toLowerCase().replace(/ё/g, "е");
  return tokens.every((t) => name.includes(t));
}
