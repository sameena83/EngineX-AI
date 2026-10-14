import { getBundle } from "@/lib/bundle";
import { getBriefForAccount, getProfile, listAccounts, listSignals } from "@/lib/db";
import {
  accountCardFromScored,
  dispatch,
  type DigestData,
  type EventData,
} from "@/lib/integrations";
import { buildFeed } from "@/lib/signals";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    event: "digest" | "account_card";
    accountId?: number;
    limit?: number;
  };

  let data: EventData;
  if (body.event === "digest") {
    const feed = buildFeed(listAccounts(), listSignals());
    const digest: DigestData = {
      accounts: feed.slice(0, body.limit ?? 8).map(accountCardFromScored),
      generatedAt: new Date().toISOString(),
      cadence: getProfile().delivery.digestCadence,
    };
    data = digest;
  } else {
    if (!body.accountId) {
      return Response.json({ error: "accountId required" }, { status: 400 });
    }
    const bundle = getBundle(body.accountId);
    if (!bundle || !bundle.score) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }
    const card = accountCardFromScored(bundle.score);
    data = { ...card, whyNow: getBriefForAccount(body.accountId)?.whyNow };
  }

  const results = await dispatch(body.event, data);
  return Response.json({
    results,
    delivered: results.filter((r) => r.ok).length,
    attempted: results.length,
  });
}
