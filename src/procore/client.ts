import type { TokenProvider } from "./auth.js";
import { ProcoreApiError } from "./errors.js";

export type QueryValue = string | number | boolean | undefined;
export type Query = Record<string, QueryValue>;

export interface ProcoreClientOptions {
  apiBase: string;
  companyId: number;
  cacheTtlMs: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const PER_PAGE = 100;
const MAX_PAGES = 100;
const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Read-only Procore REST client: auth header, company scoping, pagination,
 * retries on 429/5xx and a short-lived in-memory response cache.
 */
export class ProcoreClient {
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;

  constructor(
    private readonly options: ProcoreClientOptions,
    private readonly auth: TokenProvider,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 3;
  }

  get<T>(path: string, query: Query = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.cached(url, async () => (await this.request<T>(url)).body);
  }

  /** Fetches every page of a list endpoint. */
  getAll<T>(path: string, query: Query = {}): Promise<T[]> {
    return this.cached(`${this.buildUrl(path, query)}#all`, async () => {
      const items: T[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = this.buildUrl(path, { ...query, page, per_page: PER_PAGE });
        const { body, headers } = await this.request<T[]>(url);
        if (!Array.isArray(body)) {
          throw new ProcoreApiError("Expected a JSON array", 200, path);
        }
        items.push(...body);
        const total = Number(headers.get("total"));
        if (body.length < PER_PAGE || (total > 0 && items.length >= total)) break;
      }
      return items;
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { expiresAt: this.now() + this.options.cacheTtlMs, value });
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }

  private buildUrl(path: string, query: Query): string {
    const url = new URL(path, this.options.apiBase);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async request<T>(url: string): Promise<{ body: T; headers: Headers }> {
    const path = new URL(url).pathname;
    let reauthenticated = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getToken();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Procore-Company-Id": String(this.options.companyId),
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ProcoreApiError(`Network error: ${(error as Error).message}`, 0, path);
      }

      if (res.status === 401 && !reauthenticated) {
        reauthenticated = true;
        this.auth.invalidate();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        await this.sleep(this.retryDelay(res, attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProcoreApiError(`Procore API ${res.status} for ${path}`, res.status, path, body.slice(0, 500));
      }
      const body = (res.status === 204 ? undefined : await res.json()) as T;
      return { body, headers: res.headers };
    }
  }

  private retryDelay(res: Response, attempt: number): number {
    const retryAfter = Number(res.headers.get("retry-after"));
    if (retryAfter > 0) return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
    const reset = Number(res.headers.get("x-rate-limit-reset"));
    if (reset > 0) return Math.min(Math.max(reset * 1000 - this.now(), 1000), MAX_RETRY_DELAY_MS);
    return 1000 * 2 ** attempt;
  }
}
