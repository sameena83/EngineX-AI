import { connection } from "next/server";
import { listAccounts, listSignals } from "@/lib/db";
import { buildFeed } from "@/lib/signals";

export async function GET() {
  await connection();
  const feed = buildFeed(listAccounts(), listSignals());
  return Response.json({ feed, generatedAt: new Date().toISOString() });
}
