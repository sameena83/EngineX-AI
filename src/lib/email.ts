// Email sending adapter.
//
// The EngineX report deliberately keeps sending out of the product ("EngineX does
// not send email itself"), because deliverability and compliance belong with
// specialised tools. Direct sending is opt-in: set EMAIL_PROVIDER + EMAIL_API_KEY
// and EngineX will send an approved draft from your verified domain.
//
// The adapter is provider-agnostic and speaks a small set of common transactional
// REST shapes, so you are not locked to one vendor:
//   resend   — POST {base}/emails           Authorization: Bearer <key>
//   postmark — POST {base}/email            X-Postmark-Server-Token: <key>
//   sendgrid — POST {base}/v3/mail/send     Authorization: Bearer <key>
// With no key configured the adapter runs in dry-run mode: it validates and logs
// the send without contacting a provider, so the whole flow stays testable.

export type EmailProvider = "resend" | "postmark" | "sendgrid" | "dry-run";

export interface SendResult {
  ok: boolean;
  provider: EmailProvider;
  status: "sent" | "failed" | "dry_run";
  id: string | null;
  error: string | null;
}

export interface SendInput {
  from: { name: string; email: string };
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
}

export function configuredProvider(): EmailProvider {
  const key = process.env.EMAIL_API_KEY;
  const provider = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  if (!key || !provider || provider === "dry-run") return "dry-run";
  if (provider === "resend" || provider === "postmark" || provider === "sendgrid") {
    return provider;
  }
  return "dry-run";
}

function defaultBase(provider: EmailProvider): string {
  switch (provider) {
    case "resend":
      return "https://api.resend.com";
    case "postmark":
      return "https://api.postmarkapp.com";
    case "sendgrid":
      return "https://api.sendgrid.com";
    default:
      return "";
  }
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const provider = configuredProvider();
  if (provider === "dry-run") {
    return {
      ok: true,
      provider,
      status: "dry_run",
      id: null,
      error: null,
    };
  }

  const key = process.env.EMAIL_API_KEY as string;
  const base = (process.env.EMAIL_BASE_URL ?? defaultBase(provider)).replace(/\/$/, "");
  const fromField = input.from.name
    ? `${input.from.name} <${input.from.email}>`
    : input.from.email;

  try {
    let url: string;
    let headers: Record<string, string>;
    let body: unknown;

    if (provider === "resend") {
      url = `${base}/emails`;
      headers = { Authorization: `Bearer ${key}` };
      body = {
        from: fromField,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        reply_to: input.replyTo || undefined,
      };
    } else if (provider === "postmark") {
      url = `${base}/email`;
      headers = { "X-Postmark-Server-Token": key };
      body = {
        From: fromField,
        To: input.to,
        Subject: input.subject,
        TextBody: input.text,
        ReplyTo: input.replyTo || undefined,
        MessageStream: process.env.POSTMARK_STREAM ?? "outbound",
      };
    } else {
      url = `${base}/v3/mail/send`;
      headers = { Authorization: `Bearer ${key}` };
      body = {
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: input.from.email, name: input.from.name || undefined },
        reply_to: input.replyTo ? { email: input.replyTo } : undefined,
        subject: input.subject,
        content: [{ type: "text/plain", value: input.text }],
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        provider,
        status: "failed",
        id: null,
        error: `HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      };
    }

    let id: string | null = null;
    const data = (await res.json().catch(() => null)) as
      | { id?: string; MessageID?: string }
      | null;
    id = data?.id ?? data?.MessageID ?? null;

    return { ok: true, provider, status: "sent", id, error: null };
  } catch (err) {
    return {
      ok: false,
      provider,
      status: "failed",
      id: null,
      error: err instanceof Error ? err.message : "request failed",
    };
  }
}
