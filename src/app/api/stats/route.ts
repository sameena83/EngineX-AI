import { connection } from "next/server";
import { computePerformance } from "@/lib/stats";

export async function GET() {
  await connection();
  return Response.json(computePerformance());
}
