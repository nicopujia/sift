// Picks the extractor for the current page: a site adapter when one matches
// and succeeds, otherwise the generic extractor.

import type { Page } from "../model";
import { extractGeneric, findDialog, newCtx } from "./generic";
import { resetCaches } from "../dom";
import { elOf } from "../registry";
import { adapters, type Adapter } from "../adapters";

let current: Adapter | null = null;

export function activeAdapter(): Adapter | null {
  return current;
}

/** The page's URL; local test snapshots say which real URL they came from. */
export function pageUrl(): URL {
  if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    const real = document.querySelector('meta[name="sift-test-url"]')?.getAttribute("content");
    if (real) return new URL(real);
  }
  return new URL(location.href);
}

export function extract(): Page {
  resetCaches();
  const url = pageUrl();
  current = adapters.find((a) => a.match(url)) ?? null;
  if (current) {
    const p = current.extract(url);
    if (p) {
      // Adapters cover the page; dialogs and popups are found the same way everywhere
      // (never the search box's own suggestions).
      const se = elOf(p.search?.ref);
      // The adapter may rule out elements that only look like dialogs (YouTube's bot check).
      const drop = (el: Element) => !!current?.dropDialog?.(el);
      p.dialog ??= findDialog(newCtx(se ? { searchEl: se, drop } : { drop }));
      return p;
    }
  }
  const g = extractGeneric();
  try {
    current?.fallback?.(g);
  } catch (e) {
    console.warn("sift: adapter fallback failed", e);
  }
  return g;
}
