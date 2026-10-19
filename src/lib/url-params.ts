// Initial view state carried in a link.
//
// A dashboard tile that says "Approved accounts 1" should open the feed already
// filtered to approved accounts, rather than dropping the visitor on an
// unfiltered list and making them re-apply what they just clicked.
//
// Read once on mount from `window.location` rather than with `useSearchParams()`:
// that hook makes a client component depend on the request's query string, which
// under Cache Components means it needs a Suspense boundary and stops the page
// being prerendered. These pages only need the value to seed state, so the plain
// read is both simpler and keeps the shell static.

export function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value.trim() ? value.trim() : null;
}

/** A numeric param, or null when it is absent, unparseable or not positive. */
export function readNumberParam(name: string): number | null {
  const raw = readParam(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A param restricted to a known set of values, so a URL cannot seed bad state. */
export function readEnumParam<T extends string>(name: string, allowed: readonly T[]): T | null {
  const raw = readParam(name);
  if (raw === null) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}
