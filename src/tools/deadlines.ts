import { z } from "zod";
import { splitDeadlines } from "../analytics/deadlines.js";
import { collectWorkItems } from "../analytics/items.js";
import { compactItem } from "../analytics/summaries.js";
import { ITEM_TYPES } from "../domain/types.js";
import {
  collectWarnings,
  optionalProjectParam,
  READ_ONLY,
  respond,
  WORK_MODULES,
  type ToolRegistrar,
} from "./common.js";

export const registerDeadlines: ToolRegistrar = (server, { repo, thresholds }) => {
  server.registerTool(
    "get_deadlines",
    {
      title: "Deadlines and overdue items",
      description:
        "Overdue and upcoming deadlines across schedule tasks, RFIs, submittals, punch items and inspections, " +
        "with who is responsible.",
      inputSchema: {
        project: optionalProjectParam,
        days_ahead: z.number().int().min(0).max(180).optional().describe("Look-ahead window, default 14 days"),
        include_overdue: z.boolean().default(true),
        types: z.array(z.enum(ITEM_TYPES as [string, ...string[]])).optional().describe("Filter by item type"),
        limit: z.number().int().min(1).max(200).default(30).describe("Max items per list"),
      },
      annotations: READ_ONLY,
    },
    ({ project, days_ahead, include_overdue, types, limit }) =>
      respond(async () => {
        const today = repo.today();
        const daysAhead = days_ahead ?? thresholds.upcomingDays;
        const snapshots = await repo.loadSnapshots(project, WORK_MODULES);
        const items = snapshots.flatMap(collectWorkItems).filter((i) => !types || types.includes(i.type));
        const { overdue, upcoming, noDueDate } = splitDeadlines(items, today, daysAhead);
        return {
          asOf: today,
          daysAhead,
          overdue: include_overdue
            ? { count: overdue.length, items: overdue.slice(0, limit).map((i) => compactItem(i, today)) }
            : undefined,
          upcoming: { count: upcoming.length, items: upcoming.slice(0, limit).map((i) => compactItem(i, today)) },
          openWithoutDueDate: noDueDate,
          warnings: collectWarnings(snapshots),
        };
      }),
  );
};
