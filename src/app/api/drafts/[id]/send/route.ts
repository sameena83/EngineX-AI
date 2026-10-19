import { getBundle } from "@/lib/bundle";
import { getDraft, getProfile, recordSend } from "@/lib/db";
import { configuredProvider, sendEmail } from "@/lib/email";
import { dispatch, type SendLogData } from "@/lib/integrations";
import { currentTenantId } from "@/lib/tenant";

export async function POST(request: Request, ctx: RouteContext<"/api/drafts/[id]/send">) {
  const { id } = await ctx.params;
  const tenantId = await currentTenantId();
  const draft = await getDraft(tenantId, Number(id));
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }
  const bundle = await getBundle(tenantId, draft.accountId);
  if (!bundle) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    to?: string;
    subject?: string;
    body?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
  };

  if (!body.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.to)) {
    return Response.json({ error: "A valid recipient email is required" }, { status: 400 });
  }
  if (!body.subject || !body.body) {
    return Response.json({ error: "Subject and body are required" }, { status: 400 });
  }

  const profile = await getProfile(tenantId);
  const fromEmail = body.fromEmail || profile.sender.email;
  if (!fromEmail) {
    return Response.json(
      { error: "Set a sender address in the service profile before sending" },
      { status: 400 },
    );
  }

  const result = await sendEmail({
    from: { name: body.fromName || profile.sender.name, email: fromEmail },
    replyTo: body.replyTo || profile.sender.replyTo,
    to: body.to,
    subject: body.subject,
    text: body.body,
  });

  const record = await recordSend(tenantId, {
    accountId: draft.accountId,
    draftId: draft.id,
    toEmail: body.to,
    subject: body.subject,
    body: body.body,
    provider: result.provider,
    status: result.status,
    error: result.error,
  });

  if (result.ok && result.status === "sent") {
    const data: SendLogData = {
      accountName: bundle.account.name,
      // Without the domain a CRM has no company to hang the note on, and the
      // promise of this destination is that outreach shows up on the account.
      domain: bundle.account.domain,
      toEmail: body.to,
      subject: body.subject,
      status: result.status,
      provider: result.provider,
    };
    void dispatch(tenantId, "send_log", data).catch(() => {});
  }

  return Response.json({
    result,
    send: record,
    provider: configuredProvider(),
  });
}
