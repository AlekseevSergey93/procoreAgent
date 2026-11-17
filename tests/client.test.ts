import { describe, expect, it } from "vitest";
import { ClientCredentialsAuth, type TokenProvider } from "../src/procore/auth.js";
import { ProcoreClient } from "../src/procore/client.js";
import { ProcoreApiError } from "../src/procore/errors.js";

type Handler = (url: URL, init?: RequestInit) => Response;

function makeClient(handler: Handler, auth?: TokenProvider) {
  const requests: { url: URL; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(url, init);
  };
  let invalidations = 0;
  const tokens = auth ?? {
    getToken: async () => `token-${invalidations}`,
    invalidate: () => void invalidations++,
  };
  const client = new ProcoreClient(
    {
      apiBase: "https://api.test",
      companyId: 7,
      cacheTtlMs: 1000,
      fetchImpl,
      sleep: async (ms) => void sleeps.push(ms),
    },
    tokens,
  );
  return { client, requests, sleeps, invalidations: () => invalidations };
}

describe("ProcoreClient", () => {
  it("sends auth and company headers", async () => {
    const { client, requests } = makeClient(() => Response.json({ ok: true }));
    await client.get("/rest/v1.0/x", { a: 1, skip: undefined });
    expect(requests[0].url.search).toBe("?a=1");
    expect(requests[0].headers).toMatchObject({ Authorization: "Bearer token-0", "Procore-Company-Id": "7" });
  });

  it("follows pages until a short page", async () => {
    const { client, requests } = makeClient((url) => {
      const page = Number(url.searchParams.get("page"));
      const size = page < 3 ? 100 : 5;
      return Response.json(Array.from({ length: size }, (_, i) => ({ id: page * 1000 + i })));
    });
    const rows = await client.getAll<{ id: number }>("/rest/v1.0/list", { project_id: 1 });
    expect(rows).toHaveLength(205);
    expect(requests.map((r) => r.url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(requests[0].url.searchParams.get("per_page")).toBe("100");
  });

  it("stops when the Total header is reached", async () => {
    const { client, requests } = makeClient(() =>
      Response.json(
        Array.from({ length: 100 }, (_, i) => ({ id: i })),
        { headers: { Total: "100" } },
      ),
    );
    await client.getAll("/rest/v1.0/list");
    expect(requests).toHaveLength(1);
  });

  it("retries 429 using Retry-After", async () => {
    let n = 0;
    const { client, sleeps } = makeClient(() =>
      n++ === 0 ? new Response("slow down", { status: 429, headers: { "Retry-After": "2" } }) : Response.json([1]),
    );
    expect(await client.get("/rest/v1.0/x")).toEqual([1]);
    expect(sleeps).toEqual([2000]);
  });

  it("re-authenticates once on 401", async () => {
    const { client, requests, invalidations } = makeClient((_, init) =>
      (init?.headers as Record<string, string>).Authorization === "Bearer token-0"
        ? new Response("expired", { status: 401 })
        : Response.json({ ok: true }),
    );
    expect(await client.get("/rest/v1.0/x")).toEqual({ ok: true });
    expect(invalidations()).toBe(1);
    expect(requests).toHaveLength(2);
  });

  it("throws ProcoreApiError with a readable reason and does not cache failures", async () => {
    let n = 0;
    const { client } = makeClient(() => (n++ === 0 ? new Response("no", { status: 403 }) : Response.json([])));
    const error = await client.get("/rest/v1.0/x").catch((e) => e);
    expect(error).toBeInstanceOf(ProcoreApiError);
    expect(error.reason).toBe("no permission or tool not enabled on this project");
    expect(await client.get("/rest/v1.0/x")).toEqual([]);
  });

  it("caches successful responses and dedupes concurrent calls", async () => {
    const { client, requests } = makeClient(() => Response.json([1]));
    await Promise.all([client.get("/a"), client.get("/a")]);
    await client.get("/a");
    expect(requests).toHaveLength(1);
  });
});

describe("ClientCredentialsAuth", () => {
  it("requests a token once and refreshes before expiry", async () => {
    let now = 0;
    const bodies: string[] = [];
    const auth = new ClientCredentialsAuth(
      { loginBase: "https://login.test", clientId: "cid", clientSecret: "sec" },
      async (_, init) => {
        bodies.push(String(init?.body));
        return Response.json({ access_token: `t${bodies.length}`, expires_in: 120 });
      },
      () => now,
    );
    expect(await Promise.all([auth.getToken(), auth.getToken()])).toEqual(["t1", "t1"]);
    expect(bodies[0]).toBe("grant_type=client_credentials&client_id=cid&client_secret=sec");
    now = 61_000; // within the 60s refresh margin of a 120s token
    expect(await auth.getToken()).toBe("t2");
  });

  it("reports authentication failures", async () => {
    const auth = new ClientCredentialsAuth(
      { loginBase: "https://login.test", clientId: "x", clientSecret: "y" },
      async () => new Response("bad", { status: 401 }),
    );
    const error = await auth.getToken().catch((e) => e);
    expect(error.reason).toBe("authentication failed (check client id/secret)");
  });
});
