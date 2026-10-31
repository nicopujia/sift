// Site adapters: precise extractors for sites where generic rules are not
// good enough. Each returns null to fall back to the generic extractor.

import type { Page } from "../model";

export interface Adapter {
  name: string;
  match(url: URL): boolean;
  extract(url: URL): Page | null;
  /** Elements whose own changes never need a re-extraction (players, clocks). */
  quiet?(): Element[];
  /** Load more items, if the site loads on scroll. Return true if handled. */
  loadMore?(): boolean;
  /**
   * Original elements that must never become Sift's dialog, because the adapter
   * already shows them its own way (YouTube's player error screen is a note).
   * For the extractor: pass it as `drop` in the context given to findDialog.
   */
  dropDialog?(el: Element): boolean;
  /**
   * A page the adapter leaves to the generic extractor (YouTube's playlists and channels): what it adds to
   * the generic page, such as the site's own top bar controls.
   */
  fallback?(page: Page): void;
  /**
   * The selector of the page's content (a results page's entries), or null: while the page loads and Sift shows
   * none of it, the look that shows it runs as soon as one comes in (Sift's content gate). Pages without one keep their pace.
   */
  contentSel?(url: URL): string | null;
}

import { amazon } from "./amazon";
import { gmail } from "./gmail";
import { youtube } from "./youtube";

export const adapters: Adapter[] = [youtube, amazon, gmail];
