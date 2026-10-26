// Sift's content script. Runs at document_start on every page:
// 1. covers the page with Sift's view before the original can paint,
// 2. extracts the page into a model and renders it, re-extracting as the page
//    changes, and
// 3. replays every interaction on the original page.

import { h, render } from "preact";
import type { Block, Page } from "./model";
import type { RuntimeMsg, StatName } from "../shared/messages";
import { extract, activeAdapter } from "./extract";
import { adopt, elOf, formerOf, refOf, sweepRefs } from "./registry";
import {
  FOCUSABLE, boxOf, cancelRelease, deepContains, enterPortalStops, enteredPortal, hidePortalStops, initPortals, layout,
  leavePortalStops, parkPortals, portalElements, portalOf, portalStops, portalsDisplaced, refOfPortal, releaseForFullscreen,
  mediaOf, reraisePortals, setModalOpen, setPortals, suspendPortals, videoIn,
} from "./portal";
import { accName, clean, shadowRootOf, textIn, visible } from "./dom";
import { refreshShield, shieldOff, shieldOn } from "./shield";
import * as proxy from "./proxy";
import { App, lastTouched, lastTyped, suggestAnchor } from "./ui/app";
import { CSS } from "./ui/styles";
import { H, changed, local, onEnter, onKeys, setRenderer, store } from "./ui/store";
import { processAi, resetAi, setAiReady } from "./ai";
import { setLang, t } from "./i18n";
import { armRecent, noteMutations, clearRecent, noteEntered } from "./recent";
import { findToast } from "./extract/generic";

const MODE_KEY = "sift:mode";
const isHtml = document.contentType === "text/html" && document.documentElement?.localName === "html";

type PortalBlock = Extract<Block, { t: "portal" }>;

if (isHtml && window.top === window && !(window as any).__siftLoaded) {
  (window as any).__siftLoaded = true;
  boot();
}

/** The player shows its own error screen (a video that cannot play, a bot check). */
function errorShown(el: Element): boolean {
  for (const e of Array.from(el.querySelectorAll<HTMLElement>('[class*="error" i], [role=alert]'))) {
    if (e.checkVisibility() && e.innerText.trim()) return true;
  }
  return false;
}

/** A player's own big "Play" control (an overlay before the video loads), looking through shadow roots. */
function playControl(root: Element | null): HTMLElement | null {
  if (!root) return null;
  const found: HTMLElement[] = [];
  const walk = (r: Element | ShadowRoot) => {
    for (const el of Array.from(r.querySelectorAll<HTMLElement>("button, [role=button]"))) {
      const label = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.innerText ?? ""}`;
      if (/\b(play|reproducir|reproduzir|lire|abspielen|riproduci)\b/i.test(label) && !/play(list| next|back speed)|autoplay/i.test(label) && el.checkVisibility()) found.push(el);
    }
    for (const el of Array.from(r.querySelectorAll("*"))) if ((el as HTMLElement).shadowRoot) walk((el as HTMLElement).shadowRoot!);
  };
  walk(root);
  if ((root as HTMLElement).shadowRoot) walk((root as HTMLElement).shadowRoot!);
  const area = (el: HTMLElement) => el.getBoundingClientRect().width * el.getBoundingClientRect().height;
  return found.sort((a, b) => area(b) - area(a))[0] ?? null;
}

/** A loaded player: a video with a source, in an element still on screen. */
function livePlayer(el: Element | null, video: Element | null): boolean {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const v = video instanceof HTMLVideoElement && video.isConnected ? video : videoIn(el);
  return !!v && (!!v.currentSrc || v.readyState > 0);
}

/** `a` and `b` are the same element, or one holds the other (through shadow roots). */
function nested(a: Element, b: Element): boolean {
  return a === b || deepContains(a, b) || deepContains(b, a);
}

/** The page says something went wrong (a player's error screen, a bot check). */
function hasWarning(blocks: Block[]): boolean {
  return blocks.some((b) => (b.t === "note" && (b.tone === "warn" || b.tone === "error")) || ((b.t === "section" || b.t === "article") && hasWarning(b.blocks)));
}

function findBlock(blocks: Block[], key: string): boolean {
  return blocks.some((b) => b.key === key || ((b.t === "section" || b.t === "article") && findBlock(b.blocks, key)));
}

/** Insert `b` after the block keyed `after` (inside sections and articles too); false if not found. */
function insertAfter(blocks: Block[], after: string, b: Block): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const x = blocks[i];
    if (x.key === after) {
      blocks.splice(i + 1, 0, b);
      return true;
    }
    if ((x.t === "section" || x.t === "article") && insertAfter(x.blocks, after, b)) return true;
  }
  return false;
}

/** Each media portal with the key of the block just before it, to put it back in the same place. */
function mediaPortals(blocks: Block[], out: { b: PortalBlock; after?: string; parent?: string }[] = [], parent?: string) {
  blocks.forEach((b, i) => {
    if (b.t === "portal" && b.media) out.push({ b, after: blocks[i - 1]?.key, parent });
    else if (b.t === "section" || b.t === "article") mediaPortals(b.blocks, out, b.key);
  });
  return out;
}

function boot() {
  // ---------- the root: one element in the top layer ----------
  const host = document.createElement("sift-root");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const mount = document.createElement("div");
  mount.style.display = "contents";
  shadow.append(style, mount);
  host.setAttribute("popover", "manual");

  const hostStyle = (mode: "sift" | "original") => {
    const base =
      "all: initial !important; display: block !important; position: fixed !important; margin: 0 !important; padding: 0 !important; border: 0 !important; z-index: 2147483647 !important; color-scheme: light !important; max-width: none !important; max-height: none !important;";
    host.setAttribute(
      "style",
      mode === "sift"
        ? base + "inset: 0 !important; width: 100% !important; height: 100% !important; overflow: auto !important; overscroll-behavior: contain !important; background: #fff !important;"
        : base + "inset: auto 0 0 auto !important; width: 0 !important; height: 0 !important; overflow: visible !important; background: transparent !important;",
    );
  };

  /** Put Sift's root back on top of the top layer (and portals above it). */
  const raise = () => {
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {
      /* not connected yet */
    }
    reraisePortals();
  };

  const attach = () => {
    if (!document.documentElement) return;
    if (host.parentNode !== document.documentElement) {
      document.documentElement.appendChild(host);
      raise();
      return;
    }
    try {
      if (!host.matches(":popover-open")) host.showPopover();
    } catch {
      /* not connected yet */
    }
  };

  let mode: "sift" | "original" = "sift";
  try {
    if (sessionStorage.getItem(MODE_KEY) === "original") mode = "original";
  } catch {
    /* storage blocked */
  }
  store.mode = mode;
  hostStyle(mode);
  attach();

  let scale = 1.125;
  const fontSize = () => {
    // `medium` resolves to the user's default font size in Chrome settings.
    const probe = document.createElement("span");
    probe.style.fontSize = "medium";
    shadow.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize) || 16;
    probe.remove();
    host.style.setProperty("--sift-fs", Math.round(px * scale * 10) / 10 + "px");
  };

  const main = () => shadow.getElementById("sift-main") as HTMLElement | null;

  /**
   * What the shield must leave usable: portals, and a page modal dialog or full
   * screen element, which the user sees above Sift and answers directly.
   */
  const exempt = () => {
    const fs = document.fullscreenElement;
    return [...portalElements(), ...modals, ...(fs ? [fs] : [])];
  };

  // ---------- page modal dialogs ----------
  // Light-DOM ones match :modal. Ones inside shadow roots (MDN's search) do not,
  // and send no toggle event to the document; the page-world helper reports them.
  const shadowModals = new Set<Element>();
  /** The open page modal dialogs (or hosts of closed shadow roots holding one), as last found. */
  let modals: Element[] = [];
  function refreshModals(): Element[] {
    const out = Array.from(document.querySelectorAll(":modal"));
    for (const m of shadowModals) {
      const open = m.isConnected && (m.matches(":modal") || !!shadowRootOf(m)?.querySelector(":modal"));
      if (!open) shadowModals.delete(m);
      else if (!out.includes(m)) out.push(m);
    }
    modals = out;
    store.pageModal = out.length > 0;
    setModalOpen(out.length > 0);
    return out;
  }
  /** A page modal dialog or full screen is open: it is on top, and the user answers it directly. */
  const pageModal = () => !!document.fullscreenElement || modals.length > 0;

  /** The focused element, through open and closed shadow roots. */
  function deepFocus(from: Element | null = document.activeElement): Element | null {
    let a = from;
    for (let sr = a ? shadowRootOf(a) : null; a && sr?.activeElement; sr = shadowRootOf(a)) a = sr.activeElement;
    return a;
  }

  /** Sift's own focusable elements, in order. */
  const siftFocusables = () => Array.from(shadow.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el.classList.contains("toggle"));

  /** The first Sift control after `el` in reading order (wrapping to the first). */
  const siftAfter = (el: Element) => {
    const layer = el.closest(".layer");
    const list = siftFocusables().filter((x) => !layer || layer.contains(x));
    return list.find((x) => x !== el && !!(el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING) && !el.contains(x)) ?? list[0];
  };

  // ---------- focus: never lost ----------
  // The Sift control focused before a menu or dialog sheet opened, to return
  // to; by label too, since a re-render may have replaced it.
  let opener: { el: HTMLElement; label: string; tag: string } | null = null;

  const labelOf = (el: Element) =>
    ((el as HTMLInputElement).labels?.[0]?.innerText || (el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim();

  /** Where focus was, in terms that survive a re-render that removes the element. */
  function spotOf(el: HTMLElement) {
    const li = el.closest("li.item");
    const list = li?.parentElement ?? null;
    const lists = Array.from(shadow.querySelectorAll("ol.items"));
    const text = el.localName === "input" || el.localName === "textarea";
    const f = el as HTMLInputElement;
    let sel: [number, number] | null = null;
    try {
      if (text && f.selectionStart !== null) sel = [f.selectionStart, f.selectionEnd ?? f.selectionStart];
    } catch {
      /* no caret in this input type */
    }
    const all = Array.from(shadow.querySelectorAll<HTMLElement>(FOCUSABLE));
    const i = all.indexOf(el);
    return {
      el,
      inSheet: !!el.closest(".layer, .suggest"),
      list: list ? lists.indexOf(list) : -1,
      listLabel: list?.getAttribute("aria-label") ?? null,
      item: li && list ? Array.from(list.children).indexOf(li) : -1,
      /** Its place among its item's controls. */
      pos: li ? Array.from(li.querySelectorAll(FOCUSABLE)).indexOf(el) : -1,
      /** Its item's title, to tell when the item itself is gone. */
      itemTitle: li?.querySelector(".title")?.textContent ?? null,
      label: labelOf(el),
      tag: el.localName,
      /** The page element it stands for. */
      ref: el.dataset?.ref ?? null,
      value: text ? f.value : null,
      sel,
      /**
       * The controls just after and before it, nearest first, for when it is gone
       * for good. Never Sift's own switch or skip link, nor the top bar from
       * elsewhere: the next Enter there would turn Sift off or open the menu.
       */
      near: i < 0 ? [] : [...all.slice(i + 1, i + 4), ...all.slice(Math.max(0, i - 3), i).reverse()].filter((c) => !c.matches(".toggle, .skip") && (!c.closest(".bar") || !!el.closest(".bar"))),
    };
  }
  type Spot = ReturnType<typeof spotOf>;

  /** Focus `el` if it can take focus now (connected, shown, not inert); true when it did. */
  function tryFocus(el: HTMLElement | null | undefined, scroll = false): boolean {
    if (!el || !el.isConnected || !el.getClientRects().length) return false;
    el.focus({ preventScroll: !scroll });
    return shadow.activeElement === el;
  }

  /** The Sift control a re-render put in place of the one at `spot`. */
  function twinOf(spot: Spot): HTMLElement | null {
    const all = Array.from(shadow.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((c) => c !== spot.el && c.localName === spot.tag && !!c.closest(".layer, .suggest") === spot.inSheet);
    // The same page element first: its label may have changed ("Mark as read" became "Mark as unread").
    if (spot.ref) {
      const same = all.find((c) => c.dataset.ref === spot.ref);
      if (same) return same;
    }
    // In a list, the same place in the same item comes next (see refocus); elsewhere, the same label.
    if (spot.list >= 0 || !spot.label) return null;
    return all.find((c) => labelOf(c) === spot.label) ?? null;
  }

  /** Keep the text being typed, and the caret, in a field a re-render replaced. */
  function carry(spot: Spot, el: HTMLElement) {
    if (spot.value === null || (el.localName !== "input" && el.localName !== "textarea")) return;
    const f = el as HTMLInputElement;
    // Only text typed since the last action: after Send, the page may clear the field on purpose.
    if (f.value !== spot.value && lastTyped(spot.el) > store.actAt) {
      f.value = spot.value;
      // The field's own handler sends it to the page, as typing would.
      f.dispatchEvent(new Event("input", { bubbles: true }));
    }
    try {
      if (spot.sel) f.setSelectionRange(spot.sel[0], spot.sel[1]);
    } catch {
      /* no caret in this input type */
    }
  }

  /**
   * Put focus back where it was: the same control if it is still there, the
   * one a re-render put in its place, inside a sheet that is open, the control
   * that opened a closed sheet, or the same spot in a list.
   */
  function refocus(spot: Spot | null, heads?: Set<string>) {
    if (store.mode !== "sift") return;
    // Sift putting focus back is not the user entering a field: the page field
    // gets no focus event (it would reopen the picker just closed).
    rescuing = true;
    try {
      refocusNow(spot, heads);
    } finally {
      rescuing = false;
    }
  }
  /** The headings Sift's view shows now, to find the one a change brought (a confirmation that replaced a step). */
  const headTexts = () => new Set(Array.from(shadow.querySelectorAll("#sift-main :is(h1, h2, h3)")).map((x) => x.textContent ?? ""));
  /** Focus is being put back by Sift, not moved by the user. */
  let rescuing = false;
  function refocusNow(spot: Spot | null, heads?: Set<string>) {
    if (spot && spot.el !== host) {
      // Still there (the page blurred it): back to it.
      if (tryFocus(spot.el)) return;
      const twin = twinOf(spot);
      if (twin && tryFocus(twin)) return carry(spot, twin);
    }
    const layer = shadow.querySelector<HTMLElement>(".layer");
    if (layer) {
      if (!Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE)).some((c) => tryFocus(c))) layer.querySelector<HTMLElement>(".sheet")?.focus({ preventScroll: true });
      return;
    }
    if (spot?.inSheet && opener) {
      const o = opener;
      if (tryFocus(o.el, true)) return;
      const same = Array.from(shadow.querySelectorAll<HTMLElement>(FOCUSABLE)).find((c) => c.localName === o.tag && labelOf(c) === o.label && !c.closest(".layer") && c.getClientRects().length > 0);
      if (tryFocus(same, true)) return;
    }
    if (spot && spot.list >= 0) {
      const lists = Array.from(shadow.querySelectorAll<HTMLElement>("ol.items"));
      const list = lists.find((l) => spot.listLabel && l.getAttribute("aria-label") === spot.listLabel) ?? lists[spot.list];
      const items = list ? Array.from(list.children) : [];
      const it = items[Math.min(spot.item, items.length - 1)];
      if (it) {
        const ctls = Array.from(it.querySelectorAll<HTMLElement>(FOCUSABLE));
        const at = ctls[spot.pos]?.localName === spot.tag ? ctls[spot.pos] : undefined;
        const ctl = at ?? ctls.find((c) => labelOf(c) === spot.label) ?? ctls[0];
        if (tryFocus(ctl, true)) return;
        // Its only control went while what it opens loads ("12 replies"): stay on
        // the entry itself, so Tab goes on into what it shows next, not past it.
        if (!ctls.length) {
          (it as HTMLElement).tabIndex = -1;
          if (tryFocus(it as HTMLElement, true)) return;
        }
      }
      const head = list?.previousElementSibling;
      if (head && /^H[1-6]$/.test(head.tagName)) {
        (head as HTMLElement).tabIndex = -1;
        return (head as HTMLElement).focus();
      }
    }
    // It is gone (a suggestion the page removed): the nearest control still there, or its re-rendered twin.
    for (const c of spot?.near ?? []) {
      const ref = c.dataset.ref;
      const now = c.isConnected ? c : ref ? shadow.querySelector<HTMLElement>(`${c.localName}[data-ref="${window.CSS.escape(ref)}"]`) : null;
      // Scrolled into view: the nearest control may be off screen.
      if (now && !!now.closest(".layer, .suggest") === spot!.inSheet && tryFocus(now, true)) return;
    }
    // What replaced it (a step's "Thank you"): its heading, read out as focus lands there.
    const fresh = heads && Array.from(shadow.querySelectorAll<HTMLElement>("#sift-main :is(h1, h2, h3)")).find((x) => !heads.has(x.textContent ?? "") && x.getClientRects().length > 0);
    if (fresh) {
      fresh.tabIndex = -1;
      if (tryFocus(fresh, true)) return;
    }
    main()?.focus({ preventScroll: true });
  }

  /** When this page started: Sift's start, or its last single-page navigation (see checkUrl). */
  let navAt = Date.now();
  /** A search opener was pressed and its box is not shown yet: when, and where focus waits. */
  let searchWait: { at: number; el: Element | null } | null = null;

  // ---------- page scroll boxes read to their end ("scroll to the end to agree") ----------
  /**
   * The end of a page scroll box's text is in Sift's view (the reader got there): the page's
   * box scrolls to its end too, so the page sees it read, as it would on the original, and
   * enables its Agree box itself. Sift never ticks or enables it.
   */
  let endsFrame = 0;
  function readEnds() {
    if (endsFrame) return;
    endsFrame = requestAnimationFrame(() => {
      endsFrame = 0;
      if (store.mode !== "sift") return;
      for (const m of Array.from(shadow.querySelectorAll<HTMLElement>("[data-scroll-end]"))) {
        const r = m.getBoundingClientRect();
        // Its last line shows: in the window, and in the sheet it is in.
        const clip = m.closest(".sheet")?.getBoundingClientRect();
        if (!r.height || r.bottom > Math.min(innerHeight, clip?.bottom ?? Infinity) + 1 || r.bottom < Math.max(0, clip?.top ?? 0)) continue;
        const box = elOf(m.dataset.scrollEnd);
        if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 2) continue;
        box.scrollTop = box.scrollHeight;
      }
    });
  }
  host.addEventListener("scroll", readEnds, { passive: true });
  // A sheet scrolls on its own.
  shadow.addEventListener("scroll", readEnds, { passive: true, capture: true });

  /** Render, and if that removed the focused element, put focus somewhere sensible. */
  function paint() {
    readEnds();
    const before = shadow.activeElement as HTMLElement | null;
    const spot = before ? spotOf(before) : null;
    const heads = before ? headTexts() : undefined;
    // A top-bar button that opens the site's search (BBC, Infobae) gives way to the box it opened:
    // typing goes there, also when the box shows a render later (focus waits where it was put).
    const hadBox = !!shadow.querySelector(".bar form.search input");
    const searchOpener = !!before?.closest(".bar") && !hadBox && /search|busca|suche|recherche|cerca|pesquis/i.test(spot?.label ?? "");
    const waiting = !!searchWait && Date.now() - searchWait.at < 4000 && before === searchWait.el;
    const more = before && MORE_LABEL.test(spot?.label ?? "") ? moreSpot(before) : null;
    render(h(App, {}), mount);
    // The page showed what "Show 8 more comments" brought (or a render after, while it loads):
    // the reader lands on the first new one, where the control was, as on the original.
    if (moreWait && (Date.now() - moreWait.at > 6000 || !moreWait.box.isConnected)) moreWait = null;
    else if (moreWait && shadow.activeElement === moreWait.hold && moreFocus(moreWait)) moreWait = null;
    const box = hadBox ? null : shadow.querySelector<HTMLElement>(".bar form.search input");
    if (((searchOpener && before && !before.isConnected) || waiting) && box && tryFocus(box)) {
      searchWait = null;
      return;
    }
    if (!before || before.isConnected) return;
    if (more && spot && !twinOf(spot) && moreFocus(more)) return;
    refocus(spot, heads);
    if (searchOpener) searchWait = { at: Date.now(), el: shadow.activeElement };
    // The user's action removed the entry focus was in (Delete, Archive): say so, since
    // focus now sits on the same button of the next one. Not when it opened another
    // page (an email, a video): that page's title is said instead.
    const title = spot?.itemTitle;
    if (title && Date.now() - store.actAt < 3000 && navAt < store.actAt && !Array.from(shadow.querySelectorAll("li.item .title")).some((x) => x.textContent === title)) say(t("removed", { title }), "before");
  }

  /** A control that shows more of a list in place ("Show 8 more comments", "Load more replies"). */
  const MORE_LABEL = /\b(show|load|view|see|read|display)\b.{0,30}\bmore\b|\bmore (comments?|replies|answers|results|posts|reviews)\b|^(show|view|see|load) (all|\d+)\b|^(mostrar|ver|cargar) (más|todos?|\d+)\b/i;
  type MoreSpot = { box: HTMLElement; i: number; y: number; old: Set<string>; at: number; hold: Element | null };
  /** The box of blocks that holds a "Show more" control, and the blocks it shows now. */
  function moreSpot(el: HTMLElement): MoreSpot | null {
    let blk: HTMLElement = el;
    while (blk.parentElement && blk.parentElement.children.length < 3) blk = blk.parentElement;
    const box = blk.parentElement;
    if (!box || box === main() || !main()?.contains(box)) return null;
    const kids = Array.from(box.children);
    return { box, i: kids.indexOf(blk), y: blk.getBoundingClientRect().top, old: new Set(kids.map((c) => c.textContent ?? "")), at: Date.now(), hold: null };
  }
  /**
   * Focus the first block the "Show more" control brought into its box, without moving the
   * view: it sits where the control was. Until it shows (the page is still loading), focus
   * waits on the block before the control, and moves on at the next render (see paint).
   */
  let moreWait: MoreSpot | null = null;
  function moreFocus(m: MoreSpot): boolean {
    if (!m.box.isConnected) return false;
    const kids = Array.from(m.box.children) as HTMLElement[];
    // New where the control was first; else anywhere in its box (a list the page sorted afresh).
    const isNew = (c: HTMLElement) => c.localName !== "summary" && !m.old.has(c.textContent ?? "") && c.getClientRects().length > 0;
    const fresh = kids.slice(m.i).find(isNew) ?? kids.find(isNew);
    const el = fresh ?? (m.hold || m.i < 1 ? null : kids[Math.min(m.i, kids.length) - 1]);
    if (!el) return false;
    if (!el.matches(FOCUSABLE)) el.tabIndex = -1;
    if (!tryFocus(el)) return false;
    // Where the control was, whatever the render did to the view on the way (it can shrink for a moment),
    // unless the reader has scrolled since.
    const r = el.getBoundingClientRect();
    if (userScrollAt < m.at) host.scrollTop += (fresh ? r.top : r.bottom) - m.y;
    moreWait = fresh ? null : { ...m, hold: el, at: Date.now() };
    return true;
  }

  // ---------- rendering ----------
  setRenderer(() => {
    paint();
    syncSuspension();
    layout();
  });

  // ---------- announcements ----------
  /** Say `text` once through the one live region, even when it is the same as last time. */
  let sayTimer = 0;
  /** What waits to be said. */
  let sayNext = "";
  /**
   * `join`: keep what waits to be said, and say `text` before or after it (the item an
   * action removed, then the page's toast about it: "Removed: X. Conversation archived. Undo").
   */
  function say(text: string, join?: "before" | "after") {
    clearTimeout(sayTimer);
    if (join && sayNext && !sayNext.includes(text)) text = join === "before" ? `${text} ${sayNext}` : `${sayNext} ${text}`;
    sayNext = text;
    store.announce = "";
    changed();
    sayTimer = window.setTimeout(() => {
      sayNext = "";
      store.announce = text;
      changed();
    }, 100);
  }

  /** Show a notice (a validation problem, a page message) and say it. */
  let noticeTimer = 0;
  /** `said`: what to say, when it is more than what shows (a toast's text and its button). */
  function notify(text: string, ms = 0, said = text, join?: "after") {
    clearTimeout(noticeTimer);
    store.notice = text;
    store.noticeActions = [];
    say(said, join);
    if (ms) {
      noticeTimer = window.setTimeout(() => {
        if (store.notice === text) {
          store.notice = "";
          store.noticeActions = [];
          changed();
        }
      }, ms);
    }
  }

  function clearNotice() {
    if (!store.notice) return;
    clearTimeout(noticeTimer);
    store.notice = "";
    store.noticeActions = [];
    changed();
  }

  function scrollByKey(k: string, shift: boolean) {
    const page = host.clientHeight * 0.85;
    const by: Record<string, number> = { " ": shift ? -page : page, PageDown: page, PageUp: -page, ArrowDown: 48, ArrowUp: -48 };
    if (k === "Home") host.scrollTop = 0;
    else if (k === "End") host.scrollTop = host.scrollHeight;
    else if (by[k]) host.scrollBy({ top: by[k] });
  }

  // ---------- keyboard: Sift's keys stay in Sift ----------
  // Page scripts often bind global shortcuts (space, k, j, /, #). Keys pressed
  // in Sift's view must not reach them. Default actions (typing, Tab, Enter on a
  // button) still happen; only the page's listeners are skipped.
  for (const type of ["keydown", "keyup", "keypress"]) {
    addEventListener(
      type,
      (e) => {
        const ke = e as KeyboardEvent;
        const path = e.composedPath();
        // Not with Ctrl, Meta, or AltGr: AltGr+Shift+S types a letter on some layouts (Polish Ś).
        const plain = !ke.ctrlKey && !ke.metaKey && !ke.getModifierState("AltGraph");
        // Only the user's own keys: a page script must not switch Sift off.
        if (type === "keydown" && e.isTrusted && ke.altKey && ke.shiftKey && plain && (ke.code === "KeyS" || ke.key.toLowerCase() === "s")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          toggle();
          return;
        }
        // Keys on Sift's own controls (the switch, in either mode) never reach the page.
        if (path.includes(host)) {
          if (type === "keydown" && store.mode === "sift") {
            onSiftKey(ke);
            if ([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(ke.key)) {
              userScrollAt = Date.now();
              if (!ke.defaultPrevented) edgeScroll(keyDir(ke, path[0]), ke.key);
            }
          }
          e.stopImmediatePropagation();
          return;
        }
        if (store.mode !== "sift") return;
        const tgt = path[0] as Node;
        // Keys inside a shown original element (a player, a map) are for it.
        const portal = tgt instanceof Node ? portalOf(tgt) : null;
        if (portal) {
          if (type === "keydown") {
            keysAfterPage();
            onPortalKey(ke, portal, tgt);
          }
          return;
        }
        // A page modal dialog is on top of Sift: the keys are for it.
        if (pageModal()) return;
        // Focus is nowhere in Sift (on the page's inert body): keep the key from
        // the page, and act as Sift would. Keys the page (or Sift, closing a
        // popup) dispatches itself are left alone.
        if ((tgt === document.body || tgt === document.documentElement || tgt === document) && e.isTrusted) {
          // The user clicked into a shown original with nothing focusable there (a
          // canvas game listening on the window): its keys are for it. Tab and
          // Escape still lead out.
          const was = enteredPortal();
          if (was) {
            if (type === "keydown" && (ke.key === "Tab" || (ke.key === "Escape" && !document.fullscreenElement))) {
              e.preventDefault();
              e.stopImmediatePropagation();
              const box = boxOf(was);
              const el = elOf(was) as HTMLElement | null;
              const first = ke.key === "Tab" && !ke.shiftKey && el ? portalStops(el)[0] : undefined;
              if (!first) leavePortal();
              (first ?? (ke.key === "Tab" && !ke.shiftKey && box ? siftAfter(box) : box) ?? main())?.focus({ preventScroll: false });
            }
            return;
          }
          e.stopImmediatePropagation();
          if (type !== "keydown") return;
          // Focus fell from an original a repaint hid (an editor the user types in): it goes back there, not to the view's start.
          if (portalFocus && Date.now() - portalFocus.at < 5000) return restorePortalFocus();
          noteReading(ke.key);
          if ([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(ke.key)) {
            userScrollAt = Date.now();
            e.preventDefault();
            edgeScroll(keyDir(ke, undefined), ke.key);
            scrollByKey(ke.key, ke.shiftKey);
          } else if (ke.key === "Tab") {
            e.preventDefault();
            const list = siftFocusables();
            (ke.shiftKey ? list[list.length - 1] : list[0])?.focus();
            return;
          } else if (ke.key === "Escape") onSiftKey(ke);
          main()?.focus({ preventScroll: true });
        }
      },
      true,
    );
  }

  // Page listeners in the capture phase (outside-click hooks, smooth-scroll
  // libraries) must not see Sift's pointer, wheel, and focus events; Sift's own
  // UI only needs click, input, change, submit, and toggle. Default actions
  // (scrolling, focus) still happen.
  let pointerInSift = false;
  /** A pointer button is down in Sift right now (until pointerup; pointerInSift lasts one task longer). */
  let pressing = false;
  let openAtPointer: Element[] = [];
  /** The press ended, wherever: released over a shown original, or a touch that became a scroll (pointercancel). */
  const endPress = () => {
    if (!pressing && !pointerInSift) return;
    pressing = false;
    setTimeout(() => {
      pointerInSift = false;
      flushBlur();
    }, 0);
  };
  // The window lost focus mid-press (a click into a frame, another window): no pointerup will come.
  addEventListener("blur", endPress);
  for (const type of ["pointerdown", "pointerup", "pointercancel", "mousedown", "mouseup", "dblclick", "contextmenu", "touchstart", "touchend", "touchmove", "wheel", "focusin", "focusout", "auxclick"]) {
    addEventListener(
      type,
      (e) => {
        const path = e.composedPath();
        if (type === "pointerup" || type === "pointercancel") endPress();
        if (!path.includes(host)) {
          // A click inside a shown original (a map, a player): the user works in it now.
          // Not Sift's own replayed clicks (Play on the player's button).
          if (type === "pointerdown" && e.isTrusted && store.mode === "sift" && path[0] instanceof Node) {
            const p = portalOf(path[0]);
            const ref = p ? refOfPortal(p) : null;
            if (ref) enterPortalStops(ref);
          }
          if (type === "focusin" && store.mode === "sift" && path[0] instanceof Element) keepSiftFocus(path[0]);
          return;
        }
        if (store.mode === "sift") {
          if (type === "pointerdown") {
            pointerInSift = true;
            pressing = true;
            noteReading();
            // A click in Sift ends work in a shown original, even when focus stays on <body>.
            if (enteredPortal()) leavePortal();
            // The click will light-dismiss the page's open popovers; remember them.
            openAtPointer = Array.from(document.querySelectorAll("[popover]:popover-open")).filter((el) => el !== host && !el.hasAttribute("data-sift-portal"));
            userScrollAt = Date.now();
          } else if (type === "wheel" || type === "touchmove") {
            noteReading();
            userScrollAt = Date.now();
            if (type === "wheel" && !(path[0] instanceof Element && path[0].closest(".layer, .suggest"))) edgeScroll(Math.sign((e as WheelEvent).deltaY));
          }
          // A press on a sheet's backdrop keeps focus in the sheet, never on the original page behind it.
          else if (type === "mousedown" && path[0] instanceof Element && path[0].matches(".layer")) {
            e.preventDefault();
            const sheet = path[0].querySelector<HTMLElement>(":scope > .sheet");
            if (sheet && !sheet.contains(shadow.activeElement)) sheet.focus({ preventScroll: true });
          }
          else if (type === "focusin") onSiftFocus(e as FocusEvent, path);
          else if (type === "focusout") onSiftBlur(e as FocusEvent);
        }
        e.stopImmediatePropagation();
      },
      // Passive: stopping propagation never needs to cancel scrolling.
      type === "wheel" || type === "touchmove" || type === "touchstart" ? { capture: true, passive: true } : true,
    );
  }
  for (const type of ["click", "input", "change", "submit"]) host.addEventListener(type, (e) => e.stopPropagation());
  // Editing, clipboard, and drag events in Sift's fields are not the page's: its
  // paste handlers would swallow a paste into Sift's search, its selectstart
  // blockers would stop selecting Sift's text, its drop zones would take a file
  // dropped on Sift's file field. The default actions still happen. Copy stays
  // the page's, as on the original (an attribution added to copied text).
  for (const type of ["paste", "cut", "beforeinput", "compositionstart", "compositionupdate", "compositionend", "selectstart"]) {
    addEventListener(type, (e) => e.composedPath().includes(host) && e.stopImmediatePropagation(), true);
  }
  // A drop anywhere else in Sift's view is the page's, as on the original (a
  // page that takes photos dropped anywhere).
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    addEventListener(
      type,
      (e) => {
        const path = e.composedPath();
        const at = path[0];
        if (path.includes(host) && at instanceof Element && !!at.closest("input, textarea, select, [contenteditable]")) e.stopImmediatePropagation();
      },
      true,
    );
  }
  // Focus moving inside Sift's shadow root never reaches window listeners
  // (target and relatedTarget are both the host there); watch it here too.
  shadow.addEventListener("focusin", (e) => store.mode === "sift" && onSiftFocus(e as FocusEvent, e.composedPath()));
  shadow.addEventListener("focusout", (e) => store.mode === "sift" && onSiftBlur(e as FocusEvent));

  /** The Sift element that last had focus, to give it back when a page script takes it. */
  let siftFocus: HTMLElement | null = null;
  /** A page script is calling focus() right now (the page-world helper says so first). */
  let pageFocusing = false;
  document.addEventListener(
    "sift-pagefocus",
    (e) => {
      e.stopImmediatePropagation();
      pageFocusing = true;
      queueMicrotask(() => (pageFocusing = false));
    },
    true,
  );
  /**
   * A page script moved focus into a shown original the user is not working in
   * (YouTube focuses its player once the watch page has loaded). The user did
   * not choose it, and their keys would go there: focus stays in Sift. Only a
   * field the page opened in answer to the user's action keeps it.
   */
  function keepSiftFocus(el: Element) {
    if (!pageFocusing) return;
    const p = portalOf(el);
    const ref = p ? refOfPortal(p) : null;
    // Not a frame, nor while Sift's own Full screen starts (the player's keys work there).
    if (!ref || enteredPortal() === ref || el.localName === "iframe" || pageModal() || (fsBack && performance.now() - fsBack.at < 3000)) return;
    const f = (deepFocus(el) ?? el) as HTMLElement;
    const field = f.isContentEditable || /^(input|textarea|select)$/.test(f.localName);
    if (field && (Date.now() - store.actAt < 2000 || performance.now() - actedAt < 2000)) return;
    rescuing = true;
    try {
      if (!tryFocus(siftFocus)) main()?.focus({ preventScroll: true });
    } finally {
      rescuing = false;
    }
  }

  function onSiftFocus(e: FocusEvent, path: EventTarget[]) {
    const tgt = path[0] as HTMLElement;
    if (tgt instanceof HTMLElement && shadow.contains(tgt)) siftFocus = tgt;
    const was = enteredPortal();
    if (was) {
      leavePortal();
      // Shift+Tab out of an embedded frame lands on Sift's last control (the
      // frame's page cannot tell Sift); put focus on the frame's box instead.
      const el = elOf(was);
      const from = e.relatedTarget as Node | null;
      const fromFrame = !!el && (!from || deepContains(el, from)) && (el.localName === "iframe" || !!el.querySelector("iframe"));
      if (fromFrame && !pointerInSift && tgt === siftFocusables().at(-1)) {
        boxOf(was)?.focus({ preventScroll: true });
        return;
      }
    }
    // The page field's blur waits while focus is in its suggestion list. Back in
    // the field, the page field never left; anywhere else, it has now.
    if (blurPending && !tgt.closest?.(".suggest, .layer")) {
      if (tgt.dataset?.ref && elOf(tgt.dataset.ref) === blurPending) blurPending = null;
      else if (!pointerInSift) flushBlur();
    }
    if (!tgt.closest?.(".layer, .suggest") && tgt !== main()) opener = { el: tgt, label: labelOf(tgt), tag: tgt.localName };
  }

  // Focus that falls out of Sift (a closed popup, a removed control, a page
  // script that blurred it) comes back to it.
  function onSiftBlur(e: FocusEvent) {
    if (e.relatedTarget) return;
    const spot = spotOf((e.composedPath()[0] as HTMLElement) ?? host);
    // A click on Sift's plain text leaves focus on <body>, as on any page.
    const clicked = pressing;
    setTimeout(() => {
      const a = document.activeElement;
      // Not when focus went to the browser's own UI (Tab past the last control).
      if (!document.hasFocus() || store.mode !== "sift" || clicked) return;
      if (a && a !== document.body && a !== document.documentElement && !(a === host && !shadow.activeElement)) return;
      // A shown original the user clicked into (a canvas game) takes its keys with focus on <body>.
      if (enteredPortal()) return;
      refocus(spot);
    }, 0);
  }

  function onSiftKey(e: KeyboardEvent) {
    const tg = e.composedPath()[0] as HTMLElement;
    noteReading(e.key);
    if (e.key === "Tab") {
      // Controls the site adds to a player or map never become tab stops after Sift's own.
      hidePortalStops();
      wrapTab(e, tg);
      return;
    }
    if (sliderKey(e, tg)) return;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.ctrlKey && !e.metaKey && suggestKey(e, tg)) return;
    if (e.key === "Escape") {
      const d = store.page?.dialog;
      if (!store.menuOpen && d && !store.dismissed.has(d.key)) {
        // A suggestion list under a field: Escape goes to the page field, where
        // the keys go on the original, and the page decides whether it closes.
        const field = suggestAnchor();
        const pf = field ? elOf(field.dataset.ref) : null;
        if (field && pf) {
          // Escape in Sift's search field would also clear it (type=search): it only closes the list.
          e.preventDefault();
          return escapeList(d.key, d.ref, field, pf);
        }
      }
      // In a field that stands for a page field, the page field gets Escape first, as it
      // would on the original (an inline editor cancels); Sift closes its own sheet only
      // when the page did nothing with it.
      const pf = !e.isComposing && tg?.matches?.("input, textarea, select, [contenteditable]") ? elOf(tg.dataset.ref) : null;
      if (pf && (enterable(pf) || (pf as HTMLElement).isContentEditable)) return escapeField(e, pf);
      if (siftEscape()) return;
    }
    // Keys a group of Sift's controls takes (a video's bar: k, j, l, 0-9).
    const group = tg?.closest?.(".media");
    if (group && !e.isComposing) {
      onKeys.get(group)?.(e);
      if (e.defaultPrevented) return;
    }
    if (e.key === "Enter" && !e.isComposing) {
      const fn = tg && onEnter.get(tg);
      if (fn) fn(e);
    }
  }

  // ---------- sliders the page draws itself (role=slider) ----------
  /** The page slider Sift's range field `tg` stands for, if it is not a native range. */
  const ariaSlider = (tg: Element | null): Element | null => {
    if (!(tg instanceof HTMLInputElement) || tg.type !== "range") return null;
    const el = elOf(tg.dataset.ref);
    return el && !(el instanceof HTMLInputElement) && el.getAttribute("role") === "slider" ? el : null;
  };
  /** A slider key on Sift's copy of a page slider: the page slider gets it, and decides the new value. */
  function sliderKey(e: KeyboardEvent, tg: HTMLElement): boolean {
    const el = ariaSlider(tg);
    if (!el || e.altKey || e.ctrlKey || e.metaKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) return false;
    e.preventDefault();
    proxy.key(el, e.key);
    store.actAt = Date.now();
    afterAct();
    return true;
  }
  /** Bring a page slider to `value` (the user dragged Sift's copy) with its own arrow keys, as a keyboard user would. */
  let slideRun = 0;
  function slideTo(el: Element, value: string) {
    const target = parseFloat(value);
    const now = () => parseFloat(el.getAttribute("aria-valuenow") ?? "");
    if (!isFinite(target) || !isFinite(now())) return;
    const run = ++slideRun;
    let presses = 0;
    let stalls = 0;
    let last = NaN;
    const step = () => {
      if (run !== slideRun || !el.isConnected) return;
      const before = now();
      if (before === target || presses++ > 200) return done();
      // It moved since the last press (a page that updates a moment later).
      if (before !== last) stalls = 0;
      last = before;
      const up = target > before;
      proxy.key(el, up ? "ArrowRight" : "ArrowLeft");
      const after = now();
      // The page did not move it (yet): let it catch up, a few times at most.
      if (after === before) return ++stalls > 3 ? done() : void setTimeout(step, 30);
      stalls = 0;
      // Past the value asked for: stop there.
      if (up !== target > after) return done();
      step();
    };
    const done = () => {
      store.actAt = Date.now();
      afterAct();
    };
    step();
  }

  /** Escape for a page suggestion list shown under Sift's `field`: the page field gets it; Sift hides the list once the page did. */
  function escapeList(key: string, listRef: string | undefined, field: HTMLElement, pf: Element) {
    proxy.key(pf, "Escape");
    if (!field.matches(":focus")) field.focus();
    const hidden = () => {
      const list = elOf(listRef);
      if (list && list.checkVisibility()) return;
      if (store.dismissed.has(key)) return;
      store.dismissed.add(key);
      dismissedRefs.set(key, listRef);
      changed();
    };
    hidden();
    setTimeout(hidden, 0);
    setTimeout(() => schedule(0), 60);
  }

  /** Sift's own Escape: it closes Sift's menu or the sheet of a page popup. False when there is none. */
  function siftEscape(): boolean {
    if (store.menuOpen) {
      H.menu(false);
      return true;
    }
    const d = store.page?.dialog;
    if (!d || store.dismissed.has(d.key)) return false;
    H.closeDialog(d.key, d.close?.ref, d.ref);
    return true;
  }

  /**
   * Escape in Sift's field for page field `pf`: the page field gets it (keydown, keyup), as on the
   * original, so an inline editor's cancel works. Sift's own Escape follows only when the page did
   * nothing with it: it did not cancel the key, move focus, remove or hide the field, or close its popup.
   */
  function escapeField(e: KeyboardEvent, pf: Element) {
    const asked = pageAsked;
    const d = store.page?.dialog;
    const box = d && !store.dismissed.has(d.key) ? elOf(d.ref) : null;
    // In the popup Sift shows, what opened the popup stays found.
    const keep = inShownDialog(pf);
    store.actAt = Date.now();
    const ok = proxy.key(pf, "Escape");
    // The page took the key: Sift's field does nothing with it either (a search field would clear).
    if (!ok) e.preventDefault();
    afterAct(keep);
    if (!ok) return;
    setTimeout(() => {
      if (store.mode !== "sift" || pageAsked !== asked || !pf.isConnected || !pf.checkVisibility()) return;
      if (box && (!box.isConnected || !box.checkVisibility())) return;
      siftEscape();
    }, 120);
  }

  /** Visible tab stops inside `box`. */
  const stopsIn = (box: Element) => Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((c) => c.getClientRects().length > 0);

  /**
   * Tab and Shift+Tab stay inside an open sheet (it is modal). In a suggestion
   * list, Shift+Tab before the first goes back to its field, Tab after the last
   * goes on after the field.
   */
  function wrapTab(e: KeyboardEvent, tg: HTMLElement) {
    const layer = shadow.querySelector<HTMLElement>(".layer");
    if (layer) {
      const list = stopsIn(layer);
      if (!list.length) return;
      const i = list.indexOf(tg);
      const out = i < 0 ? !layer.contains(tg) || e.shiftKey : e.shiftKey ? i === 0 : i === list.length - 1;
      if (!out) return;
      e.preventDefault();
      (e.shiftKey ? list[list.length - 1] : list[0]).focus();
      return;
    }
    const sug = shadow.querySelector<HTMLElement>(".sheet.suggest");
    const field = suggestAnchor();
    if (!sug || !field) return;
    const list = stopsIn(sug);
    const i = list.indexOf(tg);
    if (i < 0) return;
    if (e.shiftKey && i === 0) {
      e.preventDefault();
      field.focus();
    } else if (!e.shiftKey && i === list.length - 1) {
      e.preventDefault();
      siftAfter(field)?.focus();
    }
  }

  // ---------- suggestion lists by keyboard ----------
  // The page's suggestions show in a sheet under the field, at the end of
  // Sift's tree. ArrowDown and ArrowUp move between the field and them.
  /** Focus is moving into the suggestions: the page field's blur (which closes many lists) waits. */
  let holdBlur = false;
  function suggestKey(e: KeyboardEvent, tg: HTMLElement): boolean {
    const sug = shadow.querySelector<HTMLElement>(".sheet.suggest");
    const list = sug ? stopsIn(sug) : [];
    if (!sug || !list.length) return false;
    const down = e.key === "ArrowDown";
    const field = suggestAnchor();
    // A list of plain rows that the page moves through with its field's arrow keys (jQuery
    // Autocomplete): each step Sift takes, the page field gets too, so the page highlights
    // the same row and Enter there would pick it, as on the original.
    const pf = store.page?.dialog?.arrows && field ? elOf(field.dataset.ref) : null;
    const step = () => pf && proxy.key(pf, e.key);
    const i = list.indexOf(tg);
    if (i >= 0) {
      // Fields and selects in the list keep their own arrow keys.
      if (/^(input|select|textarea)$/.test(tg.localName)) return false;
      e.preventDefault();
      const next = list[i + (down ? 1 : -1)];
      if (next) next.focus();
      else if (!down) field?.focus();
      if (next || !down) step();
      return true;
    }
    if (tg !== field || !/^(text|search|email|url|tel)$/.test((tg as HTMLInputElement).type)) return false;
    e.preventDefault();
    holdBlur = true;
    try {
      (down ? list[0] : list[list.length - 1]).focus();
    } finally {
      holdBlur = false;
    }
    // ArrowUp from the field goes to the last row in Sift; the page's list does not move.
    if (down) step();
    return true;
  }

  /**
   * The reader started reading (scrolled, clicked, used a reading key) before
   * an article's short version arrived: it must not replace the text under
   * them. Sift offers it with a notice instead.
   */
  const articleKeys = new WeakMap<Page, string[]>();
  function noteReading(key?: string) {
    if (key !== undefined && ![" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(key)) return;
    const page = store.page;
    if (!page) return;
    // Found once per page: this runs on every wheel event.
    let keys = articleKeys.get(page);
    if (!keys) {
      const found: string[] = [];
      const walk = (bs: Block[]) => {
        for (const b of bs) {
          if (b.t === "section") walk(b.blocks);
          else if (b.t === "article") found.push(b.key);
        }
      };
      walk(page.blocks);
      articleKeys.set(page, (keys = found));
    }
    let anyShort = false;
    for (const k of keys) {
      const ai = store.ai.get("condense:" + k);
      const ready = !!ai && ai.text.length > 40 && !ai.error;
      if (ready) anyShort = true;
      else if (!store.local.has("art-late:" + k)) store.local.set("art-late:" + k, true);
    }
    // For the whole page too: the site may re-render its article as a new
    // element (late hydration), and the short version found for it then must
    // not replace the text under the reader either. Cleared on navigation.
    if (keys.length && !anyShort) store.local.set("art-read-full", true);
  }

  /** Tab presses in a code editor in a shown original, decided once the page had them. */
  const tabAfterPage = new WeakSet<Event>();
  /** The code editor whose own Escape was just let through (a second Escape leaves the original). */
  let editorEscape: Element | null = null;
  const lateTab = (e: Event) => {
    if (!tabAfterPage.has(e) || e.defaultPrevented || store.mode !== "sift") return;
    const tgt = e.composedPath()[0];
    const portal = tgt instanceof Node ? portalOf(tgt) : null;
    if (portal) onPortalKey(e as KeyboardEvent, portal, tgt as Node, true);
  };
  addEventListener("keydown", lateTab);
  /**
   * The late keydown listeners must run after the page's own window listeners
   * (a canvas game takes the arrow keys on window, added after Sift's). Called
   * in the capture phase: re-added, they go to the end of the window's list.
   */
  function keysAfterPage() {
    for (const f of [lateTab, lateScroll]) {
      removeEventListener("keydown", f);
      addEventListener("keydown", f);
    }
  }
  // A scrolling key in a shown original that the page did not use (PageDown on
  // YouTube's player) would scroll the hidden page: it scrolls Sift's view, as
  // it scrolls the page on the original.
  function lateScroll(e: Event) {
    const ke = e as KeyboardEvent;
    if (e.defaultPrevented || !e.isTrusted || store.mode !== "sift" || pageModal() || ke.altKey || ke.ctrlKey || ke.metaKey) return;
    if (![" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"].includes(ke.key)) return;
    const tgt = e.composedPath()[0];
    const portal = tgt instanceof Element ? portalOf(tgt) : null;
    const f = portal ? (deepFocus(tgt as Element) as HTMLElement | null) : null;
    if (!portal || !f || f.isContentEditable || f.matches("input, textarea, select, button, a[href], summary, video, audio, iframe, [role]:not([role=application], [role=region], [role=group], [role=presentation], [role=none])")) return;
    // A scrolling box inside it (a map's side panel) takes the key, as in the page.
    for (let n: Element | null = f; n; n = n === portal ? null : (n.parentElement ?? (n.parentNode instanceof ShadowRoot ? n.parentNode.host : null))) {
      if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return;
    }
    e.preventDefault();
    userScrollAt = Date.now();
    noteReading(ke.key);
    scrollByKey(ke.key, ke.shiftKey);
  }
  addEventListener("keydown", lateScroll);

  /** Escape leaves a shown original element; Tab past its first or last control goes on in Sift. */
  function onPortalKey(e: KeyboardEvent, portal: HTMLElement, target: Node, late = false) {
    const ref = refOfPortal(portal);
    const box = ref ? boxOf(ref) : null;
    if (!box || !ref) return;
    if ((e.key === "Enter" || e.key === " ") && e.isTrusted && deepFocus(target instanceof Element ? target : null)?.matches("a[href], button, [role=button]")) {
      portalAct = { ref, at: Date.now(), url: location.href.split("#")[0], blocks: store.page?.blocks ?? [] };
    }
    if (e.key === "Escape" && !document.fullscreenElement) {
      // In a code editor, the first Escape is the editor's (CodeMirror then lets the next Tab move
      // on, to the output after it); a second one leaves the original.
      const ed = deepFocus(target instanceof Element ? target : null) as HTMLElement | null;
      if (ed && (ed.isContentEditable || ed.localName === "textarea") && editorEscape !== ed) {
        editorEscape = ed;
        return;
      }
      editorEscape = null;
      leavePortal();
      box.focus({ preventScroll: true });
      return;
    }
    if (e.key !== "Tab") return;
    // Focus is inside, so the user works in it (it may have come in by a script).
    enterPortalStops(ref);
    // Inside a closed shadow root the event's target is its host; the focused control is deeper.
    const focused = deepFocus(target instanceof Element ? target : null);
    // A code editor takes Tab to indent: Sift moves focus only if the page did not take it.
    if (!late && ((focused as HTMLElement | null)?.isContentEditable || focused?.localName === "textarea")) {
      tabAfterPage.add(e);
      return;
    }
    const inside = portalStops(portal);
    const at = inside.indexOf(focused as HTMLElement);
    if (!e.shiftKey && at < 0 && inside.length) {
      // On the element itself or a container in it: go to its first control.
      e.preventDefault();
      inside[0].focus();
      return;
    }
    const leaving = e.shiftKey ? at <= 0 : at === inside.length - 1 || at < 0;
    // A code editor let this Tab go (after its Escape): on to the next control in it, in Sift's
    // order, as the browser's own order runs into the page's inert parts (MDN's output frame).
    if (!leaving && late) {
      e.preventDefault();
      inside[at + (e.shiftKey ? -1 : 1)]?.focus();
      return;
    }
    if (!leaving) return;
    e.preventDefault();
    leavePortal();
    (e.shiftKey ? box : siftAfter(box))?.focus({ preventScroll: false });
  }

  // ---------- leaving an embedded frame forward ----------
  // Keys inside a cross-origin frame never reach Sift. A focusable marker after
  // <body> catches Tab out of the frame's last control and puts focus after its box.
  let tail: HTMLElement | null = null;
  function addTail(ref: string) {
    removeTail();
    tail = document.createElement("sift-tail");
    tail.tabIndex = 0;
    tail.setAttribute("style", "all: initial !important; position: fixed !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip-path: inset(50%) !important;");
    tail.addEventListener("focus", () => {
      const box = boxOf(ref);
      leavePortal();
      (box ? siftAfter(box) : main())?.focus({ preventScroll: false });
    });
    document.documentElement.appendChild(tail);
  }
  function removeTail() {
    tail?.remove();
    tail = null;
  }
  /** Leave the shown original the user worked in, and its frame's tab-catcher with it. */
  function leavePortal() {
    leavePortalStops();
    removeTail();
  }
  // A click into an embedded frame never reaches Sift; the window's blur tells.
  addEventListener("blur", () =>
    setTimeout(() => {
      const a = document.activeElement;
      if (store.mode !== "sift" || a?.localName !== "iframe") return;
      const p = portalOf(a);
      const ref = p ? refOfPortal(p) : null;
      if (!ref || enteredPortal() === ref) return;
      enterPortalStops(ref);
      addTail(ref);
    }, 0),
  );

  // ---------- the page's own top-layer elements ----------
  // A page popover opened after Sift would paint over it; put Sift back on top
  // (Sift shows the popover's content itself). Not for: <details> and <dialog>
  // (they also fire toggle), popovers inside a shown original (a player's
  // menu must stay above the player), and anything while a page modal dialog
  // is open (it blocks everything else, so the user answers it directly).
  const onPagePopover = (el: Element) => {
    if (store.mode !== "sift" || el === host || el.hasAttribute("data-sift-portal")) return;
    if (!el.matches("[popover]") || !el.matches(":popover-open")) return;
    if (pageModal() || portalElements().some((p) => deepContains(p, el))) return;
    raise();
  };
  document.addEventListener(
    "toggle",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || store.mode !== "sift") return;
      if (el.localName === "dialog") return onPageDialog(el as HTMLDialogElement);
      if ((e as ToggleEvent).newState === "open") onPagePopover(el);
    },
    true,
  );
  /** Where the reader was when Sift's Full screen button was pressed, to come back to on leaving it. */
  let fsBack: { el: HTMLElement | null; top: number; at: number } | null = null;
  document.addEventListener("fullscreenchange", () => {
    if (store.mode !== "sift") return;
    refreshModals();
    refreshShield(exempt());
    if (document.fullscreenElement || !fsBack) return;
    // Out of full screen (the player's own button or key): focus was left in the
    // page; back to Sift's Full screen button, at the same place in the page.
    const back = fsBack;
    fsBack = null;
    setTimeout(() => {
      const a = document.activeElement;
      const lost = !a || a === document.body || a === document.documentElement || (a === host && !shadow.activeElement);
      if (store.mode !== "sift" || !lost) return;
      host.scrollTop = back.top;
      const el = back.el?.isConnected ? back.el : Array.from(shadow.querySelectorAll<HTMLElement>(".media button")).find((b) => b.innerText.trim() === t("fullscreen"));
      if (!tryFocus(el)) main()?.focus({ preventScroll: true });
    }, 0);
  });
  // A dialog closed by Escape or a form sends close, not always toggle.
  document.addEventListener("close", (e) => e.target instanceof HTMLDialogElement && store.mode === "sift" && onPageDialog(e.target), true);
  // Modal dialogs in shadow roots: the page-world helper reports showModal() and close.
  document.addEventListener("sift-modal", (e) => {
    const el = e.composedPath()[0];
    if (!(el instanceof Element) || store.mode !== "sift") return;
    // A dialog in a shadow root, or the host of a closed one (the event names only the host).
    if (el.getRootNode() !== document || !(el instanceof HTMLDialogElement)) shadowModals.add(el);
    onPageDialog(el);
  });

  /** A page modal dialog opened or closed: make it usable (or inert again), and move focus into it as the browser would. */
  function onPageDialog(d: Element) {
    refreshModals();
    refreshShield(exempt());
    changed();
    schedule(0);
    // A closed shadow root reports its host; the dialog is inside.
    const dlg = (d.matches(":modal") ? d : shadowRootOf(d)?.querySelector(":modal")) as HTMLElement | null;
    if (!dlg || deepContains(dlg, deepFocus())) return;
    const first = dlg.querySelector<HTMLElement>("[autofocus]") ?? portalStops(dlg)[0];
    (first ?? dlg).focus();
  }
  // Popovers inside shadow roots: the page-world helper tells us (toggle does not leave a shadow root).
  document.addEventListener("sift-popover", (e) => {
    const el = e.composedPath()[0];
    if (el instanceof Element) onPagePopover(el);
  });

  /** A click in Sift light-dismissed the page popover that holds `el`: open it again before acting on it. */
  function reopenFor(el: Element) {
    for (const pop of openAtPointer) {
      if (!pop.isConnected || pop.matches(":popover-open") || !deepContains(pop, el)) continue;
      try {
        (pop as HTMLElement).showPopover();
      } catch {
        /* no longer a popover */
      }
    }
    openAtPointer = [];
  }

  // Polymer dropdowns (YouTube's Settings menu) close on a click anywhere outside
  // them, which they see in the capture phase, before Sift's own button gets it.
  // The menu would close before Sift's replayed click reaches its item, so the
  // item's next page (Display language) never opens. A click on Sift's own
  // controls does not close it, as a click on the item does not on the original.
  // Between Sift's window listener and its shadow root, only page listeners run.
  let siftClick = false;
  addEventListener(
    "click",
    (e) => {
      if (store.mode !== "sift" || !e.composedPath().includes(host)) return;
      siftClick = true;
      setTimeout(() => (siftClick = false), 0);
    },
    true,
  );
  shadow.addEventListener("click", () => (siftClick = false), true);
  addEventListener("iron-overlay-canceled", (e) => siftClick && e.preventDefault(), true);

  // ---------- extraction loop ----------
  let navPending = false;
  /** A single-page navigation still shows the last page's title: its own is said once the page names it. */
  let titleWait = false;
  let titleTimer = 0;
  let lastToast = "";
  /**
   * Entries of the lists Sift shows: in the page, and in open sections and articles (a watch page's comments).
   * With `rows`, the rows of a long table too (Discourse's topic list), which loads more the same way.
   */
  const shownItems = (blocks: Block[], rows = true): number =>
    blocks.reduce((n, b) => {
      if (b.t === "items") return n + b.items.length;
      if (b.t === "table" && rows && b.rows.length >= 10) return n + b.rows.length;
      if (b.t === "article") return n + shownItems(b.blocks, rows);
      if (b.t === "section" && local("sec:" + b.key, !b.collapsed)) return n + shownItems(b.blocks, rows);
      return n;
    }, 0);
  const itemCount = (p: Page | null) => (p ? shownItems(p.blocks) : 0);
  /**
   * When the user last asked for more entries (Load more, scrolling to the end), and how
   * many there were then. Only then is a longer list news: not while the page builds
   * its first screen, nor when Sift fills the screen by itself.
   */
  let moreAsked = { at: 0, from: 0 };
  let moreTimer = 0;
  const askMore = () => {
    if (Date.now() - moreAsked.at > 10000) moreAsked.from = itemCount(store.page);
    moreAsked.at = Date.now();
  };
  /** The user just pressed a button in a shown original (a map's Layers button): what Sift showed then. */
  let portalAct: { ref: string; at: number; url: string; blocks: Block[] } | null = null;
  /** A page's headings in reading order, with its shown originals among them. */
  const headingsOf = (blocks: Block[], out: [string, string][] = []): [string, string][] => {
    for (const b of blocks) {
      if (b.t === "h") out.push([b.key, b.text]);
      else if (b.t === "portal") out.push(["portal:" + b.ref, ""]);
      else if (b.t === "section" || b.t === "article") {
        if (b.t === "section") out.push([b.key, b.title]);
        headingsOf(b.blocks, out);
      }
    }
    return out;
  };
  let pending = 0;
  let lastDur = 20;
  let lastJson = "";
  let same = 0;
  let failures = 0;
  let lastUrl: string | null = null;
  let firstPaint = 0;
  const t0 = performance.now();
  /** Dismissed dialog keys and their elements, to know when they are really gone. */
  const dismissedRefs = new Map<string, string | undefined>();
  /** A dismissed popup the page still shows: not one it hid in place (HN Search's closed list: transparent, hidden, 2 px). */
  const stillShown = (el: Element) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /** When the pending run is due, so a sooner request can move it earlier. */
  let pendingDue = 0;
  /** A run waiting for an idle moment. */
  let idleRun = 0;
  /** When this page started loading (or the last single-page navigation). */
  let loadStart = performance.now();
  /** When the user last acted through Sift (a click, a check, a submit): the page's answer may come late. */
  let actedAt = -Infinity;
  /** Sift shows the page's content for this address (not a loading line), or the page has had its time to load. */
  const contentShown = () =>
    (!!store.page && store.page.blocks.length > 0 && !store.page.partial && store.page.url === location.href) || performance.now() - loadStart > 10000;

  /**
   * Extract again: now (`delay` 0: navigation, after an action), after
   * `delay`, or, for a change in the page, soon enough to keep up but at a
   * cost the page can afford. `minor`: only text or style changed (a clock).
   */
  const schedule = (delay?: number, minor = false) => {
    if (store.mode !== "sift") return;
    let d: number;
    let idle = false;
    if (delay !== undefined) d = delay;
    else if (!contentShown() || performance.now() - loadStart < 3000) {
      // While the page loads (until its content shows, and its first seconds,
      // when a map or a player appears), keep up with it: right after
      // the change (a loading page has no idle moment, and its next long task
      // would delay a timer), but never back to back.
      const wait = lastRunAt + Math.max(100, lastDur * 3) - performance.now();
      if (wait <= 0) return run();
      d = Math.max(16, wait);
    } else {
      // Routine updates wait for an idle moment so they never compete with
      // scrolling or typing, and back off while nothing changes.
      idle = true;
      const backoff = Math.min(2000, 60 * Math.pow(1.6, Math.min(same, 8)));
      d = Math.max(60, Math.min(800, Math.max(lastDur * 6, backoff)));
      // A big page (a long feed): extraction takes at most about a tenth of the time.
      if (lastDur > 80) d = Math.max(d, lastDur * 9);
      // Text that keeps changing (a clock, a counter) is no reason to hurry;
      // the page's answer to the user's action (a cart count, "Added") is.
      if (minor && performance.now() - actedAt > 5000) d = Math.max(d, 2500);
      d = Math.min(d, 8000);
    }
    const due = performance.now() + d;
    if (pending) {
      if (due >= pendingDue) return;
      clearTimeout(pending);
    } else if (idleRun) {
      // One is coming at the next idle moment; only an urgent one goes first.
      if (idle) return;
      cancelIdleCallback(idleRun);
      idleRun = 0;
    }
    pendingDue = due;
    pending = window.setTimeout(() => {
      pending = 0;
      if (!idle || !("requestIdleCallback" in window)) run();
      else
        idleRun = requestIdleCallback(
          () => {
            idleRun = 0;
            run();
          },
          { timeout: 600 },
        );
    }, d);
  };

  function collectPortals(blocks: Block[], out: { ref: string; el: Element; kind: "video" | "other"; focus?: [number, number] }[]) {
    for (const b of blocks) {
      if (b.t === "portal") {
        const el = elOf(b.ref);
        if (el) out.push({ ref: b.ref, el, kind: b.media ? "video" : "other", focus: b.focus });
      } else if (b.t === "section" || b.t === "article") collectPortals(b.blocks, out);
    }
  }

  /** While Sift shows a menu or dialog, page portals hide unless they are in that dialog. */
  function syncSuspension() {
    const d = store.page?.dialog;
    const shown = !!d && !store.dismissed.has(d.key) && !store.pageModal;
    const keep: { ref: string; el: Element; kind: "video" | "other" }[] = [];
    if (shown && d) collectPortals(d.blocks, keep);
    suspendPortals(store.menuOpen || shown, new Set(store.menuOpen ? [] : keep.map((k) => k.ref)));
  }

  /** The first form `page` shows that `prev` did not (a reply box an action opened): its name and first field. */
  function newForm(prev: Page, page: Page): { title: string; ref: string } | null {
    const forms = (bs: Block[], out: Extract<Block, { t: "form" }>[] = []) => {
      for (const b of bs) {
        if (b.t === "form") out.push(b);
        else if (b.t === "section" || b.t === "article") forms(b.blocks, out);
      }
      return out;
    };
    const had = new Set(forms(prev.blocks).flatMap((f) => f.fields.map((x) => x.ref)));
    for (const f of forms(page.blocks)) {
      const first = f.fields.find((x) => x.kind !== "checkbox" && x.kind !== "radio") ?? f.fields[0];
      if (first && !f.fields.some((x) => had.has(x.ref))) return { title: f.title || first.label || first.placeholder || "", ref: first.ref };
    }
    return null;
  }

  // ---------- the page's alerts ----------
  // What a screen reader would say on the original: an alert when it appears or
  // changes (a sign-in error, an error summary), and, right after the user's
  // action, a short status message ("Address saved."). Even text Sift does not
  // show (screen-reader-only live regions), but not a cookie or newsletter prompt.
  let alertsSeen = new WeakMap<Element, string>();
  /** The page's alerts are read without saying them (a new page: what it shows from the start). */
  let alertsFresh = true;
  /** When the page was last looked through for them (a big page takes a few milliseconds). */
  let alertsAt = -Infinity;
  let alertsLater = 0;
  function newAlert(): string {
    const answer = performance.now() - actedAt < 5000;
    const wait = alertsAt + 2000 - performance.now();
    if (!answer && !alertsFresh && wait > 0) {
      // Looked a moment ago: look again then, so an alert that came now is still said.
      alertsLater ||= window.setTimeout(() => {
        alertsLater = 0;
        const text = store.mode === "sift" ? newAlert() : "";
        if (text) say(text);
      }, wait);
      return "";
    }
    clearTimeout(alertsLater);
    alertsLater = 0;
    alertsAt = performance.now();
    const quiet = alertsFresh || document.readyState === "loading";
    alertsFresh = false;
    let out = "";
    for (const el of Array.from(document.querySelectorAll("[role=alert], [aria-live=assertive], [role=status], [aria-live=polite]"))) {
      if (el.closest("sift-root, [data-sift-portal]") || el.getAttribute("aria-live") === "off") continue;
      const text = el.checkVisibility() ? ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim() : "";
      const was = alertsSeen.get(el);
      alertsSeen.set(el, text);
      if (quiet || out || !text || text === was || text === lastToast || /cookie|consent|newsletter|subscribe/i.test(text)) continue;
      if (!el.matches("[role=alert], [aria-live=assertive]") && (!answer || text.length > 200)) continue;
      out = text.slice(0, 300);
    }
    return out;
  }

  /** The page's notice with a button (a toast's Undo) that Sift shows. */
  let toastEl: Element | null = null;
  function updateToast() {
    const toast = findToast();
    if (!toast) {
      // A notice with a button stays while the page shows it (other actions since or not), and goes when the page removes it.
      if (toastEl && store.noticeActions.length) {
        if (stillShown(toastEl) && textIn(toastEl).slice(0, 200) === lastToast) return;
        clearNotice();
      }
      toastEl = null;
      lastToast = "";
      return;
    }
    if (toast.said === lastToast) return;
    lastToast = toast.said;
    toastEl = null;
    // Said after the item the same action removed, when that is still to be said.
    if (!toast.actions.length) return notify(toast.text, 5000, toast.text, "after");
    // Its buttons stay reachable in the notice, without taking focus or blocking the page, while the page shows it.
    notify(toast.text, 0, toast.said, "after");
    store.noticeActions = toast.actions;
    toastEl = elOf(toast.ref);
  }

  /**
   * A player the user started never disappears from Sift: when a site swaps
   * its player's DOM and the new extraction misses it, keep the last block in
   * the same place while the player is still loaded and on screen.
   */
  function keepPlayers(prev: Page | null, page: Page) {
    if (!prev || prev.url !== page.url) return;
    // The adapter may have left the player out on purpose: it says why (YouTube's
    // bot check, which sits outside the player).
    if (hasWarning(page.blocks)) return;
    const taken = portalEls(page);
    for (const { b, after, parent } of mediaPortals(prev.blocks)) {
      if (findBlock(page.blocks, b.key)) continue;
      const el = elOf(b.ref);
      const v = videoIn(el);
      const video = elOf(b.media?.video) ?? v;
      // The adapter may have left it out on purpose: an error screen (a bot check) shows.
      if (!el || !livePlayer(el, video) || errorShown(el)) continue;
      // The new page shows this player already, under another key: as its
      // container or its video (the site's player after the generic video).
      if (taken.some((t) => nested(t, el) || (!!video && nested(t, video)))) continue;
      taken.push(el);
      const kept: PortalBlock = { ...b, media: { ...b.media, video: v ? refOf(v) : b.media?.video } };
      if (after && insertAfter(page.blocks, after, kept)) continue;
      const box = parent ? findIn(page.blocks, parent) : null;
      if (box) box.unshift(kept);
      else page.blocks.splice(Math.min(1, page.blocks.length), 0, kept);
    }
  }

  /**
   * An original the user works in (typing in MDN's "Try it" editor) never leaves the view under
   * them: when the new extraction misses it while focus is in it, its last block stays in the same
   * place, so the portal is neither dropped nor made again.
   */
  function keepFocusedPortal(prev: Page | null, page: Page) {
    if (!prev || prev.url !== page.url) return;
    const a = proxy.deepActive();
    const held = a ? portalOf(a) : null;
    const ref = held ? refOfPortal(held) : null;
    // Shown already (under another key, or as part of a bigger one).
    if (!held || !ref || portalEls(page).some((el) => nested(el, held))) return;
    // Its block in the last view, with the blocks just before and after it.
    type At = { b: Block; after?: string; before?: string; parent?: string };
    const find = (bs: Block[], parent?: string): At | null => {
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        if (b.t === "portal" && b.ref === ref) return { b, after: bs[i - 1]?.key, before: bs[i + 1]?.key, parent };
        const x = b.t === "section" || b.t === "article" ? find(b.blocks, b.key) : null;
        if (x) return x;
      }
      return null;
    };
    const was = find(prev.blocks);
    if (!was || findBlock(page.blocks, was.b.key)) return;
    if (was.after && insertAfter(page.blocks, was.after, was.b)) return;
    // Its heading went with it (the section it was alone in): before what came next.
    const insertBefore = (bs: Block[]): boolean => {
      for (let i = 0; i < bs.length; i++) {
        const x = bs[i];
        if (x.key === was.before) {
          bs.splice(i, 0, was.b);
          return true;
        }
        if ((x.t === "section" || x.t === "article") && insertBefore(x.blocks)) return true;
      }
      return false;
    };
    if (was.before && insertBefore(page.blocks)) return;
    const box = was.parent ? findIn(page.blocks, was.parent) : null;
    if (box) box.unshift(was.b);
    else page.blocks.splice(Math.min(1, page.blocks.length), 0, was.b);
  }

  /**
   * Focus was in an original Sift shows when a repaint hid it (the page moved it, or it left the
   * view for a moment): it goes back to that same element once it shows again, never to the start of
   * the view, so the user's next keys still reach it.
   */
  let portalFocus: { el: HTMLElement; at: number } | null = null;
  const focusLost = () => {
    const a = document.activeElement;
    return !a || a === document.body || a === document.documentElement;
  };
  function restorePortalFocus() {
    const pf = portalFocus;
    if (!pf) return;
    if (Date.now() - pf.at > 5000 || !pf.el.isConnected || !focusLost()) {
      portalFocus = null;
      return;
    }
    const p = portalOf(pf.el);
    const ref = p ? refOfPortal(p) : null;
    if (!p || !ref) return;
    portalFocus = null;
    enterPortalStops(ref);
    pf.el.focus({ preventScroll: true });
  }

  /**
   * The suggestion list of the page field the user is in, when the extractor
   * found no popup: the listbox or grid the field says it controls
   * (aria-controls, aria-owns), shown under Sift's field like other
   * suggestions. The page may keep it inside its search box or unpositioned,
   * which is why the popup finder misses it.
   */
  function fieldList(): Page["dialog"] {
    let a = shadow.activeElement as HTMLElement | null;
    // Focus is in the list itself (ArrowDown went there): it is still the field's.
    if (a?.closest(".sheet.suggest")) a = suggestAnchor();
    const text = !!a && (a.localName === "textarea" || (a.localName === "input" && /^(text|search|email|url|tel)$/.test((a as HTMLInputElement).type)));
    const pf = text ? elOf(a!.dataset.ref) : null;
    // Not after a search or an action from it, until the user is back at the field: the
    // page may think its field still has focus (its blur() reaches no real focus).
    if (!pf || lastTouched(a!) < store.actAt) return undefined;
    const ids = ["aria-controls", "aria-owns"].flatMap((n) => (pf.getAttribute(n) ?? "").split(/\s+/)).filter(Boolean);
    for (const id of ids) {
      const list = document.getElementById(id);
      if (!list || !list.matches("[role=listbox], [role=grid], [role=tree], [role=menu]") || !visible(list)) continue;
      let opts = Array.from(list.querySelectorAll("[role=option], [role=menuitem], [role=treeitem]"));
      const rows = !opts.length;
      // Google Maps nests a row in each row: one per suggestion, the innermost,
      // clicked on its cell (the outer wrapper has no handler on the path).
      if (rows) opts = Array.from(list.querySelectorAll("[role=row]")).filter((r) => !r.querySelector("[role=row]")).map((r) => r.querySelector("[role=gridcell]") ?? r);
      const name = (o: Element) => {
        if (!rows) return accName(o) || textIn(o);
        // A row's words, not its icon's name alone ("Transit"), which then says what kind of place it is.
        const text = textIn(o);
        const pic = clean(o.querySelector("[role=img][aria-label]")?.getAttribute("aria-label"));
        return text ? (pic && !text.includes(pic) ? `${text} (${pic})` : text) : accName(o);
      };
      const actions = opts
        .filter((o) => visible(o) && o.getAttribute("aria-disabled") !== "true")
        .slice(0, 20)
        .map((o) => ({ key: "fo:" + refOf(o), label: name(o).slice(0, 200), ref: refOf(optionLink(o) ?? o), pressed: o.getAttribute("aria-selected") === "true" || undefined }))
        .filter((x) => x.label);
      // Only a name the list is given: its options do not name it (Sift says "Suggestions").
      const named = list.hasAttribute("aria-label") || list.hasAttribute("aria-labelledby");
      if (actions.length) return { key: "pop:" + refOf(list), ref: refOf(list), title: named ? accName(list).slice(0, 80) : "", blocks: [{ t: "actions", key: "fl:" + refOf(list), actions }] };
    }
    return undefined;
  }

  /**
   * The link that fills a suggestion (Wikipedia's option holds its article's link): a click on the
   * option lands on it and opens the page, as picking it on the original does. A click on the
   * option element itself only selects it.
   */
  function optionLink(o: Element): Element | null {
    const links = o.querySelectorAll("a[href]");
    if (links.length !== 1 || o.matches("a[href]")) return null;
    const r = o.getBoundingClientRect();
    const l = links[0].getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return x >= l.left && x <= l.right && y >= l.top && y <= l.bottom ? links[0] : null;
  }

  /** The page view without its copies of the controls in `refs` (a field's list, shown under the field instead). */
  function dropControls(blocks: Block[], refs: Set<string>): Block[] {
    const out: Block[] = [];
    for (const b of blocks) {
      if (b.t === "actions" || b.t === "form") {
        const actions = b.actions.filter((x) => !refs.has(x.ref));
        if (actions.length === b.actions.length) out.push(b);
        else if (actions.length || b.t === "form") out.push({ ...b, actions });
      } else if (b.t === "section" || b.t === "article") out.push({ ...b, blocks: dropControls(b.blocks, refs) });
      else out.push(b);
    }
    return out;
  }

  /** The page's portaled elements, in its blocks and its dialog. */
  function portalEls(page: Page): Element[] {
    const out: { ref: string; el: Element; kind: "video" | "other" }[] = [];
    collectPortals(page.blocks, out);
    if (page.dialog) collectPortals(page.dialog.blocks, out);
    return out.map((p) => p.el);
  }

  /**
   * One portal per element: never one inside another or around one, even when
   * they come from different passes (the page and its dialog) or from blocks
   * kept from the last extraction. The one shown already stays, so a player
   * never jumps; otherwise the first in reading order.
   */
  function dropNestedPortals(page: Page) {
    const all: { b: PortalBlock; el: Element }[] = [];
    const walk = (bs: Block[]) => {
      for (const b of bs) {
        if (b.t === "portal") {
          const el = elOf(b.ref);
          if (el) all.push({ b, el });
        } else if (b.t === "section" || b.t === "article") walk(b.blocks);
      }
    };
    walk(page.blocks);
    if (page.dialog) walk(page.dialog.blocks);
    if (all.length < 2) return;
    const shown = new Set(portalElements());
    const order = [...all.filter((p) => shown.has(p.el)), ...all.filter((p) => !shown.has(p.el))];
    const kept: Element[] = [];
    const drop = new Set<Block>();
    for (const p of order) {
      if (kept.some((k) => nested(k, p.el))) drop.add(p.b);
      else kept.push(p.el);
    }
    if (!drop.size) return;
    const prune = (bs: Block[]): Block[] =>
      bs.filter((b) => !drop.has(b)).map((b) => (b.t === "section" || b.t === "article" ? { ...b, blocks: prune(b.blocks) } : b));
    page.blocks = prune(page.blocks);
    if (page.dialog) page.dialog = { ...page.dialog, blocks: prune(page.dialog.blocks) };
  }

  function findIn(blocks: Block[], key: string): Block[] | null {
    for (const b of blocks) {
      if (b.t !== "section" && b.t !== "article") continue;
      if (b.key === key) return b.blocks;
      const x = findIn(b.blocks, key);
      if (x) return x;
    }
    return null;
  }

  /**
   * Shadow roots Sift watches like the document: web components render late
   * inside them, with no change in the document (MDN's compatibility table,
   * two shadow roots deep). Each extraction looks for new ones.
   */
  const watchedRoots = new WeakSet<ShadowRoot>();
  let observeRoot: ((r: ShadowRoot) => void) | null = null;
  function watchShadows(root: Document | ShadowRoot = document, depth = 0) {
    if (!observeRoot || depth > 5) return;
    const els = root.querySelectorAll("*");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      // Open roots only: asking for each closed one is slow on pages of thousands of components (YouTube).
      const sr = (el as HTMLElement).shadowRoot;
      if (!sr || el === host) continue;
      if (!watchedRoots.has(sr)) {
        watchedRoots.add(sr);
        observeRoot(sr);
      }
      watchShadows(sr, depth + 1);
    }
  }

  /** The control that opened another page in place, while that page loads. */
  let openedFrom: { el: Element; title: string; at: number } | null = null;
  /** When the last extraction started. */
  let lastRunAt = -Infinity;
  /** Whether each shown player showed its own error screen when Sift last read the page. */
  const errorAt = new WeakMap<Element, boolean>();
  function run() {
    lastRunAt = performance.now();
    if (pending) clearTimeout(pending);
    pending = 0;
    if (idleRun) cancelIdleCallback(idleRun);
    idleRun = 0;
    if (store.mode !== "sift" || !document.body) return;
    if (checkUrl()) fillTries = lastCount = 0;
    const s = performance.now();
    let page: Page;
    try {
      page = extract();
      failures = 0;
    } catch (err) {
      console.warn("[sift] extraction failed", err);
      stat("error");
      if (++failures >= 3 && !store.page) {
        store.notice = "";
        setMode("original", false);
      } else schedule(400);
      return;
    }
    lastDur = performance.now() - s;
    host.dataset.ms = String(Math.round(lastDur));
    watchShadows();
    const runs = +(host.dataset.runs ?? 0) + 1;
    host.dataset.runs = String(runs);
    // Long-lived feeds churn through elements; drop references to removed ones.
    if (runs % 50 === 0) sweepRefs();
    // An adapter can say its page is still loading (YouTube renders lists late).
    page.partial = page.partial || document.readyState === "loading";
    updateToast();
    // The list a field the user types in controls (Google Maps' suggestions grid).
    // It wins over a popup found around that field (Maps' directions panel, which
    // holds the field): only a dialog the user types inside keeps its sheet. It is
    // shown under the field only, not again where the page keeps it.
    const inSheet = shadow.activeElement?.closest(".sheet");
    const fl = inSheet && !inSheet.matches(".suggest") ? undefined : fieldList();
    if (fl) {
      page.dialog = fl;
      const shown = fl.blocks[0];
      if (shown?.t === "actions") page.blocks = dropControls(page.blocks, new Set(shown.actions.map((x) => x.ref)));
    }
    // The page's dialog starts where the page put focus in it (its "Stay signed in", a confirm's Cancel).
    const dlgEl = page.dialog && !page.dialog.focus ? elOf(page.dialog.ref) : null;
    if (dlgEl && pageAsked?.isConnected && deepContains(dlgEl, pageAsked)) page.dialog = { ...page.dialog!, focus: refOf(pageAsked) };
    // Before comparing: a kept player goes as soon as it stops being live.
    keepPlayers(store.page, page);
    keepFocusedPortal(store.page, page);
    dropNestedPortals(page);
    const alert = newAlert();
    const json = JSON.stringify(page);
    if (json === lastJson) {
      same++;
      if (alert) say(alert);
      followPageFocus();
      return;
    }
    same = 0;
    lastJson = json;
    setLang(page.lang);
    const prevCount = itemCount(store.page);
    const prevUrl = store.page?.url;
    const prev = store.page;
    const prevTitle = store.page?.title;
    const navigated = navPending;
    store.page = page;
    refreshModals();
    // The same page element found again as another kind of popup (a dropdown that ignored
    // Escape, now seen as an open list box) stays dismissed.
    const pd = page.dialog;
    if (pd?.ref && !store.dismissed.has(pd.key) && [...dismissedRefs].some(([k, r]) => r === pd.ref && store.dismissed.has(k))) {
      store.dismissed.add(pd.key);
      dismissedRefs.set(pd.key, pd.ref);
    }
    // A dismissed dialog may open again later; let Sift show it then. Until its
    // element is gone or hidden, it stays dismissed, even while another is current.
    for (const k of store.dismissed) {
      if (k === page.dialog?.key) continue;
      const ref = dismissedRefs.get(k);
      const el = ref ? elOf(ref) : null;
      if (ref && el && stillShown(el)) continue;
      store.dismissed.delete(k);
      dismissedRefs.delete(k);
    }
    const nowCount = itemCount(page);
    if (navigated && page.blocks.length) {
      navPending = false;
      // The app may name the new page a moment after showing it (GitHub's <title>): say the new name then.
      // A page shown with no name yet (YouTube's video before its title) is said once it has one.
      clearTimeout(titleTimer);
      titleWait = page.title === prevTitle || !page.title;
      if (titleWait)
        titleTimer = window.setTimeout(() => {
          if (!titleWait || !store.page?.title) return;
          say(store.page.title);
          titleWait = false;
        }, 2500);
      else say(page.title);
    } else if (titleWait && page.title && page.title !== prevTitle) {
      titleWait = false;
      clearTimeout(titleTimer);
      say(page.title);
    } else if (prevCount && nowCount > prevCount && prevUrl === page.url) {
      // Said once per request, when the entries stop coming in: batches add up to one count.
      if (Date.now() - moreAsked.at < 10000) {
        clearTimeout(moreTimer);
        moreTimer = window.setTimeout(() => {
          const n = itemCount(store.page) - moreAsked.from;
          if (n > 0) say(t("newItems", { n }));
          moreAsked = { at: 0, from: 0 };
        }, 1500);
      }
    } else if (portalAct && Date.now() - portalAct.at < 3000 && portalAct.url === page.url.split("#")[0]) {
      // The button opened a panel that Sift shows outside the original (focus stays in it): say where.
      const was = new Set(headingsOf(portalAct.blocks).map(([k]) => k));
      const now = headingsOf(page.blocks);
      const at = now.findIndex(([k]) => k === "portal:" + portalAct!.ref);
      const i = now.findIndex(([k, text]) => !!text && !was.has(k));
      if (at >= 0 && i >= 0) {
        say(t(i < at ? "openedAbove" : "openedBelow", { title: now[i][1] }));
        portalAct = null;
      }
    }
    // A button opened a form in the page (Reply), where focus is not.
    const opened = prev && prevUrl === page.url && !navigated && Date.now() - store.actAt < 2500 ? newForm(prev, page) : null;
    if (page.blocks.length || !page.partial) store.booting = false;
    const before = shadow.activeElement;
    paint();
    followPageFocus();
    if (opened) {
      const f = shadow.querySelector(`[data-ref="${window.CSS.escape(opened.ref)}"]`);
      const a = shadow.activeElement;
      // Named by the button that opened it ("Reply"), else by itself.
      const title = a?.matches("button, a") ? labelOf(a) || opened.title : "";
      if (f && a && title && !f.closest("form")?.contains(a)) say(t(a.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING ? "openedBelow" : "openedAbove", { title }));
    }
    if (alert) say(alert);
    // Like a page load: put the reader at the start of the new page, unless
    // they are still in a control that is there (a filter field that writes
    // the address).
    if (navigated && page.blocks.length) {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement || (a === host && (!before || !before.isConnected))) main()?.focus({ preventScroll: true });
      // A link or button that opened another page in place (a place beside the results) may still have focus.
      else if (before && !/^(input|textarea|select)$/.test(before.localName) && Date.now() - store.actAt < 4000) openedFrom = { el: before, title: prevTitle ?? "", at: Date.now() };
    }
    // Once that page shows (its title changed), the reader goes to its start, as after a link to a new
    // page: Google Maps moves focus to the place it opened.
    if (openedFrom && (Date.now() - openedFrom.at > 4000 || shadow.activeElement !== openedFrom.el)) openedFrom = null;
    else if (openedFrom && page.title !== openedFrom.title) {
      openedFrom = null;
      // Its title, when Sift shows one; else the start of the view.
      const h1 = main()?.querySelector<HTMLElement>("h1");
      if (h1) {
        h1.tabIndex = -1;
        h1.focus({ preventScroll: true });
        h1.scrollIntoView({ block: "nearest" });
      } else main()?.focus({ preventScroll: true });
    }
    const portals: { ref: string; el: Element; kind: "video" | "other"; focus?: [number, number] }[] = [];
    collectPortals(page.blocks, portals);
    if (page.dialog && !store.dismissed.has(page.dialog.key)) collectPortals(page.dialog.blocks, portals);
    const deep = proxy.deepActive();
    const held = deep && portalOf(deep) ? deep : null;
    setPortals(portals);
    for (const p of portals) if (p.kind === "video") errorAt.set(p.el, errorShown(p.el));
    syncSuspension();
    refreshShield(exempt());
    layout();
    if (held && focusLost()) portalFocus = { el: held, at: Date.now() };
    restorePortalFocus();
    processAi(page);
    fillScreen(page);
    openAtPost();
    toEnd();
    if (!firstPaint && page.blocks.length) {
      firstPaint = performance.now() - t0;
      stat("page", { ms: Math.round(firstPaint) });
      // Keyboard focus starts in Sift, so keys never reach the hidden page; nor a shown
      // original the page focused itself (YouTube's player), which the user has not entered.
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement || (portalOf(a) && !enteredPortal())) main()?.focus({ preventScroll: true });
    }
  }

  /** Kinds of history changes since the last check (the Navigation API tells push from replace). */
  const navKinds = new Set<string>();
  /** Whether each hash seen is an app route (decided once, when the page has loaded). */
  const routeHashes = new Map<string, boolean>();

  /** The page's address without an in-page anchor; a hash that is an app route ("#/", "#!", "#inbox/123") stays. */
  function pageUrl(): string {
    const [base, ...rest] = location.href.split("#");
    const hash = rest.join("#");
    if (!hash) return base;
    let route = routeHashes.get(hash);
    if (route === undefined) {
      let id = hash;
      try {
        id = decodeURIComponent(hash);
      } catch {
        /* not encoded */
      }
      route = /^[!/]/.test(hash) || hash.includes("/") || (id !== "top" && !document.getElementById(id) && !document.getElementsByName(id).length);
      // While the page loads, its anchor target may not exist yet.
      if (document.readyState !== "loading") routeHashes.set(hash, route);
    }
    return route ? base + "#" + hash : base;
  }

  function checkUrl(): boolean {
    const u = pageUrl();
    const kinds = Array.from(navKinds);
    navKinds.clear();
    if (lastUrl === null || u === lastUrl) {
      lastUrl = u;
      return false;
    }
    const prev = lastUrl;
    lastUrl = u;
    // A page that writes what the user types into its address
    // (history.replaceState on input) is still the same page.
    const noQuery = (x: string) => x.replace(/\?[^#]*/, "");
    if (kinds.length && kinds.every((k) => k === "replace") && noQuery(prev) === noQuery(u)) return false;
    // A thread that writes the post in view into its address as it is scrolled (Discourse's
    // ".../143208/5"), right after Sift scrolled it along with the reader, is still the same page.
    if (kinds.length && kinds.every((k) => k === "replace") && Date.now() - lastStep < 4000) return false;
    // A new page inside a single-page app. A section kept across its pages (a playlist) stays open or closed.
    const kept: [string, unknown][] = [];
    const keep = (bs: Block[]) => {
      for (const b of bs) {
        if (b.t === "section" && b.keep && store.local.has("sec:" + b.key)) kept.push(["sec:" + b.key, store.local.get("sec:" + b.key)]);
        if (b.t === "section" || b.t === "article") keep(b.blocks);
      }
    };
    keep(store.page?.blocks ?? []);
    store.local.clear();
    for (const [k, v] of kept) store.local.set(k, v);
    // A dialog the user dismissed that the page still shows stays dismissed (a
    // nag with no way to close it must not come back and take focus).
    for (const k of store.dismissed) {
      const el = elOf(dismissedRefs.get(k));
      if (el && stillShown(el)) continue;
      store.dismissed.delete(k);
      dismissedRefs.delete(k);
    }
    clearRecent();
    alertsFresh = true;
    store.menuOpen = false;
    store.notice = "";
    suspendPortals(false);
    resetAi();
    lastJson = "";
    host.scrollTop = 0;
    sweepRefs();
    firstPaint = 0;
    loadStart = performance.now();
    navPending = true;
    navAt = Date.now();
    return true;
  }

  // ---------- watching the page ----------
  const quiet = () => [...portalElements(), ...(activeAdapter()?.quiet?.() ?? [])];
  const mo = new MutationObserver((muts) => {
    if (host.parentNode !== document.documentElement) attach();
    noteMutations(muts);
    if (store.mode !== "sift") return;
    const q = quiet();
    let shieldDirty = false;
    const added: Node[] = [];
    for (const m of muts) {
      const tgt = m.target as Node;
      if (m.type === "childList") {
        if (tgt === document.body || tgt === document.documentElement) shieldDirty = true;
        for (const n of Array.from(m.addedNodes)) if (n.nodeType === 1) added.push(n);
      }
      if (m.type === "attributes" && m.attributeName === "inert" && (tgt as Element).hasAttribute?.("data-sift-inert")) shieldDirty = true;
    }
    // A site moved a shown original (theater mode, a mini player): show it again
    // now, and make its new ancestors reachable.
    if (q.length && portalsDisplaced(added)) {
      refreshShield(exempt());
      layout();
    }
    // New children of <body> or <html> (chat widgets, ads) must be inert too.
    else if (shieldDirty) refreshShield(exempt());
    let minor = true;
    let any = false;
    let inQuiet = false;
    for (const m of muts) {
      const tgt = m.target as Node;
      if (tgt === host || tgt === document.documentElement) continue;
      if (m.type === "attributes") {
        const n = m.attributeName ?? "";
        if (n.startsWith("data-sift") || n === "inert" || n === "popover" || n === "role") continue;
      }
      if (q.some((el) => deepContains(el, tgt))) {
        inQuiet = true;
        continue;
      }
      any = true;
      // Only text, or an element's inline style, changed (a ticking clock, an animation).
      const textOnly = (ns: NodeList) => Array.from(ns).every((n) => n.nodeType === 3);
      if (!(m.type === "characterData" || (m.type === "attributes" && m.attributeName === "style") || (m.type === "childList" && textOnly(m.addedNodes) && textOnly(m.removedNodes)))) {
        minor = false;
        break;
      }
    }
    // A shown player putting up (or taking down) its own error screen ("Video
    // unavailable") is news, though its other changes are not: the adapter shows
    // the error instead of a dead player.
    if (!any && inQuiet && portalElements().some((p) => errorAt.has(p) && errorShown(p) !== errorAt.get(p))) {
      any = true;
      minor = false;
    }
    // The suggestions for what the user just typed came in: shown soon, not at the next idle moment,
    // so Sift never offers the list the page has replaced (never back to back, though).
    if (any) schedule(Date.now() - suggestAt < 4000 ? Math.max(30, lastRunAt + Math.max(100, lastDur * 2) - performance.now()) : undefined, minor);
  });
  const moOpts: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    // To tell a real change from a page writing the same value again (see noteMutations).
    attributeOldValue: true,
    attributeFilter: ["class", "hidden", "open", "aria-hidden", "aria-expanded", "aria-selected", "aria-checked", "aria-pressed", "aria-disabled", "disabled", "value", "src", "href", "style", "inert"],
  };
  mo.observe(document, moOpts);
  observeRoot = (r) => mo.observe(r, moOpts);
  const nav = (window as any).navigation;
  nav?.addEventListener?.("navigatesuccess", () => schedule(0));
  nav?.addEventListener?.("navigate", (e: any) => navKinds.add(String(e.navigationType)));
  addEventListener("popstate", () => schedule(0));
  // Back/forward cache restores the page without any DOM change.
  addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) schedule(0);
  });
  document.addEventListener("DOMContentLoaded", () => {
    attach();
    schedule(0);
  });
  addEventListener("load", () => schedule(0));
  // Inputs change without DOM mutations; catch up after the user acts.
  host.addEventListener("click", () => setTimeout(() => schedule(0), 120));

  // ---------- infinite lists: scrolling Sift near the end loads more ----------
  let lastNudge = 0;
  /** When Sift last scrolled the original along with the reader (see stepWith). */
  let lastStep = 0;
  /** When the reader last scrolled Sift (wheel, touch, a press, a scrolling key), and where Sift's view was. */
  let userScrollAt = 0;
  let lastTop = 0;
  let stepTimer = 0;
  host.addEventListener(
    "scroll",
    () => {
      if (store.mode !== "sift") return;
      // Any way of moving down the page (find in page, a screen reader's browse
      // mode, a script) means the reader started: a short version must not
      // replace the text under them.
      if (host.scrollTop > 120) noteReading();
      const near = host.scrollTop + host.clientHeight > host.scrollHeight - host.clientHeight * 1.5;
      const moved = host.scrollTop - lastTop;
      lastTop = host.scrollTop;
      // Only the reader's own scrolling moves the original along: Sift's view also scrolls when the page redraws.
      const mine = Date.now() - userScrollAt < 1000;
      if (!store.page || Date.now() - lastStep < 1500 || (mine && stepWith(near, Math.sign(moved)))) return;
      if (!near || Date.now() - lastNudge < 1500) return;
      // A list in an open section counts too (a watch page's comments).
      if (!shownItems(store.page.blocks)) return;
      // A thread that unloads its posts loads more as it is scrolled (stepWith), never by a jump to its end.
      if (cloakedPosts()) return;
      lastNudge = Date.now();
      askMore();
      loadMore();
    },
    { passive: true },
  );

  /**
   * A page that keeps only the posts near its own scroll position (a Discourse
   * thread: the others are empty boxes of their height): the original follows
   * the reader a screen at a time, down near Sift's end, back up at its top,
   * until the reader has more than a screen to read. Jumping to its end would
   * skip the posts between.
   */
  function stepWith(near: boolean, keep = 0): boolean {
    const top = host.scrollTop < host.clientHeight * 0.5;
    if (store.mode !== "sift" || (!near && !top) || !cloakedPosts()) return false;
    const se = document.scrollingElement ?? document.documentElement;
    const up = top && se.scrollTop > 0 && keep !== 1;
    const down = near && se.scrollTop + innerHeight < se.scrollHeight - 2 && keep !== -1;
    // At Sift's top the earlier posts come back first (a short view is near its end too).
    const dir = up ? -1 : down ? 1 : 0;
    if (!dir) return false;
    lastStep = Date.now();
    se.scrollTop += dir * innerHeight;
    dispatchEvent(new Event("scroll"));
    // The reader may stay where they are (at Sift's end, which has no more to scroll): check again, the same way,
    // while they are still scrolling. Never by itself: the reader stopped there to read.
    clearTimeout(stepTimer);
    stepTimer = window.setTimeout(() => Date.now() - userScrollAt < 1600 && stepWith(host.scrollTop + host.clientHeight > host.scrollHeight - host.clientHeight * 1.5, dir), 1600);
    return true;
  }

  /** Which way a scrolling key moves Sift's view: -1 up, 1 down, 0 not a scroll (a key a field or a group of controls takes). */
  function keyDir(ke: KeyboardEvent, tg: EventTarget | undefined): number {
    if (ke.altKey || ke.ctrlKey || ke.metaKey) return 0;
    if (tg instanceof Element && tg.closest("input, textarea, select, [contenteditable], [role=listbox], [role=radiogroup], [role=slider], [role=menu], [role=tablist], [role=grid], .layer, .suggest, .media")) return 0;
    if (ke.key === " ") return tg instanceof Element && tg.closest("button, summary, [role=button]") ? 0 : ke.shiftKey ? -1 : 1;
    return ({ Home: -1, PageUp: -1, ArrowUp: -1, End: 1, PageDown: 1, ArrowDown: 1 } as Record<string, number>)[ke.key] ?? 0;
  }

  /**
   * The reader scrolls at Sift's top or end, where its view cannot move, so no scroll event comes:
   * a thread that unloads its posts moves on a screen (see stepWith). Home goes to its start.
   */
  function edgeScroll(dir: number, key = "") {
    if (!dir || store.mode !== "sift" || !store.page) return;
    const se = document.scrollingElement ?? document.documentElement;
    // Home is the thread's start, wherever Sift's view is.
    if (key === "Home" && se.scrollTop > 0 && cloakedPosts()) {
      lastStep = Date.now();
      se.scrollTop = 0;
      dispatchEvent(new Event("scroll"));
      return;
    }
    // End is its last post, as on the original: Sift's view follows once that post shows (toEnd).
    if (key === "End" && cloakedPosts()) {
      if (se.scrollTop + innerHeight >= se.scrollHeight - 2) return;
      lastStep = endAt = Date.now();
      se.scrollTop = se.scrollHeight;
      dispatchEvent(new Event("scroll"));
      return;
    }
    if (Date.now() - lastStep < 1500) return;
    if (dir < 0 ? host.scrollTop > 0 : host.scrollTop + host.clientHeight < host.scrollHeight - 2) return;
    if (cloakedPosts()) stepWith(dir > 0, dir);
  }

  /** When the reader pressed End in a thread that unloads its posts (see edgeScroll). */
  let endAt = 0;
  /** After End, Sift's view stays at its end while the thread's last posts come in, until the reader moves. */
  function toEnd() {
    if (!endAt) return;
    if (Date.now() - endAt > 5000 || userScrollAt > endAt) {
      endAt = 0;
      return;
    }
    host.scrollTop = host.scrollHeight;
  }

  /** The address for which Sift opened a thread at the post the original opened at (see openAtPost). */
  let placedUrl: string | null = null;
  /**
   * A thread that opens at a post ("/t/topic/143208/12"): Sift opens at that post too, as the
   * original does. Once per page, soon after it opens, and not once the reader has moved.
   */
  function openAtPost() {
    if (placedUrl === lastUrl || Date.now() - navAt > 15000) return;
    if (userScrollAt > navAt || lastStep > navAt) {
      placedUrl = lastUrl;
      return;
    }
    const se = document.scrollingElement ?? document.documentElement;
    // Looked for only on a page that opened scrolled, and afresh: the posts unload a moment after they show.
    if (se.scrollTop <= 0 || !findCloaked() || !cloakBox?.isConnected) return;
    // The first post not hidden under the page's own top bar, and the first thing Sift shows of it.
    const y = innerHeight * 0.15;
    const post = Array.from(cloakBox.children).find((c) => c.getBoundingClientRect().bottom > y);
    const ctl =
      post &&
      Array.from(shadow.querySelectorAll<HTMLElement>("#sift-main [data-ref]")).find((c) => {
        const o = elOf(c.dataset.ref);
        return !!o && post.contains(o);
      });
    if (!ctl) return;
    placedUrl = lastUrl;
    const el = ctl.closest<HTMLElement>("p, ul, ol, li, h2, h3, h4, h5, h6, blockquote") ?? ctl;
    const bar = shadow.querySelector(".bar")?.getBoundingClientRect().height ?? 0;
    host.scrollTop += el.getBoundingClientRect().top - bar - 8;
    // The reader starts there, as on the original (not when they are in a control already).
    const a = shadow.activeElement;
    if (!a || a === main()) {
      if (!el.matches(FOCUSABLE)) el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
  }

  /** Three or more empty boxes side by side held at a set height: posts a page unloads until scrolled to. */
  let cloakAt = -1e9;
  let cloakVal = false;
  /** The element holding those posts, as last found. */
  let cloakBox: Element | null = null;
  function cloakedPosts(): boolean {
    // Asked on every scroll event near either end: looked up at most once a second.
    if (performance.now() - cloakAt < 1000) return cloakVal;
    cloakAt = performance.now();
    return (cloakVal = findCloaked());
  }
  function findCloaked(): boolean {
    const boxes = document.querySelectorAll<HTMLElement>("[style*='height']");
    const by = new Map<Element, number>();
    for (let i = 0; i < boxes.length && i < 2000; i++) {
      const b = boxes[i];
      if (!b.parentElement || !/(^|;)\s*height\s*:\s*\d/.test(b.getAttribute("style") ?? "") || b.offsetHeight < 100 || b.closest("sift-root")) continue;
      // Empty but for screen-reader text ("post by Anlis"), which takes no room.
      if (Array.from(b.querySelectorAll("*")).some((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && !!(e.textContent ?? "").trim();
      })) continue;
      const n = (by.get(b.parentElement) ?? 0) + 1;
      if (n >= 3) {
        cloakBox = b.parentElement;
        return true;
      }
      by.set(b.parentElement, n);
    }
    return false;
  }

  // A list shorter than the screen cannot be scrolled, so the "near the end"
  // trigger never fires: ask the page for more until it fills two screens,
  // giving up after a few tries that bring nothing new.
  let fillTries = 0;
  let lastCount = 0;
  function fillScreen(page: Page) {
    // Lists only: a table that fits the screen is all there is.
    const count = shownItems(page.blocks, false);
    if (!count) return;
    if (count > lastCount) fillTries = 0;
    lastCount = count;
    if (fillTries >= 4 || host.scrollHeight > host.clientHeight * 2 || Date.now() - lastNudge < 1200) return;
    // A thread that unloads its posts is not a short list: a jump to its end would skip them.
    if (cloakedPosts()) return;
    fillTries++;
    lastNudge = Date.now();
    loadMore();
    setTimeout(() => schedule(0), 1300);
  }

  function loadMore(ref?: string) {
    const el = elOf(ref);
    if (el) return proxy.click(el);
    if (activeAdapter()?.loadMore?.()) return;
    const se = document.scrollingElement ?? document.documentElement;
    se.scrollTop = se.scrollHeight;
    dispatchEvent(new Event("scroll"));
    stat("loadMore");
  }

  // ---------- mode switching ----------
  function setMode(next: "sift" | "original", remember = true) {
    // Leaving Sift: what the user typed in a rich editor's Sift field reaches the
    // page now. Kept for later, it would overwrite what they type in the original.
    if (next === "original" && store.mode === "sift") {
      flushEdits();
      flushBlur();
    }
    store.mode = next;
    if (remember) {
      try {
        if (next === "original") sessionStorage.setItem(MODE_KEY, "original");
        else sessionStorage.removeItem(MODE_KEY);
      } catch {
        /* storage blocked */
      }
    }
    hostStyle(next);
    if (next === "original") {
      removeTail();
      parkPortals(true);
      shieldOff();
      render(h(App, {}), mount);
    } else {
      lastJson = "";
      parkPortals(false);
      refreshModals();
      shieldOn(exempt());
      // A popover the page opened in the original would cover Sift; a page modal dialog stays on top.
      if (!pageModal()) raise();
      render(h(App, {}), mount);
      schedule(0);
    }
  }

  function toggle() {
    const next = store.mode === "sift" ? "original" : "sift";
    setMode(next);
    stat(next === "original" ? "toOriginal" : "toSift");
    const focusTarget = next === "sift" ? main() : shadow.querySelector<HTMLElement>(".toggle");
    focusTarget?.focus({ preventScroll: true });
  }

  // ---------- handlers used by the UI ----------
  // Rich editors (contenteditable) get the text when the user leaves Sift's
  // field, and always before any action, so Send never misses the last words.
  // Never while typing: writing into the page editor needs focus there, which
  // would cut an IME composition and make screen readers announce the move.
  const pendingEdits = new Map<string, string>();
  /** Write what was typed into rich editors; true when there was something to write. */
  const flushEdits = (): boolean => {
    if (!pendingEdits.size) return false;
    const edits = Array.from(pendingEdits);
    pendingEdits.clear();
    // Focus goes back to wherever it is now (the field, or the control the user moved to).
    const back = proxy.deepActive();
    for (const [ref, value] of edits) {
      const el = elOf(ref);
      if (el) proxy.setValue(el, value, back);
    }
    return true;
  };

  // Leaving the page or the tab: the text reaches the editor first (the site may save a draft).
  addEventListener("pagehide", () => flushEdits());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushEdits());

  // Entering and leaving Sift's field enters and leaves the page field, as in
  // Chrome: focus there (pages open date pickers and history lists on focus),
  // and on leaving change (if the value changed) and blur, which closes many
  // suggestion lists. When the user leaves Sift's field for the list or picker
  // the page opened (a click on a suggestion, ArrowDown), the page field
  // leaves only after that, and never if they come back to the field.
  /** The page field Sift entered and has not left yet. */
  let pageFocus: Element | null = null;
  let blurPending: Element | null = null;
  const leaveField = (el: Element) => {
    const entered = pageFocus === el;
    if (entered) pageFocus = null;
    if (!el.isConnected) return;
    // Blur only a field it entered or typed in.
    if (proxy.change(el) || entered) proxy.blur(el);
  };
  const flushBlur = () => {
    const el = blurPending;
    blurPending = null;
    if (el) leaveField(el);
  };
  /** A submit or Apply button beside the field (in its form or popup), not a suggestion or a menu choice. */
  const commitsField = (btn: Element, field: Element): boolean => {
    if (btn.closest("[role=listbox], [role=option], [role=menu], [role=menuitem], [role=grid]")) return false;
    const label = (btn.getAttribute("aria-label") || (btn as HTMLInputElement).value || btn.textContent || "").trim();
    if ((btn as HTMLButtonElement).type !== "submit" && !/^(apply|aplicar|ok|done|listo|save|guardar|update|actualizar|filter|filtrar|go|ir)$/i.test(label)) return false;
    for (let a = btn.parentElement, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) if (a.contains(field)) return true;
    return false;
  };
  /** The look Sift takes when the user pauses typing in a field with suggestions. */
  let typedRun = 0;
  /** When the user last typed in a field with suggestions: the page's new list (its answer from the network) shows promptly. */
  let suggestAt = -Infinity;
  /** The page field Sift entered last, and its selection before that. */
  let entrySel: { el: Element; sel: [number, number] | null; at: number } | null = null;
  /**
   * The page field `ref` names, or the one the page put in its place: Wikipedia swaps
   * its search box for its typeahead's on first focus, and the keys typed meanwhile
   * must reach the new one. Same kind, name and form, and the only one shown. It gets
   * focus if the old one had it, and (`sync`) the text Sift's field holds.
   */
  function liveField(ref: string | undefined, sync = true): Element | null {
    const el = elOf(ref);
    if (el || !ref) return el;
    const old = formerOf(ref);
    if (!old || old.isConnected || !plainField(old) || !old.name) return null;
    // Its form, if it went with it (a field taken out alone has none any more).
    const form = old.form?.id ?? old.closest("form")?.id;
    const like = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(old.localName)).filter(
      (c) => c.name === old.name && c.type === old.type && (form === undefined || (c.form?.id ?? "") === form) && !c.closest("sift-root") && c.checkVisibility(),
    );
    if (like.length !== 1) return null;
    const now = like[0];
    adopt(ref, now);
    if (pageFocus === old) {
      pageFocus = now;
      proxy.focus(now);
    }
    const mine = shadow.querySelector<HTMLInputElement>(`input[data-ref="${window.CSS.escape(ref)}"], textarea[data-ref="${window.CSS.escape(ref)}"]`);
    if (sync && mine && mine.value !== now.value) proxy.setValue(now, mine.value);
    return now;
  }

  /** A text field's selection (null where its type has none). */
  const selOf = (el: Element): [number, number] | null => {
    if (!plainField(el)) return null;
    try {
      const f = el as HTMLInputElement;
      return f.selectionStart === null || f.selectionEnd === null ? null : [f.selectionStart, f.selectionEnd];
    } catch {
      return null;
    }
  };
  /** Rich editors get their text on leaving instead (see flushEdits). */
  const plainField = (el: Element | null): el is HTMLInputElement => !!el && !(el as HTMLElement).isContentEditable && /^(input|textarea)$/.test(el.localName);
  /** A page field Sift's field enters and leaves: a text field, or a select (pages fill lists when one is entered). */
  const enterable = (el: Element | null): el is HTMLInputElement | HTMLSelectElement => plainField(el) || el instanceof HTMLSelectElement;

  /**
   * Before an action on `el`: the page field left by a press in Sift leaves
   * now, as the press (mousedown) makes it leave in Chrome, so change and blur
   * come before the click (a page that saves what change gave it). Not when the
   * press is in its own suggestion list or picker, which its blur may close.
   */
  function leaveBefore(el: Element) {
    const f = blurPending;
    if (!f) return;
    const sheet = shadow.activeElement?.closest(".suggest, .layer");
    if (sheet && !sheet.querySelector(`[data-ref="${window.CSS.escape(refOf(f))}"]`)) return;
    const ids = ["aria-controls", "aria-owns"].flatMap((n) => (f.getAttribute(n) ?? "").split(/\s+/)).filter(Boolean);
    if (ids.some((id) => document.getElementById(id)?.contains(el))) return;
    flushBlur();
  }

  /** `keep`: the action was inside the popup Sift shows (a box checked there): what opened it stays found. */
  const afterAct = (keep = false) => {
    actedAt = performance.now();
    armRecent(2500, keep);
    for (const d of [60, 400, 1200]) setTimeout(() => schedule(0), d);
  };
  /** `el` is inside the page popup or dialog Sift shows as a sheet. */
  const inShownDialog = (el: Element | null) => {
    const d = store.page?.dialog;
    const box = d && !store.dismissed.has(d.key) ? elOf(d.ref) : null;
    return !!box && !!el && deepContains(box, el);
  };

  /** A submit the browser refuses: focus goes to Sift's control for the first invalid field, as Chrome moves it on the original. */
  function focusInvalid(form: HTMLFormElement | null | undefined) {
    const bad = form && Array.from(form.elements).find((e) => (e as HTMLInputElement).willValidate && !(e as HTMLInputElement).validity?.valid);
    if (!bad) return;
    // Once the notice shows: a notice fixed at the top of the window (a flat bar) moves where focus stops.
    setTimeout(() => {
      const ctl = Array.from(shadow.querySelectorAll<HTMLElement>(`[data-ref="${window.CSS.escape(refOf(bad))}"]`)).find((c) => c.matches("input, select, textarea") && c.getClientRects().length > 0);
      if (!ctl) return;
      if (shadow.activeElement !== ctl) ctl.focus();
      else ctl.scrollIntoView({ block: "nearest" });
    }, 120);
  }

  /** A sheet closed while focus was on <body> (a click on its backdrop): back to the control that opened it. */
  const backToOpener = (tries = 2) =>
    setTimeout(() => {
      const a = document.activeElement;
      const lost = !a || a === document.body || a === document.documentElement || (a === host && !shadow.activeElement);
      // The start of the view, where focus fell meanwhile, counts as lost too.
      const fell = a === host && shadow.activeElement === main();
      if (store.mode === "sift" && (lost || fell) && !enteredPortal() && opener) {
        // A re-render may have replaced the opener (HN Search's list shown open beside its label): the control for the same page element, else with the same label.
        const o = opener;
        const ref = o.el.dataset.ref;
        const twin = o.el.isConnected
          ? o.el
          : Array.from(shadow.querySelectorAll<HTMLElement>(FOCUSABLE)).find((c) => !c.closest(".layer, .suggest") && c.localName === o.tag && (ref ? c.dataset.ref === ref : labelOf(c) === o.label));
        rescuing = true;
        const done = tryFocus(twin, true);
        rescuing = false;
        // It comes back with the page's next extractions (once the list it held is gone): try again then.
        if (!done && tries) backToOpener(tries - 1);
      }
    }, tries === 2 ? 0 : tries === 1 ? 450 : 1300);

  const disabled = (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";

  // ---------- links to a place in the page ----------
  /** The page element a block stands for, from its key ("s:r12") or its ref. */
  const blockEl = (b: Block): Element | null => elOf(/:(r[0-9a-z]+)$/.exec(b.key)?.[1]) ?? ("ref" in b ? elOf(b.ref) : null);

  /**
   * A same-page link ("22 comments" to #commentsFeed): after the page handled
   * it, show that place in Sift as the browser would in the page. The block
   * holding the target (or the first after it), with every closed section
   * around it opened, is scrolled to and focused.
   */
  function followAnchor(href: string | undefined) {
    let u: URL;
    try {
      u = new URL(href ?? "", location.href);
    } catch {
      return;
    }
    if (u.hash.length < 2 || u.href.split("#")[0] !== location.href.split("#")[0]) return;
    let id = u.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* not encoded */
    }
    // The page may build or open the target on the click (a comments feed).
    setTimeout(() => {
      const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
      // The page moved focus there itself (an error link to its field): Sift followed it already.
      if (target && performance.now() - pageFocusAt > 1000) showPlace(target);
    }, 150);
  }

  /**
   * A link that seeks a shown video (a timestamp in a comment): the page brings
   * its player into view as it seeks, and so does Sift, with its own copy of
   * that player. Called just before the click is replayed.
   */
  function followSeek() {
    const url = location.href;
    const was = store.page
      ? mediaPortals(store.page.blocks)
          .map(({ b }) => ({ ref: b.ref, v: mediaOf(elOf(b.ref), elOf(b.media?.video)) }))
          .filter((p) => !!p.v)
          .map((p) => ({ ...p, t: p.v!.currentTime, at: performance.now() }))
      : [];
    if (!was.length) return;
    let tries = 0;
    const check = () => {
      if (location.href !== url || store.mode !== "sift") return;
      // Moved more than playing on would move it.
      const hit = was.find(({ v, t, at }) => Math.abs(v!.currentTime - t - (v!.paused ? 0 : ((performance.now() - at) / 1000) * v!.playbackRate)) > 2);
      if (!hit) return void (++tries < 4 && setTimeout(check, 250));
      const box = boxOf(hit.ref);
      if (!box?.isConnected) return;
      const r = box.getBoundingClientRect();
      const bar = shadow.querySelector(".bar")?.getBoundingClientRect().bottom ?? 0;
      if (r.top >= bar && r.bottom <= host.clientHeight) return;
      host.scrollTop += r.top - Math.max(0, bar) - 8;
    };
    setTimeout(check, 150);
  }

  /**
   * Show where `target` is in Sift, as the browser would scroll to it in the
   * page: the block holding it (or the first one after it), with every closed
   * section around it opened, scrolled to and focused; not `loose`, only a
   * block inside it. False when Sift shows no block there.
   */
  function showPlace(target: Element, loose = true): boolean {
    const page = store.page;
    if (!page) return false;
    // The innermost block around the target, else the first one after it; with its sections.
    type Hit = { b: Block; path: Block[] };
    const found: { around?: Hit; inside?: Hit; after?: Hit } = {};
    const walk = (bs: Block[], path: Block[]) => {
      for (const b of bs) {
        const el = blockEl(b);
        // Blocks are walked outside in, so the last one around it is the innermost.
        if (el && deepContains(el, target)) found.around = { b, path };
        else if (el && deepContains(target, el)) found.inside ??= { b, path };
        else if (el && !found.after && target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found.after = { b, path };
        if (b.t === "section" || b.t === "article") walk(b.blocks, [...path, b]);
        // An entry of a list (a comment of a thread: "parent", "next") is a place of its own; its key names its element.
        if (b.t === "items")
          for (const it of b.items) {
            const ie = elOf(it.key.replace(/^i:/, ""));
            if (ie && deepContains(ie, target)) found.inside ??= { b: { t: "p", key: it.key, content: [] }, path: [...path, b] };
          }
      }
    };
    walk(page.blocks, []);
    const hit = loose ? found.inside ?? found.around ?? found.after : found.inside;
    if (!hit) return false;
    // Open the sections on the way (a section that loads on opening loads now).
    for (const sec of [...hit.path, hit.b]) {
      if (sec.t !== "section" || local("sec:" + sec.key, !sec.collapsed)) continue;
      store.local.set("sec:" + sec.key, true);
      if (sec.reveal) H.reveal(sec.reveal);
    }
    changed();
    setTimeout(() => {
      // The block itself when Sift marks it (a section, a heading), else its section.
      const keys = [hit.b, ...hit.path.slice().reverse()].map((b) => b.key);
      const el = keys.map((k) => shadow.querySelector<HTMLElement>(`[data-key="${window.CSS.escape(k)}"]`)).find(Boolean);
      if (!el) return;
      // To the top of the view, below Sift's sticky bar.
      const bar = shadow.querySelector(".bar")?.getBoundingClientRect().height ?? 0;
      host.scrollTop += el.getBoundingClientRect().top - bar - 8;
      const stop = el.localName === "details" ? el.querySelector<HTMLElement>("summary") : el;
      if (stop && stop.localName !== "summary") stop.tabIndex = -1;
      stop?.focus({ preventScroll: true });
    }, 0);
    return true;
  }

  // ---------- the page's own focus moves ----------
  // In answer to the user's action, the page moves focus (to its error summary,
  // the field an error link names, the reply box it opened). It cannot while
  // Sift is shown (it is inert); the page-world helper reports where it tried,
  // and Sift moves its own focus to its copy of that place once it shows it.
  let pageFocusTo: { el: Element; at: number } | null = null;
  /** When Sift last followed such a move. */
  let pageFocusAt = -Infinity;
  /** When the user last pressed the site's search button in Sift's bar (it opens a panel to type in). */
  let searchOpenedAt = -Infinity;
  /** The element the page last asked to focus (a dialog's default button), however long ago. */
  let pageAsked: Element | null = null;
  document.addEventListener("sift-focus", (e) => {
    const el = e.composedPath()[0];
    if (!(el instanceof Element) || store.mode !== "sift" || pageModal() || portalOf(el)) return;
    pageAsked = el;
    // The page put a new field in place of the one Sift's field stands for, and focused it
    // (Wikipedia's typeahead, on first focus): Sift's field stands for the new one now.
    if (pageFocus && !pageFocus.isConnected && liveField(refOf(pageFocus)) === el) {
      clearTimeout(typedRun);
      typedRun = window.setTimeout(() => schedule(0), 300);
      return;
    }
    // Not a page focusing things on its own (an autofocus on load).
    if (Date.now() - store.actAt > 2000 && performance.now() - actedAt > 2000) return;
    pageFocusTo = { el, at: performance.now() };
    setTimeout(followPageFocus, 0);
  });
  function followPageFocus() {
    const to = pageFocusTo;
    if (!to || store.mode !== "sift") return;
    if (performance.now() - to.at > 2500 || !to.el.isConnected) {
      pageFocusTo = null;
      return;
    }
    // Sift's control for it, in the open sheet if there is one.
    const layer = shadow.querySelector(".layer");
    const ref = window.CSS.escape(refOf(to.el));
    const ctl = Array.from((layer ?? shadow).querySelectorAll<HTMLElement>(`[data-ref="${ref}"]`)).find((c) => c.matches(FOCUSABLE) && c.getClientRects().length > 0);
    // A search opened from Sift's bar starts in its box, though the site's panel focuses a button
    // (BBC's menu focuses its "Search" button). A box the page has not enabled yet is waited for.
    if (ctl && layer && performance.now() - searchOpenedAt < 4000 && !ctl.matches("input, textarea")) {
      const box = layer.querySelector<HTMLInputElement>("input[type=search], input[type=text], input:not([type])");
      if (box) {
        if (box.disabled) return;
        pageFocusTo = null;
        pageFocusAt = performance.now();
        if (shadow.activeElement !== box) box.focus();
        return;
      }
    }
    if (ctl || (!layer && !shadow.querySelector(".suggest") && showPlace(to.el, false))) {
      pageFocusTo = null;
      pageFocusAt = performance.now();
      if (ctl && shadow.activeElement !== ctl) {
        ctl.focus();
        // The page selected the field's text as it focused it (an inline Edit): Sift's copy
        // selects the same range, so typing replaces the text as it would on the page.
        const sel = selOf(to.el);
        if (sel && plainField(ctl) && ctl.value === (to.el as HTMLInputElement).value)
          try {
            ctl.setSelectionRange(sel[0], sel[1], (to.el as HTMLInputElement).selectionDirection ?? undefined);
          } catch {
            /* a type with no selection */
          }
      }
    }
  }

  Object.assign(H, {
    toggle,
    act(ref, href) {
      const wrote = flushEdits();
      const el = elOf(ref);
      stat("action");
      if (store.page?.top?.some((a) => a.ref === ref && /^(search|buscar|busca|suche|recherche|cerca|pesquisar)\b/i.test(a.label))) searchOpenedAt = performance.now();
      // A page notice with a button (Undo) stays while the page shows it, unless that button was pressed.
      if (!store.noticeActions.length || store.noticeActions.some((a) => a.ref === ref)) clearNotice();
      if (el) {
        // A press inside the popup Sift shows may change nothing in the page (Double it, a refused
        // Subscribe): what opened the popup stays found while the page shows it.
        const keep = inShownDialog(el);
        reopenFor(el);
        let tries = 0;
        const go = () => {
          leaveBefore(el);
          // Sift's copy may still show the state from before the last edits; the page decides.
          // It enables Send once the text reached its editor, in a microtask or a task (React, Vue).
          if (disabled(el)) return wrote && tries++ < 2 ? void setTimeout(go, tries === 1 ? 0 : 60) : flushBlur();
          const problem = proxy.submitProblem(el);
          store.actAt = Date.now();
          // Pressing the Apply or submit button of the field just typed in commits the field first,
          // as leaving it does in the browser (Craigslist's price filter reads min and max on change).
          if (blurPending && commitsField(el, blurPending)) proxy.change(blurPending);
          if (el.localName === "a") followSeek();
          proxy.click(el);
          flushBlur();
          if (problem) {
            notify(problem);
            focusInvalid((el as HTMLButtonElement).form);
          }
          afterAct(keep);
          if (el.localName === "a") followAnchor((el as HTMLAnchorElement).href);
        };
        go();
      } else if (href) {
        location.assign(href);
        followAnchor(href);
      }
    },
    input(ref, value) {
      const el = liveField(ref, false);
      if (!el) return;
      if (store.notice && !lastToast) clearNotice();
      if (!(el instanceof HTMLInputElement) && el.getAttribute("role") === "slider") return slideTo(el, value);
      if ((el as HTMLElement).isContentEditable) pendingEdits.set(ref, value);
      else proxy.setValue(el, value);
      // A field with a suggestion list: Sift shows the list once the user pauses, not at the
      // next routine look, which on a long page (a Wikipedia article) is seconds away.
      if (el.matches("[aria-controls], [aria-owns], [list], [role=combobox]")) {
        clearTimeout(typedRun);
        typedRun = window.setTimeout(() => schedule(0), 300);
      }
      if (suggestAnchor() || el.matches("[aria-controls], [aria-owns], [list], [role=combobox]")) suggestAt = Date.now();
    },
    commit(ref) {
      const el = elOf(ref);
      // Focus is moving right now; write once it has landed, then come back there.
      // Plain fields get change with blur, when Sift's field is left (H.leave).
      if ((el as HTMLElement | null)?.isContentEditable) setTimeout(flushEdits, 0);
    },
    focus(ref) {
      const el = liveField(ref);
      if (!enterable(el)) return;
      // Entered from the page view, its box is the page's (never a popup); from a sheet, the popup's.
      noteEntered(shadow.activeElement?.closest(".layer, .sheet") ? null : el);
      // Back from its own suggestion list or picker: the page field never left.
      if (blurPending === el) {
        blurPending = null;
        return;
      }
      flushBlur();
      // A re-render replaced Sift's field: the page field never left either.
      // Sift putting focus back after a sheet closed: the user did not enter it.
      if (pageFocus === el || rescuing) return;
      if (pageFocus) leaveField(pageFocus);
      pageFocus = el;
      entrySel = { el, sel: selOf(el), at: performance.now() };
      proxy.focus(el);
      // What it opens (a calendar, recent searches) shows next to the field;
      // what the last action opened (the popup this field is in) stays found.
      armRecent(2500, true);
      setTimeout(() => schedule(0), 150);
    },
    leave(ref, to) {
      const el = elOf(ref);
      if (!enterable(el)) return;
      // Into the list or picker the page opened for it, or a press in Sift (on a suggestion): later.
      if (pointerInSift || holdBlur || (to instanceof Element && !!to.closest(".suggest, .layer"))) {
        if (blurPending !== el) flushBlur();
        blurPending = el;
      } else {
        if (blurPending === el) blurPending = null;
        leaveField(el);
      }
    },
    fieldClick(ref) {
      const el = elOf(ref);
      if (!enterable(el)) return;
      // The click a user's press on the field makes there (pickers and comboboxes open on it).
      // As it was before the press entered it (the page may select on focus or on click).
      const was = entrySel?.el === el && performance.now() - entrySel.at < 1500 ? entrySel.sel : selOf(el);
      proxy.click(el);
      armRecent(2500, true);
      // The page selected its whole text on that click (Google Maps' directions fields): so does
      // Sift's field, so the first key typed replaces the text there as it would on the page.
      const f = shadow.activeElement as HTMLInputElement | null;
      const mirror = () => {
        const now = selOf(el);
        if (!plainField(el) || !now || !el.value || f !== shadow.activeElement || f?.dataset.ref !== ref || f.value !== el.value) return false;
        if (now[0] !== 0 || now[1] !== el.value.length || (was && was[0] === 0 && was[1] === el.value.length)) return false;
        f.select();
        return true;
      };
      if (!mirror()) setTimeout(mirror, 0);
    },
    check(ref, checked) {
      const el = elOf(ref);
      // A native box makes no change in the page that would show its popup is still open.
      const keep = inShownDialog(el);
      if (el) {
        reopenFor(el);
        leaveBefore(el);
        proxy.setChecked(el, checked);
      }
      afterAct(keep);
    },
    select(ref, value) {
      const el = elOf(ref);
      const keep = inShownDialog(el);
      if (el instanceof HTMLSelectElement) proxy.setSelect(el, value);
      afterAct(keep);
    },
    files(ref, files) {
      const el = elOf(ref);
      if (el instanceof HTMLInputElement) proxy.setFiles(el, files);
    },
    submit(field, formRef, buttonRef, via) {
      flushEdits();
      flushBlur();
      stat("action");
      store.actAt = Date.now();
      const fieldEl = field ? liveField(field.ref) : null;
      const form = (elOf(formRef) as HTMLFormElement | null) ?? (fieldEl as HTMLInputElement | null)?.form ?? null;
      const keep = inShownDialog(form ?? fieldEl);
      const problem = proxy.submit(fieldEl, elOf(buttonRef), form instanceof HTMLFormElement ? form : null, via);
      // The page would show its validation bubble on a hidden field; say it here.
      if (problem) {
        notify(problem);
        focusInvalid(form instanceof HTMLFormElement ? form : null);
      } else clearNotice();
      afterAct(keep);
    },
    media(op, info, portalRef) {
      const portal = elOf(portalRef);
      // The same video Sift's bar shows: what plays now, else the player's own.
      const v = mediaOf(portal, elOf(info.video));
      const btn = (r?: string) => elOf(r);
      switch (op) {
        case "play":
          if (btn(info.play)) proxy.click(btn(info.play)!);
          else if (v && (v.currentSrc || v.readyState > 0)) v.paused ? v.play().catch(() => {}) : v.pause();
          else {
            // The player has not loaded its video yet (a poster with a big Play
            // button): start it the way a user would, with its own control.
            const start = playControl(portal);
            if (start) proxy.click(start);
            else v?.play().catch(() => {});
          }
          break;
        case "back":
          if (v) v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case "fwd":
          if (v) v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
          break;
        case "mute":
          if (v) v.muted = !v.muted;
          break;
        case "captions":
          if (btn(info.captions)) proxy.click(btn(info.captions)!);
          break;
        case "fullscreen":
          fsBack = { el: proxy.deepActive(), top: host.scrollTop, at: performance.now() };
          // An element showing as a popover cannot go full screen: release it first.
          releaseForFullscreen(portalRef);
          if (btn(info.fullscreen)) proxy.click(btn(info.fullscreen)!);
          else (portal as HTMLElement | null)?.requestFullscreen?.().catch(() => cancelRelease(portalRef));
          break;
      }
      changed();
    },
    closeDialog(key, closeRef, dialogRef) {
      if (store.dismissed.has(key)) return;
      // A page modal with no close of its own (a consent wall, an age gate) stays until the page
      // removes it: Escape goes to the page, which decides, and Sift never hides only its copy.
      const d = store.page?.dialog;
      const blocking = d?.key === key && !!d.blocking;
      if (!blocking) {
        store.dismissed.add(key);
        dismissedRefs.set(key, dialogRef);
      }
      flushEdits();
      const el = elOf(closeRef);
      if (!blocking) backToOpener();
      if (el) proxy.click(el);
      else {
        // Escape goes to the page's popup, never to Sift's own elements.
        const target = elOf(dialogRef);
        const pageFocus = document.activeElement && document.activeElement !== host ? document.activeElement : null;
        proxy.key(target ?? pageFocus ?? document.body, "Escape");
        // A menu that ignores Escape (HN Search's dropdowns) closes on a click outside it, as it would on the original.
        if (target && !blocking)
          setTimeout(() => {
            if (store.mode === "sift" && store.dismissed.has(key) && target.isConnected && stillShown(target)) proxy.click(document.body);
          }, 150);
      }
      changed();
      afterAct();
    },
    loadMore(ref) {
      askMore();
      loadMore(ref);
    },
    reveal(ref) {
      const el = elOf(ref);
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      dispatchEvent(new Event("scroll"));
      afterAct();
      setTimeout(() => schedule(0), 2500);
    },
    menu(open) {
      store.menuOpen = open;
      changed();
      if (!open) backToOpener();
    },
    enterPortal(ref) {
      const el = elOf(ref) as HTMLElement | null;
      if (!el) return;
      enterPortalStops(ref);
      const stops = portalStops(el);
      const first = stops[0] ?? el;
      // A frame may sit in the element's shadow root (MDN's runner).
      if (el.localName === "iframe" || el.querySelector("iframe") || stops.some((s) => s.localName === "iframe")) addTail(ref);
      first.focus();
    },
  } satisfies typeof H);

  // ---------- messages from the toolbar button and shortcut ----------
  try {
    chrome.runtime.onMessage.addListener((msg: RuntimeMsg) => {
      if (msg.type === "toggle") toggle();
    });
  } catch {
    /* orphaned after an extension reload */
  }

  function stat(name: StatName, extra: { ms?: number } = {}) {
    try {
      chrome.runtime.sendMessage({ type: "stat", name, ...extra } satisfies RuntimeMsg).catch(() => {});
    } catch {
      /* orphaned */
    }
  }

  // ---------- settings and fonts ----------
  // The content script only gets the few settings it needs; the API key stays
  // in the background. Model calls wait until these arrive.
  (async () => {
    try {
      const cfg = (await chrome.runtime.sendMessage({ type: "config" } satisfies RuntimeMsg)) as { scale: number; ai: boolean; never: boolean } | undefined;
      if (cfg) {
        scale = cfg.scale;
        if (!cfg.ai) store.aiOff = true;
        if (cfg.never) {
          store.aiOff = true;
          if (store.mode === "sift") setMode("original", false);
        }
      }
    } catch {
      /* no background (extension reloaded) */
    }
    fontSize();
    setAiReady();
    if (store.page) processAi(store.page);
  })();
  loadFont();

  initPortals(host, () => shadow.querySelector(".bar"), () => shadow.querySelector(".toggle"));
  if (store.mode === "sift") shieldOn([]);
  render(h(App, {}), mount);
  // Show the loading line only if the page is slow to give us anything.
  setTimeout(() => {
    if (store.booting) changed();
  }, 400);
  if (document.body) schedule(0);
}

async function loadFont() {
  try {
    const faces = [
      ["fonts/atkinson-next-latin.woff2", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
      ["fonts/atkinson-next-latin-ext.woff2", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"],
    ];
    for (const [path, range] of faces) {
      const buf = await (await fetch(chrome.runtime.getURL(path))).arrayBuffer();
      const face = new FontFace("Sift Sans", buf, { weight: "100 900", unicodeRange: range, display: "swap" } as FontFaceDescriptors);
      await face.load();
      document.fonts.add(face);
    }
  } catch {
    /* system fonts are fine */
  }
}
