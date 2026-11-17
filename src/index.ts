#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp, loadDotEnv } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { registerTools } from "./tools/index.js";

const INSTRUCTIONS =
  "Read-only access to Procore construction projects. Start with get_portfolio_overview for a company-wide " +
  "picture, get_project_digest for one project, get_risks for problems, get_deadlines for due dates and " +
  "get_team_status for who holds what. Projects can be referenced by id or part of their name.";

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const { repo } = createApp(config);

  const server = new McpServer({ name: "procore-mcp", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, { repo, thresholds: config.thresholds });
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol; diagnostics go to stderr.
  console.error(`procore-mcp ready: company ${config.companyId} at ${config.apiBase}`);
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
