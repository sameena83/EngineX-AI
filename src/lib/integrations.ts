import { listIntegrations } from "./db";
import type { Integration, IntegrationKind, ScoredAccount } from "./types";

// EngineX delivers accounts where partners already work. All four targets are
// plain inbound webhooks, so a single dispatcher covers them — only the payload
// shape differs:
//   slack  — incoming webhook, { text } / Block Kit
//   teams  — Workflows (Power Automate) webhook, message envelope + Adaptive Card
//   make   — Custom webhook, arbitrary JSON
//   zapier — Catch Hook, arbitrary JSON
// The legacy Office 365 connector webhooks were retired in May 2026, so Teams
// uses the Workflows trigger.

export const INTEGRATION_KINDS: IntegrationKind[] = [
  "slack",
  "teams",
  "make",
  "zapier",
];

export interface IntegrationMeta {
  label: string;
  hint: string;
  /** Example of what the pasted URL looks like, for the input placeholder. */
  urlHint: string;
  /** The three-beat summary shown on the card. */
  setup: string[];
  /** Full click-by-click instructions. */
  steps: string[];
  docs: string;
}

export const INTEGRATION_META: Record<IntegrationKind, IntegrationMeta> = {
  slack: {
    label: "Slack",
    hint: "Signal digest on your cadence (daily or weekly), plus strong-signal alerts in a channel.",
    urlHint: "https://hooks.slack.com/services/…",
    setup: [
      "Open api.slack.com/apps and create an app.",
      "Turn on Incoming Webhooks and add one to a channel.",
      "Copy the hooks.slack.com URL and paste it here.",
    ],
    steps: [
      "If you haven't yet: api.slack.com/apps → Create New App → From scratch, name it, pick your workspace, Create App.",
      "Now at api.slack.com/apps click the app you just created — the URL is inside the app, not on the apps list.",
      "In the app's left sidebar under Features, click Incoming Webhooks.",
      "Set Activate Incoming Webhooks to On (a green toggle). The page now shows an Add New Webhook to Workspace button.",
      "Click Add New Webhook to Workspace. Slack opens an authorization page — pick the channel EngineX should post in, then click Allow.",
      "You land back on the Incoming Webhooks page. Under “Webhook URLs for Your Workspace” copy the https://hooks.slack.com/services/… URL.",
      "Paste it here and click Send test — you should see “Test delivered ✓”.",
      "If there's no URL yet, it's because the Authorize step didn't finish. One URL posts to one channel; treat it like a password.",
      "Warning: ignore the Access/Refresh tokens on your apps list — those are Slack CLI configuration tokens, not a webhook. Only the hooks.slack.com/services/… URL works here.",
    ],
    docs: "https://api.slack.com/messaging/webhooks",
  },
  teams: {
    label: "Microsoft Teams",
    hint: "Same digest and account cards, via a Workflows webhook.",
    urlHint: "https://prod-00.westus.logic.azure.com/workflows/…/triggers/manual/paths/invoke/…",
    setup: [
      "Open Workflows from the channel you want posts in.",
      "Use the template “Send webhook alerts to a channel” and Save it.",
      "Copy the workflow's callback URL and paste it here.",
    ],
    steps: [
      "In Teams, hover the channel → ••• → Workflows (or open the Workflows app), then search for the template “Send webhook alerts to a channel”.",
      "Selecting that template is the fastest route: it wires the trigger to a post in your channel. Save the flow.",
      "To build it by hand instead: add the trigger “When a Teams webhook request is received”, set its authentication to Anyone, then add the action “Post adaptive card in a chat or channel” and pick your channel.",
      "After saving, copy the trigger's callback URL (prod-….logic.azure.com/workflows/…).",
      "Paste it here and click Send test.",
      "Do not use the old Office 365 connector webhooks — Microsoft retired them in May 2026. With authentication “Anyone”, send no token header (EngineX doesn't).",
    ],
    docs: "https://support.microsoft.com/en-us/workflows/send-messages-in-teams-using-incoming-webhooks",
  },
  make: {
    label: "Make",
    hint: "Catch-all for other tools: CRM sync, sequencers, spreadsheets.",
    urlHint: "https://hook.eu2.make.com/…",
    setup: [
      "Create a scenario and add the Webhooks → Custom webhook module.",
      "Click Add, name the webhook, and copy the generated URL.",
      "Paste it here, then Send test so Make learns the fields.",
    ],
    steps: [
      "In Make, create a scenario and click the large + to add a module.",
      "Search Webhooks, choose Custom webhook, then click Add in the Webhook field.",
      "Give it a name and save — Make shows a URL (hook.eu2.make.com/…).",
      "Copy that URL and paste it here, then click Send test.",
      "Back in Make, click Run once so it captures the sample; you can now map fields (Company, AI_Subject, …) into later modules.",
      "Keep the scenario switched on — Make deactivates unused webhooks after about five days.",
    ],
    docs: "https://help.make.com/webhooks",
  },
  zapier: {
    label: "Zapier",
    hint: "Catch-all for other tools: CRM sync, sequencers, spreadsheets.",
    urlHint: "https://hooks.zapier.com/hooks/catch/…",
    setup: [
      "Create a Zap with the trigger Webhooks by Zapier → Catch Hook.",
      "Copy the hook URL it shows.",
      "Paste it here, then Send test and Test trigger in Zapier.",
    ],
    steps: [
      "In Zapier, click Create → Zap.",
      "For the trigger app choose Webhooks by Zapier, and for the event choose Catch Hook, then Continue.",
      "Copy the webhook URL shown on the trigger step (hooks.zapier.com/hooks/catch/…).",
      "Paste it here and click Send test, then go back to Zapier and click Test trigger to pull the sample.",
      "Map the fields in the following action steps (e.g. create a CRM record).",
      "Keep the Zap turned on: requests to a switched-off Zap's hook return 404. Use Catch Raw Hook if you need the untouched body.",
    ],
    docs: "https://help.zapier.com/hc/en-us/articles/8496288690317",
  },
};

export type IntegrationEvent = "digest" | "account_card" | "send_log";

export interface AccountCardData {
  accountName: string;
  sector: string;
  employees: number;
  location: string;
  score: number;
  tier: string;
  signalType: string;
  signalSummary: string;
  whyNow?: string;
  url?: string;
}

export interface DigestData {
  accounts: AccountCardData[];
  generatedAt: string;
  /** Cadence the digest was scheduled on, so the title matches reality. */
  cadence?: "off" | "daily" | "weekly";
}

/** "EngineX daily signal digest" / "weekly" / plain when no cadence is known. */
function digestTitle(d: DigestData): string {
  const cadence = d.cadence === "weekly" || d.cadence === "daily" ? `${d.cadence} ` : "";
  return `EngineX ${cadence}signal digest`;
}

export interface SendLogData {
  accountName: string;
  toEmail: string;
  subject: string;
  status: string;
  provider: string;
}

export type EventData = AccountCardData | DigestData | SendLogData;

export function accountCardFromScored(s: ScoredAccount): AccountCardData {
  return {
    accountName: s.account.name,
    sector: s.account.sector,
    employees: s.account.employees,
    location: s.account.location,
    score: s.score,
    tier: s.tier,
    signalType: s.topSignal?.type ?? "",
    signalSummary: s.topSignal?.summary ?? "",
  };
}

function summaryLine(d: AccountCardData | DigestData | SendLogData): string {
  if ("accounts" in d) {
    const lines = d.accounts
      .map((a, i) => `${i + 1}. ${a.accountName} — ${a.score} (${a.signalSummary})`)
      .join("\n");
    return `${digestTitle(d)} — ${d.accounts.length} accounts\n${lines}`;
  }
  if ("toEmail" in d) {
    return `EngineX sent an outreach email to ${d.toEmail} (${d.accountName}) — ${d.status}.`;
  }
  return `EngineX signal: ${d.accountName} scored ${d.score} — ${d.signalSummary}`;
}

function slackPayload(d: EventData) {
  if ("accounts" in d) {
    return {
      text: summaryLine(d),
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: digestTitle(d) },
        },
        ...d.accounts.slice(0, 10).map((a) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${a.accountName}* — score ${a.score} · ${a.sector}\n${a.signalSummary}`,
          },
        })),
      ],
    };
  }
  if ("toEmail" in d) {
    return { text: summaryLine(d) };
  }
  return {
    text: summaryLine(d),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${d.accountName}* — score ${d.score}\n${d.signalSummary}`,
        },
      },
    ],
  };
}

function teamsPayload(d: EventData) {
  const cardBody =
    "accounts" in d
      ? [
          {
            type: "TextBlock",
            size: "Large",
            weight: "Bolder",
            text: digestTitle(d),
          },
          ...d.accounts.slice(0, 10).flatMap((a) => [
            {
              type: "TextBlock",
              wrap: true,
              text: `**${a.accountName}** — score ${a.score} · ${a.sector}`,
            },
            { type: "TextBlock", wrap: true, isSubtle: true, text: a.signalSummary },
          ]),
        ]
      : [
          {
            type: "TextBlock",
            size: "Large",
            weight: "Bolder",
            text: "toEmail" in d ? "EngineX outreach sent" : "EngineX signal",
          },
          {
            type: "TextBlock",
            wrap: true,
            text:
              "toEmail" in d
                ? `${d.accountName} — ${d.subject} → ${d.toEmail} (${d.status})`
                : `${d.accountName} — score ${d.score}\n${d.signalSummary}`,
          },
        ];

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body: cardBody,
        },
      },
    ],
  };
}

function genericPayload(event: IntegrationEvent, d: EventData) {
  return { source: "enginex", event, payload: d };
}

export function buildPayload(
  kind: IntegrationKind,
  event: IntegrationEvent,
  data: EventData,
) {
  switch (kind) {
    case "slack":
      return slackPayload(data);
    case "teams":
      return teamsPayload(data);
    default:
      return genericPayload(event, data);
  }
}

export interface DispatchResult {
  kind: IntegrationKind;
  label: string;
  ok: boolean;
  status: number | null;
  error: string | null;
}

async function post(url: string, body: unknown): Promise<DispatchResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      kind: "slack",
      label: "",
      ok: res.ok,
      status: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      kind: "slack",
      label: "",
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : "request failed",
    };
  }
}

/** Send one event to every enabled destination subscribed to it. */
export async function dispatch(
  event: IntegrationEvent,
  data: EventData,
): Promise<DispatchResult[]> {
  const targets = listIntegrations().filter(
    (i) => i.enabled && i.events.includes(event),
  );
  return Promise.all(
    targets.map(async (i) => {
      const result = await post(i.url, buildPayload(i.kind, event, data));
      return { ...result, kind: i.kind, label: i.label };
    }),
  );
}

/** Send a one-off sample payload to a single destination, for the Test button. */
export async function testIntegration(i: Pick<Integration, "kind" | "url" | "label">) {
  const sample: AccountCardData = {
    accountName: "Sample Co",
    sector: "Logistics",
    employees: 850,
    location: "Chicago, IL",
    score: 84,
    tier: "very_strong",
    signalType: "new_data_leader",
    signalSummary: "New Head of Data hired, first 90 days",
  };
  const result = await post(i.url, buildPayload(i.kind, "account_card", sample));
  return { ...result, kind: i.kind, label: i.label };
}
