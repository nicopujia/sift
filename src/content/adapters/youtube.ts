// YouTube: home, search, and watch pages. Lists become plain lists of videos
// (title rewritten to one plain line); the watch page keeps the player and
// the few actions that matter.

import type { Action, Block, Dialog, Inline, Item, Page } from "../model";
import { refOf } from "../registry";
import { absUrl, clean, imgSrc, textIn, visible } from "../dom";
import { findNav, toAction, toField } from "../extract/generic";
import { setLang, t } from "../i18n";
import { store } from "../ui/store";
import type { Adapter } from "./index";

const q = <T extends Element = Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const qa = <T extends Element = Element>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/**
 * A link's address as the original has it, whole: a Mix or playlist keeps its
 * list= and index=, a time its t=, so a middle-click, Ctrl+click or copied
 * link opens what it opens on the original.
 */
function cleanHref(href: string | null | undefined): string | undefined {
  return absUrl(href);
}

function search(): Page["search"] {
  const input = q<HTMLInputElement>("yt-searchbox input[name=search_query], input#search[name=search_query], input[name=search_query]");
  const f = input ? toField(input) : null;
  if (!input || !f) return undefined;
  f.kind = "search";
  f.label = t("search");
  f.placeholder = clean(input.placeholder) || t("search");
  const btn = q("yt-searchbox button.ytSearchboxComponentSearchButton, #search-icon-legacy, button[aria-label=Search]");
  if (btn) f.submit = refOf(btn);
  return f;
}

function nav(): Action[] {
  // The full guide, or the mini guide YouTube shows before the guide is first opened.
  // Entries without an address ("Shorts", "Show more") are buttons, still usable.
  const links = qa<HTMLAnchorElement>("ytd-guide-renderer a#endpoint, ytd-mini-guide-renderer a#endpoint, ytd-guide-entry-renderer tp-yt-paper-item[role=link], ytd-guide-collapsible-entry-renderer #expander-item");
  const out: Action[] = [];
  const seen = new Set<string>();
  if (!q("ytd-guide-renderer a#endpoint")) renderGuide();
  for (const a of links) {
    // The guide's hidden toggle ("Show less" while collapsed) is not an entry.
    if (!(a as HTMLElement).checkVisibility()) continue;
    const label = clean(a.getAttribute("title")) || textIn(a) || clean(a.getAttribute("aria-label"));
    const href = absUrl(a.getAttribute("href"));
    const k = href ?? "label:" + label;
    if (!label || seen.has(k) || seen.has("label:" + label)) continue;
    seen.add(k);
    seen.add("label:" + label);
    // "Show more" and "Show less" are one entry whose label changes: the same key keeps it, and focus on it (F922).
    const box = a.closest("#expander-item, #collapser-item") ? a.closest("ytd-guide-collapsible-entry-renderer") : null;
    const key = box && !seen.has("n:more:" + refOf(box)) ? "n:more:" + refOf(box) : "n:" + refOf(a);
    seen.add(key);
    out.push(href ? { key, label, ref: refOf(a), href } : { key, label, ref: refOf(a) });
  }
  return out.length > 2 ? out : [...out, ...findNav({ used: new WeakSet() } as any).filter((a) => !seen.has(a.href ?? "") && !seen.has("label:" + a.label))];
}

/**
 * YouTube draws its full guide (History, Music, Live, Gaming, ...) only once it
 * is first opened, so until then Menu would hold just the mini guide. Open it
 * once behind Sift and close it again as soon as it has drawn: the page ends
 * as it was, with the guide in the DOM.
 */
let guideTries = 0;
let guideBusy = false;
/**
 * A YouTube popup is open (a sign-in prompt, a menu): to it, a click on the guide button is a click outside, and it closes (F721).
 * Not one the reader already closed in Sift that the page still shows.
 */
const popupOpen = () => {
  const d = store.page?.dialog;
  if (d && store.dismissed.has(d.key)) return false;
  return qa<HTMLElement>("ytd-popup-container tp-yt-iron-dropdown, ytd-popup-container tp-yt-paper-dialog").some((e) => e.checkVisibility());
};
function renderGuide() {
  if (guideBusy || guideTries >= 2 || store.mode !== "sift") return;
  const btn = q<HTMLElement>("ytd-masthead #guide-button button, ytd-masthead #guide-button");
  if (!btn) return;
  guideBusy = true;
  guideTries++;
  const drawn = () => !!q("ytd-guide-renderer a#endpoint");
  const state = () => `${q("tp-yt-app-drawer#guide")?.hasAttribute("opened")}|${q("ytd-app")?.hasAttribute("guide-persistent-and-visible")}`;
  // Once the page has settled and is idle, so the first view is not slowed down.
  const later = (fn: () => void) => setTimeout(() => requestIdleCallback(fn, { timeout: 2000 }), 4000);
  later(function open() {
    if (store.mode !== "sift" || drawn() || !btn.isConnected) {
      guideBusy = false;
      return;
    }
    // Not while the reader has a popup open: try again once it is closed.
    if (popupOpen()) return later(open);
    const before = state();
    btn.click();
    // Once drawn, close it again; a click while the drawer still slides open is ignored, so check a few times.
    let n = 0;
    const iv = setInterval(() => {
      if (!drawn() && ++n < 20) return;
      clearInterval(iv);
      const restore = (left: number): void =>
        void setTimeout(() => {
          // Not while the reader has a popup open (the drawer stays open behind Sift until then).
          if (state() !== before && popupOpen() && btn.isConnected) return restore(left);
          if (state() !== before) btn.click();
          if (left > 0) restore(left - 1);
          else guideBusy = false;
        }, 700);
      restore(2);
    }, 150);
  });
}

function top(): Action[] {
  const out: Action[] = [];
  const signIn = q<HTMLAnchorElement>("ytd-masthead a[aria-label='Sign in'], ytd-masthead ytd-button-renderer a[href*='ServiceLogin']");
  if (signIn && visible(signIn)) out.push(toAction(signIn, clean(signIn.getAttribute("aria-label")) || textIn(signIn)));
  // The top bar's settings menu (language, Restricted Mode, appearance, help), named by YouTube.
  const settings = qa("ytd-masthead ytd-topbar-menu-button-renderer button[aria-label]").find((b) => visible(b));
  if (settings) out.push({ ...toAction(settings, clean(settings.getAttribute("aria-label"))), kind: "quiet" });
  return out;
}

function isAd(el: Element): boolean {
  if (el.matches("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer")) return true;
  if (el.querySelector("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ad-badge-view-model, feed-ad-metadata-view-model")) return true;
  return qa("badge-shape, .badge-style-type-ad, span", el).slice(0, 40).some((b) => /^(sponsored|ad|patrocinado|anuncio)$/i.test(clean(b.textContent)));
}

/** A video from the new lockup component (home, sidebar, some search results). */
function fromLockup(lock: Element): Item | null {
  const a = q<HTMLAnchorElement>("a.ytLockupMetadataViewModelTitle, a.yt-lockup-metadata-view-model__title, h3 a[href]", lock);
  const h3 = q("yt-lockup-metadata-view-model h3, h3[title]", lock);
  const title = clean(h3?.getAttribute("title")) || (a ? textIn(a) : "");
  if (!title || !a) return null;
  const rows = qa(".ytContentMetadataViewModelMetadataRow, .yt-content-metadata-view-model__metadata-row", lock).map((r) =>
    qa(".ytContentMetadataViewModelMetadataText, .yt-content-metadata-view-model__metadata-text", r)
      .map((s) => clean(s.textContent))
      .filter(Boolean),
  );
  const badges = qa("yt-thumbnail-view-model badge-shape, yt-thumbnail-badge-view-model badge-shape", lock)
    .map((b) => clean(b.textContent))
    .filter(Boolean);
  // A playlist or mix: its title is a name, and its later rows only sample its videos.
  const collection = !!q("yt-collection-thumbnail-view-model, yt-collections-stack", lock) || /^\/playlist\?/.test(a.getAttribute("href") ?? "");
  if (collection) {
    const meta = [...new Set([...(rows[0] ?? []), badges[0]].filter(Boolean))] as string[];
    return { key: "i:" + refOf(lock), title, href: cleanHref(a.getAttribute("href")), ref: refOf(a), meta, keepTitle: true };
  }
  const duration = badges.find((b) => /^\d+(:\d+)+$/.test(b)) ?? badges.find((b) => /videos?|vídeos/i.test(b));
  // Usually row 1 is the channel and row 2 views and age; some layouts put all in one row.
  let first = rows[0] ?? [];
  let stats = rows[1] ?? [];
  if (!rows[1] && first.length >= 3) {
    // "Shakira", "and 2 more" both name the channel.
    const n = /^(and|y|e|et|und) \d+ /i.test(first[1] ?? "") ? 2 : 1;
    stats = first.slice(n);
    first = first.slice(0, n);
  }
  const channel = first.join(" ");
  const meta = [channel, duration, ...stats.map(views), ...rows.slice(2).flat()].filter(Boolean) as string[];
  return {
    key: "i:" + refOf(lock),
    title,
    href: cleanHref(a.getAttribute("href")),
    ref: refOf(a),
    meta,
    context: channel,
  };
}

/** A video from the classic renderer used on search pages. */
function fromVideoRenderer(r: Element): Item | null {
  const a = q<HTMLAnchorElement>("a#video-title", r);
  if (!a) return null;
  const title = clean(a.getAttribute("title")) || textIn(a);
  if (!title) return null;
  const channelA = q("#channel-info ytd-channel-name a, ytd-channel-name#channel-name a", r);
  const channel = channelA ? clean(channelA.textContent) : "";
  const metaLine = qa("#metadata-line span.inline-metadata-item", r).map((s) => clean(s.textContent)).filter(Boolean);
  const duration = clean(q("ytd-thumbnail-overlay-time-status-renderer badge-shape, ytd-thumbnail-overlay-time-status-renderer #text", r)?.textContent);
  const snippet = qa(".metadata-snippet-text, .metadata-snippet-text-navigation, #description-text", r).find((s) => visible(s));
  // The live badge in the page's own words ("LIVE", "EN DIRECTO").
  const liveEl = qa("ytd-badge-supported-renderer .badge-style-type-live-now-alternate, badge-shape", r).find((b) => b.matches(".badge-style-type-live-now-alternate") || /^live$/i.test(clean(b.textContent)));
  const live = liveEl ? clean(liveEl.textContent) : "";
  const meta = [channel, live || duration, ...metaLine.map(views)].filter(Boolean) as string[];
  return {
    key: "i:" + refOf(r),
    title,
    href: cleanHref(a.getAttribute("href")),
    ref: refOf(a),
    meta,
    context: [channel, snippet ? clean(snippet.textContent).slice(0, 160) : ""].filter(Boolean).join(" · "),
  };
}

/** "3.4M" alone is ambiguous; YouTube's English UI drops the word on search pages. */
function views(s: string): string {
  return /^[\d.,]+\s?[KMB]?$/i.test(s) && /^en/i.test(document.documentElement.lang || "en") ? s + " views" : s;
}

function fromShort(s: Element): Item | null {
  const a = q<HTMLAnchorElement>("a.shortsLockupViewModelHostEndpoint[title], a[href^='/shorts/'][title]", s);
  if (!a) return null;
  const title = clean(a.getAttribute("title")) || textIn(a);
  const views = clean(q(".shortsLockupViewModelHostMetadataSubhead", s)?.textContent);
  return { key: "i:" + refOf(s), title, href: absUrl(a.getAttribute("href")), ref: refOf(a), meta: ["Short", views].filter(Boolean), context: "YouTube Short" };
}

const SHORT_SEL = "ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model";

/** Shorts in a shelf, each once: the v2 lockup wraps the old one, so both match. */
function shortsIn(root: Element, seen: Set<string>, out: Item[]) {
  for (const s of qa(SHORT_SEL, root)) {
    if (s.parentElement?.closest(SHORT_SEL)) continue;
    const it = fromShort(s);
    if (!it || !it.href || seen.has(it.href)) continue;
    seen.add(it.href);
    out.push(it);
  }
}

/** Shorts as their own list when they are all there is (the Shorts chip), else folded away under the shelf's own title. */
function shortsBlock(shorts: Item[], alone: boolean, title = ""): Block {
  const list: Block = { t: "items", key: "shorts-list", items: shorts, rewrite: "oneliner" };
  return alone ? list : { t: "section", key: "shorts", title: title || "Shorts", collapsed: true, blocks: [list] };
}

/** A Shorts shelf's own title ("Shorts"), in the page's language. */
function shelfTitle(root: ParentNode): string {
  const h = q("grid-shelf-view-model h2, ytd-rich-shelf-renderer #title, ytd-reel-shelf-renderer #title, yt-section-header-view-model h2, h2", root);
  return h ? textIn(h) : "";
}

/** When this URL was first seen, to tell a page still rendering from one Sift cannot read. */
let seenUrl = "";
let seenAt = 0;

/**
 * YouTube renders lists a moment after the page shell or a navigation. Within
 * a few seconds of the URL changing, a missing list means "still loading";
 * after that, it means the layout is one this adapter does not know, and the
 * generic extractor takes over.
 */
function settling(): boolean {
  if (location.href !== seenUrl) {
    seenUrl = location.href;
    seenAt = performance.now();
  }
  return document.readyState !== "complete" || performance.now() - seenAt < 5000;
}

/**
 * A watch page whose player is up waits longer for the rest: on a slow load
 * YouTube draws its watch page and title 10 s or more after the player, and
 * the generic view in between would replace the page twice.
 */
function watchSettling(): boolean {
  return settling() || (!!q("#movie_player") && performance.now() - seenAt < 30000);
}

/** Shown while YouTube has not rendered its list yet, so Sift never says "nothing" too early. */
function loadingBlock(): Block {
  return { t: "p", key: "yt-loading", content: [t("loading")], small: true };
}

/** YouTube's search filter dialog: each group a heading, its options choices with the current one pressed. */
function filterDialog(): Dialog | undefined {
  const r = qa("ytd-search-filter-options-dialog-renderer").find((d) => visible(d));
  if (!r) return undefined;
  const box = r.closest("tp-yt-paper-dialog") ?? r;
  const blocks: Block[] = [];
  for (const g of qa("ytd-search-filter-group-renderer", r)) {
    const name = clean(q("#filter-group-name", g)?.textContent);
    const actions: Action[] = [];
    for (const f of qa("ytd-search-filter-renderer", g)) {
      const a = q("a#endpoint, a", f);
      const label = clean(q("#label", f)?.textContent);
      if (!a || !label) continue;
      const act = toAction(a, label);
      // A button, not a link, so the pressed state shows; the click still goes to YouTube's link.
      delete act.href;
      act.kind = "quiet";
      act.pressed = f.classList.contains("selected") || a.getAttribute("aria-selected") === "true";
      if (f.classList.contains("disabled")) act.disabled = true;
      actions.push(act);
    }
    if (!name || !actions.length) continue;
    blocks.push({ t: "h", key: "fh:" + refOf(g), level: 3, text: name });
    blocks.push({ t: "actions", key: "fa:" + refOf(g), actions });
  }
  if (!blocks.length) return undefined;
  const close = q("#close-button button, #close-button", r);
  return {
    key: "dlg:" + refOf(box),
    ref: refOf(box),
    title: clean(q("#title", r)?.textContent) || "Filters",
    blocks,
    close: close ? toAction(close, clean(close.getAttribute("aria-label")) || t("close")) : undefined,
  };
}

function chips(root: Element | null): Block | null {
  if (!root) return null;
  const actions: Action[] = [];
  for (const c of qa("yt-chip-cloud-chip-renderer", root)) {
    if (!visible(c)) continue;
    const target = q("button, [role=tab]", c) ?? c;
    const label = textIn(c);
    if (!label) continue;
    const a = toAction(target, label);
    a.pressed = c.hasAttribute("selected") || target.getAttribute("aria-selected") === "true";
    a.kind = "quiet";
    actions.push(a);
  }
  return actions.length ? { t: "actions", key: "chips:" + refOf(root), actions } : null;
}

function base(blocks: Block[], title: string): Page {
  return {
    url: location.href,
    title,
    site: "YouTube",
    lang: document.documentElement.lang || "en",
    search: search(),
    nav: nav(),
    top: top(),
    blocks,
    source: "youtube",
  };
}

/** Feeds whose browse page has the rich grid this adapter reads; others (History, Playlists) are left to the generic extractor. */
const GRID_FEEDS: Record<string, string> = { "/": "home", "/feed/subscriptions": "subscriptions" };

function home(path: string): Page | null {
  const subtype = GRID_FEEDS[path];
  const browse = (subtype && q(`ytd-browse[page-subtype="${subtype}"]:not([hidden])`)) || (path === "/" ? q("ytd-browse:not([hidden])") : null);
  if (!browse) return subtype && settling() ? loadingPage() : null;
  const blocks: Block[] = [];
  // Topic chips are many and rarely needed: fold them away.
  const ch = chips(q("ytd-feed-filter-chip-bar-renderer", browse));
  if (ch) blocks.push({ t: "section", key: "topics", title: t("topics"), collapsed: true, blocks: [ch] });
  const nudge = q("ytd-feed-nudge-renderer", browse);
  if (nudge && visible(nudge)) blocks.push({ t: "p", key: "nudge:" + refOf(nudge), content: [textIn(nudge)] });
  const grid = q("ytd-rich-grid-renderer > #contents", browse);
  const items: Item[] = [];
  const shorts: Item[] = [];
  const seen = new Set<string>();
  let shelf = "";
  if (grid) {
    for (const child of Array.from(grid.children)) {
      if (child.localName === "ytd-rich-item-renderer") {
        if (isAd(child)) continue;
        const lock = q("yt-lockup-view-model", child);
        const it = lock ? fromLockup(lock) : fromVideoRenderer(child);
        if (it) items.push(it);
      } else if (child.localName === "ytd-rich-section-renderer") {
        const n = shorts.length;
        shortsIn(child, seen, shorts);
        if (shorts.length > n) shelf ||= shelfTitle(child);
        // A shelf of videos ("New to you", "Top music videos in your region"): its videos join the feed where the shelf stands.
        for (const ri of qa("ytd-rich-item-renderer", child)) {
          const lock = q("yt-lockup-view-model", ri);
          if (!lock || isAd(ri)) continue;
          const it = fromLockup(lock);
          if (it && !items.some((x) => x.href === it.href)) items.push(it);
        }
      }
    }
  }
  if (items.length) blocks.push({ t: "items", key: "feed", items, rewrite: "oneliner" });
  if (shorts.length) blocks.push(shortsBlock(shorts, !items.length, shelf));
  const title = clean(document.title.replace(/\s*-\s*YouTube$/, "")) || "YouTube";
  // The home feed, named as YouTube's own guide names it ("Home", "Inicio").
  const homeName = () =>
    qa("ytd-guide-entry-renderer a#endpoint[href='/'], ytd-mini-guide-entry-renderer a#endpoint[href='/']")
      .map((a) => clean(a.getAttribute("title")) || textIn(a))
      .find(Boolean) ?? "YouTube";
  const page = base(blocks, title === "YouTube" && path === "/" ? homeName() : title);
  // The feed renders a moment after the page shell; until then, say it is loading.
  const filled = grid ? Array.from(grid.children).some((c) => c.localName !== "ytd-continuation-item-renderer") : false;
  if (!items.length && !shorts.length && !(nudge && visible(nudge))) {
    // A grid with children Sift cannot read is a changed layout: the generic extractor reads it.
    if (filled || !settling()) return null;
    blocks.push(loadingBlock());
    page.partial = true;
  }
  return page;
}

/** A page for the moment before YouTube renders the part Sift reads: search box and a loading line. */
function loadingPage(): Page {
  const query = new URL(location.href).searchParams.get("search_query") ?? "";
  const page = base([loadingBlock()], query ? `${t("search")}: ${query}` : "YouTube");
  page.partial = true;
  return page;
}

/** Search result rows this adapter reads (or knowingly skips). */
const KNOWN_ROWS = new Set([
  "ytd-video-renderer", "yt-lockup-view-model", "ytd-playlist-renderer", "ytd-channel-renderer", "ytd-shelf-renderer",
  "ytd-horizontal-card-list-renderer", "grid-shelf-view-model", "ytd-reel-shelf-renderer", "ytd-background-promo-renderer",
  "ytd-message-renderer", "ytd-ad-slot-renderer", "ytd-vertical-list-renderer", "yt-horizontal-list-renderer", "ytd-radio-renderer",
  "ytd-search-pyv-renderer", "ytd-promoted-sparkles-web-renderer", "ytd-showing-results-for-renderer", "ytd-did-you-mean-renderer",
]);

function results(): Page | null {
  const page = q("ytd-search:not([hidden])");
  if (!page) return settling() ? loadingPage() : null;
  const blocks: Block[] = [];
  const header = q("ytd-search-header-renderer", page);
  const ch = chips(q("yt-chip-cloud-renderer", header ?? page));
  const filterBtn = header ? q("#filter-button button", header) : null;
  if (ch && ch.t === "actions" && filterBtn) ch.actions.push(toAction(filterBtn, textIn(filterBtn) || clean(filterBtn.getAttribute("aria-label")) || t("filters")));
  if (ch) blocks.push(ch);
  const items: Item[] = [];
  const shorts: Item[] = [];
  const seen = new Set<string>();
  const notes: Block[] = [];
  let rendered = 0;
  // Rows of a kind this adapter does not know: if nothing else could be read, the generic extractor reads them.
  let unknown = 0;
  let shelf = "";
  for (const sec of qa("ytd-section-list-renderer > #contents > ytd-item-section-renderer #contents", page)) {
    for (const child of Array.from(sec.children)) {
      if (!visible(child) || child.localName === "ytd-continuation-item-renderer") continue;
      rendered++;
      if (isAd(child)) continue;
      const tag = child.localName;
      if (!KNOWN_ROWS.has(tag)) unknown++;
      if (tag === "ytd-video-renderer") {
        const it = fromVideoRenderer(child);
        if (it) items.push(it);
      } else if (tag === "yt-lockup-view-model" || tag === "ytd-playlist-renderer") {
        const lock = tag === "yt-lockup-view-model" ? child : q("yt-lockup-view-model", child);
        const it = lock ? fromLockup(lock) : null;
        if (it) items.push(it);
      } else if (tag === "ytd-channel-renderer") {
        const a = q<HTMLAnchorElement>("a#main-link, a.channel-link", child);
        const name = clean(q("ytd-channel-name #text", child)?.textContent);
        if (a && name) {
          // The channel's name stays; its handle and subscriber count sit in two separate spots.
          const meta = [...new Set(qa("#metadata #subscribers, #metadata #video-count, #subscribers, #video-count", child).map((e) => clean(e.textContent)).filter(Boolean))];
          const about = clean(q("#description", child)?.textContent);
          const sub = q("#subscribe-button a, #subscribe-button button", child);
          const actions = sub && visible(sub) && (textIn(sub) || sub.getAttribute("aria-label")) ? [toAction(sub, textIn(sub) || clean(sub.getAttribute("aria-label")))] : undefined;
          items.push({ key: "i:" + refOf(child), title: name, href: absUrl(a.getAttribute("href")), ref: refOf(a), meta, text: about || undefined, keepTitle: true, actions });
        }
      } else if (tag === "ytd-shelf-renderer" || tag === "ytd-horizontal-card-list-renderer") {
        for (const r of qa("ytd-video-renderer", child)) {
          if (isAd(r)) continue;
          const it = fromVideoRenderer(r);
          if (it) items.push(it);
        }
      } else if (tag === "grid-shelf-view-model" || tag === "ytd-reel-shelf-renderer") {
        const n = shorts.length;
        shortsIn(child, seen, shorts);
        if (shorts.length > n) shelf ||= shelfTitle(child);
      } else if (tag === "ytd-background-promo-renderer" || tag === "ytd-message-renderer") {
        // "No results found. Try different keywords or remove search filters."
        const msg = qa("#title, #body, #text, #subtext", child).map((e) => textIn(e)).filter(Boolean);
        const text = msg.length ? msg.join(". ").replace(/\.\./g, ".") : textIn(child);
        if (text) notes.push({ t: "note", key: "msg:" + refOf(child), tone: "info", text });
      }
    }
  }
  // Rows were drawn but none could be read: a layout this adapter does not know.
  if (!items.length && !shorts.length && !notes.length && unknown) return null;
  if (items.length) blocks.push({ t: "items", key: "results", items, rewrite: "oneliner" });
  if (shorts.length) blocks.push(shortsBlock(shorts, !items.length, shelf));
  blocks.push(...notes);
  const query = new URL(location.href).searchParams.get("search_query") ?? "";
  const out = base(blocks, query ? `${t("search")}: ${query}` : "YouTube");
  // Results arrive a moment after the page shell; until then, say it is loading.
  // Long after that, the results sit somewhere this adapter does not look.
  if (!rendered) {
    if (!settling()) return null;
    blocks.push(loadingBlock());
    out.partial = true;
  }
  out.dialog = filterDialog();
  return out;
}

/** The address the tab loaded; until the reader moves inside the site, the tab's title names this video. */
const loadedUrl = location.href;
let moved = false;
function firstLoad(): boolean {
  if (location.href !== loadedUrl) moved = true;
  return !moved;
}
/** The loaded video's title as the tab first gave it (YouTube resets the tab's title to "YouTube" while it starts). */
let loadedTitle = "";
/** The tab's title when watch() first saw this address (none on the page's first load): the page left's, until YouTube swaps it. */
let docAt = { url: "", title: "" };

/** YouTube's player with Sift's controls: play, captions and full screen through its own buttons. */
function playerBlock(player: Element, label: string): Block {
  const video = q<HTMLVideoElement>("video.html5-main-video, video", player);
  const vis = (sel: string) => {
    const b = q(sel, player);
    return b && getComputedStyle(b).display !== "none" ? refOf(b) : undefined;
  };
  // YouTube hides CC on small players with CSS, but the button still works; it hides
  // it inline only when the video has no captions.
  const cc = q<HTMLElement>(".ytp-subtitles-button", player);
  const captions = cc && cc.style.display !== "none" && cc.getAttribute("aria-disabled") !== "true" ? refOf(cc) : undefined;
  const ratio = video && video.videoWidth ? video.videoHeight / video.videoWidth : 9 / 16;
  // On a playlist or Mix, its own Previous and Next (on the first video, Previous replays it once it has started).
  const list = new URL(location.href).searchParams.has("list");
  return {
    t: "portal",
    key: "player",
    ref: refOf(player),
    ratio: Math.min(Math.max(ratio, 0.4), 1),
    label,
    media: {
      video: video ? refOf(video) : undefined, play: vis(".ytp-play-button"), captions, fullscreen: vis(".ytp-fullscreen-button"),
      prev: list ? vis(".ytp-prev-button") : undefined, next: list ? vis(".ytp-next-button") : undefined,
    },
  };
}

/** The player's place while YouTube has not drawn it yet, so the title under it never jumps. */
function playerWait(label: string): Block {
  return { t: "portal", key: "player", ref: "yt-player-wait", ratio: 9 / 16, label: label || t("video"), media: {} };
}

function watch(): Page | null {
  const flexy = q("ytd-watch-flexy:not([hidden])");
  // On a fresh load the tab's title already names the video, before YouTube draws its own.
  const docTitle = clean(document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, ""));
  if (firstLoad() && !loadedTitle && docTitle !== "YouTube") loadedTitle = docTitle;
  const early = firstLoad() ? loadedTitle : "";
  // After an in-place navigation the tab's title still names the page left: never this video's name (F921).
  if (docAt.url !== location.href) docAt = { url: location.href, title: firstLoad() ? "" : docTitle };
  if (!flexy) {
    // YouTube draws its player before the rest of the watch page. Until then: that
    // player and the title in this page's own layout, so nothing jumps when the rest comes.
    if (!watchSettling()) return null;
    const player = early ? q("#movie_player") : null;
    const blocks: Block[] = [player ? playerBlock(player, early) : playerWait(early)];
    if (early) blocks.push({ t: "h", key: "title", level: 1, text: early });
    blocks.push(loadingBlock());
    // Unnamed until its title shows: while YouTube opens a video, every page is called "YouTube".
    const page = base(blocks, early);
    page.partial = true;
    return page;
  }
  const meta = q("ytd-watch-metadata", flexy);
  const blocks: Block[] = [];
  const title = clean(q("#title h1", meta ?? flexy)?.textContent);
  // Without a title, the metadata panels still hold the previous video: show nothing stale.
  const fresh = !!title;

  // YouTube's own error screen (unavailable video, "confirm you're not a bot").
  const err = q("#error-screen", flexy);
  const errShown = !!err && visible(err) && textIn(err).length > 0;
  // An error screen comes with no title, but Up next and comments still load for this video.
  const vid = new URL(location.href).searchParams.get("v");
  const lists = fresh || (errShown && !!vid && flexy.getAttribute("video-id") === vid);
  if (errShown) {
    const lines = qa(".interstitialViewModelTextTitle, .interstitialViewModelTextSubtitle, .interstitialViewModelTextDescription, #reason, #subreason, .ytp-error-content-wrap-reason", err)
      .map((e) => textIn(e))
      .filter(Boolean);
    blocks.push({ t: "note", key: "yt-error", tone: "warn", text: (lines.length ? lines : [textIn(err)]).join(". ").replace(/\.\./g, ".") });
    const acts = qa("button, a[href]", err).filter((b) => visible(b) && textIn(b)).map((b) => toAction(b, textIn(b)));
    if (acts.length) blocks.push({ t: "actions", key: "yt-error-actions", actions: acts });
  }

  // On a fresh load the player is drawn first outside the watch page, and moved into it a moment later.
  const player = q("#movie_player", flexy) ?? (early ? q("#movie_player") : null);
  if (player && !errShown) blocks.push(playerBlock(player, title || early));
  else if (!fresh && !errShown) blocks.push(playerWait(early));
  if (title || (early && !errShown)) blocks.push({ t: "h", key: "title", level: 1, text: title || early });
  if (!fresh && !errShown) blocks.push(loadingBlock());

  if (meta && fresh) {
    // Channel, views, date.
    const chA = q<HTMLAnchorElement>("#owner ytd-channel-name a", meta);
    const subs = clean(q("#owner-sub-count", meta)?.textContent);
    const tip = clean(q("ytd-watch-info-text tp-yt-paper-tooltip", meta)?.textContent);
    const parts = tip ? tip.split("•").map((s) => s.trim()).filter(Boolean).slice(0, 2) : [];
    if (!parts.length) {
      const v = q("ytd-watch-info-text #view-count", meta)?.getAttribute("aria-label");
      const d = q("ytd-watch-info-text #date-text", meta)?.getAttribute("aria-label");
      if (v) parts.push(clean(v));
      if (d) parts.push(clean(d));
    }
    if (chA) {
      blocks.push({
        t: "p",
        key: "channel",
        content: [{ a: clean(chA.textContent), href: absUrl(chA.getAttribute("href")), ref: refOf(chA) }, subs ? " · " + subs : ""],
      });
    }
    if (parts.length) blocks.push({ t: "p", key: "stats", content: [parts.join(" · ")], small: true });

    const actions: Action[] = [];
    const sub = q("#subscribe-button ytd-subscribe-button-renderer button, #subscribe-button button", meta);
    if (sub && visible(sub)) actions.push({ ...toAction(sub, textIn(sub) || clean(sub.getAttribute("aria-label"))), kind: "primary" });
    actions.push(...likeActions(meta));
    // Save, found by its bookmark icon (its label changes with the language), or by its label until the icon has loaded.
    const save = qa("#top-level-buttons-computed button, #flexible-item-buttons button", meta).find(
      (b) => visible(b) && (SAVE_ICON.test(q("path", b)?.getAttribute("d") ?? "") || SAVE_LABEL.test(clean(b.getAttribute("aria-label")) || textIn(b))),
    );
    if (save) actions.push(toAction(save, textIn(save) || clean(save.getAttribute("aria-label"))));
    else {
      // At some widths and zooms YouTube folds Save into its "More actions" menu: offer that menu, which opens as Sift's dialog.
      const more = vis1(qa("ytd-menu-renderer > yt-button-shape button[aria-label], ytd-menu-renderer > yt-icon-button button[aria-label]", q("#actions", meta) ?? meta));
      if (more) actions.push(toAction(more, clean(more.getAttribute("aria-label")) || textIn(more)));
    }
    if (actions.length) blocks.push({ t: "actions", key: "watch-actions", actions });
  }

  // The playlist or Mix this video plays in (also under the bot check, as on the original).
  const playlist = lists ? playlistSection(flexy) : null;
  if (playlist) blocks.push(playlist);

  // Chapters (hidden panel, always in the DOM when the video has chapters).
  const chapterEls = qa('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] ytd-macro-markers-list-item-renderer', flexy.ownerDocument);
  if (chapterEls.length && fresh) {
    const rows = chapterEls
      .map((c) => {
        const a = q<HTMLAnchorElement>("a#endpoint", c);
        const ttl = clean(q("h4[title], h3[title]", c)?.getAttribute("title")) || clean(q("h4, h3", c)?.textContent);
        const time = clean(q("#time", c)?.textContent);
        return a && ttl ? [{ a: `${time} ${ttl}`.trim(), href: absUrl(a.getAttribute("href")), ref: refOf(a) }] : null;
      })
      .filter(Boolean) as { a: string; href?: string; ref: string }[][];
    const name = panelTitle("engagement-panel-macro-markers-description-chapters") || t("chapters");
    if (rows.length) blocks.push({ t: "section", key: "chapters", title: `${name} (${rows.length})`, collapsed: true, blocks: [{ t: "ul", key: "chapter-list", items: rows }] });
  }

  // Description: full text sits in a hidden panel; fall back to the inline expander.
  const exp =
    q('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"] ytd-expandable-video-description-body-renderer ytd-text-inline-expander') ??
    (meta ? q("#description-inline-expander", meta) : null);
  const descRoot = exp ? [q("#expanded", exp), q("#snippet", exp)].find((e) => e && clean(e.textContent)) ?? exp : null;
  const paras = descRoot && fresh ? descParas(descRoot) : [];
  // The transcript, which YouTube offers at the end of the description and opens in a panel.
  const transcript = fresh ? transcriptPanel() : null;
  const tsBtn = fresh ? qa("ytd-video-description-transcript-section-renderer button").find((b) => !!(clean(b.getAttribute("aria-label")) || textIn(b))) : undefined;
  const tsAct: Block[] = [];
  if (tsBtn) {
    const a = toAction(tsBtn, clean(tsBtn.getAttribute("aria-label")) || textIn(tsBtn));
    a.expanded = !!transcript;
    tsAct.push({ t: "actions", key: "desc-transcript", actions: [a] });
  }
  if (paras.length) {
    const words = paras.reduce((n, p) => n + p.content.map((c) => (typeof c === "string" ? c : "a" in c ? c.a : "")).join(" ").split(/\s+/).filter(Boolean).length, 0);
    // Link lists and lyrics are not prose to shorten: shown whole, with their links.
    const links = paras.reduce((n, p) => n + p.content.filter((c) => typeof c === "object" && "a" in c).length, 0);
    const lines = paras.reduce((n, p) => n + 1 + p.content.filter((c) => typeof c === "object" && "br" in c).length, 0);
    const proseLike = links < 4 && words / Math.max(1, lines) >= 9;
    blocks.push({
      t: "section",
      key: "description",
      title: panelTitle("engagement-panel-structured-description") || t("description"),
      // A long description (lyrics, link lists) would push Up next and comments far down.
      collapsed: words > 80 || paras.length > 6,
      blocks: [{ t: "article", key: "desc-article", words, blocks: paras, ...(proseLike ? {} : { prose: false }) }, ...tsAct],
    });
  } else if (tsAct.length) blocks.push(...tsAct);
  if (transcript) blocks.push(transcript);

  // Up next: beside the video, or below it in the one-column layout (narrow windows, zoom).
  const related = qa("#related ytd-watch-next-secondary-results-renderer yt-lockup-view-model, #related ytd-compact-video-renderer", flexy)
    .filter((r) => !isAd(r))
    .map((r) => (r.localName === "yt-lockup-view-model" ? fromLockup(r) : fromVideoRenderer(r)))
    .filter(Boolean) as Item[];
  if (related.length && lists) blocks.push({ t: "section", key: "related", title: t("upNext"), collapsed: true, blocks: [{ t: "items", key: "related-list", items: related, rewrite: "oneliner" }] });

  // Comments render only when scrolled near; opening the section asks for them.
  const comments = q("ytd-comments#comments", flexy);
  if (comments && lists) {
    const count = clean(q("ytd-comments-header-renderer #count", comments)?.textContent);
    const items = commentList(comments);
    // "Sort by" (Top comments, Newest first) opens YouTube's menu, which Sift shows as a dialog.
    const sortBtn = vis1(qa("ytd-comments-header-renderer #sort-menu tp-yt-paper-button, ytd-comments-header-renderer #sort-menu button, ytd-comments-header-renderer yt-sort-filter-sub-menu-renderer [role=button]", comments));
    const sort: Block[] = sortBtn ? [{ t: "actions", key: "c-sort", actions: [{ ...toAction(sortBtn, clean(sortBtn.getAttribute("aria-label")) || textIn(sortBtn) || "Sort by"), kind: "quiet" }] }] : [];
    // "Comments are turned off": say so instead of loading forever.
    const msg = q("ytd-message-renderer", comments);
    const closed = msg && visible(msg) ? textIn(q("#message", msg) ?? msg) : "";
    blocks.push({
      t: "section",
      key: "comments",
      title: count || t("comments"),
      collapsed: true,
      reveal: refOf(comments),
      blocks: items.length ? [...sort, { t: "items", key: "comment-list", items }] : [{ t: "p", key: "c-loading", content: [closed || t("loading")], small: true }],
    });
  }
  const page = base(blocks, title || (errShown ? (docTitle !== "YouTube" && docTitle !== docAt.title && docTitle) || early || "YouTube" : early));
  if (!fresh && !errShown) {
    // Long after the video changed, still no title: the title sits somewhere this adapter
    // does not look, and the generic extractor shows the page instead.
    if (!watchSettling()) return null;
    page.partial = true;
  }
  page.dialog = sortDialog();
  return page;
}

/**
 * The playlist or Mix panel beside the video: its name (a link to the playlist),
 * owner, place ("3 / 28"), loop and shuffle, and its videos with the one playing marked.
 */
function playlistSection(flexy: Element): Block | null {
  const p = qa("ytd-playlist-panel-renderer", flexy).find((e) => visible(e) && q("ytd-playlist-panel-video-renderer", e));
  if (!p) return null;
  const head = q("#header-contents", p) ?? p;
  // Its name, also while YouTube shows "Next: ..." in its place (a collapsed panel).
  const titleEl = q("#header-description h3:not(#next-video-title)", head);
  const name = clean(titleEl?.textContent) || clean(q(".byline-title", head)?.getAttribute("title"));
  if (!name) return null;
  const nameA = (titleEl && q<HTMLAnchorElement>("a[href]", titleEl)) ?? q<HTMLAnchorElement>(".byline-title a[href]", head);
  // The owner, or what a Mix says instead ("Mixes are playlists YouTube makes for you").
  const owner = q(".publisher", head);
  const ownerA = owner ? q<HTMLAnchorElement>("a[href]", owner) : null;
  const ownerText = owner ? clean(owner.textContent) : "";
  // A Mix has no place: YouTube hides its "1 / NaN".
  const pos = qa(".index-message", head).map((e) => (visible(e) ? clean(e.textContent) : "")).find((s) => /^\d+\s*\/\s*\d+$/.test(s)) ?? "";
  const line: Inline[] = [nameA ? { a: name, href: absUrl(nameA.getAttribute("href")), ref: refOf(nameA) } : name];
  if (ownerText && ownerText !== name) line.push(" · ", ownerA ? { a: ownerText, href: absUrl(ownerA.getAttribute("href")), ref: refOf(ownerA) } : ownerText);
  if (pos) line.push(" · " + pos);
  const blocks: Block[] = [{ t: "p", key: "pl-head", content: line }];
  // Loop (its label says what the next press does: "Loop playlist", "Loop video", "Turn off loop") and Shuffle.
  const acts = qa("#playlist-actions #start-actions button", p)
    .filter((b) => visible(b) && !!(clean(b.getAttribute("aria-label")) || textIn(b)))
    .map((b) => {
      const a = toAction(b, clean(b.getAttribute("aria-label")) || textIn(b));
      const pr = b.getAttribute("aria-pressed");
      if (pr === "true" || pr === "false") a.pressed = pr === "true";
      a.kind = "quiet";
      return a;
    });
  if (acts.length) blocks.push({ t: "actions", key: "pl-actions", actions: acts });
  const items: Item[] = [];
  for (const r of qa("ytd-playlist-panel-video-renderer", p)) {
    if (r.closest("[hidden]")) continue;
    const a = q<HTMLAnchorElement>("a#wc-endpoint, a[href*='/watch']", r);
    const ttl = q("#video-title", r);
    const title = clean(ttl?.getAttribute("title")) || (ttl ? textIn(ttl) : "");
    if (!a || !title) continue;
    const channel = clean(q("#byline", r)?.textContent);
    const time = clean(q("ytd-thumbnail-overlay-time-status-renderer badge-shape, ytd-thumbnail-overlay-time-status-renderer #text", r)?.textContent);
    const it: Item = { key: "pl:" + refOf(r), title, href: cleanHref(a.getAttribute("href")), ref: refOf(a), meta: [channel, time].filter(Boolean), context: channel };
    if (r.hasAttribute("selected")) it.badge = t("nowPlaying");
    items.push(it);
  }
  if (!items.length) return null;
  blocks.push({ t: "items", key: "pl-list", items, rewrite: "oneliner" });
  // Open or closed, it stays so while the reader moves through this list, as YouTube keeps its panel.
  const list = new URL(location.href).searchParams.get("list") || name;
  return { t: "section", key: "playlist:" + list, title: pos ? `${name} · ${pos}` : name, collapsed: true, keep: true, blocks };
}

/** The bookmark icon of the Save button (and the older "add to playlist" icon). */
const SAVE_ICON = /^(M19 2H5a2 2 0 00-2 2v16\.887|M22 13h-4v4h-2v-4h-4v-2h4V7h2v4h4v2z)/;
const SAVE_LABEL = /^(save|guardar|añadir a|agregar a|salvar|enregistrer|speichern|salva|opslaan|zapisz|kaydet|сохранить|保存|저장)/i;

/** Like (with its count) and Dislike. YouTube's like label repeats the count in a long sentence, so Sift says "Like" in the page's language. */
function likeActions(root: ParentNode): Action[] {
  const out: Action[] = [];
  const like = q("like-button-view-model button, #like-button button", root);
  if (like && visible(like)) {
    const a = toAction(like, t("like"));
    // The count, when shown; signed out on a fresh video the button just says "Like".
    // On a Short it sits in the button's label, beside the button.
    const n = textIn(like) || textIn(like.closest("label") ?? like);
    a.badge = /\d/.test(n) ? n : undefined;
    out.push(a);
  }
  const dislike = q("dislike-button-view-model button, #dislike-button button", root);
  const no = dislike ? clean(dislike.getAttribute("aria-label")) || textIn(dislike) : "";
  if (dislike && no && visible(dislike)) out.push(toAction(dislike, no));
  return out;
}

/**
 * The transcript panel, once opened ("Show transcript"): each line with its
 * time, a click on it plays from there, as on the original; and its Close.
 */
function transcriptPanel(): Block | null {
  const panel = qa('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]').find((p) => /transcript/i.test(p.getAttribute("target-id") ?? ""));
  if (!panel) return null;
  const rows: Inline[][] = [];
  // The current layout (a line is a button holding its time and text), then the older one.
  for (const seg of qa("macro-markers-panel-item-view-model, ytd-transcript-segment-renderer", panel)) {
    const target = seg.matches("[role=button]") ? seg : (q("[role=button], .segment", seg) ?? seg);
    const time = clean(q("transcript-segment-view-model > [aria-hidden=true], .segment-timestamp", seg)?.textContent);
    const text = clean(q("transcript-segment-view-model span[role=text], .segment-text", seg)?.textContent);
    if (text) rows.push([{ a: time ? `${time} ${text}` : text, ref: refOf(target) }]);
  }
  const title = clean(q("ytd-engagement-panel-title-header-renderer #title-text", panel)?.textContent) || "Transcript";
  const close = qa("ytd-engagement-panel-title-header-renderer #visibility-button button", panel).find((b) => !!clean(b.getAttribute("aria-label")));
  const blocks: Block[] = [];
  if (close) blocks.push({ t: "actions", key: "ts-close", actions: [{ ...toAction(close, clean(close.getAttribute("aria-label"))), kind: "quiet" }] });
  blocks.push(rows.length ? { t: "ul", key: "ts-lines", items: rows } : loadingBlock());
  return { t: "section", key: "transcript", title, blocks };
}

/** An engagement panel's own title ("Description", "Chapters"), in the page's language, once YouTube has drawn it. */
function panelTitle(target: string): string {
  return clean(q(`ytd-engagement-panel-section-list-renderer[target-id="${target}"] ytd-engagement-panel-title-header-renderer #title-text`)?.textContent);
}

const COMMENT_SEL = "ytd-comment-view-model, ytd-comment-renderer";

/** The visible top-level comment threads, each with its visible replies nested under it. */
function commentList(root: Element): Item[] {
  return qa("ytd-comment-thread-renderer", root)
    .filter((th) => !th.parentElement?.closest("ytd-comment-thread-renderer") && visible(th))
    // Enough for a long read; scrolling to the end of Sift loads more.
    .slice(0, 400)
    .map((th) => commentItem(th, 0))
    .filter(Boolean) as Item[];
}

/** One comment: a thread's own comment (with its replies) or a single reply. */
function commentItem(el: Element, depth: number): Item | null {
  const own = el.matches(COMMENT_SEL) ? el : (q(":scope > #comment-container, :scope > #comment", el) ?? q(COMMENT_SEL, el));
  if (!own) return null;
  const author = clean(q("#author-text", own)?.textContent);
  const content = q("#content-text", own);
  // The whole text: its paragraphs, links (sites, timestamps, hashtags) and emoji (images) kept.
  const body: Block[] = content ? descParas(content, true).map((b) => ({ ...b, key: "c" + b.key })) : [];
  // An attached image is part of what the comment says, with or without text.
  const pic = q("ytw-comment-image-attachment-view-model, #attachment, [class*=ImageAttachment]", own);
  const img = pic ? q<HTMLImageElement>("img", pic) : null;
  const alt = clean(img?.getAttribute("alt")) || t("image");
  const src = img ? imgSrc(img) : "";
  if (src && !src.startsWith("data:")) body.push({ t: "img", key: "cimg", img: { src, alt, w: img!.width || undefined } });
  else if (pic && !body.length) body.push({ t: "p", key: "cimg", content: [`[${alt}]`] });
  if (!body.length) return null;
  const when = clean(q("#published-time-text", own)?.textContent);
  const likes = clean(q("#vote-count-middle", own)?.textContent);
  // "Pinned by @ElaVegan", in the page's words.
  const pinEl = q("#pinned-comment-badge", own);
  const pinned = pinEl && visible(pinEl) ? textIn(pinEl) : "";
  // Author and time over the text, as in other comment threads.
  const it: Item = { key: "c:" + refOf(el), title: when || author, lead: when ? author : undefined, body, meta: [pinned, likes ? t("nLikes", { n: likes }) : ""].filter(Boolean) };
  if (el.localName === "ytd-comment-thread-renderer") {
    const r = repliesOf(el, depth);
    if (r.items.length) it.replies = r.items;
    if (r.actions.length) it.actions = r.actions;
  }
  return it;
}

/** Already scrolled into view, so YouTube loads them: each reply loader once. */
const woken = new WeakSet<Element>();

/**
 * A thread's replies: shown ones as items, and its own reply buttons ("12 replies",
 * "Show more replies", "Hide replies"). Replies YouTube hides (after a re-sort it
 * reuses a thread and hides its old replies) are left out.
 */
function repliesOf(th: Element, depth: number): { items: Item[]; actions: Action[] } {
  const out = { items: [] as Item[], actions: [] as Action[] };
  const rr = q(":scope > #replies ytd-comment-replies-renderer", th);
  if (!rr || !visible(rr)) return out;
  const mine = (e: Element) => e.parentElement?.closest("ytd-comment-thread-renderer") === th;
  if (depth < 3) {
    // Threaded layout: each reply is a sub-thread; older layout: plain comments.
    const subs = qa("ytd-comment-thread-renderer", rr).filter((s) => mine(s) && visible(s));
    const plain = subs.length ? [] : qa(COMMENT_SEL, rr).filter((c) => mine(c) && !c.parentElement?.closest(COMMENT_SEL) && visible(c));
    for (const r of [...subs, ...plain].slice(0, 100)) {
      const it = commentItem(r, depth + 1);
      if (it) out.items.push(it);
    }
  }
  const seen = new Set<string>();
  for (const b of qa("#more-replies button, #more-replies-sub-thread button, #less-replies button, ytd-continuation-item-renderer button", rr)) {
    const label = textIn(b) || clean(b.getAttribute("aria-label"));
    if (!mine(b) || !label || seen.has(label) || !visible(b)) continue;
    seen.add(label);
    out.actions.push({ ...toAction(b, label), kind: "quiet" });
  }
  // Opening replies shows a loader that YouTube fills only once it scrolls into view;
  // the original is never scrolled under Sift, so bring it into view once.
  const loader = qa("ytd-continuation-item-renderer", rr).find((c) => mine(c) && visible(c) && !qa("button", c).some((b) => visible(b)));
  if (loader && !woken.has(loader)) {
    woken.add(loader);
    loader.scrollIntoView({ block: "center" });
    dispatchEvent(new Event("scroll"));
  }
  return out;
}

/** The comments' sort menu when open: named by its button, each choice with its description, the current one pressed. */
function sortDialog(): Dialog | undefined {
  const menu = qa("yt-sort-filter-sub-menu-renderer").find((m) => {
    const dd = q("tp-yt-iron-dropdown", m);
    return !!dd && dd.getAttribute("aria-hidden") !== "true" && visible(dd) && !!q("tp-yt-paper-listbox a, tp-yt-paper-listbox tp-yt-paper-item", dd);
  });
  if (!menu) return undefined;
  const dd = q("tp-yt-iron-dropdown", menu)!;
  const trigger = q("#label, [aria-haspopup] [role=button], tp-yt-paper-button", menu);
  const title = clean(trigger?.getAttribute("aria-label")) || clean(q("tp-yt-paper-tooltip", menu)?.textContent) || clean(q("#icon-label", menu)?.textContent);
  const blocks: Block[] = [];
  for (const opt of qa("tp-yt-paper-listbox > a, tp-yt-paper-listbox > tp-yt-paper-item", dd)) {
    const label = clean(q(".item", opt)?.childNodes[0]?.textContent) || clean(q(".item", opt)?.textContent) || textIn(opt).split("\n")[0];
    if (!label) continue;
    const a = toAction(q("tp-yt-paper-item", opt) ?? opt, label);
    delete a.href;
    a.kind = "quiet";
    a.pressed = opt.getAttribute("aria-selected") === "true" || opt.classList.contains("iron-selected");
    blocks.push({ t: "actions", key: "so:" + refOf(opt), actions: [a] });
    const sub = clean(q("#subtitle", opt)?.textContent);
    if (sub) blocks.push({ t: "p", key: "sd:" + refOf(opt), content: [sub], small: true });
  }
  if (!blocks.length) return undefined;
  return { key: "dlg:" + refOf(dd), ref: refOf(dd), title: title || t("comments"), blocks };
}

/**
 * A Short: its player (or YouTube's error in its place, with no player controls),
 * title, channel, and the few actions that matter, including the previous and next Short.
 */
function shorts(): Page | null {
  const root = q("ytd-shorts:not([hidden])");
  const player = root ? q("#shorts-player", root) : null;
  // The Short on screen is the reel that holds the player.
  const reel = player?.closest("ytd-reel-video-renderer") ?? (root ? q("ytd-reel-video-renderer[is-active]", root) : null);
  if (!root || !reel) return settling() ? loadingPage() : null;
  const docTitle = clean(document.title.replace(/^\(\d+\)\s*/, "").replace(/\s*-\s*YouTube$/, ""));
  const title = clean(q("h1, h2", reel)?.textContent) || docTitle;
  if (!title) return settling() ? loadingPage() : null;
  const blocks: Block[] = [];
  // Laid out, whether or not it is drawn now: behind Sift (not shown through it), the
  // player of a Short reached by Next video keeps its error hidden, and fades it in.
  const said = (e: Element) => clean(e.textContent);
  const err = player ? qa(".ytp-error", player).find((e) => e.checkVisibility() && said(e)) : undefined;
  if (err) {
    const lines = qa(".ytp-error-content-wrap-reason, .ytp-error-content-wrap-subreason", err).map(said).filter(Boolean);
    blocks.push({ t: "note", key: "yt-error", tone: "warn", text: (lines.length ? lines : [said(err)]).join(". ").replace(/\.\./g, ".") });
  } else if (player) {
    const video = q<HTMLVideoElement>("video", player);
    const ratio = video && video.videoWidth ? video.videoHeight / video.videoWidth : 16 / 9;
    // Upright video: narrow, so the whole Short fits on the screen.
    blocks.push({ t: "portal", key: "player", ref: refOf(player), ratio: Math.min(Math.max(ratio, 0.4), 2), maxWidth: 360, label: title, media: { video: video ? refOf(video) : undefined } });
  }
  blocks.push({ t: "h", key: "title", level: 1, text: title });
  const chA = q<HTMLAnchorElement>("yt-reel-channel-bar-view-model a[href], a[href^='/@']", reel);
  if (chA && textIn(chA)) blocks.push({ t: "p", key: "channel", content: [{ a: textIn(chA), href: absUrl(chA.getAttribute("href")), ref: refOf(chA) }] });
  const actions: Action[] = [];
  const sub = q("yt-reel-channel-bar-view-model button, #subscribe-button button", reel);
  if (sub && visible(sub) && textIn(sub)) actions.push({ ...toAction(sub, textIn(sub)), kind: "primary" });
  const bar = q("reel-action-bar-view-model, #actions", reel);
  if (bar) {
    actions.push(...likeActions(bar));
    // Comments: the button that opens them, named by YouTube ("View 177 comments").
    const cm = qa("button", bar).find((b) => visible(b) && !b.closest("like-button-view-model, dislike-button-view-model") && /\d/.test(clean(b.getAttribute("aria-label"))));
    if (cm) actions.push(toAction(cm, clean(cm.getAttribute("aria-label"))));
  }
  for (const id of ["navigation-button-up", "navigation-button-down"]) {
    const b = q(`#${id} button`, root);
    if (b && visible(b) && (b.getAttribute("aria-label") || textIn(b))) actions.push({ ...toAction(b, clean(b.getAttribute("aria-label")) || textIn(b)), kind: "quiet" });
  }
  if (actions.length) blocks.push({ t: "actions", key: "short-actions", actions });
  // The full video a Short points to.
  const full = q<HTMLAnchorElement>("yt-reel-carousel-view-model a[href], yt-reel-multi-format-link-view-model a[href]", reel);
  if (full && textIn(full)) blocks.push({ t: "p", key: "full-video", content: [{ a: textIn(full), href: cleanHref(full.getAttribute("href")), ref: refOf(full) }] });
  // Comments, once their panel is open.
  const panel = qa("#shorts-panel-container ytd-engagement-panel-section-list-renderer", root).find((p) => visible(p) && q("ytd-comment-thread-renderer", p));
  if (panel) {
    const items = commentList(panel);
    const head = clean(q("ytd-engagement-panel-title-header-renderer #title-text", panel)?.textContent) || t("comments");
    if (items.length) blocks.push({ t: "section", key: "comments", title: head, blocks: [{ t: "items", key: "comment-list", items }] });
  }
  return base(blocks, title);
}

// Parts of YouTube's inline expander that are controls, not text.
const DESC_SKIP = "tp-yt-paper-button, #expand, #collapse, #ellipsis, [hidden], script, style, svg, img, yt-icon";

/**
 * The description as paragraphs with its links kept (sites, hashtags, timestamps).
 * YouTube keeps line breaks as "\n" in the text: a blank line starts a paragraph.
 */
function descParas(root: Element, emoji = false): Extract<Block, { t: "p" }>[] {
  const runs: Inline[] = [];
  const walkDesc = (el: Element) => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) runs.push(n.nodeValue ?? "");
      else if (n.nodeType === 1) {
        const e = n as Element;
        // A comment's custom emoji are images; their alt is the emoji.
        if (emoji && e.localName === "img") runs.push(e.getAttribute("alt") ?? "");
        if (e.matches(DESC_SKIP)) continue;
        if (e.localName === "br") runs.push("\n");
        else if (e.localName === "a") {
          const label = clean(e.textContent);
          if (label) runs.push({ a: label, href: cleanHref(e.getAttribute("href")), ref: refOf(e) });
        } else walkDesc(e);
      }
    }
  };
  walkDesc(root);
  const paras: Inline[][] = [[]];
  for (const r of runs) {
    if (typeof r !== "string") {
      paras[paras.length - 1].push(r);
      continue;
    }
    r.replace(/[ \t\u00a0]+/g, " ").split(/(\n)/).forEach((piece) => {
      const cur = paras[paras.length - 1];
      if (piece !== "\n") {
        if (piece) cur.push(piece);
        return;
      }
      // Two line breaks in a row end the paragraph; one is a line break inside it.
      const last = cur[cur.length - 1];
      if (last && typeof last === "object" && "br" in last) {
        cur.pop();
        paras.push([]);
      } else if (cur.length) cur.push({ br: true });
    });
  }
  return paras
    .map((p) => {
      while (p.length && typeof p[p.length - 1] === "object" && "br" in (p[p.length - 1] as object)) p.pop();
      return p;
    })
    .filter((p) => p.some((c) => (typeof c === "string" ? c.trim() : true)))
    .slice(0, 60)
    .map((content, i) => ({ t: "p" as const, key: "desc" + i, content }));
}

/**
 * The top bar's Settings menu and its pages (Appearance, Display language,
 * Restricted Mode, Location), named as YouTube names them: the menu after its
 * button, a page after its own heading. A page's chosen entry is pressed.
 */
function settingsMenu(): Dialog | undefined {
  const menu = qa("ytd-popup-container ytd-multi-page-menu-renderer[menu-style=multi-page-menu-style-type-system]").find((m) => visible(m));
  if (!menu) return undefined;
  const box = menu.closest("tp-yt-iron-dropdown") ?? menu;
  // A page (Display language) is a menu inside the menu, with Back and its heading.
  const page = qa("#submenu ytd-multi-page-menu-renderer", menu).filter((m) => visible(m)).pop() ?? menu;
  // This page's own heading: a page left with Back stays in the menu, hidden, with its heading.
  const head = qa("ytd-simple-menu-header-renderer", page).find((h) => h.closest("ytd-multi-page-menu-renderer") === page && visible(h)) ?? null;
  const opener = qa("ytd-masthead ytd-topbar-menu-button-renderer button[aria-label]").find((b) => visible(b));
  const title = clean(q("h2", head ?? page)?.textContent) || clean(opener?.getAttribute("aria-label")) || t("menu");
  const blocks: Block[] = [];
  const back = head ? q("#back-button button", head) : null;
  if (back && visible(back)) blocks.push({ t: "actions", key: "ms-back", actions: [{ ...toAction(back, clean(back.getAttribute("aria-label")) || textIn(back)), kind: "quiet" }] });
  let row: Action[] = [];
  let section: Element | null = null;
  const flush = () => {
    if (row.length) blocks.push({ t: "actions", key: "ms:" + row[0].ref, actions: row });
    row = [];
  };
  const ENTRY = "ytd-compact-link-renderer, ytd-toggle-theme-compact-link-renderer, ytd-toggle-item-renderer, ytd-message-renderer";
  for (const e of qa(ENTRY, page)) {
    if (e.closest("ytd-multi-page-menu-renderer") !== page || !visible(e)) continue;
    // Each group of entries is its own row, as YouTube separates them.
    const sec = e.closest("yt-multi-page-menu-section-renderer");
    if (sec !== section) flush();
    section = sec;
    if (e.localName === "ytd-message-renderer") {
      flush();
      if (textIn(e)) blocks.push({ t: "p", key: "ms:" + refOf(e), content: [textIn(e)], small: true });
    } else if (e.localName === "ytd-toggle-item-renderer") {
      // Restricted Mode: what it does, then its switch, named by its caption.
      flush();
      const sw = q("tp-yt-paper-toggle-button, [role=switch], [aria-pressed]", e);
      const cap = q("#caption", e);
      for (const d of qa(":scope > div", e)) {
        if (d.contains(sw) || !textIn(d)) continue;
        blocks.push({ t: "p", key: "ms:" + refOf(d), content: [textIn(d)] });
      }
      if (sw) {
        const a = toAction(sw, (cap && textIn(cap)) || clean(sw.getAttribute("aria-label")) || textIn(e));
        const on = sw.getAttribute("aria-pressed") ?? sw.getAttribute("aria-checked");
        a.pressed = on === "true";
        row.push(a);
        flush();
      }
    } else {
      // An entry opens its page, a link, or (on a page) chooses; the chosen one has YouTube's check mark.
      const target = q("a#endpoint", e) ?? e;
      const label = textIn(e);
      if (!label) continue;
      const a = toAction(target, label);
      a.kind = "quiet";
      if (/selection/.test(e.getAttribute("compact-link-style") ?? "")) {
        const mark = q("#content-icon", e);
        a.pressed = !!mark && visible(mark) && !!q("yt-icon:not([hidden])", mark);
      }
      row.push(a);
    }
  }
  flush();
  if (blocks.length <= (back ? 1 : 0)) return undefined;
  return { key: "dlg:" + refOf(box), ref: refOf(box), title, blocks };
}

/** The first visible element of a list. */
function vis1(els: Element[]): Element | null {
  return els.find((e) => visible(e)) ?? null;
}

const POPUP_HOST = "ytd-popup-container, tp-yt-paper-dialog, tp-yt-iron-dropdown, dialog, [role=dialog], [role=alertdialog], [aria-modal=true]";

export const youtube: Adapter = {
  name: "youtube",
  match: (u) => /(^|\.)youtube\.com$/.test(u.hostname) && u.hostname !== "music.youtube.com",
  extract(u) {
    setLang(document.documentElement.lang || "en");
    // Whatever goes wrong here, the generic extractor still shows the page.
    try {
      const p =
        u.pathname === "/watch" ? watch()
        : u.pathname === "/results" ? results()
        : u.pathname.startsWith("/shorts/") ? shorts()
        : u.pathname === "/" || u.pathname.startsWith("/feed/") ? home(u.pathname)
        : null;
      if (p) p.dialog ??= settingsMenu();
      return p;
    } catch (e) {
      console.warn("sift: youtube adapter failed, using the generic view", e);
    }
    return null;
  },
  // A page this adapter does not read (a playlist, a channel) has the same top bar: Settings stays in Sift's (F1061).
  fallback(p) {
    const have = new Set((p.top ?? []).flatMap((a) => [a.ref, a.label.toLowerCase()]));
    const add = top().filter((a) => !have.has(a.ref) && !have.has(a.label.toLowerCase()));
    if (add.length) p.top = [...(p.top ?? []), ...add];
    p.dialog = settingsMenu() ?? p.dialog;
  },
  quiet: () => qa("#movie_player, ytd-miniplayer, #video-preview, tp-yt-paper-tooltip"),
  // YouTube opens its popups in a few known hosts. Fixed or absolute page parts (the masthead,
  // a shelf's "Show more") are not popups, and the bot check (role=dialog) is already a note.
  dropDialog: (el) => !!el.closest("#error-screen, yt-player-interstitial-renderer") || !el.closest(POPUP_HOST),
  loadMore() {
    // Rendered ones only: a spent continuation stays in the DOM with no size, and scrolling to it loads nothing.
    const conts = qa("ytd-continuation-item-renderer").filter((c) => c.closest("[hidden]") === null && c.getBoundingClientRect().height > 0);
    // On a watch page, more follows the section the reader has open in Sift: comments when Comments is
    // open (it comes last in Sift's view), else Up next. YouTube loads the first comments by itself.
    let pick = conts;
    if (location.pathname === "/watch") {
      const wantComments = store.local.get("sec:comments") === true;
      const mine = conts.filter((c) => !!c.closest("ytd-comments") === wantComments);
      // Comments not loaded yet: their own continuation is not rendered, and Up next's is the one to use.
      if (mine.length || !wantComments) pick = mine;
    }
    const cont = pick.pop();
    if (!cont) return false;
    cont.scrollIntoView({ block: "end" });
    return true;
  },
};
