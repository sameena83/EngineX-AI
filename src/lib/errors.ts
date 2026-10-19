// Small error vocabulary shared by the data layer and the route handlers.

/** A resource does not exist, or does not belong to the caller's tenant. */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
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
  console.error("[api]", err);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}
