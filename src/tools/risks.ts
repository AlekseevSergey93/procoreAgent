import { z } from "zod";
import { collectWorkItems } from "../analytics/items.js";
import { atLeast, countBySeverity, evaluateProjectRisks, evaluateTeamRisks, sortRisks } from "../analytics/risks.js";
import { compactRisk } from "../analytics/summaries.js";
import { buildTeamLoad } from "../analytics/team.js";
import { collectWarnings, optionalProjectParam, READ_ONLY, respond, type ToolRegistrar } from "./common.js";

export const registerRisks: ToolRegistrar = (server, { repo, thresholds }) => {
  server.registerTool(
    "get_risks",
    {
      title: "Risks and problems",
      description:
        "Rule-based risks: overdue or slipping schedule tasks (critical path first), overdue RFIs, submittals " +
        "late for site, budget overruns, pending change orders, deficient inspections, overdue punch items, " +
        "missing daily logs, site delays and overloaded people. Each risk has severity, evidence and owners.",
      inputSchema: {
        project: optionalProjectParam,
        min_severity: z.enum(["high", "medium", "low"]).default("low"),
        limit: z.number().int().min(1).max(200).default(25),
      },
      annotations: READ_ONLY,
    },
    ({ project, min_severity, limit }) =>
      respond(async () => {
        const today = repo.today();
        const snapshots = await repo.loadSnapshots(project);
        const items = snapshots.flatMap(collectWorkItems);
        const all = sortRisks([
          ...snapshots.flatMap((s) => evaluateProjectRisks(s, today, thresholds)),
          ...evaluateTeamRisks(buildTeamLoad(items, today, thresholds.upcomingDays), thresholds),
        ]);
        const risks = atLeast(all, min_severity);
        return {
          asOf: today,
          counts: countBySeverity(all),
          risks: risks.slice(0, limit).map(compactRisk),
          omitted: Math.max(risks.length - limit, 0) || undefined,
          warnings: collectWarnings(snapshots),
        };
      }),
  );
};
