import { Card, PageHeader } from "@/components/ui";

// Terms of service, drafted for a Swedish B2B SaaS selling to businesses.
//
// The commercial shape is the one this codebase actually implements: one workspace
// per customer, sign-in or a named single workspace, drafts that a human approves
// before anything is sent, per-workspace model usage with a daily ceiling, and no
// sending at all unless the customer configures an email provider. Terms that
// promise more than the product does are the ones that become a liability.
//
// Draft for review. Swedish governing law, consumer law deliberately out of scope
// (the product is sold to businesses), and the liability cap is a placeholder.

export const metadata = {
  title: "Terms of service (draft) — EngineX AI",
  description: "Draft subscription terms for EngineX AI, a B2B signal and outreach product.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Terms of service"
        subtitle="Draft subscription terms for business customers. Not yet reviewed by a lawyer."
      />

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
        <p className="font-semibold">This is a draft, not an offer.</p>
        <p className="mt-1">
          Fill in every <span className="font-mono">[BRACKETED]</span> value and have a Swedish
          commercial lawyer review the liability, termination and data-protection clauses before these
          terms are used with a customer. The privacy policy is a separate document.
        </p>
      </div>

      <Section title="1. Who this is between">
        <p>
          These terms are between <span className="font-mono">[COMPANY LEGAL NAME]</span>, org.nr{" "}
          <span className="font-mono">[ORG.NR]</span>, Sweden (&ldquo;we&rdquo;), and the business
          that subscribes to EngineX AI (&ldquo;you&rdquo;). They apply to the exclusion of any terms
          you send us. The product is sold to businesses and organisations only; nothing here is
          intended for a consumer, and the Swedish Consumer Sales Act does not apply.
        </p>
      </Section>

      <Section title="2. What the service is">
        <p>
          EngineX AI reads company-level buying signals from the sources you configure, ranks the
          companies that show them, and produces a research brief plus drafted outreach for each
          account you approve. You review every draft; <strong>nothing is sent on your behalf</strong>{" "}
          unless you configure an email provider and press send. Drafts are generated with the help of
          a language model and may be wrong — the human review step is part of the product, not an
          optional extra.
        </p>
        <p>
          The service changes: we improve it, and we may add, change or retire features. A change that
          materially reduces what you paid for is announced before it takes effect.
        </p>
      </Section>

      <Section title="3. Workspaces, seats and sign-in">
        <p>
          Each subscription covers one workspace. If sign-in is enabled, every person you invite works
          inside that workspace and sees its accounts, briefs and drafts; you are responsible for who
          you invite and for removing people who leave. On a single-workspace deployment without
          sign-in, anyone who can reach the URL can use the workspace — that configuration is intended
          for one customer and you accept the risk of it.
        </p>
      </Section>

      <Section title="4. Your responsibilities">
        <p>
          You are the controller of the personal data in your workspace and you decide who to contact.
          That means you are responsible for having a lawful basis for your outreach, for honouring
          objections and opt-outs, for the accuracy of anything you import, and for complying with the
          marketing rules that apply where your recipients are (including GDPR, PECR, and local
          e-marketing law). We supply the tooling; we do not supply your legal basis.
        </p>
        <p>
          You must not use the service to scrape LinkedIn, to contact people who have asked you not to,
          to send unlawful or misleading messages, to resell access, or to attempt to reach another
          customer&apos;s workspace. We may suspend a workspace that is being used that way, and will
          tell you why.
        </p>
      </Section>

      <Section title="5. AI usage and limits">
        <p>
          Model usage is metered per workspace and shown in the app, with a daily spend ceiling that
          pauses model-written copy until the next day; when the ceiling is reached the product falls
          back to its template engine rather than failing. Plan-level allowances are listed in{" "}
          <span className="font-mono">[PLAN TABLE / ORDER FORM]</span>. You may raise a ceiling on
          request; sustained use beyond your plan may require a different plan.
        </p>
      </Section>

      <Section title="6. Fees, term and taxes">
        <p>
          Subscriptions are billed <span className="font-mono">[MONTHLY/ANNUALLY]</span> in advance and
          renew automatically until cancelled. Prices exclude VAT. Where Swedish VAT applies it is
          added; for a business customer in another EU country the reverse-charge mechanism applies and
          you must supply a valid VAT number. Invoices are due{" "}
          <span className="font-mono">[30]</span> days from the invoice date; overdue amounts may bear
          interest under the Swedish Interest Act and the workspace may be suspended after notice.
        </p>
        <p>
          The <span className="font-mono">[14]</span>-day trial needs no payment details. Either party
          may terminate with <span className="font-mono">[30]</span> days&apos; notice to the end of a
          billing period. Prepaid fees are not refunded for a part month, except where we end the
          agreement without cause.
        </p>
      </Section>

      <Section title="7. Data protection">
        <p>
          Our processing of personal data is described in the privacy policy. Where we process personal
          data on your instructions — the target contacts in your workspace — we act as your processor
          and the data processing agreement at{" "}
          <span className="font-mono">[DPA LINK]</span> applies. We will tell you before adding a new
          subprocessor that handles your data.
        </p>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          We own the software, the presets and the documentation. You own your workspace content:
          accounts you import or approve, notes, briefs, drafts and outcomes. You grant us the licence
          needed to host and process that content in order to run the service, and nothing wider. We do
          not use your workspace content to train models.
        </p>
      </Section>

      <Section title="9. Availability and support">
        <p>
          We aim for the service to be available continuously but do not promise an uptime figure in
          this draft; if an SLA is agreed it belongs in{" "}
          <span className="font-mono">[ORDER FORM / SLA]</span>. Planned maintenance is announced in
          the app. Support is by email at <span className="font-mono">[SUPPORT EMAIL]</span> on
          business days.
        </p>
      </Section>

      <Section title="10. Liability">
        <p>
          Nothing in these terms limits liability for wilful misconduct, gross negligence, death or
          personal injury, or anything else that cannot be limited by law. Subject to that, our total
          liability in any twelve-month period is limited to{" "}
          <span className="font-mono">[THE FEES PAID IN THE TWELVE MONTHS BEFORE THE CLAIM]</span>, and
          neither party is liable for indirect or consequential loss, lost profit or lost business.
        </p>
        <p>
          We are not responsible for the accuracy of data supplied by third parties or for a decision
          you take on the basis of a draft you did not review.
        </p>
      </Section>

      <Section title="11. Ending the agreement">
        <p>
          On termination your workspace becomes read-only for{" "}
          <span className="font-mono">[30]</span> days so you can export what you need, and is then
          deleted, including from backups on their normal rotation. We may terminate immediately for
          non-payment after notice, or for a breach of section 4 that we cannot resolve with you.
        </p>
      </Section>

      <Section title="12. Changes, law and contact">
        <p>
          We may update these terms; a material change is emailed to workspace owners at least{" "}
          <span className="font-mono">[30]</span> days before it applies, and continuing to use the
          service after that accepts it. These terms are governed by Swedish law, and the courts of
          Sweden have exclusive jurisdiction, with <span className="font-mono">[STOCKHOLM]</span>{" "}
          district court as the first instance. Questions:{" "}
          <span className="font-mono">[CONTRACT EMAIL]</span>.
        </p>
      </Section>

      <Card className="mt-8 p-4 text-[13px] leading-relaxed text-slate-600">
        <p className="font-medium text-slate-800">Before publishing</p>
        <p className="mt-1">
          The liability cap, the termination and refund position, and the processor/DPA wording are the
          three clauses most likely to matter in a dispute. Decide the plan allowances and the SLA
          before promising them, and keep section 2 honest: the product does not send anything without
          a human, and the terms should say exactly that.
        </p>
      </Card>
    </div>
  );
}
