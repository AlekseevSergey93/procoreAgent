import { buildBudgetStatus } from "../analytics/summaries.js";
import { projectParam, READ_ONLY, respond, type ToolRegistrar } from "./common.js";

export const registerBudgetStatus: ToolRegistrar = (server, { repo }) => {
  server.registerTool(
    "get_budget_status",
    {
      title: "Budget and change orders",
      description:
        "Budget totals (original, revised, committed, projected, variance), biggest overrunning cost codes, " +
        "and pending/approved change orders for a project.",
      inputSchema: { project: projectParam },
      annotations: READ_ONLY,
    },
    ({ project }) =>
      respond(async () => {
        const snapshot = await repo.loadSnapshot(await repo.resolveProject(project), ["budget", "changeOrders"]);
        return buildBudgetStatus(snapshot);
      }),
  );
};
