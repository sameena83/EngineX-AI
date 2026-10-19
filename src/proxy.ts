// The request boundary.
//
// In Next.js 16 this file is `proxy.ts` — it was `middleware.ts` through 15, and
// the convention moved to the Node.js runtime. Clerk's own docs use exactly this
// shape for 16, so the name here is not a preference.
//
// Two jobs, in order:
//
//   1. Clerk resolves the session, so `auth()` works in server code and the
//      browser knows who is signed in.
//   2. The sign-in gate (./lib/session-gate.ts) sends a signed-out visitor to
//      sign-in, or answers an API caller 401 rather than letting a handler fail
//      with a 500 because it could not resolve a workspace.
//
// What it deliberately does NOT do is decide what a user may see. That is the
// tenant id required by every data call (see ./lib/db.ts and ./lib/tenant.ts):
// authorization belongs next to the data, and a gate that runs before the request
// cannot see it.
//
// With no Clerk keys there is nothing to resolve and nothing to gate — a
// development install, or the single-workspace deployment the README describes
// for customers who do not want sign-in — so the proxy steps aside entirely,
// which is also what keeps `npm test` and a plain Node process working.

import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveSessionGate } from "./lib/session-gate";

type ProxyHandler = (request: NextRequest, event: NextFetchEvent) => unknown;

const identityEnabled = () =>
  Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

let clerkHandler: ProxyHandler | null = null;

/**
 * Built on first request rather than at import: this pulls in the Clerk server
 * package, which reads the keys and has no business being constructed in a
 * deployment that has none.
 */
async function buildClerkHandler(): Promise<ProxyHandler> {
  const { clerkMiddleware } = await import("@clerk/nextjs/server");
  const middleware = clerkMiddleware(async (auth, request) => {
    const { userId } = await auth();
    const decision = resolveSessionGate({
      pathname: request.nextUrl.pathname,
      identityConfigured: true,
      signedIn: Boolean(userId),
    });

    if (decision.action === "allow") return;
    if (decision.action === "unauthorised") {
      return NextResponse.json({ error: decision.error }, { status: 401 });
    }

    // Where the visitor was heading, so signing in lands them there. Clerk's own
    // redirect helper is not used because the gate also covers API paths, which
    // are refused rather than redirected (above).
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("redirect_url", decision.returnTo);
    return NextResponse.redirect(url);
  });
  return middleware as unknown as ProxyHandler;
}

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!identityEnabled()) return NextResponse.next();
  clerkHandler ??= await buildClerkHandler();
  return clerkHandler(request, event);
}

export const config = {
  matcher: [
    // Everything except Next.js internals, Clerk's own routes and static files.
    "/((?!_next|__clerk|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // ...and always the API routes, whose responses are JSON rather than documents.
    "/(api|trpc)(.*)",
  ],
};
