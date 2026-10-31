import { ApiError, apiFailureKind, RequestFailure } from "./ApiError";

import type { SessionInfo } from "../api";

type SignedIn = Extract<SessionInfo, { kind: "signedIn" }>;

// a request that outlasts these has stalled; image bytes can take minutes
// on a slow link, everything else is small
const REQUEST_TIMEOUT = 20_000;
const IMAGE_TIMEOUT = 120_000;

/** Appends ids to a path as the API's comma-separated `ids` query. */
export const withIds = (path: string, ids: readonly string[]) =>
  `${path}?ids=${ids.map(encodeURIComponent).join(",")}`;

/**
 * Requests to the account API as one signed-in user. Each attempt times out,
 * a mutation whose outcome is uncertain is sent once more, and an expired
 * session stops further mutations until the page reloads.
 */
export class AccountClient {
  private closed = false;
  private expired = false;
  private readonly requests = new Set<AbortController>();

  constructor(
    private readonly options: {
      session: SignedIn;
      fetch: typeof fetch;
      onSessionExpired: () => void;
    },
  ) {}

  get(path: string) {
    return this.request(path, { method: "GET" });
  }

  post(path: string, body: unknown) {
    return this.request(
      path,
      { method: "POST", body: JSON.stringify(body) },
      true,
    );
  }

  /** Aborts requests in flight and refuses new ones. */
  close() {
    this.closed = true;
    for (const controller of this.requests) {
      controller.abort(new ApiError(0, "This workspace is closed"));
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    retry = false,
  ): Promise<unknown> {
    if (this.closed) {
      throw new ApiError(0, "This workspace is closed");
    }
    // the session's CSRF token is fixed, so a mutation can't succeed again
    // until the page reloads with a new session
    if (this.expired && init.method !== "GET") {
      throw new ApiError(401, "expired");
    }
    try {
      return await this.send(path, init);
    } catch (error) {
      // the server may have applied a request it never answered
      const uncertain =
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500;
      if (retry && uncertain && !this.closed) {
        return this.retryUncertainRequest(path, init);
      }
      throw error;
    }
  }

  // one attempt, which stops when it stalls or the client closes
  private async send(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new ApiError(0, "timeout")),
      path.startsWith("/api/files") ? IMAGE_TIMEOUT : REQUEST_TIMEOUT,
    );
    this.requests.add(controller);
    try {
      const response = await this.options.fetch(path, {
        ...init,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": this.options.session.csrfToken,
          "X-Setsquare-Account": this.options.session.user.id,
        },
      });
      if (!response.ok) {
        let message = `The request failed (${response.status})`;
        try {
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof body.error === "string"
          ) {
            message = body.error;
          }
        } catch {
          // a proxy can return an error page rather than the API's JSON
        }
        const error = new ApiError(response.status, message);
        if (apiFailureKind(error) === "expired" && !this.expired) {
          this.expired = true;
          this.options.onSessionExpired();
        }
        throw error;
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }

  private async retryUncertainRequest(path: string, init: RequestInit) {
    try {
      return await this.request(path, init);
    } catch (error) {
      // A refusal of the retry cannot disprove the first attempt's commit.
      throw new RequestFailure("unknown", error);
    }
  }
}
