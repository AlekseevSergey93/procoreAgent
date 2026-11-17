import { toIsoDate } from "../../domain/dates.js";
import type { DailyLogSummary, DelayEntry, ManpowerDay } from "../../domain/types.js";
import type { ApiContext } from "../context.js";
import { describeError } from "../errors.js";
import { num, str, type Raw } from "../raw.js";

const LOG_TYPES = ["manpower_logs", "delay_logs", "notes_logs"] as const;
type LogType = (typeof LOG_TYPES)[number];

export interface DailyLogsRaw {
  logs: Partial<Record<LogType, Raw[]>>;
  unavailable: string[];
}

/** Without a date range these endpoints return only today's logs. */
export async function fetchDailyLogsRaw(
  ctx: ApiContext,
  projectId: number,
  from: string,
  to: string,
): Promise<DailyLogsRaw> {
  const results = await Promise.allSettled(
    LOG_TYPES.map((type) =>
      ctx.client.getAll<Raw>(`/rest/v1.0/projects/${projectId}/${type}`, { start_date: from, end_date: to }),
    ),
  );
  if (results.every((r) => r.status === "rejected")) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  const raw: DailyLogsRaw = { logs: {}, unavailable: [] };
  results.forEach((result, i) => {
    if (result.status === "fulfilled") raw.logs[LOG_TYPES[i]] = result.value;
    else raw.unavailable.push(`${LOG_TYPES[i]}: ${describeError(result.reason)}`);
  });
  return raw;
}

function logDate(row: Raw): string | undefined {
  return toIsoDate(row.date ?? row.log_date ?? row.datetime ?? row.created_at);
}

export function normalizeDailyLogs(raw: DailyLogsRaw, from: string, to: string, url: string): DailyLogSummary {
  const manpowerRows = raw.logs.manpower_logs ?? [];
  const delayRows = raw.logs.delay_logs ?? [];
  const noteRows = raw.logs.notes_logs ?? [];

  const byDate = new Map<string, ManpowerDay>();
  for (const row of manpowerRows) {
    const date = logDate(row);
    if (!date) continue;
    const day = byDate.get(date) ?? { date, workers: 0, manHours: 0, companies: [] };
    const workers = num(row.num_workers) ?? 0;
    day.workers += workers;
    // num_hours is hours per worker on the Procore manpower log.
    day.manHours += workers * (num(row.num_hours) ?? 0);
    const company = str(row.vendor?.name) ?? str(row.company?.name) ?? str(row.contact?.name);
    if (company && !day.companies.includes(company)) day.companies.push(company);
    byDate.set(date, day);
  }

  const delays: DelayEntry[] = delayRows
    .map((row) => ({
      date: logDate(row) ?? "",
      type: str(row.delay_type?.name) ?? str(row.delay_type),
      description: str(row.description) ?? str(row.notes) ?? str(row.comments),
    }))
    .filter((d) => d.date);

  const daysWithLogs = [
    ...new Set([...manpowerRows, ...delayRows, ...noteRows].map(logDate).filter((d): d is string => !!d)),
  ].sort();

  return {
    from,
    to,
    lastLogDate: daysWithLogs.at(-1),
    daysWithLogs,
    manpower: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    delays: delays.sort((a, b) => b.date.localeCompare(a.date)),
    notesCount: noteRows.length,
    unavailable: raw.unavailable,
    url,
  };
}

export async function fetchDailyLogs(
  ctx: ApiContext,
  projectId: number,
  from: string,
  to: string,
): Promise<DailyLogSummary> {
  const raw = await fetchDailyLogsRaw(ctx, projectId, from, to);
  return normalizeDailyLogs(raw, from, to, ctx.links.dailyLog(projectId));
}
