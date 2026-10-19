import { resetTenant } from "@/lib/db";
import { RESET_GUARD, secretGuard } from "@/lib/guards";
import { currentTenantId } from "@/lib/tenant";

// Demo reset. Scoped to the calling tenant, so it can never clear another
// customer's workspace.
//
// It is also the one endpoint that destroys work, and the UI never calls it, so
// a deployment closes it with RESET_SECRET: on a public URL without sign-in an
// unauthenticated wipe is a data-loss button for anyone who finds it. See
// ./src/lib/guards.ts for the rule; development stays open so the demo reset
// keeps working with no configuration.
export async function POST(request: Request) {
  const blocked = secretGuard(request, RESET_GUARD);
  if (blocked) return blocked;

  const tenantId = await currentTenantId();
  await resetTenant(tenantId);
  return Response.json({ ok: true });
}
