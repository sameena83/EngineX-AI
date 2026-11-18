# EngineX AI — pitch pack for a Qatar AI funding round

Written against the code in this repository as it stands today (no paying customers, sample
market seeded, no Arabic support yet). Every claim below is either something this app already
does or is labelled as a milestone.

---

## 1. The pitch in one sentence

> EngineX AI reads Qatar's public record — tenders, job adverts, leadership moves, funding — in
> **Arabic and English**, and hands a consultancy the five companies that need them *this week*,
> with the paragraph of evidence that proves it and an approach already drafted.

Ten-second stage version:

> "Qatar publishes everything. The tenders are public, the job adverts are public, the
> appointments get announced. Tonight someone at a Doha consultancy reads all of it by hand.
> We read it for them — in Arabic and English — and hand back the shortlist with the evidence
> attached."

## 2. Why this framing, and not "an AI sales tool"

A funding panel funds three things. Answer all three in the first ninety seconds:

| What they fund | Your answer |
| --- | --- |
| **A named buyer** | Boutique consultancies and system integrators selling into Qatar's digital build-out, plus the in-house business-development teams at larger firms. 10–200 people, no data team, no research function. |
| **A measurable outcome** | Meetings booked per 50 accounts — a number this app already computes per signal type. Promise a before/after, not "efficiency". |
| **A reason it has to be built here** | The evidence is in Arabic and in Qatari procurement. Global tools do not read it. That is the moat, and it is also the thing funding buys. |

**Do not lead with the model.** Lead with the Sunday night: a partner at a Doha firm with a
pipeline target and a government agenda moving faster than their research capacity. Model
novelty is the weakest thing you have; a working evidence trail is the strongest.

## 3. The wedge

Apollo, ZoomInfo, Clay and the rest sell **contact lists**. Their unit is a person's email
address, their coverage of the Gulf is thin, and none of them read Arabic-language tender
notices. Meanwhile a tender is the most explicit statement of need a company ever makes — it is
structured, public, dated, and it names the buyer.

So the product sells the **why now**, not the address book: ranked accounts, the evidence line,
the source link, and a draft written from the customer's own case studies. It sits on top of the
sequencer the customer already pays for rather than replacing it (this app deliberately does not
send email).

## 4. The deck — eight slides

Each row says what the panel is actually testing on that slide.

| # | Slide | What to put on it | What they are testing |
| --- | --- | --- | --- |
| 1 | **Title** | Name, one-liner from §1, your name, Doha date | Can you say what it is in one line? |
| 2 | **The problem** | The Sunday-night scene, one real tender notice screenshot, and the sentence "the buyer already told the market what they need, in Arabic, and nobody is reading it" | Is the pain specific and observable? |
| 3 | **Why now** | National Digital Agenda 2030, the national AI strategy, and the fact that tender and hiring data is public and machine-readable today. One line on Arabic-first national AI (Fanar) as evidence of direction, **not** as a dependency | Do you understand the country you are asking money from? |
| 4 | **The product** | Three screens: feed → account brief with evidence → export. Screenshots, not architecture | Does it exist? |
| 5 | **Why it is defensible** | Markets are **configuration, not code** (four presets ship today, a fifth is a data change); every signal carries its raw evidence and source URL; a wrong signal is rejected in one click and logged. Evidence trail = the trust answer | What stops a copy? |
| 6 | **Traction** | What is real: working multi-tenant product, per-workspace isolation, five evidence channels, four market presets, delivery to Slack/Teams/Make/Zapier and HubSpot, 80 tests. Then say plainly: **no paying customers yet** | Are you honest about the gap? |
| 7 | **Model and market** | Price per workspace per month for a 5–20 seat firm. **Countable TAM**: the number of distinct firms bidding on digital tenders in Qatar is public — you can count it with the product itself. Say so instead of quoting an analyst figure | Is the market bottom-up and checkable? |
| 8 | **The ask** | Amount, 18 months, milestone table from §7, and what the money buys (Arabic coverage, three portals, five design partners, one referenceable customer) | Is the amount tied to outcomes? |

Slide 7 is the one most founders get wrong here. **Never quote a TAM you cannot source.** The
strong answer is that your market is *countable from the same public record you sell access to* —
"we will report the number of firms bidding on Qatari digital tenders, with names, in month
three" is a better answer than a billion-dollar figure, and it is true.

## 5. The demo — ninety seconds, no slides

Rehearse this exact order. It moves from *what the market looks like* to *why you can trust it* to
*why this is a platform*.

1. **Feed** (10s) — ranked accounts, each with its signal chip and score. "This is this morning."
2. **One account** (25s) — open it: why-now, the evidence paragraph, the source link, the
   classification method. "Every claim here is traceable to a document."
3. **Reject a signal** (10s) — press *This is wrong*. "It disappears, the score recomputes, and the
   rejection is logged with the evidence. A buyer can audit us."
4. **Switch market** (20s) — `/niches`, switch from Data & AI to Cybersecurity, come back: the same
   collected evidence is re-scored for the new market. "One product, every market they sell. That
   is why this is a platform and not a point tool."
5. **Export** (10s) — CSV with `AI_Subject` / `AI_Body` going straight into their sequencer. "We
   don't replace their stack. We fill it."
6. **Slack** (15s) — the digest landing in a channel, if a webhook is connected.

**Demo rule: never present the seeded sample market as real data.** The accounts are fictional
fixtures. If a judge asks "is this live?" and the answer is discovered rather than volunteered,
the whole pitch is discounted. Say it first — see §6 — then demo a real notice you pushed in
during the session.

## 6. How to talk about traction

Say this, more or less verbatim:

> "The software is real and I'll show you all of it. What I don't have is a paying customer, and
> the accounts you're about to see are sample data. What I'm asking for is the eighteen months
> that turns this into five Qatari design partners and one referenceable logo."

Three sentences that buy credibility for everything else. What **not** to do:

- Do not imply customer logos, revenue, or a pilot that does not exist.
- Do not demo the sample market as live signal.
- Do not describe the product as it will be; describe it as it is, then say what funding adds.

## 7. The ask

Ask for the smallest amount that hits the milestones — asking for the programme maximum reads as
unserious for a company with no revenue.

| Milestone | Month | Evidence you will show |
| --- | --- | --- |
| Arabic signal coverage — the vocabulary reads Arabic tender and job text, English/Arabic mixed records handled | 3 | A real Arabic tender classified correctly, side by side with the English one |
| Three Qatari sources wired (tender portal + job board + news), live on a schedule | 4 | Ingestion report per source, per channel |
| Five design partners signed in Qatar | 6 | Signed LOIs, weekly digest delivered to each |
| First paid workspace | 9 | Invoice, and retention through a second renewal |
| One referenceable customer + meetings-per-50-accounts lift reported | 12 | Their before/after from the signal performance table |
| GCC expansion — one more market, one more language pair or country | 18 | A second country's sources running on the same engine |

Suggested ask: **USD 250–350k over 18 months**, milestone-based. Say explicitly what it pays for:
two engineers, one Doha-based go-to-market hire, three data-source contracts.

Routes, in the order worth pursuing (verify current intake — these were the 2026 positions):

| Route | What it is | Your fit |
| --- | --- | --- |
| **Startup Qatar — START (QDB)** | Milestone-based investment, up to ~US$1.1m, for tech startups establishing in Qatar; AI is a priority sector | Primary ask. Do not ask for the maximum. |
| **Startup Qatar — AI Compute Credits** | In-kind cloud/GPU credits | Cheap to ask for, useful even though you are not compute-bound; frame it as model cost, not training |
| **QDB Pre-Accelerator** | 8 weeks, pitch for up to US$75k for 6% | The 2026 call closed 5 Sep 2026 (programme ran Oct–Nov 2026). Ask QDB about the next intake — it is the closest stage match you have |
| **QSTP Tech Venture Fund** | US$30m fund, pre-seed to seed, Qatar-headquartered deep tech, impact thesis | Weaker fit: this is an application layer on public data, not deep tech. Approach only with a research partner |
| **Web Summit Qatar 2027 startup programme / PITCH** | Exhibition + investor access + PITCH (under €5m raised); event 31 Jan–3 Feb 2027 | Best value for a first round of investor conversations |
| **World Summit AI Qatar accelerator** | Pod, passes, matchmaking, pitch shortlist; no cash | Secondary; check participation cost first |

QFC (US$500 application + US$5,000/yr per licensed activity) and QFZ (100% foreign ownership,
20-year tax holiday, ICT permitted) are **setup channels, not funding**. Mention them only when
asked "will you be here?" — the answer is yes, and name which route.

The procurement detail worth knowing before you promise anything: government bids are generally
in Arabic unless the tender says otherwise, and tenders of QAR 5m or less are limited to locally
registered suppliers. That is not a reason to avoid the public sector — it is the reason a local
entity and a local partner are part of the plan, and saying so unprompted signals you have done
the homework.

## 8. Hard questions, and the answers

| Question | Answer |
| --- | --- |
| "Apollo / ZoomInfo already do this." | They sell contact lists. They do not read Arabic tender notices, and their Gulf coverage is thin. We sell the reason to call, and we feed the sequencer they already pay for. |
| "Why Qatar and not the US?" | The buyer is concentrated, the record is public and bilingual, and there is a government agenda creating demand with a date on it. One country and one language pair is a market you can actually cover. |
| "Anyone can call an LLM." | With no key at all this runs on a deterministic rule engine over the customer's own vocabulary, and it degrades to templates rather than breaking. The model is an upgrade, not the product. |
| "What about data residency and privacy?" | Company-level public signals and licensed person data; no scraping of personal profiles; every draft is human-approved and we do not send on the customer's behalf. Postgres-per-deployment with tenant-scoped rows, so an in-region deployment is a hosting decision, not a rewrite. |
| "How do you keep it accurate?" | Every signal carries its raw evidence, its source, and how it was classified; a wrong one is rejected in one click and the rejection is logged. Accuracy is auditable per customer per signal type — which is also the retention story. |
| "Why won't the consultancies build this?" | They have no data team, and the same engine has to serve four different markets with different definitions of a signal. That is configuration work plus source contracts — not a weekend project, and not something they want to own. |
| "What is your unfair advantage?" | The vocabulary. Four markets' worth of signal rules, per-customer, editable, and measurable per signal — accumulated per customer, and portable to the next country. |

## 9. What not to pitch

- **"AI agents that write and send your outreach."** Commodity, and the product deliberately does
  not send. Sending is where someone else's deliverability problems live.
- **The current README framing — boutique consultancies in the US/UK.** It is not wrong, it is
  simply not why a Qatari programme would fund you. Keep it as the second market, not the pitch.
- **Sovereignty you cannot demonstrate.** Do not say "sovereign AI" unless you can show where
  prompts, records and logs live and who can read them.
- **A TAM from an analyst report.** See §4, slide 7.

## 10. What must be built before you walk in

Ordered by how much it costs you to be caught without it.

1. **Arabic.** Today the codebase contains **no Arabic handling at all** — no Arabic patterns, no
   RTL handling, no Qatar or GCC strings anywhere. The signal vocabulary is regex, so Arabic
   support starts as patterns plus a bilingual fixture and correct normalisation (alef variants,
   taa marbuta, diacritics, mixed Arabic/English company names). Until this exists the
   differentiator is a slide, not a demo. This is the highest-value two days of work available.
2. **One real Qatari source live.** A tender portal through `INGEST_HTTP_SOURCES` on the `tender`
   channel, plus one job board. Then ingest a real notice end to end and keep it for the demo.
3. **One design partner LOI.** A Doha consultancy saying "we would use this" is worth more than any
   slide, and it is achievable before the round closes.
4. **A price and a one-page commercial sheet.** Per workspace, per month, with what is included.
   Panels ask; having no answer is worse than having a low one.
5. **The Qatar/GCC market preset** — a fifth entry in the niche presets, so adopting Qatar is one
   click in the demo rather than a promise.
6. **A recorded 90-second demo.** Applications close before you find out whether the connection in
   the room works.

## 11. Two-week plan

| When | Do |
| --- | --- |
| Days 1–2 | Arabic signal patterns + a bilingual tender fixture; ingest one real Arabic tender and confirm it classifies |
| Days 3–4 | Wire two Qatari sources as `INGEST_HTTP_SOURCES`; confirm per-channel ingestion reports |
| Days 5–6 | Add the Qatar/GCC niche preset (targeting, exclusions, buyer roles, source queries) |
| Days 7–8 | Three design-partner calls in Doha; ask each for one LOI |
| Days 9–10 | Build the deck from §4, record the demo from §5, write the milestones in §7 |
| Days 11–14 | Submit START and the compute-credits application; apply to Web Summit Qatar 2027; ask QDB about the next pre-accelerator intake |

---

### Caveats on the programme details

Programme terms, ticket sizes and intakes above come from public sources that were partly
unreadable at the time of writing (the Startup Qatar and QSTP pages in particular). Confirm each
ticket size, deadline and equity term directly with the programme before you put a number on a
slide or make a relocation commitment. The product claims in §4–§6 are drawn from this
repository and are checkable in it.
