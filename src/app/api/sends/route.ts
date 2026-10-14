import { connection } from "next/server";
import { listSends } from "@/lib/db";
import { configuredProvider } from "@/lib/email";

export async function GET() {
  await connection();
  return Response.json({
    sends: listSends(),
    provider: configuredProvider(),
  });
}
