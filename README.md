# EngineX AI

A signal-based pipeline engine for boutique consultancies. It finds companies showing a
specific need **right now** and hands a partner a short list of researched accounts with
drafted outreach. This app implements the core product loop from the EngineX AI project
report, scoped to the launch niche: **data & AI consultancies (5–50 people) selling to US
mid-market companies**.

EngineX does **not** send email. Sending and deliverability stay with specialised tools
(Instantly, Smartlead, Lemlist); this app produces the research and the drafts.

## The loop

1. **Service profile** (`/profile`) — describe services, ideal client and case studies once.
2. **Signal feed** (`/signals`) — companies showing need-signals, ranked by strength and recency.
3. **Account brief** (`/accounts/[id]`) — why now, likely pain, matching case-study angle, who to contact.
4. **Contact finder** — decision-makers and verified emails (sample licensed-provider data).
5. **Outreach drafts** — an email, a manual LinkedIn message and a warm-intro suggestion, with tone and length controls.
6. **Export** (`/export`) — CSV with `AI_Subject` / `AI_Body` columns ready for a sequencer.

## Signals tracked (launch niche)

| Signal | Weight |
| --- | --- |
| New data leader, first 90 days | 0.95 |
| Data hiring without data leadership | 0.85 |
| Public RFP or tender | 0.90 |
| Funding or M&A | 0.70 |
| Platform adoption (Snowflake, Databricks, dbt) | 0.60 |

An account's 0–100 score combines each signal's weight, its observed strength and a recency
delay (a signal's influence halves roughly every 45 days). Independent signals combine as
`1 − Π(1 − p)`, so several moderate signals outrank a single weak one.

Signals come from the **ingestion path** below; the 25-account sample market is only a starting
point, and `npm run dev` works with no sources configured.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

The local SQLite file (`data/enginex.db`, via Node's built-in `node:sqlite`) is created and
seeded automatically on first request. To reset the sample market, delete `data/enginex.db`
or POST to `/api/reset`.

### LLM (optional)

With no configuration, briefs and drafts use a deterministic template engine. To use an LLM,
copy [.env.example](.env.example) to `.env.local` and set an OpenAI-compatible key
(the recommended gateway is [OpenLLM](https://openllm.sh)). See [src/lib/llm.ts](src/lib/llm.ts)
for the adapter; it silently falls back to templates on any error.

## Signal sources (`/api/ingest`)

Where accounts and signals actually come from. Every source is an adapter configured only by
environment variables, in the same style as the email adapter — set the ones you have, leave the
rest blank, and `/integrations` shows which are live. With nothing set, **Dry run** still works
against a bundled sample feed, and a scheduled run pulls nothing rather than inventing data.

| Source | Env | Pulls |
| --- | --- | --- |
| Webz.io News Search | `WEBZ_API_TOKEN` (+ `WEBZ_QUERIES`) | Press coverage for funding rounds, leadership changes and platform moves, attributed to a named company |
| Generic REST source | `INGEST_HTTP_URL` (+ `INGEST_HTTP_TOKEN`, `INGEST_HTTP_FIELD_MAP`, `INGEST_HTTP_ITEMS_PATH`) | Any JSON API you have credentials for: job boards, ATS feeds, tender portals, people data |
| Push API | `INGEST_SECRET` (optional) | Nothing — a scraper, spreadsheet script or Make/Zapier scenario posts candidates in |

```bash
curl -X POST http://localhost:3000/api/ingest                    # pull every configured source
curl -X POST 'http://localhost:3000/api/ingest?dry=1'            # fetch + classify, write nothing
curl -X POST 'http://localhost:3000/api/ingest?source=webz'      # one source
curl -X POST http://localhost:3000/api/ingest -H 'content-type: application/json' \
  -d '{"candidates":[{"companyName":"Acme Freight","text":"Acme Freight raises a $42M Series C","url":"https://example.com/a","sector":"Logistics"}]}'
```

Each candidate is **classified** to one of the five tracked signal types — by the LLM when a key
is set, otherwise by a deterministic rule engine ([src/lib/classify.ts](src/lib/classify.ts)). It is
then attached to an existing account when the domain or a normalised company name matches, or a new
account is created. Items with no attributable company are counted as `unattributed`, and items that
are not evidence of a tracked need are counted as `unclassified`; neither is guessed into the feed.
Re-polling the same source is a no-op: signals carry a dedupe key (company, type, summarised event)
with a unique index ([src/lib/db.ts](src/lib/db.ts)), so a second sighting is reported as a duplicate
instead of a new signal. A source that fails is reported by name and the rest of the run continues.

The scheduler runs ingestion first when a pull source is configured, so the digest is built from the
current market — `POST /api/cron` returns an `ingested` summary alongside the delivery result.

### Trusting a signal enough to act on it

A feed nobody can audit is a feed nobody acts on, so the account page shows each signal with the
**raw evidence** it was read from, its source label, a link to the source URL, when it was detected,
and how it was classified (`rules`, with the phrases that matched, or `LLM`). If a signal is wrong,
**This is wrong** removes it in one click — the account's score is recomputed immediately, and the
claim is written to `signal_corrections` with its evidence, source and URL so the mistake stays
auditable (`GET /api/signals/corrections?accountId=…`, `POST /api/signals/[id]/reject`). Rejected
signals are listed at the bottom of the account page, and a demo reset clears them with the rest of
the sample market.

## Integrations (`/integrations`)

All four delivery targets are inbound webhooks, so one dispatcher covers them — only the payload
shape differs:

| Target | Payload | How to get the URL |
| --- | --- | --- |
| Slack | Incoming webhook, `text` + Block Kit | Apps → Incoming Webhooks → add to a channel |
| Microsoft Teams | Workflows webhook, message envelope + Adaptive Card | Workflows → *When a Teams webhook request is received* |
| Make | Arbitrary JSON | Scenario → *Custom webhook* module |
| Zapier | Arbitrary JSON | Zap → *Webhooks by Zapier* → *Catch Hook* |

Events: `digest` (scheduled signal summary), `account_card` (one account, when it first qualifies)
and `send_log` (when an outreach email is sent). Each destination ticks the events it wants, so
Slack can get alerts while a CRM gets everything. Teams uses the Workflows trigger because the
legacy Office 365 connector webhooks were retired in May 2026. Payload builders live in
[src/lib/integrations.ts](src/lib/integrations.ts).

### Delivery cadence

Two urgency levels, set in the **Delivery policy** card on `/integrations` (stored on the profile):

| | Digest | Strong-signal alert |
| --- | --- | --- |
| What | A ranked list of the top accounts | One account, with its why-now |
| When | On your cadence — **weekly** (default), **daily**, or **off** | The first scheduler run after an account reaches `alertMinScore` (default 80) |
| Repeats | Every period | Once per account — tracked in `runtime_state` so a channel is never spammed |

The default is the report's Slack Phase 1: a **weekly digest** plus alerts for accounts at
**score ≥ 80** ("very strong"). Set the cadence to *daily* if you want a morning list, or the
threshold to 0 to disable alerts and keep only the digest.

### Scheduling the delivery

Nothing is scheduled inside the app. A single endpoint does the work and only sends what is due,
so an hourly ping is ideal:

```bash
curl -X POST http://localhost:3000/api/cron
```

**Local crontab** (every hour):

```cron
0 * * * * curl -s -X POST http://localhost:3000/api/cron >/dev/null
```

**Vercel Cron** (`vercel.json`):

```json
{ "crons": [{ "path": "/api/cron", "schedule": "0 * * * *" }] }
```

Or use a Make/Zapier schedule that calls the same URL. Set `CRON_SECRET` in the environment to
require an `x-cron-secret` header (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
`POST /api/cron?force=1` ignores the schedule for testing, and **Run scheduled delivery now** in
the UI does the same. The response reports what was due, what was delivered and how many alerts
went out; the schedule only advances when something actually lands, so a failed send is retried.

## AI review agent and direct sending

The review agent ([src/lib/agent.ts](src/lib/agent.ts)) sits between generation and sending. Open a
draft on an account and press **Review with agent**: it lists concrete problems (placeholders, spam
trigger words, no clear ask, missing personalisation, length) and returns a corrected version you can
apply with one click. It never sends on its own.

**Send email** then delivers an approved draft and logs it. Sending is opt-in — with no email
provider configured it runs in dry-run mode, so the flow is fully testable. Set `EMAIL_PROVIDER`
and `EMAIL_API_KEY` (see [.env.example](.env.example)) to send for real from your verified domain
via a provider-agnostic adapter ([src/lib/email.ts](src/lib/email.ts)).

## Results and signal performance

A feed nobody measures is a guess, so outcomes close the loop. On an account's **Results** card,
log *Replied*, *Meeting booked*, *Won* or *No response*; the dashboard's **Signal performance**
table then shows, per signal type, how many accounts carry it, how many were contacted, replies,
meetings and **meetings per 50 accounts** — the metric the report tracks to decide whether a signal
is worth keeping. An account counts as contacted if you sent to it or logged an outcome for it.
Computed in [src/lib/stats.ts](src/lib/stats.ts); exposed at `/api/stats` and `/api/outcomes`.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS 4
- SQLite through `node:sqlite` — no external database for local development
- OpenAI-compatible LLM adapter with template fallback

The report proposes PostgreSQL, a Python/FastAPI backend and Stripe for production; those
slots are isolated behind the data layer ([src/lib/db.ts](src/lib/db.ts)) and the generation
layer ([src/lib/generate.ts](src/lib/generate.ts)) so they can be swapped without touching the UI.

## Data, compliance and ethics

Account data here is **fictional sample data**. The product is built on company-level public
signals and licensed person-level data. LinkedIn scraping, scanning company systems, and
outreach triggered by data breaches are explicitly out of scope (see the report), as is
sending email on the customer's behalf.
