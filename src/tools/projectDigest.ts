import { analyzeProject, buildProjectDigest } from "../analytics/summaries.js";
import { projectParam, READ_ONLY, respond, type ToolRegistrar } from "./common.js";

export const registerProjectDigest: ToolRegistrar = (server, { repo, thresholds }) => {
  server.registerTool(
    "get_project_digest",
    {
      title: "Project digest",
      description:
        "One-project summary: health, top risks, next deadlines, schedule progress, RFIs, submittals, " +
        "punch list, inspections, budget and site activity.",
      inputSchema: { project: projectParam },
      annotations: READ_ONLY,
    },
    ({ project }) =>
      respond(async () => {
        const today = repo.today();
        const snapshot = await repo.loadSnapshot(await repo.resolveProject(project));
        return buildProjectDigest(analyzeProject(snapshot, today, thresholds), today, thresholds);
      }),
  );
};
