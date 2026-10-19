// Evidence channels: the kind of place a buying signal shows up.
//
// A signal rule is a pattern, and a pattern is only as good as the evidence it is
// run against. "A public tender is an explicit statement of need" is true of a
// procurement portal and false of a press release: the same words mean different
// things in different places, and some signals only exist in one channel at all.
// A company hiring three data engineers is evidence of a data team being built;
// no amount of news coverage says that, and a job board says nothing about a
// funding round.
//
// So a rule declares the channels it reads, an adapter declares the channel it
// feeds, and ingestion only runs a rule against evidence from a channel it reads.
// That is what stops a noisy news feed from manufacturing tender signals, and it
// is why a niche's vocabulary and its sources have to be configured together.
//
// A rule with no channels declared reads everything — that is the historical
// behaviour, and it is what keeps a hand-written rule or a signal stored under an
// earlier vocabulary working rather than silently dropping out of the pipeline.

export type Channel = "news" | "job_board" | "tender" | "people" | "funding";

export interface ChannelInfo {
  id: Channel;
  label: string;
  /** One line on what this channel is good evidence for. */
  reads: string;
}

export const CHANNELS: ChannelInfo[] = [
  {
    id: "tender",
    label: "Tenders & procurement",
    reads: "Funded, published statements of need — the strongest and shortest-lived evidence there is.",
  },
  {
    id: "job_board",
    label: "Job boards & ATS",
    reads: "Hiring that has not been announced anywhere else, including the gap above it.",
  },
  {
    id: "news",
    label: "News & press",
    reads: "Funding, appointments, incidents, migrations and vendor selections, attributed to a company.",
  },
  {
    id: "people",
    label: "People data",
    reads: "Leadership changes and contact records, from a licensed people provider or a company site.",
  },
  {
    id: "funding",
    label: "Funding & company data",
    reads: "Rounds, acquisitions and filings, with the headcount and sector fields the matcher reads.",
  },
];

const CHANNEL_IDS = new Set<string>(CHANNELS.map((c) => c.id));

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && CHANNEL_IDS.has(value);
}

/** Filter anything channel-shaped down to the channels that exist. */
export function asChannels(values: unknown): Channel[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(isChannel))];
}

export function channelLabel(channel: Channel): string {
  return CHANNELS.find((c) => c.id === channel)?.label ?? channel;
}

/**
 * Which channels rules read but no configured source feeds.
 *
 * The honest answer to "why is the feed empty?" — a rule reading tender evidence
 * can be flawless and still never fire if the only configured source is a news
 * feed. Rules with no channel declared are not counted: they read everything, so
 * any source can reach them.
 */
export function uncoveredChannels(
  ruleChannels: Channel[],
  sourceChannels: Channel[],
): Channel[] {
  const fed = new Set(sourceChannels);
  return [...new Set(ruleChannels)].filter((c) => !fed.has(c));
}
