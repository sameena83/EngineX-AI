import { connection, type NextRequest } from "next/server";
import { getBundle } from "@/lib/bundle";
import { bundlesToCsv } from "@/lib/csv";
import { listAccounts } from "@/lib/db";
import { currentTenantId } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  await connection();
  const tenantId = await currentTenantId();
  const params = request.nextUrl.searchParams;
  const idsParam = params.get("ids");
  const status = params.get("status");

  let ids: number[];
  if (idsParam) {
    ids = idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  } else {
    ids = (await listAccounts(tenantId))
      .filter((a) => (status ? a.status === status : true))
      .map((a) => a.id);
  }

  // Bundles are independent reads, so they can run together.
  const bundles = (
    await Promise.all(ids.map((id) => getBundle(tenantId, id)))
  ).filter((b): b is NonNullable<typeof b> => b !== null);

  const csv = bundlesToCsv(bundles);
  const rowCount = bundles.reduce((n, b) => n + Math.max(1, b.contacts.length), 0);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="enginex-export.csv"`,
      "X-Row-Count": String(rowCount),
    },
  });
}
