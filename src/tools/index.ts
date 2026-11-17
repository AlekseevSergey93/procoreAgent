import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBudgetStatus } from "./budgetStatus.js";
import type { ToolDeps } from "./common.js";
import { registerDeadlines } from "./deadlines.js";
import { registerFieldActivity } from "./fieldActivity.js";
import { registerItem } from "./item.js";
import { registerListProjects } from "./listProjects.js";
import { registerPortfolioOverview } from "./portfolioOverview.js";
import { registerProjectDigest } from "./projectDigest.js";
import { registerRisks } from "./risks.js";
import { registerTeamStatus } from "./teamStatus.js";

export function registerTools(server: McpServer, deps: ToolDeps): void {
  for (const register of [
    registerListProjects,
    registerPortfolioOverview,
    registerProjectDigest,
    registerDeadlines,
    registerTeamStatus,
    registerRisks,
    registerBudgetStatus,
    registerFieldActivity,
    registerItem,
  ]) {
    register(server, deps);
  }
}
