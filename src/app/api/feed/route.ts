import { connection } from "next/server";
import { getProfile, getVocabulary, listAccounts, listSignals } from "@/lib/db";
import { rankFeed } from "@/lib/signals";
import { currentTenantId } from "@/lib/tenant";

// The ranked pipeline: opportunities worth acting on, best first.
//
// Accounts that clearly do not fit the consultancy's market are returned
// separately rather than silently dropped, so "where did that account go?" is
// always answerable from the response.
export async function GET() {
  await connection();
  const tenantId = await currentTenantId();
  const [accounts, signals, profile, vocabulary] = await Promise.all([
    listAccounts(tenantId),
    listSignals(tenantId),
    getProfile(tenantId),
    getVocabulary(tenantId),
  ]);
  const { opportunities, excluded } = rankFeed(accounts, signals, vocabulary, profile);
  return Response.json({
    feed: opportunities,
    excluded,
    excludedCount: excluded.length,
    generatedAt: new Date().toISOString(),
  });
}
