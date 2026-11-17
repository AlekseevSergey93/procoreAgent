import { addDays, daysBetween } from "../domain/dates.js";
import type { WorkItem } from "../domain/types.js";

export interface DatedItem extends WorkItem {
  dueDate: string;
  /** Days from today to the due date; negative when overdue. */
  daysLeft: number;
}

export interface Deadlines {
  overdue: DatedItem[];
  upcoming: DatedItem[];
  noDueDate: number;
}

export function splitDeadlines(items: WorkItem[], today: string, daysAhead: number): Deadlines {
  const horizon = addDays(today, daysAhead);
  const result: Deadlines = { overdue: [], upcoming: [], noDueDate: 0 };
  for (const item of items) {
    if (!item.dueDate) {
      result.noDueDate++;
      continue;
    }
    const dated = { ...item, dueDate: item.dueDate, daysLeft: daysBetween(today, item.dueDate) };
    if (dated.daysLeft < 0) result.overdue.push(dated);
    else if (item.dueDate <= horizon) result.upcoming.push(dated);
  }
  const byDue = (a: DatedItem, b: DatedItem) =>
    a.dueDate.localeCompare(b.dueDate) || Number(b.critical) - Number(a.critical);
  result.overdue.sort(byDue);
  result.upcoming.sort(byDue);
  return result;
}
