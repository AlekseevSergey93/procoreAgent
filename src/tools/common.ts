import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Thresholds } from "../config.js";
import type { ProcoreRepository } from "../domain/repository.js";
import type { Module, ProjectSnapshot } from "../domain/types.js";
import { ProcoreApiError, UserError } from "../procore/errors.js";

export interface ToolDeps {
  repo: ProcoreRepository;
  thresholds: Thresholds;
}

export type ToolRegistrar = (server: McpServer, deps: ToolDeps) => void;

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };

/** Modules that produce owned, dated work items. */
export const WORK_MODULES: readonly Module[] = ["schedule", "rfis", "submittals", "punch", "inspections"];

export const projectParam = z
  .string()
  .describe('Project id, project number, or part of the project name (e.g. "Lenina 5")');

export const optionalProjectParam = projectParam.optional().describe("Limit to one project; omit for all active projects");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export function collectWarnings(snapshots: ProjectSnapshot[]): string[] | undefined {
  const warnings = snapshots.flatMap((s) => s.warnings.map((w) => `${s.project.name}: ${w}`));
  return warnings.length ? warnings : undefined;
}

export async function respond(load: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await load()) }] };
  } catch (error) {
    let message: string;
    if (error instanceof UserError) {
      message = error.message;
    } else if (error instanceof ProcoreApiError) {
      message = `Procore API error: ${error.reason} (${error.path})`;
      console.error(error, error.body);
    } else {
      message = `Unexpected error: ${(error as Error).message}`;
      console.error(error);
    }
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}
