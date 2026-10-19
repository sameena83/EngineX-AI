# EngineX AI — architecture and flow

How a request gets from a browser to a row in Postgres and back, where each decision is made,
and what blocks a deployment before it can be used. Every claim here is grounded in the files
linked; the [README](../README.md) covers configuration and features, this document covers
structure.

## 1. Shape of a deployment

One Next.js application, one Postgres database, one row per customer workspace.

```
 Browser
   │  HTML / fetch
   ▼
 src/proxy.ts ──── Clerk session ──── session gate (src/lib/session-gate.ts)
   │                                     │ no session → /sign-in or 401
   ▼
 app/*/page.tsx (server or client) ──► /api/* route handlers
                                          │
                                          │ currentTenantId()        ← src/lib/tenant.ts
                                          │   → identity (Clerk)     ← src/lib/clerk-session.ts
                                          │   → tenants / members
                                          ▼
                                    src/lib/db.ts               ← every query, tenant-scoped
                                          │
                                          ▼
                                    src/lib/pg/pool.ts          ← the only Postgres seam
                                          │
                                          ▼
                                       Postgres
```

There is exactly one storage seam (`getPool()`), one tenant resolver (`currentTenantId()`), and
one module that owns SQL (`src/lib/db.ts`). Everything above them is pure logic that takes data
as arguments — which is why the scoring, the classifier, the gate and the tenant rule can all be
unit-tested without a database or a browser.

| Layer | Files | Responsibility |
| --- | --- | --- |
| UI | `src/app/**/page.tsx`, `src/components/*` | Render only; all data arrives over `/api/*` |
| Request boundary | `src/proxy.ts`, `src/lib/session-gate.ts` | Resolve the session, send visitors to sign-in, answer API callers 401 |
| API | `src/app/api/**/route.ts` | Validate input, resolve the tenant, call domain code, shape JSON |
| Domain | `src/lib/{signals,match,generate,agent,ingest,analytics,stats,integrations,hubspot}.ts` | Scoring, classification, briefs, drafts, delivery |
| Data | `src/lib/db.ts`, `src/lib/pg/pool.ts`, `src/lib/pg/migrations.ts` | Tenant-scoped SQL, schema, pool |
| Identity | `src/lib/tenant.ts`, `src/lib/clerk-session.ts`, `src/lib/identity.ts` | Who is asking, and which workspace they get |

## 2. Flow: from a first visit to a workspace

### 2.1 Signed out

1. `src/proxy.ts` runs on every route except Next internals, Clerk's own routes and static files.
   With no Clerk keys it steps aside entirely, which is what keeps `npm test` and a bare
   development install working.
2. With keys, `clerkMiddleware` resolves the session and hands the path to `resolveSessionGate`.
3. A signed-out page request is redirected to `/sign-in?redirect_url=<path>`; a signed-out
   `/api/*` call gets `401 {"error":"Sign in required"}` rather than HTML. `/api/health`,
   `/api/cron`, `/api/ingest`, `/sign-in` and `/sign-up` stay reachable because each carries its
   own credential.
4. `/sign-in` renders Clerk's `<SignIn/>`; `/sign-up` the same. Only a same-site `redirect_url` is
   honoured, so the parameter cannot bounce a user off-site.

The gate is deliberately *not* the authorization layer — it decides whether a request is worth
handling, not what it may see. That is the tenant id (section 3).

### 2.2 Signing in

| Method | Where it is configured | Which workspace it lands in |
| --- | --- | --- |
| Email / password | Clerk dashboard | Personal workspace (or the active org, if one is selected) |
| Google | Clerk dashboard → Social connections (needs a Google OAuth client) | Same as above |
| Company SSO (SAML / OIDC) | Clerk dashboard, on the organization | That organization's workspace |

`Continue with Google` and a company sign-in are not code paths here: the buttons appear because
the connection exists in Clerk. What the code decides is what a session *maps to*:

1. `src/lib/clerk-session.ts` reads `auth()` once per request, returning the user id, email, name
   and — when the session has one — `orgId`, `orgSlug`, `orgName`, `orgRole`. The profile lookup
   is cached per process so a Clerk outage cannot become one API call per request.
2. `resolveTenantDecision` in `src/lib/tenant.ts` is a pure function of that shape and is the only
   place the question is answered:

   ```
   SINGLE_TENANT_SLUG set ──────────────► that workspace   (sign-in unused by design)
   session with an organization ───────► the org's workspace
   session without one ────────────────► the person's own workspace
   keys set, no session ───────────────► refuse (401)
   no keys, production ────────────────► refuse (500, names both ways out)
   no keys, development ───────────────► the seeded `dev` workspace
   ```
3. An organization resolves through `tenants.clerk_org_id` (`ensureOrganizationTenant`): the first
   colleague to sign in creates the workspace (slug derived from the org id, so it cannot collide
   with a personal one), claims it with a compare-and-set `UPDATE`, and is recorded as `owner`;
   everyone after them is added as `member`. Two requests racing on a first sign-in are decided by
   the unique partial index, and the loser reads the winner's row.
4. A person with no organization resolves through `members` (`ensureUserTenant`): their existing
   row if there is one, otherwise a new workspace seeded with the sample market. A first sign-in
   is never an empty screen.
5. The UI exposes the same switch: `OrganizationSwitcher` in `src/components/Nav.tsx` moves a
   session between a personal workspace and a company one. Nothing is copied between them.

Verified against a real database: two identities in one org share a workspace (`admin` → `owner`,
`member` → `member`), a second org gets a separate workspace, and deleting the rows removes the
seeded sample market with them (cascade).

## 3. Flow: how a request is scoped

Every route handler begins with `const tenantId = await currentTenantId()` and passes it as the
first argument to every `db.ts` call. That is the whole isolation model:

- A route cannot forget to scope — the function signature requires the id.
- A client-supplied id in a URL (`/api/accounts/15`) is looked up *within* the tenant, so another
  customer's id resolves to `null` and the route answers 404. There is no global lookup by id.
- The scheduler is the single exception: `POST /api/cron` with `CRON_SECRET` and no `tenantId`
  walks `listTenants()` and runs each workspace separately, reporting per-tenant failures so one
  broken webhook cannot stop another customer's digest.

`GET /api/health` reports which mode a deployment is in (`multi`, `single`, `refuse`) and whether
the destructive endpoints are closed, so a misconfiguration is visible from outside without
exposing a secret.

## 4. Flow: signal to send

### 4.1 Ingest and score

```
pull sources (src/lib/sources.ts) ─┐
push  /api/ingest (INGEST_SECRET)  ─┼─► candidates
sample seed (src/lib/seed-data.ts) ┘        │
                                            ▼
                  classify.ts ── per-tenant vocabulary (signal_definitions)
                                            │  unknown/unmatched items dropped
                                            ▼
                  accounts + signals rows (tenant-scoped, evidence retained)
                                            │
                                            ▼
                  signals.ts / match.ts ── weight × strength × recency, then fit
                                            │  reasons + penalties, gate in/borderline/out
                                            ▼
                                         /signals
```

Scoring is one pure function of `(account, signals, vocabulary, profile)`: independent signals
combine as `1 − Π(1 − p)`, recency halves every `halfLifeDays`, and market fit adds up to
`fitPoints`. `out` accounts are not deleted — they stay in a collapsed panel with the reason,
because hiding a rejection without explaining it makes the ranking feel arbitrary.

The vocabulary is data, not an enum: a tenant can define a signal key this build has never heard
of, and the classifier, the chips, the scorer and the performance table all read the same rows.

### 4.2 Research, draft, send

```
/accounts/[id]  ──► POST /api/accounts/[id]/brief ──► generateBrief()
                       │  LLM when configured, templates otherwise
                       ▼
                    brief (why now, likely pain, case-study angle, buyer roles)
                       │
                       ▼
                    POST /api/accounts/[id]/drafts ──► generateDrafts()
                       │  email + LinkedIn message + warm-intro suggestion
                       ▼
                    POST /api/drafts/[id]/review ───► agent.ts (optional AI review)
                       │
                       ▼
                    PATCH /api/drafts/[id]  (approve / dismiss)
                       │
                       ▼
                    POST /api/drafts/[id]/send ──► email.ts (provider or dry-run)
                       │
                       ▼
                    sends row ──► dispatch("send_log") ──► CRM / webhook
                       │
                       ▼
                    /accounts/[id] outcome ──► /analytics, signal performance
```

Two deliberate boundaries:

- **Generation degrades, it does not fail.** With no `OPENLLM_API_KEY`/`OPENAI_API_KEY`,
  `generate.ts` falls back to the template engine — the dashboard names the provider it is using.
- **Sending is opt-in.** With no provider key, `email.ts` runs in dry-run mode: the send is
  recorded, the event is dispatched, and nothing leaves the building. Deliverability stays with a
  specialised sequencer; this app produces research and drafts.

## 5. Flow: scheduled delivery

`POST /api/cron` is one endpoint with three entry shapes — the signed-in user's own workspace (the
"Run now" button), one named workspace, or every workspace when `CRON_SECRET` is presented. Each
run pulls new signals first (when a source is configured), then sends what is due: a digest at the
profile's cadence, and one strong-signal card per account crossing the alert threshold, sent once
per account so a channel is not spammed. `account_card`, `digest` and `send_log` are the three
events `src/lib/integrations.ts` can deliver to a webhook, an API transport or HubSpot, each with a
dry preview on `/integrations` before it is switched on.

## 6. Blocks, and what to do about them

| Block | Symptom | Mitigation | State |
| --- | --- | --- | --- |
| No Clerk keys | Every page works in development, production refuses with 500 and `/api/health` says `refuse` | Set `CLERK_SECRET_KEY` + `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, or name one workspace with `SINGLE_TENANT_SLUG` | Covered by design and tested |
| Google button missing | `/sign-in` shows only email | Enable Google in the Clerk dashboard with a Google Cloud OAuth client; no code change | Dashboard step |
| "Company account" missing | No SSO option on sign-in | Enterprise SSO is per-organization and a paid Clerk feature; create the org, connect the IdP, then sign in | Dashboard step, per customer |
| An org is created after people already signed in personally | Two workspaces for one firm | They switch to the company workspace with the sidebar switcher; nothing is merged, so a migration would be a deliberate move of accounts | Known, by design |
| Serverless + Postgres | "too many clients already" under load | `src/lib/pg/pool.ts` drops to one connection when `VERCEL` is set; use a pooled connection string; `DATABASE_POOL_MAX` overrides | Covered |
| Two instances start together | Schema applied twice | Migrations are serialised with an advisory lock | Covered |
| Anonymous caller triggers ingestion on a no-sign-in host | Provider credits burned by a stranger | Pulls carry no candidates and the UI needs them, so they stay reachable; a Clerk deployment puts them behind sign-in. Push — the part that writes evidence — is closed without `INGEST_SECRET` | Covered, with a known cost exposure for single-workspace hosts |
| No email provider | "Send" appears to succeed | It is a dry run and the UI says so; set a provider key to send for real | Covered |
| No LLM key | Briefs read generically | Template engine is the documented fallback; `/api/health` reports the provider | Covered |
| Open destructive endpoints on a public host | Anyone can wipe or poison a workspace | Closed by default in every environment: without `RESET_SECRET` / `INGEST_SECRET` the call is refused with a 503 that names the variable; `ALLOW_UNGUARDED_DEMO=1` reopens them for local work only, and `/api/health.access` reports `secret` / `closed` / `open` | Covered |
| A public host with `SINGLE_TENANT_SLUG` | Everyone who finds it shares one workspace | `tenantIsolation: false` in `/api/health`; use multi-tenant for anything public | Documented |
| `members.role` is stored but not enforced | Every member can act as an owner | Roles are recorded correctly (org admin → `owner`); enforcement is the next step and belongs next to the data, not in the proxy | **Open** |
| `tenants.plan` is stored but unread | No way to gate a tier or bill | Column exists with a default; a plan check belongs in the same resolver that answers "which workspace" | **Open** |
| Per-workspace export / erasure | Enterprise buyers ask early | Export exists (`/export`, `/api/export`); a workspace-level erasure path does not | **Open** |

## 7. What this shape buys, and what it costs

**Buys.** One deployment serves many consultancies with logical isolation that cannot be forgotten
in a query; identity is swappable behind `src/lib/identity.ts`; storage is swappable behind one
pool; scoring and classification are pure functions, so a market change is data and a new market is
a preset; every optional integration has a configured/unconfigured branch rather than a crash.

**Costs.** Isolation is logical, not physical — a bad query that omits `tenant_id` would leak, which
is why the id is a required argument rather than a filter each route adds. Everything runs in one
process, so a slow ingestion run competes with page renders. And a dedicated database per tenant is
not offered: `getPool()` resolves one connection string, and the per-tenant version of that is a
deliberate change (a `tenant_databases` mapping plus per-database migrations), not a switch.
