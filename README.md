# EngineX AI

A signal-based pipeline engine for boutique consultancies. It finds companies showing a
specific need **right now** and hands a partner a short list of researched accounts with
drafted outreach. This app implements the core product loop from the EngineX AI project
report.

The engine is **niche-agnostic**: what counts as a buying signal, who to approach, what to
exclude and how fast evidence goes stale are all per-tenant configuration, not code. Four
presets ship — **Data & AI**, **Cybersecurity**, **DevOps & platform engineering** and
**Automation & ERP** — and a new market is a new preset (see [Niche profiles](#niche-profiles)).
The sample market is data & AI, so a fresh workspace shows something real immediately.

EngineX does **not** send email. Sending and deliverability stay with specialised tools
(Instantly, Smartlead, Lemlist); this app produces the research and the drafts.

How the pieces fit together — request path, sign-in and workspace resolution, the signal-to-send
pipeline, and the blocks a deployment can hit — is in
[docs/architecture.md](docs/architecture.md).

## The loop

1. **Service profile** (`/profile`) — describe services, ideal client and case studies once.
2. **Signal feed** (`/signals`) — companies showing need-signals, ranked by strength and recency.
3. **Account brief** (`/accounts/[id]`) — why now, likely pain, matching case-study angle, who to contact.
4. **Contact finder** — decision-makers and verified emails (sample licensed-provider data).
5. **Outreach drafts** — an email, a manual LinkedIn message and a warm-intro suggestion, with tone and length controls.
6. **Export** (`/export`) — CSV with `AI_Subject` / `AI_Body` columns ready for a sequencer.

## Niche profiles

Everything market-specific lives in one configuration object per tenant, editable on
`/profile` without a redeploy:

| Field | What it decides |
| --- | --- |
| Signal vocabulary | Which signals exist, their weights, the regex patterns the offline classifier compiles, the evidence channels each rule reads, and the service keywords the fit matcher reads |
| Services | The work being sold — the fit matcher scores an opportunity against these |
| Ideal client | Target industries, headcount range and region (workspace-level; overrides a preset's targeting) |
| Targeting | The starting size band, industries and geographies a niche sells into |
| Buyer roles | Who to approach first; used by briefs and drafts |
| Exclusions | Companies that are competitors or non-buyers (a consultancy, an agency, a recruiter) |
| Negative rules | Items that are noise in any market — vendor marketing, awards, listicles |
| Scoring | How many points a perfect fit adds, and the freshness half-life |
| Source queries | What the news source searches for |
| Outreach angle | One line the copywriter and the templates work from |

Switching market is one call (`POST /api/niche`): the vocabulary, config and service list are
replaced together. **Signals already collected are kept** and re-scored against the new service
list — a market switch re-labels history rather than erasing it, which is what makes the signal
performance table below meaningful across a change of direction.

The vocabulary is stored per tenant in `signal_definitions` (migration 4) and compiled at
runtime, so the classifier, the scorer, the UI chips and the performance table all read the same
rows. A signal key is plain text, not a database enum: a tenant can define one this build has
never heard of.

### Preset vocabularies

| Niche | Signals | Freshness half-life |
| --- | --- | --- |
| Data & AI | public RFP, new data leader, data hiring without leadership, funding/M&A, platform adoption | 30 days |
| Cybersecurity | public RFP, breach/incident, new security leader, compliance audit (SOC 2, ISO 27001, NIS2…), funding/M&A, security hiring without leadership, security technology change | 45 days |
| DevOps & platform | public RFP, reliability/outage pressure, new platform leader, funding/M&A, cloud cost drive, platform hiring without leadership, technology adoption (Kubernetes, Terraform…) | 21 days |
| Automation & ERP | public RFP, ERP selection, new operations leader, funding/M&A, automation hiring without leadership | 60 days |

`public_rfp`, `funding_ma`, `*_leader_hired` and `*_hiring_no_leadership` deliberately share a key
across presets, so signal performance can be compared between markets instead of starting from
zero.

### Choosing a market (`/niches`)

The niche explorer is the read-only twin of the editor on `/profile`: pick a market and it shows the
whole profile EngineX would run for it — who it sells to (size band, industries, geographies),
services and the problems they solve, every positive signal rule with its weight and regex sources,
the guardrail rules that veto noise, buyer roles, the outreach angle, scoring weights, freshness
threshold and source queries.

Beneath the configuration it shows **what adopting that profile would change here**, computed
against the workspace's *current* values rather than the preset it started from — a customer may
have edited any field, and a diff against the original preset would claim changes that would not
happen. Signals are compared by key, so a switch reports how many rules are new, how many are
retired and how many are already shared (the keys that make performance comparable across markets).
Adopting is one click: `POST /api/niche`, the same call the editor makes.

**Adding a niche is a data change, not a release.** Add an entry to `NICHE_PRESETS` in
[src/lib/niches.ts](src/lib/niches.ts) — a label, a signal list with patterns, evidence channels and
service keywords, an initial service list, buyer roles, exclusions, a targeting block and a freshness
half-life — and it appears as a preset for every workspace, in both the explorer and the profile
editor. Tenants can
also build their own vocabulary by hand on `/profile` without touching the code at all.

The `targeting` block is deliberately prose rather than filters: `employees` is a band such as
`200–5,000` and the industries and geographies are starting points, because the matcher reads the
workspace's own `idealClient` numbers, which win as soon as someone edits them.

```bash
curl http://localhost:3000/api/vocabulary                 # vocabulary + niche config + presets
curl -X POST http://localhost:3000/api/niche \
  -H 'content-type: application/json' -d '{"key":"cybersecurity"}'
curl -X PUT http://localhost:3000/api/vocabulary \
  -H 'content-type: application/json' -d '{"vocabulary":[{"type":"compliance_audit","label":"Compliance audit","shortLabel":"Compliance","weight":0.9,"why":"A framework deadline forces work.","patterns":["\\bsoc 2\\b"],"serviceKeywords":["assurance"]}]}'
```

The editor on `/profile` uses these two endpoints; changes take effect on the next ingestion run,
with no restart.

### Scoring

An account's 0–100 score combines each signal's weight, its observed strength and a recency
delay (its influence halves every `halfLifeDays`, per niche). Independent signals combine as
`1 − Π(1 − p)`, so several moderate signals outrank a single weak one. Market fit then adds up to
`fitPoints` (25 by default): industry, size, region and whether the signal's service keywords
match a service you actually sell.

Accounts are gated `in` / `borderline` / `out`. `out` means excluded outright, or an industry you
do not serve **and** a size you cannot — those stay visible in a collapsed panel on `/signals`
rather than disappearing, and every ranking carries its `reasons` and `penalties`.

Signals come from the **ingestion path** below; the sample market is only a starting point, and
`npm run dev` works with no sources configured.

## Running it

```bash
npm install
npm run db:start   # the local Postgres this checkout expects (data/pg5433, port 5433)
npm run dev        # http://localhost:3000
```

`npm run db:start` needs the host's own Postgres binaries (`brew install postgresql@16`, or your
distro's package); `npm run db:stop` and `npm run db:status` are the other two, and creating the
cluster the first time is part of `start`. Point `DATABASE_URL` at any other Postgres and the script
is irrelevant — nothing in the app knows which one it is talking to.

Storage is Postgres (`DATABASE_URL`); the schema is applied automatically on first use, and the
sample market is seeded per tenant, so a fresh database needs no manual setup. To reset one tenant's
workspace, `POST /api/reset` — it keeps that tenant's niche and re-seeds the market. `GET /api/health`
answers 503 rather than 200 when the database is unreachable, which is the difference between "the
host is down" and "the app is broken" when something stops working.

### Who a request belongs to

One function decides it ([src/lib/tenant.ts](src/lib/tenant.ts), `resolveTenantDecision`), in this
order:

- **`SINGLE_TENANT_SLUG=acme`** — this deployment serves that one workspace, in any environment,
  with sign-in unused. It is the first thing checked and it outranks a session, which is what makes
  `npm run build && npm start` possible for a single customer or your own install.
- **a session signed in through an organization** — that company's workspace. This outranks
  the personal one: sign in with your work account and you see the firm's accounts, drafts and
  sends, because the workspace belongs to the org (`tenants.clerk_org_id`), not to you.
- **a session resolved** — that user's personal workspace, through `members`. This is the
  multi-tenant case, and it is what a deployment does once `CLERK_SECRET_KEY` and
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` are set.
- **keys set, but no session on this request** — refused, in every environment. Falling back would
  serve one workspace to everyone while the operator believes sign-in is enforced. A signed-out
  visitor is sent to `/sign-in` by the proxy; an API caller gets a 401.
- **neither set, in production** — refused: data requests fail with a message naming both ways out,
  rather than quietly handing one workspace to every visitor.
- **neither set, in development** — the seeded `DEV_TENANT_SLUG` workspace (default `dev`), so the
  app runs with no configuration at all.

### Multi-tenancy

One deployment serves many consultancies. The identity provider is Clerk, and the mapping between a
person and a workspace is one row in `members`:

- A signed-in request is resolved to a tenant id by [src/lib/tenant.ts](src/lib/tenant.ts)
  (`currentTenantId`) — the only place that decides it.
- A user who has no `members` row yet gets a workspace created on their first request, named from
  their profile and seeded with the sample market, so the app is never empty on arrival.
- Everything downstream takes that tenant id as a required argument
  ([src/lib/db.ts](src/lib/db.ts)), so no route, query or filter can reach another customer's rows
  by omission. Two signed-in users see two different workspaces out of one database.
- `src/proxy.ts` is Clerk's middleware plus a sign-in gate: a signed-out visitor is redirected to
  `/sign-in` rather than shown a page that cannot load, and a signed-out API call gets a 401 rather
  than a 500. It is not the authorization layer — the tenant id is.
- The scheduler runs every workspace: `POST /api/cron` with `CRON_SECRET` and no `tenantId` walks
  all tenants and reports per-tenant failures, so one customer's broken webhook cannot stop
  another's digest.

### Signing in with Google, or with a company account

Both are the same Clerk session; what differs is whether the session carries an organization.

- **Google** is a social connection configured in the Clerk dashboard, not in this code: enable
  Google under *User & authentication → Social connections* and paste an OAuth client from Google
  Cloud Console. `Continue with Google` then appears on `/sign-in` and `/sign-up`. Nothing here has
  to change, and a Google sign-in lands in a personal workspace.
- **A company account** is an organization. Any signed-in person can create one from the workspace
  switcher in the sidebar (`OrganizationSwitcher`, [src/components/Nav.tsx](src/components/Nav.tsx));
  an admin can also connect the company's own identity provider (SAML/OIDC) to that organization in
  the Clerk dashboard, which is what makes *Continue with your company account* appear — that
  connection is an Enterprise SSO feature and is configured per organization in Clerk, not here.
- Signing in through an organization resolves to that organization's workspace
  (`ensureOrganizationTenant` in [src/lib/tenant.ts](src/lib/tenant.ts)), and every colleague who
  signs in through the same org lands there: same accounts, same briefs, same drafts. The
  organization is keyed by `tenants.clerk_org_id`, so renaming it changes nothing. The org admin is
  stored as the workspace `owner`, everyone else as a `member`.
- Signing in *without* an active organization still reaches a personal workspace, which is why the
  switcher shows both. Nothing is copied between them: a person who starts solo and later joins a
  company workspace keeps their own workspace intact.

Two limits worth knowing: an organization must exist before a person can sign in through it, and
its SSO connection is a paid Clerk feature, so the “company account” path is per-customer setup
rather than something the first sign-in can create on its own.

`GET /api/health` reports which of these a deployment is doing: `workspace.mode` is `multi` when each
user gets their own workspace, `single` when `SINGLE_TENANT_SLUG` names one, and `refuse` when the
instance is misconfigured (in which case it also carries the reason).

### Deploying this app

A production deployment needs a database, an answer to "who is this user?", and the two destructive
endpoints closed. There are two supported shapes, and the second exists so a single-customer install
never has to stand up an identity provider:

1. **A Postgres database** — any Postgres works. Create it, then set `DATABASE_URL` on the host. The
   schema is applied on the first request (migrations are serialised with an advisory lock, so two
   instances starting together cannot double-apply), and a workspace is seeded on first use, so
   there is no separate migrate step to run before the app will answer.
2. **Identify users — pick one.**
   - **Multi-tenant (recommended):** set `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
     Each signed-in user gets their own workspace. Add the deployment's domain to the instance's
     allowed origins (and `http://localhost:3403` for local work) in the Clerk dashboard.
   - **Single workspace:** set `SINGLE_TENANT_SLUG=acme`. Every request is served that one
     workspace, sign-in is not used at all, and the server logs once that there is no per-user
     isolation. Without either, a production instance refuses every data request on purpose, and
     `/api/health` says which variable is missing.
3. **`RESET_SECRET` and `INGEST_SECRET`** — these open the two endpoints a stranger must not be
   able to reach ([src/lib/guards.ts](src/lib/guards.ts)): unauthenticated `POST /api/reset` wipes
   the workspace, and a pushed `candidates` body injects unverified items into the feed. Both are
   **closed by default, in every environment** — an unset variable means a 503 that names the
   variable, not an open endpoint. Neither is called by the UI, so setting them costs nothing. A
   local demo that wants no secrets sets `ALLOW_UNGUARDED_DEMO=1`, which is ignored in production;
   `/api/health` reports each endpoint as `secret`, `closed` or `open`.
4. **`CRON_SECRET`** — required only if you use the scheduler. `POST /api/cron` accepts the secret as
   `x-cron-secret` or `Authorization: Bearer …`, and the Bearer form is what Vercel Cron sends, so
   [vercel.json](vercel.json) needs no other wiring. The endpoint decides for itself what is due
   (`/integrations` sets the cadence and thresholds). On a single-workspace deployment it runs that
   workspace; a scheduler covering many tenants would call it once per tenant with `?tenantId=`.
5. **Optional adapters** — `OPENLLM_API_KEY`/`OPENAI_API_KEY` for model-written copy,
   `EMAIL_PROVIDER`+`EMAIL_API_KEY` to send, `WEBZ_API_TOKEN` or `INGEST_HTTP_SOURCES` for live
   signals, `HUBSPOT_ACCESS_TOKEN` to write to a CRM. Each is independent, and `/api/health`
   reports which ones this instance actually has.

`GET /api/health` is the deployment's own answer to "is this instance ready?": 200 when the database
answers and a workspace can be resolved, 503 when either fails, with the adapter and guard state
attached. Point the host's health check at it.

Notes for a serverless host (Vercel, and anything else that runs functions rather than a server):

- **Use a pooled connection string** (a Neon/Supabase-style `-pooler` host). A function instance
  that holds its own Postgres connection multiplies, which is what "too many clients already" means
  in production. `DATABASE_POOL_MAX` is capped at one automatically when `VERCEL` is set, and
  overrides it anywhere else ([src/lib/pg/pool.ts](src/lib/pg/pool.ts)).
- **Serverless does not need `vercel.json` to build**, but it does for the cron entry above. If your
  plan cannot run an hourly job, run the same endpoint from system cron or a GitHub Actions
  schedule instead — the schedule lives in the endpoint, not in the caller.
- **The scheduler is the only thing that runs on its own.** A deployment with no source configured
  pulls nothing rather than inventing data, so an empty feed means "no source", not "no signals".
- **`next start` works for a normal Node host** (Render, Fly, Railway, a VPS): `npm run build &&
  npm start`. There the pool default applies and the app is a long-lived server, which is what the
  in-process migrations and scheduler were designed for.

### Checks

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # node:test, no build step, no framework
npm run check      # all three
```

The tests run the TypeScript sources directly through Node's type stripping
(`tests/register-hooks.mjs` teaches its resolver the extensionless imports the bundler allows), so
they cover the files that ship rather than a build of them. They pin the parts that are easy to
break by accident: that a rule only reads the channels it declares, that a rule stored before
channels existed inherits the preset routing while one cleared on purpose does not, that every
preset rule declares a channel, and that several REST endpoints can be configured at once — one
feeding each channel, fetched against a stub HTTP server.

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

| Source | Env | Channel | Pulls |
| --- | --- | --- | --- |
| Webz.io News Search | `WEBZ_API_TOKEN` (+ `WEBZ_QUERIES`) | `news` | Press coverage for funding rounds, leadership changes and platform moves, attributed to a named company. Queries come from the niche config unless `WEBZ_QUERIES` overrides them |
| Generic REST sources | `INGEST_HTTP_SOURCES` — a JSON array of endpoints (or the original single-endpoint `INGEST_HTTP_URL` + `INGEST_HTTP_TOKEN`, `INGEST_HTTP_CHANNEL`, `INGEST_HTTP_FIELD_MAP`, `INGEST_HTTP_ITEMS_PATH`) | Per endpoint: `channel`, default `job_board` | Any JSON API you have credentials for: job boards, ATS feeds, tender portals, people data. As many as you like, one channel each, all feeding the same run |
| Push API | `INGEST_SECRET` (required, or the endpoint refuses pushes) | Per candidate, or all | Nothing — a scraper, spreadsheet script or Make/Zapier scenario posts candidates in |
| Bundled sample feed | — | All | Fixtures used by a dry run so the whole pipeline is exercisable offline |

### Evidence channels

A pattern is only as good as the evidence it is run against. "A public tender is an explicit
statement of need" is true of a procurement portal and false of a press release; "hiring three data
engineers" is evidence of a data team being built and is invisible in news. So every rule declares
the **channels** it reads, every source declares the channel it feeds, and ingestion only runs a
rule against evidence from a channel it reads
([src/lib/channels.ts](src/lib/channels.ts)).

The five channels are `tender`, `job_board`, `news`, `people` and `funding`. The presets wire them
per rule, and they say something about each signal that a keyword list cannot: `public_rfp` reads
tenders only, `*_hiring_no_leadership` reads job boards only, `*_leader_hired` reads news and people
data, and `funding_ma` reads news and funding data. The technology rules are per market: the DevOps
rule names Kubernetes and Terraform, which job adverts carry as readily as announcements, so it
reads news and job boards, while the Data & AI platform-migration rule and the DevOps cloud-cost
rule read news only. Rules are editable per rule on `/profile`, and the niche explorer shows the
whole routing before anyone adopts a market.

A rule with **no channel declared reads every channel** — the tolerant default, so a rule someone
wrote by hand, or one stored before the column existed, stays in the pipeline rather than silently
never matching. It is also how a tender phrase ends up matching a press release, so the presets
always declare one.

An empty list has two possible meanings, and the app keeps them apart. A rule whose channels were
**inherited** reads what the presets declare for its rule key: that is how every rule stored before
the channel column existed got routed, without anyone editing it, and the profile shows those rules
as `preset default`. Toggling a channel on such a rule makes the choice the customer's, after which
an empty list means what it says. Rules still reading everything are listed under `unconstrained` on
`GET /api/ingest` and called out on `/integrations`, next to the channels no source feeds (`uncovered`)
— one means a rule cannot fire, the other means it fires on the wrong evidence.

Two things make the routing visible instead of mysterious. A run reports `offChannel` separately
from `unclassified`: an item that matched a rule which does not read its channel is listed with the
rule it almost became (`matches "Public RFP", which reads tenders & procurement — this item arrived
on news`), because "nothing we track" and "we track this, but not from here" need different fixes.
And `GET /api/ingest` returns `uncovered` — the channels the tenant's rules read that no configured
source feeds, surfaced on `/integrations` — since a tender rule with only a news source configured
can be flawless and still never fire.

Pushed candidates may declare their own channel, which is what lets a scraper say what it scraped:

```bash
curl -X POST http://localhost:3000/api/ingest -H 'content-type: application/json' \
  -d '{"candidates":[{"companyName":"Civic Water Authority","channel":"tender",\
       "text":"Civic Water Authority issues a public tender for a cloud data warehouse"}]}'
```

Omitting `channel` leaves the item readable by every rule — the caller is asserting relevance, and
routing an undeclared item away from every rule would discard it silently.

```bash
curl -X POST http://localhost:3000/api/ingest                    # pull every configured source
curl -X POST 'http://localhost:3000/api/ingest?dry=1'            # fetch + classify, write nothing
curl -X POST 'http://localhost:3000/api/ingest?source=webz'      # one source
curl -X POST http://localhost:3000/api/ingest -H 'content-type: application/json' \
  -d '{"candidates":[{"companyName":"Acme Freight","text":"Acme Freight raises a $42M Series C","url":"https://example.com/a","sector":"Logistics"}]}'
```

Each candidate is first checked against the niche's **negative rules** (vendor marketing, awards,
promotional filler) and counted as `suppressed` if it trips one. What survives is **classified** to
one of the tenant's signal types — by the LLM when a key is set, otherwise by a deterministic rule
engine that compiles the vocabulary's own regex patterns
([src/lib/classify.ts](src/lib/classify.ts)). It is
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

Four of the five targets are inbound webhooks, so one dispatcher covers them — only the payload
shape differs. HubSpot is the exception: it is an API the app drives (see below).

| Target | Payload | How to get the URL |
| --- | --- | --- |
| Slack | Incoming webhook, `text` + Block Kit | Apps → Incoming Webhooks → add to a channel |
| Microsoft Teams | Workflows webhook, message envelope + Adaptive Card | Workflows → *When a Teams webhook request is received* |
| Make | Arbitrary JSON | Scenario → *Custom webhook* module |
| Zapier | Arbitrary JSON | Zap → *Webhooks by Zapier* → *Catch Hook* |
| HubSpot | Not a webhook — records via the CRM API | Private-app token in `HUBSPOT_ACCESS_TOKEN` |

Events: `digest` (scheduled signal summary), `account_card` (one account, when it first qualifies)
and `send_log` (when an outreach email is sent). Each destination ticks the events it wants, so
Slack can get alerts while a CRM gets everything. Teams uses the Workflows trigger because the
legacy Office 365 connector webhooks were retired in May 2026. Payload builders live in
[src/lib/integrations.ts](src/lib/integrations.ts).

### HubSpot

A CRM does not want a payload to map by hand; it wants a company, a deal and the evidence. So
HubSpot gets its own adapter ([src/lib/hubspot.ts](src/lib/hubspot.ts)) that calls the CRM API,
and the event decides what is written:

| Event | What lands in HubSpot |
| --- | --- |
| `account_card` (strong signal) | Company upsert, a deal in the pipeline/stage you chose, a note with the evidence, both associations |
| `digest` | Company upsert only — eight deals every Monday would be vandalism |
| `send_log` | A note on the company recording that outreach went out |

Companies are matched on their **domain** (HubSpot's `idProperty: "domain"` upsert), so re-syncing
updates the record instead of duplicating it, and an account with no domain is skipped and reported
rather than created unnamed. Deals need the internal pipeline and stage ids, which is why the card
lists them from `GET /api/integrations/hubspot/pipelines` — a read-only call whose answer is also
the connection check. Rate limits are retried (`Retry-After` when present, otherwise exponential
backoff with jitter) and each account is synced in sequence, one result per account, so a partial
write is visible instead of summarised away.

`HUBSPOT_ACCESS_TOKEN` is a deployment credential (a private-app token), not per-workspace state;
what each workspace chooses — pipeline, stage, whether to open deals at all — lives on its
integration row. Without a token, or with `HUBSPOT_DRY_RUN=1`, every run reports the plan it would
have sent and writes nothing, so the whole path is exercisable offline.

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
is worth keeping. The table lists every signal in the tenant's vocabulary, including one added by
hand, plus any signal still stored from an earlier vocabulary (shown under a neutral label rather
than dropped). An account counts as contacted if you sent to it or logged an outcome for it.
Computed in [src/lib/stats.ts](src/lib/stats.ts); exposed at `/api/stats` and `/api/outcomes`.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS 4
- Postgres through `pg` — any provider; the schema is applied automatically, every table is
  tenant-scoped, and the signal vocabulary is per-tenant rows rather than a fixed union
- OpenAI-compatible LLM adapter with template fallback

The report proposes PostgreSQL, a Python/FastAPI backend and Stripe for production; those
slots are isolated behind the data layer ([src/lib/db.ts](src/lib/db.ts)) and the generation
layer ([src/lib/generate.ts](src/lib/generate.ts)) so they can be swapped without touching the UI.

## Data, compliance and ethics

Account data here is **fictional sample data**. The product is built on company-level public
signals and licensed person-level data. LinkedIn scraping, scanning company systems, and
outreach triggered by data breaches are explicitly out of scope (see the report), as is
sending email on the customer's behalf.
