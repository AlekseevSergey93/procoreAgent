import { z } from "zod";
import { READ_ONLY, respond, type ToolRegistrar } from "./common.js";

export const registerListProjects: ToolRegistrar = (server, { repo }) => {
  server.registerTool(
    "list_projects",
    {
      title: "List Procore projects",
      description: "Lists company projects with id, number, stage and planned dates. Use to find the right project.",
      inputSchema: { include_inactive: z.boolean().default(false).describe("Include inactive/archived projects") },
      annotations: READ_ONLY,
    },
    ({ include_inactive }) =>
      respond(async () => {
        const projects = await repo.listProjects(include_inactive);
        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          number: p.number,
          stage: p.stage,
          active: include_inactive ? p.active : undefined,
          start: p.startDate,
          completion: p.completionDate,
          address: p.address,
          url: p.url,
        }));
      }),
  );
};
