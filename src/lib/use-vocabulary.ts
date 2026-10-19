"use client";

// The tenant's signal vocabulary, fetched once per page load and shared.
//
// The UI needs it for the same reason the engine does: "what the signals are
// called" is data now, not a compile-time list. One request per session is
// enough, so the response is cached at module scope and every component reads
// the same copy.

import { useEffect, useState } from "react";
import type { NicheConfig, Vocabulary } from "./types";

export interface VocabularyResponse {
  vocabulary: Vocabulary;
  niche: NicheConfig;
  niches: { key: string; label: string; description: string; signals: number }[];
}

let cache: VocabularyResponse | null = null;
let inflight: Promise<VocabularyResponse> | null = null;

export function loadVocabulary(): Promise<VocabularyResponse> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/vocabulary")
      .then((r) => r.json() as Promise<VocabularyResponse>)
      .then((data) => {
        cache = data;
        inflight = null;
        return data;
      })
      .catch((err: unknown) => {
        // A failed load is not cached: the next mount retries rather than the
        // whole session running label-less.
        inflight = null;
        throw err;
      });
  }
  return inflight;
}

/**
 * Drop the cached copy after an edit, so the UI re-reads the saved vocabulary.
 *
 * Also announces it: the sidebar, chips and filters all read this one cache, and
 * after a niche switch they must re-render together rather than showing the old
 * market's labels until the next page load.
 */
export function clearVocabularyCache(): void {
  cache = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(VOCABULARY_CHANGED));
  }
}

const VOCABULARY_CHANGED = "enginex:vocabulary-changed";

export function useVocabulary(): VocabularyResponse | null {
  const [data, setData] = useState<VocabularyResponse | null>(cache);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (cache) {
        setData(cache);
        return;
      }
      loadVocabulary()
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => {
          // Labels fall back to the raw key; nothing else on the page depends on it.
        });
    };
    load();
    window.addEventListener(VOCABULARY_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(VOCABULARY_CHANGED, load);
    };
  }, []);
  return data;
}
