export class ProcoreApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ProcoreApiError";
  }

  /** Short explanation suitable for showing to the end user. */
  get reason(): string {
    switch (this.status) {
      case 0:
        return "network error";
      case 401:
        return "authentication failed (check client id/secret)";
      case 403:
        return "no permission or tool not enabled on this project";
      case 404:
        return "not found or tool not enabled on this project";
      case 429:
        return "Procore rate limit reached, try again later";
      default:
        return `HTTP ${this.status}`;
    }
  }
}

/** Errors caused by tool input (unknown project, ambiguous name, ...). */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ProcoreApiError) return error.reason;
  if (error instanceof Error) return error.message;
  return String(error);
}
