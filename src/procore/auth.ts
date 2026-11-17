import { ProcoreApiError } from "./errors.js";

export interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(): void;
}

export interface ClientCredentialsOptions {
  loginBase: string;
  clientId: string;
  clientSecret: string;
}

const REFRESH_MARGIN_MS = 60_000;

/** OAuth2 client_credentials flow for a Procore Developer Managed Service Account. */
export class ClientCredentialsAuth implements TokenProvider {
  private token?: { value: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(
    private readonly options: ClientCredentialsOptions,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  getToken(): Promise<string> {
    if (this.token && this.now() < this.token.expiresAt - REFRESH_MARGIN_MS) {
      return Promise.resolve(this.token.value);
    }
    this.pending ??= this.requestToken().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  invalidate(): void {
    this.token = undefined;
  }

  private async requestToken(): Promise<string> {
    const path = "/oauth/token";
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.loginBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new ProcoreApiError(`OAuth token request failed: ${(error as Error).message}`, 0, path);
    }
    if (!res.ok) {
      throw new ProcoreApiError("OAuth token request failed", res.status, path, await res.text().catch(() => ""));
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new ProcoreApiError("OAuth token response has no access_token", res.status, path);
    }
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
