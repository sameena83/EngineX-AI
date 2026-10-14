import { connection } from "next/server";
import { listDraftsWithAccount } from "@/lib/db";

export async function GET() {
  await connection();
  return Response.json({ drafts: listDraftsWithAccount() });
}
