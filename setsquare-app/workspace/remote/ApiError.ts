/** A rejected API request, including expired account access. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** The operation's commit outcome, independently of its last failure reason. */
export class RequestFailure extends Error {
  constructor(
    readonly outcome: "not-committed" | "unknown",
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "The request failed");
    this.name = "RequestFailure";
  }
}

export const apiFailureCause = (error: unknown): unknown =>
  error instanceof RequestFailure ? apiFailureCause(error.cause) : error;

export const apiFailureKind = (
  error: unknown,
): "expired" | "rejected" | "unknown" => {
  error = apiFailureCause(error);
  if (!(error instanceof ApiError)) {
    return "unknown";
  }
  if (
    error.status === 401 ||
    (error.status === 403 && error.message === "csrf_failed")
  ) {
    return "expired";
  }
  if (
    error.status === 408 ||
    error.status === 429 ||
    (error.status === 409 && error.message === "concurrent_write")
  ) {
    return "unknown";
  }
  return error.status >= 400 && error.status < 500 ? "rejected" : "unknown";
};
