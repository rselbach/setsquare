import { ApiError, RequestFailure } from "../../workspace/remote/ApiError";
import { AccountClient, withIds } from "../../workspace/remote/transport";

import type { SessionInfo } from "../../workspace/api";

const session: Extract<SessionInfo, { kind: "signedIn" }> = {
  kind: "signedIn",
  user: {
    id: "greendale",
    login: "troy-barnes",
    name: "Troy Barnes",
    avatarUrl: "https://avatars.githubusercontent.com/u/123",
  },
  csrfToken: "greendale-csrf-token",
};

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// a request whose connection went quiet: it settles only when aborted
const stalled: typeof globalThis.fetch = (_, init) =>
  new Promise((_, reject) =>
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
  );

const client = (fetch: typeof globalThis.fetch, onSessionExpired = vi.fn()) =>
  new AccountClient({ session, fetch, onSessionExpired });

afterEach(() => {
  vi.useRealTimers();
});

describe("AccountClient", () => {
  it("sends the session's credentials, CSRF token and account on each request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({}));
    const account = client(fetch);
    await account.get("/api/workspace");
    await account.post("/api/commands", { requestId: "pierce" });
    expect(fetch.mock.calls.map(([path, init]) => [path, init])).toEqual([
      [
        "/api/workspace",
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": "greendale-csrf-token",
            "X-Setsquare-Account": "greendale",
          },
        }),
      ],
      [
        "/api/commands",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ requestId: "pierce" }),
        }),
      ],
    ]);
  });

  it("joins ids into an encoded query", () => {
    expect(withIds("/api/files", ["abed", "troy & abed"])).toBe(
      "/api/files?ids=abed,troy%20%26%20abed",
    );
  });

  it("gives image requests longer than other requests before timing out", async () => {
    vi.useFakeTimers();
    const account = client(stalled);
    const workspace = account.get("/api/workspace").catch((error) => error);
    const files = account.get("/api/files?ids=abed").catch((error) => error);
    let filesFailed = false;
    void files.then(() => {
      filesFailed = true;
    });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await workspace).toEqual(new ApiError(0, "timeout"));
    expect(filesFailed).toBe(false);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(await files).toEqual(new ApiError(0, "timeout"));
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a server error", async () => response({ error: "unavailable" }, 503)],
  ])(
    "sends a mutation once more after %s and reports an unknown outcome",
    async (_, fail) => {
      const fetch = vi.fn<typeof globalThis.fetch>(fail);
      const sending = client(fetch).post("/api/commands", {
        requestId: "chang",
      });
      await expect(sending).rejects.toBeInstanceOf(RequestFailure);
      await expect(sending).rejects.toHaveProperty("outcome", "unknown");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);
    },
  );

  it("returns the retry's answer when it succeeds", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ ok: true }));
    expect(await client(fetch).post("/api/commands", {})).toEqual({
      ok: true,
    });
  });

  it.each([
    ["a read", (account: AccountClient) => account.get("/api/workspace"), 503],
    [
      "a refused mutation",
      (account: AccountClient) => account.post("/api/commands", {}),
      400,
    ],
  ])("does not resend %s", async (_, send, status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ error: "nope" }, status),
    );
    await expect(send(client(fetch))).rejects.toEqual(
      new ApiError(status, "nope"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the HTTP status when the error body is not JSON", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("<html>Bad gateway</html>", { status: 502 }),
    );
    await expect(client(fetch).get("/api/workspace")).rejects.toEqual(
      new ApiError(502, "The request failed (502)"),
    );
  });

  it.each([
    [401, "unauthenticated"],
    [403, "csrf_failed"],
  ])(
    "reports an expired session once on %s %s and refuses mutations after it",
    async (status, message) => {
      const expired = vi.fn();
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        response({ error: message }, status),
      );
      const account = client(fetch, expired);
      await expect(account.post("/api/commands", {})).rejects.toEqual(
        new ApiError(status, message),
      );
      await expect(account.post("/api/commands", {})).rejects.toEqual(
        new ApiError(401, "expired"),
      );
      await expect(account.get("/api/workspace")).rejects.toEqual(
        new ApiError(status, message),
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(expired).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts its requests and refuses new ones once closed", async () => {
    const fetch = vi.fn(stalled);
    const account = client(fetch);
    const pending = account.post("/api/commands", {});
    account.close();
    await expect(pending).rejects.toEqual(
      new ApiError(0, "This workspace is closed"),
    );
    await expect(account.get("/api/workspace")).rejects.toEqual(
      new ApiError(0, "This workspace is closed"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
