import { z } from "zod";
import { collectWorkItems } from "../analytics/items.js";
import { compactItem } from "../analytics/summaries.js";
import { buildTeamLoad, matchesPerson } from "../analytics/team.js";
import { UserError } from "../procore/errors.js";
import {
  collectWarnings,
  optionalProjectParam,
  READ_ONLY,
  respond,
  WORK_MODULES,
  type ToolRegistrar,
} from "./common.js";

export const registerTeamStatus: ToolRegistrar = (server, { repo, thresholds }) => {
  server.registerTool(
    "get_team_status",
    {
      title: "Team workload and responsibility",
      description:
        "Per person: open items they currently hold (ball in court / assignee / schedule resource), overdue count, " +
        "due soon, by item type and project. Pass `person` to see one person's items in detail.",
      inputSchema: {
        project: optionalProjectParam,
        person: z.string().optional().describe("Part of a person's name"),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
    },
    ({ project, person, limit }) =>
      respond(async () => {
        const today = repo.today();
        const snapshots = await repo.loadSnapshots(project, WORK_MODULES);
        const loads = buildTeamLoad(snapshots.flatMap(collectWorkItems), today, thresholds.upcomingDays);
        const selected = person ? loads.filter((l) => matchesPerson(l, person)) : loads;
        if (person && !selected.length) {
          const known = loads.slice(0, 30).map((l) => l.name).join(", ");
          throw new UserError(`Nobody matching "${person}" holds open items. People with open items: ${known}.`);
        }
        const itemsPerPerson = person ? limit : 3;
        return {
          asOf: today,
          people: selected.slice(0, person ? 5 : limit).map((l) => ({
            name: l.name,
            open: l.open,
            overdue: l.overdue,
            dueSoon: l.dueSoon,
            maxDaysOverdue: l.maxDaysOverdue || undefined,
            byType: l.byType,
            projects: l.projects,
            items: [...l.items]
              .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
              .slice(0, itemsPerPerson)
              .map((i) => compactItem(i, today)),
          })),
          totalPeople: selected.length,
          warnings: collectWarnings(snapshots),
        };
      }),
  );
};
