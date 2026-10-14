import { connection } from "next/server";
import { computeAllWonAnalytics } from "@/lib/analytics";

// Accounts won over time, bucketed weekly, monthly and yearly. All three views
// come back in one response so the page can switch tabs without refetching.

export async function GET() {
  await connection();
  return Response.json(computeAllWonAnalytics());
}
