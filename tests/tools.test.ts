import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeAll, describe, expect, it } from "vitest";
import { registerTools } from "../src/tools/index.js";
import { createTestRepo } from "./helpers/fakeProcore.js";

let client: Client;

beforeAll(async () => {
  const { repo, thresholds } = createTestRepo();
  const server = new McpServer({ name: "procore-mcp", version: "test" });
  registerTools(server, { repo, thresholds });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test", version: "1" });
  await client.connect(clientTransport);
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError === true, text, json: result.isError ? undefined : JSON.parse(text) };
}

describe("MCP tools", () => {
  it("exposes the read-only tool set", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_budget_status",
      "get_deadlines",
      "get_field_activity",
      "get_item",
      "get_portfolio_overview",
      "get_project_digest",
      "get_risks",
      "get_team_status",
      "list_projects",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("list_projects", async () => {
    const { json } = await call("list_projects");
    expect(json.map((p: { id: number }) => p.id)).toEqual([101, 102]);
  });

  it("get_portfolio_overview", async () => {
    const { json } = await call("get_portfolio_overview");
    expect(json.totals).toMatchObject({ projects: 2, red: 1 });
    expect(json.projects[0].topRisks).toHaveLength(3);
  });

  it("get_project_digest resolves a project by name", async () => {
    const { json } = await call("get_project_digest", { project: "lenina" });
    expect(json.project.id).toBe(101);
    expect(json.health).toBe("red");
  });

  it("get_deadlines filters by type and honours include_overdue", async () => {
    const { json } = await call("get_deadlines", { types: ["rfi"], include_overdue: true });
    expect(json.overdue.items.map((i: { title: string }) => i.title)).toEqual([
      "#12 Beam size at grid C",
      "#13 Waterproofing detail",
    ]);
    expect(json.overdue.items[0]).toMatchObject({ overdueDays: 12, owners: "John Architect", critical: true });
    expect(json.warnings).toEqual(["Harbor Office Tower: schedule: no permission or tool not enabled on this project"]);
    const upcomingOnly = await call("get_deadlines", { include_overdue: false });
    expect(upcomingOnly.json.overdue).toBeUndefined();
  });

  it("get_team_status for one person", async () => {
    const { json } = await call("get_team_status", { person: "petrov" });
    expect(json.people).toHaveLength(1);
    expect(json.people[0]).toMatchObject({ name: "Ivan Petrov", overdue: 2 });
    expect(json.people[0].items).toHaveLength(2);
    const missing = await call("get_team_status", { person: "nobody" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("Ivan Petrov");
  });

  it("get_risks with min_severity", async () => {
    const { json } = await call("get_risks", { min_severity: "high" });
    expect(json.risks.every((r: { severity: string }) => r.severity === "high")).toBe(true);
    expect(json.counts.high).toBe(3);
  });

  it("get_budget_status, get_field_activity, get_item", async () => {
    expect((await call("get_budget_status", { project: "101" })).json.totals.variance).toBe(10_000);
    const field = await call("get_field_activity", { project: "101", from: "2026-10-20", to: "2026-10-27" });
    expect(field.json.period).toEqual({ from: "2026-10-20", to: "2026-10-27" });
    const item = await call("get_item", { project: "101", type: "rfi", id: 11 });
    expect(item.json).toMatchObject({ type: "rfi", subject: "Beam size at grid C" });
    const bad = await call("get_field_activity", { project: "101", from: "2026-10-28", to: "2026-10-27" });
    expect(bad.isError).toBe(true);
  });

  it("returns user errors instead of throwing", async () => {
    const result = await call("get_project_digest", { project: "unknown place" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/);
  });
});
