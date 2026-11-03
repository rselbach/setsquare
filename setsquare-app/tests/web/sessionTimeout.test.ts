import { readAccountSession } from "../../web/workspaceStore";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each(["headers", "body"])(
  "times out stalled session %s and preserves the known-server fallback",
  async (phase) => {
    vi.useFakeTimers();
    localStorage.setItem("setsquare-account-server", "true");
    let signal: AbortSignal | null | undefined;
    vi.spyOn(window, "fetch").mockImplementation((_input, init) => {
      signal = init?.signal;
      const stalled = new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Aborted")), {
          once: true,
        });
      });
      if (phase === "headers") {
        return stalled;
      }
      const response = new Response("", {
        headers: { "Content-Type": "application/json" },
      });
      vi.spyOn(response, "json").mockReturnValue(stalled);
      return Promise.resolve(response);
    });
    const session = readAccountSession(window);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signal?.aborted).toBe(true);
    expect(await session).toEqual({ kind: "unreachable" });
    expect(vi.getTimerCount()).toBe(0);
  },
);
