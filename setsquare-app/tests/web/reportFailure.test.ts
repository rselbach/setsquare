import { reportFailure } from "../../web/workspaceActions";
import { ApiError, RequestFailure } from "../../workspace/remote/ApiError";

import type { StoreFailure } from "../../web/workspaceActions";

afterEach(() => vi.restoreAllMocks());

describe("reportFailure", () => {
  const cases: Record<string, { failure: StoreFailure; want: string | null }> =
    {
      "a refused move into a trashed folder": {
        failure: { reason: "targetTrashed" },
        want: "That folder is in the Trash now.",
      },
      "the server refusing a trashed folder": {
        failure: {
          error: new ApiError(409, "target_trashed"),
        },
        want: "That folder is in the Trash now.",
      },
      "an item that's gone": {
        failure: { reason: "notFound" },
        want: "“Troy Barnes” no longer exists.",
      },
      "a change made elsewhere first": {
        failure: { reason: "conflict" },
        want: "“Troy Barnes” changed elsewhere. Try again.",
      },
      "a network that's down, retried once": {
        failure: {
          error: new RequestFailure(
            "unknown",
            new TypeError("Failed to fetch"),
          ),
        },
        want: "Couldn't reach the server. Check your connection and try again.",
      },
      "a server error": {
        failure: { error: new ApiError(503, "unavailable") },
        want: "Couldn't reach the server. Check your connection and try again.",
      },
      "a request that timed out": {
        failure: { error: new ApiError(0, "timeout") },
        want: "Couldn't reach the server. Check your connection and try again.",
      },
      "another refusal from the server": {
        failure: { error: new ApiError(409, "invalid_tree") },
        want: "Couldn't move “Troy Barnes”.",
      },
      "a browser storage error": {
        failure: {
          error: new DOMException("The disk is full", "QuotaExceededError"),
        },
        want: "Couldn't move “Troy Barnes”.",
      },
      "an expired session, which the account notice reports": {
        failure: { error: new ApiError(401, "expired") },
        want: null,
      },
      "an expired session, retried once": {
        failure: {
          error: new RequestFailure("unknown", new ApiError(401, "expired")),
        },
        want: null,
      },
    };

  it.each(Object.entries(cases))("reports %s", (_, tc) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const show = vi.fn();

    reportFailure(show, tc.failure, "move", "Troy Barnes");

    expect(show.mock.calls).toEqual(
      tc.want === null ? [] : [[{ text: tc.want, error: true }]],
    );
  });
});
