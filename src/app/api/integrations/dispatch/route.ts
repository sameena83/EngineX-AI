import { getBundle } from "@/lib/bundle";
import {
  getBriefForAccount,
  getProfile,
  getVocabulary,
  listAccounts,
  listSignals,
} from "@/lib/db";
import {
  accountCardFromScored,
  dispatch,
  type DigestData,
  type EventData,
} from "@/lib/integrations";
import { buildFeed } from "@/lib/signals";
import { currentTenantId } from "@/lib/tenant";

export async function POST(request: Request) {
  const tenantId = await currentTenantId();
  const body = (await request.json()) as {
    event: "digest" | "account_card";
    accountId?: number;
    limit?: number;
  };

  let data: EventData;
  if (body.event === "digest") {
    const [accounts, signals, profile, vocabulary] = await Promise.all([
      listAccounts(tenantId),
      listSignals(tenantId),
      getProfile(tenantId),
      getVocabulary(tenantId),
    ]);
    const feed = buildFeed(accounts, signals, vocabulary, profile).filter(
      (a) => a.fit.gate !== "out",
    );
    const digest: DigestData = {
      accounts: feed.slice(0, body.limit ?? 8).map(accountCardFromScored),
      generatedAt: new Date().toISOString(),
      cadence: profile.delivery.digestCadence,
    };
    data = digest;
  } else {
    if (!body.accountId) {
      return Response.json({ error: "accountId required" }, { status: 400 });
    }
    const bundle = await getBundle(tenantId, body.accountId);
    if (!bundle || !bundle.score) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }
    const card = accountCardFromScored(bundle.score);
    const brief = await getBriefForAccount(tenantId, body.accountId);
    data = { ...card, whyNow: brief?.whyNow };
  }

  const results = await dispatch(tenantId, body.event, data);
  return Response.json({
    results,
    delivered: results.filter((r) => r.ok).length,
    attempted: results.length,
  });
}
