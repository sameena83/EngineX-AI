// Small error vocabulary shared by the data layer and the route handlers.

/** A resource does not exist, or does not belong to the caller's tenant. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The request has no workspace to act on because nobody is signed in.
 *
 * Distinct from a 500 on purpose: a deployment with Clerk configured and a
 * signed-out caller is a normal state, and the caller's next step is to sign in —
 * not to report a server error.
 */
export class UnauthenticatedError extends Error {
  constructor(message = "Sign in required") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Map a thrown error to a response. A missing or not-owned resource is a 404
 * rather than a 500, which is also what keeps a cross-tenant id from revealing
 * whether the row exists at all.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof NotFoundError) {
    return Response.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof UnauthenticatedError) {
    return Response.json({ error: err.message }, { status: 401 });
  }
  console.error("[api]", err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}
