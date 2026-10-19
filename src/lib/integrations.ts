import { listIntegrations } from "./db";
import {
  HUBSPOT_ASSOCIATION,
  hubspotConfigured,
  hubspotMode,
  hubspotPipelines,
  hubspotSyncAccount,
  type HubspotNoteLink,
  type HubspotSyncPlan,
} from "./hubspot";
import type { Integration, IntegrationKind, ScoredAccount } from "./types";

// EngineX delivers accounts where partners already work. Most targets are plain
// inbound webhooks, so one dispatcher covers them — only the payload shape
// differs:
//   slack   — incoming webhook, { text } / Block Kit
//   teams   — Workflows (Power Automate) webhook, message envelope + Adaptive Card
//   make    — Custom webhook, arbitrary JSON
//   zapier  — Catch Hook, arbitrary JSON
//   hubspot — not a webhook: EngineX calls the CRM's own API instead (./hubspot.ts),
//             because what a CRM wants is a company, a deal and the evidence, not
//             a payload someone has to map by hand.
// The legacy Office 365 connector webhooks were retired in May 2026, so Teams
// uses the Workflows trigger.

export const INTEGRATION_KINDS: IntegrationKind[] = [
  "slack",
  "teams",
  "make",
  "zapier",
  "hubspot",
];

/**
 * How a destination is reached, which is what the UI branches on.
 *
 * "webhook" needs a URL pasted by the customer; "api" is configured deployment-
 * wide (a token in the environment) and needs a *choice* from the customer instead.
 */
export type IntegrationTransport = "webhook" | "api";

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
  transport: IntegrationTransport;
}

/** What a HubSpot integration stores per tenant, on its integration row. */
export interface HubspotSettings {
  /** Internal pipeline id — never the label, which a customer can rename. */
  pipelineId?: string;
  dealStageId?: string;
  /** Off when a customer wants companies and evidence but no deals yet. */
  createDeals?: boolean;
}

export function hubspotSettingsOf(integration: Pick<Integration, "settings">): HubspotSettings {
  const s = (integration.settings ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return {
    pipelineId: str(s.pipelineId),
    dealStageId: str(s.dealStageId),
    createDeals: s.createDeals === undefined ? true : Boolean(s.createDeals),
  };
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
    transport: "webhook",
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
    transport: "webhook",
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
    transport: "webhook",
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
    transport: "webhook",
  },
  hubspot: {
    label: "HubSpot",
    hint: "Qualified accounts become companies and deals in your CRM, with the evidence attached as a note.",
    urlHint: "Not a URL — this destination is configured with HUBSPOT_ACCESS_TOKEN",
    transport: "api",
    setup: [
      "Create a HubSpot private app and copy its access token.",
      "Set HUBSPOT_ACCESS_TOKEN in the environment and restart the app.",
      "Pick the pipeline and stage new deals open in, then Check connection.",
    ],
    steps: [
      "In HubSpot, open Settings → Integrations → Private Apps and click Create a private app.",
      "On Basic Info, name it something recognisable like “EngineX” — that is what the activity is attributed to in each record's history.",
      "On the Scopes tab add crm.objects.companies.write, crm.objects.contacts.write and crm.objects.deals.write. Add crm.objects.companies.read and crm.objects.deals.read as well — the read scopes are what make the pipeline check below work.",
      "Click Create app, then Show token and copy the access token. It is shown once: store it as HUBSPOT_ACCESS_TOKEN in your environment (.env.local when running locally) and restart the app.",
      "Back here, click Check connection. It is read-only and lists the pipelines and stages this portal really has, with their internal IDs.",
      "Enter the pipeline ID and the stage ID new deals should open in. IDs, not labels: HubSpot identifies a stage by ID and a label can be renamed at any time.",
      "Choose what should arrive: Strong-signal alerts opens a company, a deal and a note per qualifying account; Scheduled digest keeps companies up to date without creating deals; Send log records that outreach went out as a note.",
      "Companies are matched on their domain, so re-syncing updates the record instead of duplicating it. Set HUBSPOT_DRY_RUN=1 to plan and log everything without writing to HubSpot.",
    ],
    docs: "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview",
  },
};

export type IntegrationEvent = "digest" | "account_card" | "send_log";

export interface AccountCardData {
  accountName: string;
  /**
   * The account's domain, present because a CRM needs a stable key to match on:
   * HubSpot's unique company property is the domain, and names are not unique
   * ("Acme" and "Acme Ltd" are one customer).
   */
  domain: string;
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
  /** Optional: without it a CRM note has no company to attach to. */
  domain?: string;
  toEmail: string;
  subject: string;
  status: string;
  provider: string;
}

export type EventData = AccountCardData | DigestData | SendLogData;

export function accountCardFromScored(s: ScoredAccount): AccountCardData {
  return {
    accountName: s.account.name,
    domain: s.account.domain,
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

/* --------------------------------- hubspot -------------------------------- */

/**
 * What one account turns into in the CRM.
 *
 * The event decides the shape, and that mapping is the whole integration:
 * a strong-signal alert is a *reason to call*, so it opens a deal and attaches the
 * evidence; a digest is a state-of-the-world update, so it only keeps companies
 * current — opening eight deals every Monday would be vandalism; a send log is a
 * fact about outreach, so it is a note.
 */
export function hubspotPlans(
  event: IntegrationEvent,
  data: EventData,
  settings: HubspotSettings,
): { plans: { label: string; plan: HubspotSyncPlan }[]; skipped: string[] } {
  const cards: { card: AccountCardData; send?: SendLogData }[] =
    "accounts" in data
      ? data.accounts.map((card) => ({ card }))
      : "toEmail" in data
        ? [
            {
              card: {
                accountName: data.accountName,
                domain: data.domain ?? "",
                sector: "",
                employees: 0,
                location: "",
                score: 0,
                tier: "",
                signalType: "",
                signalSummary: `Outreach sent: ${data.subject}`,
              },
              send: data,
            },
          ]
        : [{ card: data }];

  const pipelineId = settings.pipelineId ?? "";
  const stageId = settings.dealStageId ?? "";
  const dealReady = Boolean(settings.pipelineId && settings.dealStageId);
  const wantsDeals = event === "account_card" && settings.createDeals !== false && dealReady;

  const plans: { label: string; plan: HubspotSyncPlan }[] = [];
  const skipped: string[] = [];

  // Deals are the one part of this that needs a choice from the customer, and a
  // deal with a stage that does not exist in their portal is a 400, not a sync.
  // Say so once, and keep the company and the evidence flowing meanwhile.
  if (event === "account_card" && settings.createDeals !== false && !dealReady) {
    skipped.push(
      "No pipeline and stage chosen yet, so only companies and evidence were synced — pick both on /integrations to open deals.",
    );
  }

  for (const { card, send } of cards) {
    // A company is matched on its domain. Without one there is nothing to key on,
    // and creating a company from a name alone is how a CRM fills with duplicates.
    if (!card.domain) {
      skipped.push(`${card.accountName}: no domain to match a company on`);
      continue;
    }

    const plan: HubspotSyncPlan = {
      company: {
        domain: card.domain,
        name: card.accountName,
        employees: card.employees > 0 ? card.employees : null,
        description: [card.sector, card.location].filter(Boolean).join(" · ") || null,
      },
    };

    if (wantsDeals) {
      plan.deal = {
        name: `${card.accountName} — ${card.signalSummary || "buying signal"}`,
        pipelineId,
        stageId,
        description: [
          `EngineX score ${card.score} (${card.tier})`,
          card.signalType ? `Signal: ${card.signalType}` : "",
          card.signalSummary,
          card.whyNow ? `Why now: ${card.whyNow}` : "",
          card.url ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    if (event === "account_card" || event === "send_log") {
      const links: HubspotNoteLink[] = [
        { toType: "companies", toId: "", associationTypeId: HUBSPOT_ASSOCIATION.noteToCompany },
      ];
      if (plan.deal) {
        links.push({ toType: "deals", toId: "", associationTypeId: HUBSPOT_ASSOCIATION.noteToDeal });
      }
      plan.note = {
        text:
          event === "send_log" && send
            ? [
                `EngineX outreach sent to ${send.toEmail} — “${send.subject}” (${send.status} via ${send.provider}).`,
                card.url ? `Account: ${card.url}` : "",
              ]
                .filter(Boolean)
                .join("\n")
            : [
                `EngineX signal: ${card.signalSummary}`,
                `Score ${card.score} (${card.tier})${card.signalType ? ` · ${card.signalType}` : ""}`,
                card.whyNow ? `Why now: ${card.whyNow}` : "",
                card.url ? `Source: ${card.url}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
        links,
      };
    }

    plans.push({ label: card.accountName, plan });
  }

  return { plans, skipped };
}

/**
 * The plan shapes, for the preview panel.
 *
 * Uses placeholder pipeline/stage ids on purpose: the point of the preview is to
 * show a customer the deal body before they have chosen ids, so hiding the deal
 * would hide the part they are being asked to decide about.
 */
export function hubspotPreview(event: IntegrationEvent, data: EventData) {
  const { plans, skipped } = hubspotPlans(event, data, {
    pipelineId: "<pipeline-id>",
    dealStageId: "<deal-stage-id>",
    createDeals: true,
  });
  return { plans, skipped };
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
    case "hubspot":
      return hubspotPreview(event, data);
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
  /** What actually happened, for destinations where "ok" is not enough. */
  detail?: string | null;
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

/**
 * Send one event to every enabled destination the tenant subscribes to. Scoped
 * by tenant id, so one customer's digest can never post to another's Slack.
 */
export async function dispatch(
  tenantId: number,
  event: IntegrationEvent,
  data: EventData,
): Promise<DispatchResult[]> {
  const targets = (await listIntegrations(tenantId)).filter(
    (i) => i.enabled && i.events.includes(event),
  );

  // Webhooks go out together — they are independent and there are few of them.
  // A CRM is different: each account is several API calls against a rate limit
  // shared by every app in that portal, so those are sent one account at a time.
  const webhooks = targets.filter((t) => t.kind !== "hubspot");
  const crms = targets.filter((t) => t.kind === "hubspot");

  const webhookResults = await Promise.all(
    webhooks.map(async (i) => {
      const result = await post(i.url, buildPayload(i.kind, event, data));
      return { ...result, kind: i.kind, label: i.label };
    }),
  );

  const crmResults: DispatchResult[] = [];
  for (const crm of crms) {
    crmResults.push(...(await dispatchHubspot(crm, event, data)));
  }

  return [...webhookResults, ...crmResults];
}

/** One result per account, so a partial write is visible instead of summarised away. */
async function dispatchHubspot(
  target: Integration,
  event: IntegrationEvent,
  data: EventData,
): Promise<DispatchResult[]> {
  const { plans, skipped } = hubspotPlans(event, data, hubspotSettingsOf(target));
  const results: DispatchResult[] = skipped.map((reason) => ({
    kind: "hubspot" as const,
    label: `${target.label} · ${reason.split(":")[0]}`,
    ok: false,
    status: null,
    error: reason,
    detail: null,
  }));

  if (plans.length === 0 && results.length === 0) {
    return [
      {
        kind: "hubspot",
        label: target.label,
        ok: true,
        status: null,
        error: null,
        detail: "nothing to sync",
      },
    ];
  }

  for (const { label, plan } of plans) {
    const sync = await hubspotSyncAccount(plan);
    results.push({
      kind: "hubspot",
      label: `${target.label} · ${label}`,
      ok: sync.ok,
      status: null,
      error: sync.error,
      detail:
        sync.mode === "dry_run"
          ? `dry run — ${sync.planned.length} request(s) planned, nothing written`
          : sync.actions
              .filter((a) => a.ok)
              .map((a) => `${a.step}${a.id ? ` ${a.id}` : ""}`)
              .join(" · "),
    });
  }

  return results;
}

/** Send a one-off sample payload to a single destination, for the Test button. */
export async function testIntegration(
  i: Pick<Integration, "kind" | "url" | "label"> & { settings?: Record<string, unknown> },
) {
  if (i.kind === "hubspot") return hubspotConnectionCheck(i.settings);

  const sample: AccountCardData = {
    accountName: "Sample Co",
    domain: "sample.co",
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

/**
 * A read-only check of the HubSpot connection.
 *
 * Deliberately writes nothing: the question a customer is asking when they press
 * this is "did I paste the right token, and does the stage I typed exist?" — and
 * the answer to that is a list of pipelines, not a test company in their portal.
 */
export async function hubspotConnectionCheck(
  settings: Record<string, unknown> | undefined,
): Promise<DispatchResult> {
  const label = INTEGRATION_META.hubspot.label;
  const fail = (error: string, detail: string | null = null): DispatchResult => ({
    kind: "hubspot",
    label,
    ok: false,
    status: null,
    error,
    detail,
  });

  if (!hubspotConfigured()) {
    return fail("HUBSPOT_ACCESS_TOKEN is not set, so there is nothing to check yet.");
  }

  const configured = hubspotSettingsOf({ settings });
  try {
    const pipelines = await hubspotPipelines();
    if (pipelines.length === 0) return fail("HubSpot returned no deal pipelines for this token.");

    const describe = (p: (typeof pipelines)[number]) =>
      `${p.label} [${p.id}]: ${p.stages
        .map(
          (s) =>
            `${s.id} ${s.label}${s.closed === "won" ? " (won)" : s.closed === "lost" ? " (lost)" : ""}`,
        )
        .join(", ")}`;
    const detail = pipelines.map(describe).join("\n");

    if (configured.pipelineId && !pipelines.some((p) => p.id === configured.pipelineId)) {
      return fail(`No pipeline with id “${configured.pipelineId}” exists in this portal.`, detail);
    }
    const chosen = pipelines.find((p) => p.id === configured.pipelineId);
    if (chosen && configured.dealStageId && !chosen.stages.some((s) => s.id === configured.dealStageId)) {
      return fail(
        `Stage “${configured.dealStageId}” is not part of pipeline “${chosen.label}”.`,
        detail,
      );
    }

    const prefix =
      hubspotMode() === "dry_run"
        ? "Dry run (HUBSPOT_DRY_RUN=1) — nothing would be written. "
        : "Connected. ";
    return {
      kind: "hubspot",
      label,
      ok: true,
      status: 200,
      error: null,
      detail: `${prefix}${pipelines.length} pipeline(s):\n${detail}`,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "HubSpot check failed");
  }
}
