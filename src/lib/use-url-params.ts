"use client";

// Link-carried view state, read without an effect.
//
// These exist so a dashboard tile can open a page already filtered — "Approved
// accounts 1" opening the feed filtered to approved accounts — without the page
// setting state after mount. Calling setState in an effect is exactly the pattern
// the React lint rules reject, and the obvious alternative (seeding useState from
// `window.location` during render) renders differently on the client than on the
// server and triggers a hydration mismatch.
//
// `useSyncExternalStore` is the supported form of "this value lives outside
// React": it returns the server snapshot (null) while hydrating, then the real
// value, so both renders agree and nothing is set after the fact.

import { useSyncExternalStore } from "react";
import { readEnumParam, readNumberParam } from "./url-params";

/** Nothing outside React changes these mid-session except history navigation. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/** A query param restricted to known values, or null. */
export function useUrlParamEnum<T extends string>(name: string, allowed: readonly T[]): T | null {
  return useSyncExternalStore(
    subscribe,
    () => readEnumParam(name, allowed),
    () => null,
  );
}

/** A positive numeric query param, or null. */
export function useUrlNumberParam(name: string): number | null {
  return useSyncExternalStore(
    subscribe,
    () => readNumberParam(name),
    () => null,
  );
}
