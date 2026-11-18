import { Card, PageHeader } from "@/components/ui";

// A draft, deliberately in the app rather than in a document nobody opens: a B2B
// product that processes business contact data needs this page to exist before the
// first customer's procurement review. The placeholders are marked so nobody
// publishes it with "[COMPANY LEGAL NAME]" still in the text.
//
// It is not legal advice and it is not a substitute for one: the lawful-basis
// reasoning, the transfer mechanism and the retention periods are the parts a
// Swedish lawyer should read before this is public. See the draft banner.

export const metadata = {
  title: "Privacy policy (draft) — EngineX AI",
  description: "How EngineX AI processes business contact data, and the rights attached to it.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2 last:border-0 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="text-[13px] font-medium text-slate-600">{term}</dt>
      <dd className="text-[13px] text-slate-700">{children}</dd>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Privacy policy"
        subtitle="How EngineX AI handles personal data. Draft for legal review — last edited when this page was written, not yet reviewed by a lawyer."
      />

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
        <p className="font-semibold">This is a draft, not a published policy.</p>
        <p className="mt-1">
          Every <span className="font-mono">[BRACKETED]</span> value must be filled in, and the
          lawful-basis and transfer sections should be checked by a Swedish data-protection lawyer
          before this page is linked from a live site. Nothing here is legal advice.
        </p>
      </div>

      <Section title="Who is responsible for your data">
        <p>
          <span className="font-mono">[COMPANY LEGAL NAME]</span>, registered in Sweden under
          organisation number <span className="font-mono">[ORG.NR]</span>, with its registered office
          at <span className="font-mono">[ADDRESS]</span>, is the controller of the personal data
          described below. Contact:{" "}
          <span className="font-mono">[PRIVACY EMAIL]</span>. A data protection officer has{" "}
          <span className="font-mono">[NOT / HAS]</span> been appointed.
        </p>
        <p>
          EngineX AI is a business-to-business product. We do not market to consumers, we do not buy
          consumer lists, and the personal data we hold is overwhelmingly the business contact data
          of people acting in a professional capacity.
        </p>
      </Section>

      <Section title="What we process, and why">
        <dl className="divide-y divide-slate-100">
          <Row term="Workspace and user data">
            Name, work email, organisation and role of the people who sign in, plus session and
            security logs. Purpose: to operate the account, keep workspaces separate, and secure the
            service. Basis: contract (Art. 6(1)(b)).
          </Row>
          <Row term="Business contact data">
            Name, job title, employer, work email and professional profile links for the people at
            target companies. Purpose: to produce the account briefs and outreach drafts the customer
            asked for. Basis: legitimate interests (Art. 6(1)(f)) — B2B prospecting by a business
            contact at another business — weighed against the individual&apos;s reasonable
            expectations, and subject to objection at any time.
          </Row>
          <Row term="Company and signal data">
            Company names, sectors, headcount, locations, tender notices, job adverts, press coverage
            and similar public or licensed company-level records. This is generally not personal
            data, but a named individual can appear in an article and is then treated as such.
          </Row>
          <Row term="Content you create">
            Accounts you approve, notes, briefs, drafts, outcomes and sent-message logs. Purpose: to
            provide the service. Basis: contract.
          </Row>
          <Row term="Usage and billing data">
            Feature usage, model token counts and estimated cost per workspace, plan and invoice
            records. Purpose: to meter the service and meet bookkeeping duties. Basis: contract, and
            legal obligation (Art. 6(1)(c)) for accounting records.
          </Row>
        </dl>
      </Section>

      <Section title="Where the data comes from">
        <p>
          Public sources (company websites, news and press releases, tender portals, job boards),
          licensed data providers, and the customer itself — including any candidates pushed into the
          app through its ingestion endpoint. We do not scrape LinkedIn, and we do not access the
          private systems of any company.
        </p>
      </Section>

      <Section title="Automated scoring, and what it does not do">
        <p>
          Accounts are ranked by a score built from signals, size, industry and region fit, and drafts
          are generated with the help of a language model. That ranking decides what the customer sees
          first; it does not make decisions with legal or similarly significant effects about any
          individual, and no message is sent without a human approving it.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          We use a small number of processors, each bound by a data processing agreement. The current
          list — keep it current, and tell customers before adding a new one:
        </p>
        <dl className="divide-y divide-slate-100">
          <Row term="Hosting and database">
            <span className="font-mono">[HOSTING PROVIDER]</span>, EU region. Stores the workspace
            data.
          </Row>
          <Row term="Authentication">
            <span className="font-mono">[CLERK / AUTH PROVIDER]</span>. Handles sign-in and
            organisation membership.
          </Row>
          <Row term="AI provider">
            <span className="font-mono">[LLM PROVIDER]</span>. Receives the account and contact
            details needed to write a brief or draft. Contracted on terms that do not permit training
            on our data.
          </Row>
          <Row term="Email delivery">
            <span className="font-mono">[EMAIL PROVIDER]</span>, only if the customer switches sending
            on. Otherwise messages stay simulated.
          </Row>
        </dl>
        <p>
          We do not sell personal data, and we do not share it with advertising networks.
        </p>
      </Section>

      <Section title="Transfers outside the EU/EEA">
        <p>
          Some providers are established in the United States. Where data leaves the EEA, the
          transfer relies on an adequacy decision (such as the EU–US Data Privacy Framework) or on
          the European Commission&apos;s Standard Contractual Clauses together with a transfer impact
          assessment. <span className="font-mono">[CONFIRM WHICH, PER PROVIDER]</span>
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Workspace content is kept while the subscription is active and for{" "}
          <span className="font-mono">[30]</span> days after termination, then deleted from backups on
          their normal rotation. Contact data for a target account is kept while the account is in the
          workspace. Accounting records are kept for seven years as Swedish bookkeeping law requires.
          Security logs are kept for <span className="font-mono">[90]</span> days.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask for access to your data, correction, deletion, restriction, portability, and you
          can object to processing based on legitimate interests — including objecting to being
          contacted at all, which we action by suppressing that contact across the workspace.
        </p>
        <p>
          Write to <span className="font-mono">[PRIVACY EMAIL]</span>. We answer within one month. If
          you are not satisfied, you can complain to the Swedish Authority for Privacy Protection
          (Integritetsskyddsmyndigheten, IMY), or to your local supervisory authority.
        </p>
      </Section>

      <Section title="When we act as a processor">
        <p>
          For the target companies and contacts that a customer imports or approves, the customer
          decides what is processed and why, and we process it on their instructions. In that role our
          obligations are set out in the data processing agreement, which forms part of the
          subscription terms. If you are a data subject of a customer&apos;s workspace, contact that
          company first.
        </p>
      </Section>

      <Section title="Cookies and local storage">
        <p>
          We set only what the service needs: a session cookie from the authentication provider, and
          local storage for interface preferences. There are no advertising or cross-site tracking
          cookies. <span className="font-mono">[ADD ANALYTICS HERE IF ONE IS EVER ADDED]</span>
        </p>
      </Section>

      <Section title="Security, and changes to this policy">
        <p>
          Data is encrypted in transit, workspaces are separated at the database level with a tenant
          identifier on every query, and access to production is limited. No service can promise
          perfect security; if a breach affects your data we notify you and IMY within 72 hours where
          the law requires it.
        </p>
        <p>
          We will post any change on this page and, for a material change, email workspace owners
          before it takes effect.
        </p>
      </Section>

      <Card className="mt-8 p-4 text-[13px] leading-relaxed text-slate-600">
        <p className="font-medium text-slate-800">Before publishing</p>
        <p className="mt-1">
          Fill every bracketed value, confirm each processor and its transfer mechanism, set the
          retention periods to what the system actually does, and have a Swedish lawyer read the
          legitimate-interests and processor sections. A policy that describes a product other than
          the one running is worse than no policy.
        </p>
      </Card>
    </div>
  );
}
