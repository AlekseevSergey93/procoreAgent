import { z } from "zod";
import type { Module } from "../domain/types.js";
import { UserError } from "../procore/errors.js";
import { projectParam, READ_ONLY, respond, type ToolRegistrar } from "./common.js";

const SOURCES = {
  task: { module: "schedule", list: "tasks" },
  rfi: { module: "rfis", list: "rfis" },
  submittal: { module: "submittals", list: "submittals" },
  punch: { module: "punch", list: "punchItems" },
  inspection: { module: "inspections", list: "inspections" },
  change_order: { module: "changeOrders", list: "changeOrders" },
} as const satisfies Record<string, { module: Module; list: string }>;

type ItemKind = keyof typeof SOURCES;

export const registerItem: ToolRegistrar = (server, { repo }) => {
  server.registerTool(
    "get_item",
    {
      title: "Item details",
      description: "Full details of one schedule task, RFI, submittal, punch item, inspection or change order.",
      inputSchema: {
        project: projectParam,
        type: z.enum(Object.keys(SOURCES) as [ItemKind, ...ItemKind[]]),
        id: z.number().int().describe("Procore id of the item (from other tools' output)"),
      },
      annotations: READ_ONLY,
    },
    ({ project, type, id }) =>
      respond(async () => {
        const source = SOURCES[type];
        const snapshot = await repo.loadSnapshot(await repo.resolveProject(project), [source.module]);
        if (snapshot.warnings.length) throw new UserError(snapshot.warnings.join("; "));
        const list = (snapshot[source.list] ?? []) as { id: number }[];
        const item = list.find((x) => x.id === id);
        if (!item) throw new UserError(`No ${type} with id ${id} in ${snapshot.project.name}.`);
        return { project: snapshot.project.name, type, ...item };
      }),
  );
};
