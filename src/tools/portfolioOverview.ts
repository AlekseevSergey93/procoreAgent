import { analyzeProject, buildPortfolioOverview } from "../analytics/summaries.js";
import { READ_ONLY, respond, type ToolRegistrar } from "./common.js";

export const registerPortfolioOverview: ToolRegistrar = (server, { repo, thresholds }) => {
  server.registerTool(
    "get_portfolio_overview",
    {
      title: "Portfolio overview",
      description:
        "Health (green/yellow/red) of every active project with risk counts, overdue items, budget variance, " +
        "top risks and overloaded people. Best starting point for a CEO briefing.",
      annotations: READ_ONLY,
    },
    () =>
      respond(async () => {
        const today = repo.today();
        const snapshots = await repo.loadSnapshots(undefined);
        const analyses = snapshots.map((s) => analyzeProject(s, today, thresholds));
        return buildPortfolioOverview(analyses, today, thresholds);
      }),
  );
};
