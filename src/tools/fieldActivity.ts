import { buildFieldActivity } from "../analytics/summaries.js";
import { addDays } from "../domain/dates.js";
import { UserError } from "../procore/errors.js";
import { isoDate, projectParam, READ_ONLY, respond, type ToolRegistrar } from "./common.js";

export const registerFieldActivity: ToolRegistrar = (server, { repo }) => {
  server.registerTool(
    "get_field_activity",
    {
      title: "Site activity",
      description:
        "What happens on site: daily logs (manpower per day, delays, notes), open inspections with deficiencies " +
        "and punch list status. Defaults to the last 7 days.",
      inputSchema: {
        project: projectParam,
        from: isoDate.optional().describe("Start date YYYY-MM-DD, default 7 days ago"),
        to: isoDate.optional().describe("End date YYYY-MM-DD, default today"),
      },
      annotations: READ_ONLY,
    },
    ({ project, from, to }) =>
      respond(async () => {
        const today = repo.today();
        const logsTo = to ?? today;
        const logsFrom = from ?? addDays(logsTo, -7);
        if (logsFrom > logsTo) throw new UserError(`"from" (${logsFrom}) is after "to" (${logsTo}).`);
        const snapshot = await repo.loadSnapshot(
          await repo.resolveProject(project),
          ["dailyLogs", "inspections", "punch"],
          { logsFrom, logsTo },
        );
        return buildFieldActivity(snapshot, today);
      }),
  );
};
