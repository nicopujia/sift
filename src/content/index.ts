// Sift's content script. Runs at document_start on every page:
// 1. covers the page with Sift's view before the original can paint,
// 2. extracts the page into a model and renders it, re-extracting as the page
//    changes, and
// 3. replays every interaction on the original page.

import { h, render } from "preact";
import type { Block, Page } from "./model";
import { blocksText } from "./model";
import type { RuntimeMsg, StatName } from "../shared/messages";
import { extract, activeAdapter } from "./extract";
import { adopt, elOf, formerOf, refOf, sweepRefs } from "./registry";
import {
  FOCUSABLE, boxOf, cancelRelease, deepContains, enterPortalStops, enteredPortal, hidePortalStops, initPortals, layout,
  leavePortalStops, parkPortals, portalElements, portalOf, portalStops, portalsDisplaced, refOfPortal, releaseForFullscreen,
  mediaOf, reraisePortals, setModalOpen, setPortals, suspendPortals, videoIn,
} from "./portal";
import { accName, clean, resetCaches, shadowRootOf, textIn, visible } from "./dom";
import { refreshShield, shieldOff, shieldOn, withoutShield } from "./shield";
import * as proxy from "./proxy";
import { App, lastTouched, lastTyped, suggestAnchor } from "./ui/app";
import { CSS } from "./ui/styles";
import { H, changed, local, onEnter, onKeys, setRenderer, store } from "./ui/store";
import { processAi, resetAi, setAiReady } from "./ai";
import { setLang, t } from "./i18n";
import { armRecent, noteMutations, clearRecent, noteEntered, pageChangedAt } from "./recent";
import { askConsent, consentWallUp, cutShort, findToast } from "./extract/generic";
import { pageUrl as siteUrl } from "./extract";

const MODE_KEY = "sift:mode";
const isHtml = document.contentType === "text/html" && document.documentElement?.localName === "html";

type PortalBlock = Extract<Block, { t: "portal" }>;
/** A page's bars, menus and hidden parts (a folded filter's options), whose text is not its content (the content gate, perf16). */
const GATE_CHROME = "nav, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=menu], [role=menubar], [role=dialog], dialog, [hidden], template, noscript, script, style, select, details:not([open]) > :not(summary)";

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

/** The part of a poster with no labeled Play that a click starts: its largest element with a pointer cursor (F924). */
function posterTarget(root: Element | null): HTMLElement | null {
  if (!root) return null;
  const area = (el: Element) => el.getBoundingClientRect().width * el.getBoundingClientRect().height;
  let best: HTMLElement | null = null;
  for (const el of [root, ...Array.from(root.querySelectorAll("*")).slice(0, 300)])
    if (el instanceof HTMLElement && getComputedStyle(el).cursor === "pointer" && area(el) > (best ? area(best) : 0)) best = el;
  return best;
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

/** The original elements of the social posts' fallback quotes in `blocks` (X's blockquote before its widget loads). */
function embedQuotes(blocks: Block[], out: Element[] = []): Element[] {
  for (const b of blocks) {
    if (b.t === "quote" && b.embed) {
      const el = elOf(b.key.slice(2).split(":")[0]);
      if (el) out.push(el);
    } else if (b.t === "section" || b.t === "article") embedQuotes(b.blocks, out);
  }
  return out;
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
        ? base + "inset: 0 !important; width: 100% !important; height: 100% !important; overflow: auto !important; overscroll-behavior: contain !important; background: light-dark(#fff, #121212) !important; color-scheme: light dark !important;"
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

  // A fresh YouTube list (search, home, a feed) has nothing for Sift to show before YouTube draws it. A look before
  // YouTube's own first paint (its layout of the half-parsed page) let Chrome draw a frame just before YouTube's
  // long startup task, and YouTube's results (so Sift's list) then came 300-900 ms later. Looks wait for that
  // paint, a switch, or 4 s (perf16).
  let ytHold = mode === "sift" && /(^|\.)youtube\.com$/.test(location.hostname) && location.hostname !== "music.youtube.com" && /^\/(results|feed\/.*)?$/.test(location.pathname);
  let ytRelease = () => {};
  if (ytHold) {
    let po: PerformanceObserver | null = null;
    const holdTimer = setTimeout(() => ytRelease(), 4000);
    ytRelease = () => {
      ytRelease = () => {};
      ytHold = false;
      po?.disconnect();
      clearTimeout(holdTimer);
      schedule(0);
    };
    try {
      po = new PerformanceObserver((l) => {
        if (l.getEntries().some((e) => e.name === "first-contentful-paint")) ytRelease();
      });
      po.observe({ type: "paint", buffered: true });
    } catch {
      ytHold = false;
    }
  }

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
    const label = labelOf(el);
    const inSheet = !!el.closest(".layer, .suggest");
    // A field: the fields with its tag and label (each cart row's Quantity), to find its row's again (F953).
    const peers = /^(input|textarea|select)$/.test(el.localName) ? all.filter((c) => c.localName === el.localName && !!c.closest(".layer, .suggest") === inSheet && labelOf(c) === label) : [el];
    return {
      el,
      inSheet,
      list: list ? lists.indexOf(list) : -1,
      listLabel: list?.getAttribute("aria-label") ?? null,
      item: li && list ? Array.from(list.children).indexOf(li) : -1,
      /** Its place among its item's controls. */
      pos: li ? Array.from(li.querySelectorAll(FOCUSABLE)).indexOf(el) : -1,
      /** Its item's title, to tell when the item itself is gone. */
      itemTitle: li?.querySelector(".title")?.textContent ?? null,
      label,
      /** Its rank among the fields with its tag and label, and how many there were. */
      rank: peers.indexOf(el),
      peers: peers.length,
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
    const same = all.filter((c) => labelOf(c) === spot.label);
    // Several fields share the label (each cart row's Quantity): the same row's, at its rank while as
    // many are there; never simply the first, where the next key would change another row (F953).
    if (spot.peers > 1) return same.length === spot.peers && spot.rank >= 0 ? same[spot.rank] ?? null : null;
    return same[0] ?? null;
  }

  /** Keep the text being typed, and the caret, in a field a re-render replaced. */
  function carry(spot: Spot, el: HTMLElement) {
    if (spot.value === null || (el.localName !== "input" && el.localName !== "textarea")) return;
    const f = el as HTMLInputElement;
    // Only into the same page field, or the one the page put in its place: a control
    // that only shares its label (the next item's Quantity) gets focus, never the text (F851).
    const ref = el.dataset.ref;
    const now = spot.ref && ref !== spot.ref ? liveField(spot.ref, false) : null;
    const same = ref === (spot.ref ?? undefined) || (!!now && elOf(ref) === now);
    // Only text typed since the last action: after Send, the page may clear the field on purpose.
    if (same && f.value !== spot.value && lastTyped(spot.el) > store.actAt) {
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
      // Re-rendered: the control for the same page element first (a combobox whose label now shows the pick, F1112), else one with the same label.
      const ref = o.el.dataset.ref;
      const outside = Array.from(shadow.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((c) => c.localName === o.tag && !c.closest(".layer, .suggest") && c.getClientRects().length > 0);
      const byRef = ref ? outside.filter((c) => c.dataset.ref === ref) : [];
      const same = byRef.find((c) => labelOf(c) === o.label) ?? byRef[0] ?? outside.find((c) => labelOf(c) === o.label);
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
  /** The top-bar control that opens the site's search, to come back to when its panel closes (F733). */
  let searchFrom: { label: string; tag: string; url: string } | null = null;

  // ---------- page scroll boxes read to their end ("scroll to the end to agree") ----------
  /**
   * The end of a page scroll box's text is in Sift's view (the reader got there): the page's
   * box scrolls to its end too, so the page sees it read, as it would on the original, and
   * enables its Agree box itself. Sift never ticks or enables it.
   */
  let endsFrame = 0;
  /** Boxes found not to gate anything, and when (checked again a second later: the gate may render after the box). */
  const notGates = new WeakMap<Element, number>();
  /**
   * A real scroll gate: a box of text whose end a control waits on (terms to scroll to the end
   * of before "I agree" enables). A disabled checkbox or button is among the first controls after
   * it, before any field to type in, and the box holds all its text (its text reaches the end of what it scrolls). Never a list
   * the page draws by scroll position (react-window, ag-grid), a chat or a feed: those keep
   * their own scroll position, with the rows where the page shows them.
   */
  function scrollGate(box: Element): boolean {
    if (Date.now() - (notGates.get(box) ?? 0) < 1000) return false;
    const gate = (() => {
      if (box.matches("[role=list], [role=listbox], [role=grid], [role=treegrid], [role=tree], [role=table], [role=feed], [role=log], [aria-live]:not([aria-live=off])")) return false;
      if (box.querySelector("[role=feed], [role=log], [role=grid], [role=treegrid], [role=listbox], [role=row]")) return false;
      // The first controls after the box (in the same form or dialog, or the rows that follow it): a disabled
      // checkbox or button among them, before any field to type in (a chat's message box and its Send).
      let after: Element[] = [];
      for (let a = box.parentElement, up = 0; a && !after.length && up < 4; a = a.parentElement, up++) {
        after = Array.from(a.querySelectorAll("input:not([type=hidden]), button, select, textarea, [contenteditable]:not([contenteditable=false]), [role=checkbox], [role=switch], [role=button]"))
          .filter((c) => !box.contains(c) && !!(box.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING))
          .slice(0, 3);
      }
      const field = after.findIndex((c) => !c.matches("input[type=checkbox], input[type=submit], input[type=button], button, [role=checkbox], [role=switch], [role=button]"));
      if (!after.slice(0, field < 0 ? 3 : field).some((c) => c.matches(":disabled, [aria-disabled=true]"))) return false;
      // Its text reaches its end: not rows drawn by scroll position under a tall spacer.
      const texts: Text[] = [];
      const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) if ((w.currentNode as Text).data.trim()) texts.push(w.currentNode as Text);
      const range = document.createRange();
      const last = texts.reverse().find((t) => (range.selectNodeContents(t), range.getClientRects().length > 0));
      if (!last) return false;
      const end = box.getBoundingClientRect().top + box.clientTop - box.scrollTop + box.scrollHeight;
      return end - range.getBoundingClientRect().bottom < box.clientHeight;
    })();
    if (!gate) notGates.set(box, Date.now());
    return gate;
  }
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
        if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 2 || !scrollGate(box)) continue;
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
    if (searchOpener && before) searchFrom = { label: spot?.label ?? "", tag: before.localName, url: location.href };
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
    // The site's search panel closed (its "Close", or Escape in its box) and took the focused control with it:
    // back to the top-bar control that opened it, not to a heading further down.
    if (hadBox && searchFrom && searchFrom.url === location.href && !shadow.querySelector(".bar form.search input")) {
      const o = searchFrom;
      const opener = Array.from(shadow.querySelectorAll<HTMLElement>(".bar " + o.tag)).find((c) => labelOf(c) === o.label);
      rescuing = true;
      const done = tryFocus(opener, true);
      rescuing = false;
      if (done) return;
    }
    // The page focused what the control became (a name turned editable as Rename was pressed): there, not the next control (F1412).
    if (!(pageFocusTo && followPageFocus())) refocus(spot, heads);
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
    // Main itself on a page with no sections: its blocks are the box.
    if (!box || !main()?.contains(box)) return null;
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
    // Main itself (a page with no sections): its first block is still there (the same page grew,
    // it did not go to another), and only blocks where the control was are new ones.
    const inMain = m.box === main();
    if (inMain && m.i > 0 && !m.old.has(kids[0]?.textContent ?? "")) return false;
    // New where the control was first; else anywhere in its box (a list the page sorted afresh).
    const isNew = (c: HTMLElement) => c.localName !== "summary" && !m.old.has(c.textContent ?? "") && c.getClientRects().length > 0;
    const fresh = kids.slice(m.i).find(isNew) ?? (inMain ? undefined : kids.find(isNew));
    const prev = m.i < 1 ? undefined : kids[Math.min(m.i, kids.length) - 1];
    // In main, the block before the control grew in place (the entries it holds): focus goes there and the view stays.
    const grown = inMain && !fresh && prev && isNew(prev) ? prev : undefined;
    const el = fresh ?? grown ?? (m.hold ? null : prev);
    if (!el) return false;
    if (!el.matches(FOCUSABLE)) el.tabIndex = -1;
    if (!tryFocus(el)) return false;
    // Where the control was, whatever the render did to the view on the way (it can shrink for a moment),
    // unless the reader has scrolled since.
    const r = el.getBoundingClientRect();
    if (userScrollAt < m.at && !grown) host.scrollTop += (fresh ? r.top : r.bottom) - m.y;
    moreWait = fresh || grown ? null : { ...m, hold: el, at: Date.now() };
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
          // A press on the bar search's button keeps focus in its field, so the search goes as Enter's does
          // (F856: Discourse closes its results when its field blurs).
          else if (type === "mousedown" && path[0] instanceof Element && path[0].closest("form.search button[type=submit]") && shadow.activeElement?.closest("form.search") === path[0].closest("form.search")) e.preventDefault();
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
  // script that blurred it) comes back to it. So does focus a page script gave Sift's root
  // itself: the root is the page's active element, and Google Maps focuses it again after a route update (F960).
  function onSiftBlur(e: FocusEvent) {
    if (e.relatedTarget && e.relatedTarget !== host) return;
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
      tabAt = Date.now();
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
    // Keys a group of Sift's controls takes (a video's bar: the player's letter keys, 0-9), also on the video's box.
    const group = tg?.closest?.(".media") ?? (tg?.matches?.(".portal") ? tg.parentElement?.querySelector(":scope > .media") : null);
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
  /** The page slider Sift's range field `tg` stands for, if it is not a native range, or the page spinbutton Sift's spinbutton is (F902). */
  const ariaSlider = (tg: Element | null): Element | null => {
    if (tg instanceof HTMLElement && tg.getAttribute("role") === "spinbutton" && tg.dataset.ref) {
      const el = elOf(tg.dataset.ref);
      return el?.getAttribute("role") === "spinbutton" ? el : null;
    }
    if (!(tg instanceof HTMLInputElement) || tg.type !== "range") return null;
    const el = elOf(tg.dataset.ref);
    return el && !(el instanceof HTMLInputElement) && el.getAttribute("role") === "slider" ? el : null;
  };
  /** A slider key on Sift's copy of a page slider: the page slider gets it, and decides the new value. */
  function sliderKey(e: KeyboardEvent, tg: HTMLElement): boolean {
    const el = ariaSlider(tg);
    if (!el || e.altKey || e.ctrlKey || e.metaKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
      // A spinbutton the page draws may take typed digits too (a time's hour).
      if (!el || el.getAttribute("role") !== "spinbutton" || e.altKey || e.ctrlKey || e.metaKey || !/^([0-9]|Backspace|Delete)$/.test(e.key)) return false;
    }
    e.preventDefault();
    // A digit typed in a segment the page edits itself (React Aria's date and time fields) reaches it as
    // the browser sends it after an uncancelled keydown: beforeinput, then input if not cancelled (F1041).
    const typed = /^[0-9]$/.test(e.key) && (el as HTMLElement).isContentEditable;
    // The page moves on to the next segment once one is filled (12, then the day), or on ArrowRight: during
    // the key the page-world helper names the segment as the active element and lets the page's focus
    // manager find the next one, whose focus() Sift then follows to its copy (F1103).
    const seg = el.getAttribute("role") === "spinbutton";
    store.actAt = Date.now();
    if (seg) el.dispatchEvent(new CustomEvent("sift-enter", { bubbles: true, composed: true, detail: "key" }));
    try {
      proxy.key(el, e.key, typed ? () => {
        const init = { inputType: "insertText", data: e.key, bubbles: true, cancelable: true, composed: true };
        if (el.dispatchEvent(new InputEvent("beforeinput", init))) el.dispatchEvent(new InputEvent("input", { ...init, cancelable: false }));
      } : undefined);
    } finally {
      // On the document: the page may have replaced the segment meanwhile.
      if (seg) document.dispatchEvent(new CustomEvent("sift-leave", { detail: "key" }));
    }
    store.actAt = Date.now();
    keyAct(el, tg);
    return true;
  }
  /**
   * A held key is many presses: Sift's copy shows the page's new value as soon as the page set it, and the
   * page is read again once the presses pause, not three times per press (F1042).
   */
  let keyRun = 0;
  function keyAct(el: Element, tg?: HTMLElement) {
    actedAt = performance.now();
    if (tg)
      queueMicrotask(() => {
        if (!tg.isConnected) return;
        const now = el.getAttribute("aria-valuenow");
        const text = el.getAttribute("aria-valuetext") || (tg instanceof HTMLInputElement ? "" : (el.textContent ?? "").trim());
        if (tg instanceof HTMLInputElement) {
          if (now) tg.value = now;
          if (text) tg.setAttribute("aria-valuetext", text);
          return;
        }
        if (now) tg.setAttribute("aria-valuenow", now);
        if (text) tg.setAttribute("aria-valuetext", text);
        const t = tg.firstChild;
        const shown = text || now;
        if (shown && t instanceof Text && !t.nextSibling && t.data !== shown) t.data = shown;
      });
    clearTimeout(keyRun);
    keyRun = window.setTimeout(() => schedule(0), 250);
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
      // A drag moves it many times: the page is read once the drag pauses (F1042).
      keyAct(el);
    };
    step();
  }

  /**
   * Escape for a page suggestion list shown under Sift's `field`: the page field gets it first, and
   * Sift's list closes. A page that keeps its list (Wikipedia's portal closes it only through the
   * browser's own Escape, which Sift's field holds back) gets it back once the user types again.
   */
  let escapedList: { key: string; ref: string | undefined } | null = null;
  function escapeList(key: string, listRef: string | undefined, field: HTMLElement, pf: Element) {
    flushEdits();
    proxy.key(pf, "Escape");
    if (!field.matches(":focus")) field.focus();
    const hidden = (force: boolean) => {
      const list = elOf(listRef);
      const kept = !!list && list.checkVisibility();
      if ((kept && !force) || store.dismissed.has(key)) return;
      store.dismissed.add(key);
      dismissedRefs.set(key, listRef);
      if (kept) escapedList = { key, ref: field.dataset.ref };
      changed();
    };
    hidden(false);
    setTimeout(() => hidden(true), 0);
    setTimeout(() => schedule(0), 60);
  }
  /**
   * Escape closed the list for that opening only: the user opens it again (enters the field,
   * clicks it, types) and the list the page still shows comes back (F951: a calendar under a
   * read-only date field that ignores Escape).
   */
  function unescapeList(ref: string) {
    if (escapedList?.ref !== ref) return;
    store.dismissed.delete(escapedList.key);
    dismissedRefs.delete(escapedList.key);
    escapedList = null;
    changed();
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
    // What was typed reaches the page field first: an editor that keeps a draft on Escape keeps all of it.
    flushEdits();
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
    if (i < 0) {
      // A picker drawn under its field (a calendar) comes right after the field in Tab order, as it is
      // drawn, when the page's popup has tab stops of its own. A suggestion list keeps its arrow keys.
      const pop = elOf(store.page?.dialog?.ref);
      if (!list.length || !pop || pop.matches("[role=listbox], [role=menu]") || pop.querySelector("[role=listbox], [role=menu], [role=option]")) return;
      if (!Array.from(pop.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")).some((c) => c.tabIndex >= 0 && !(c as HTMLButtonElement).disabled && c.checkVisibility())) return;
      const to = !e.shiftKey && tg === field ? list[0] : e.shiftKey && tg === siftAfter(field) ? list[list.length - 1] : null;
      if (!to) return;
      e.preventDefault();
      to.focus();
      return;
    }
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
  /** The title and first heading of the page shown when the address changed: never said for the next page (F921). */
  let titleFrom = { title: "", head: "" };
  const headOf = (p: Page | null | undefined) => (p?.blocks.find((b) => b.t === "h" && b.level === 1) as { text?: string } | undefined)?.text ?? "";
  /**
   * A new page still shows the last one's title (YouTube swaps it seconds later, longer under load): say its
   * own once it has one, or its new heading (a page that shares the site's title), never the old title.
   */
  function lateTitle() {
    const p = store.page;
    if (!titleWait || !p) return;
    const head = headOf(p);
    const name = p.title && p.title !== titleFrom.title ? p.title : head && head !== titleFrom.title && head !== titleFrom.head ? head : "";
    if (name) {
      titleWait = false;
      return say(name);
    }
    if (Date.now() - navAt < 12000) titleTimer = window.setTimeout(lateTitle, 1000);
    // Still the old title: nothing new to say. A page with no title yet keeps waiting for one.
    else if (p.title) titleWait = false;
  }
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
  /** The last look stopped at its time budget (see run): the next reads the whole page (F1220). */
  let cutLast = false;
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
  /**
   * The content gate: while the page loads and Sift shows none of its content, the text the page added
   * outside its bars since the last look. Once it reaches gateMin, the look runs at once, in the change
   * that brought the content: no wait behind a look that found only the page's header (perf16).
   */
  let contentAdded = 0;
  let gateMin = 200;
  /** The look under way was started by the gate. */
  let byGate = false;
  /** How the gate sees content: "" by its text (a page with no adapter), an adapter's selector for its entries, null not at all (other adapter pages). */
  let gateSel: string | null = "";
  /** A run waiting for an idle moment. */
  let idleRun = 0;
  /** When this page started loading (or the last single-page navigation). */
  let loadStart = performance.now();
  /** When the user last acted through Sift (a click, a check, a submit): the page's answer may come late. */
  let actedAt = -Infinity;
  /** When the user last typed in a Sift field: the page's text answer to it (a "65 characters left" counter) is no clock (F802). */
  let typedAt = -Infinity;
  /** Sift shows the page's content for this address (not a loading line), or the page has had its time to load. */
  const contentShown = (minor = false) =>
    (!!store.page && store.page.blocks.length > 0 && !thinView(store.page.blocks) && !store.page.partial && store.page.url === location.href) ||
    // A slow or busy machine can take far more than 10 s to fill a page's frame: while Sift shows only
    // that frame, the page's changes (not a ticking clock) are read promptly for a minute (F873).
    performance.now() - loadStart > (!minor && store.page && !store.page.partial && thinView(store.page.blocks) ? 60000 : 10000);
  /**
   * The page is still coming in: its first half minute, or, on a slow or busy machine, while it has not
   * finished loading or Sift shows only its frame, up to a minute and a half (F873).
   */
  const stillLoading = () => {
    const t = performance.now() - loadStart;
    return t < 30000 || (t < 90000 && (document.readyState !== "complete" || (!!store.page && thinView(store.page.blocks))));
  };
  /**
   * Only a title and a line (a results page before its results come in, F728), or only the
   * frame's headings and a few links (weather.com before its forecast, F873): the content is still to come.
   */
  const thinView = (bs: Block[]) =>
    blocksText(bs).length < 200 &&
    bs.every((b) => b.t === "h" || b.t === "p" || b.t === "note" || (bs.length > 3 && (b.t === "ul" || b.t === "actions")));
  /**
   * None of the page's content: no entries, table, code, facts, picture, player, article text or grid of
   * controls (a picker's 3000 buttons), and under 200 characters outside folded sections (a title with its
   * sort and count, a repository's header and tabs, perf16).
   */
  const noContent = (bs: Block[]): boolean => {
    const rich = (xs: Block[]): boolean =>
      xs.some((b) => (b.t === "items" && b.items.length > 0) || (b.t === "actions" && b.actions.length >= 40) || b.t === "table" || b.t === "pre" || b.t === "portal" || b.t === "facts" || b.t === "img" || (b.t === "article" && blocksText(b.blocks).length >= 100) || (b.t === "section" && !b.collapsed && rich(b.blocks)));
    return !rich(bs) && blocksText(bs.filter((b) => !(b.t === "section" && b.collapsed))).length < 200;
  };
  /** Sift shows none of the page's content yet: nothing, or only a title and a line (see thinView). Asked on every change while loading: kept per page read. */
  const emptyViews = new WeakMap<Page, boolean>();
  const viewEmpty = () => {
    const p = store.page;
    if (!p?.blocks.length) return true;
    let e = emptyViews.get(p);
    if (e === undefined) emptyViews.set(p, (e = thinView(p.blocks) || (gateSel !== null && noContent(p.blocks))));
    return e;
  };
  /** The gate is open: a page it sees content on, still loading, with none of its content shown (perf16). */
  const gateOpen = () => gateSel !== null && document.readyState !== "complete" && viewEmpty();
  /** A view that fills the screen (a screenful of text, entries, a table or code): while the HTML comes in, read again less often (perf16). */
  const fullViews = new WeakMap<Page, boolean>();
  const fullView = (p: Page | null) => {
    if (!p) return false;
    let f = fullViews.get(p);
    if (f === undefined) {
      let n = 0;
      let rich = false;
      const walk = (bs: Block[]) => {
        for (const b of bs) {
          if (b.t === "items") n += b.items.length;
          else if (b.t === "table" || b.t === "pre") rich = true;
          else if (b.t === "section" || b.t === "article") walk(b.blocks);
        }
      };
      walk(p.blocks);
      fullViews.set(p, (f = rich || n >= 8 || blocksText(p.blocks).length >= 1500));
    }
    return f;
  };

  /**
   * Extract again: now (`delay` 0: navigation, after an action), after
   * `delay`, or, for a change in the page, soon enough to keep up but at a
   * cost the page can afford. `minor`: only text or style changed (a clock).
   */
  const schedule = (delay?: number, minor = false, grew = false) => {
    if (store.mode !== "sift") return;
    // The page's content came in while Sift shows none of it: the look that shows it runs now (perf16).
    if (delay === undefined && contentAdded >= gateMin && gateOpen()) {
      byGate = true;
      return run();
    }
    let d: number;
    let idle = false;
    if (delay !== undefined) d = delay;
    // `grew`: the page added a lot of new text in its first half minute (its forecast, its code):
    // on a slow machine that is its content still coming in, not a routine update (F873).
    else if (!contentShown(minor) || performance.now() - loadStart < 3000 || (grew && stillLoading())) {
      // While the page loads (until its content shows, and its first seconds,
      // when a map or a player appears), keep up with it: right after
      // the change (a loading page has no idle moment, and its next long task
      // would delay a timer), but never back to back.
      // After a long look (over 300 ms), the pause is three times its length (F1220).
      // While the HTML still comes in and Sift shows none of its content, a quick look (the page's first bytes)
      // holds the next back only by three times its length: the first view comes as soon as the content is in (F1300).
      // Where the gate sees the content come in, a look at the page's header waits longer: the gate runs the next (perf16).
      // A view that already fills the screen is read again less often while the HTML comes in: each look holds up the page's parser (perf16).
      const soon = document.readyState === "loading" && viewEmpty();
      const full = !activeAdapter() && document.readyState === "loading" && fullView(store.page);
      const wait = lastRunAt + (full ? Math.max(300, lastDur * 4) : lastDur > 300 ? lastDur * 4 : Math.max(soon ? (gateSel !== null ? 300 : 16) : 100, lastDur * 3)) - performance.now();
      if (wait <= 0) return run();
      d = Math.max(16, wait);
    } else {
      // Routine updates wait for an idle moment so they never compete with
      // scrolling or typing, and back off while nothing changes.
      idle = true;
      const backoff = Math.min(2000, 60 * Math.pow(1.6, Math.min(same, 8)));
      d = Math.max(60, Math.min(800, Math.max(lastDur * 6, backoff)));
      // A big page (a long feed): extraction takes at most about a tenth of the time.
      // While it still loads, a page's new content is read sooner, at about a quarter of the time: on a slow machine
      // (a 4x slower CPU) nine times a long read put weather.com's forecast seconds behind the original (F873).
      if (lastDur > 80) d = Math.max(d, lastDur * (!minor && stillLoading() ? 3 : 9));
      // Text that keeps changing (a clock, a counter) is no reason to hurry;
      // the page's answer to the user's action (a cart count, "Added") is.
      if (minor && performance.now() - Math.max(actedAt, typedAt) > 5000) d = Math.max(d, 2500);
      // The page's answer to a key just typed (a counter, a live hint) follows it closely (F802), on a
      // page cheap to read again, while looks still find changes (not a clock Sift does not show).
      if (performance.now() - typedAt < 2000 && same < 3 && lastDur < 60) d = Math.min(d, Math.max(60, lastDur * 4));
      d = Math.min(d, 8000);
    }
    // The page held its main thread past the time the coming run was due (a slow machine building the
    // page in long tasks): the change that ends such a task is read now, as the page shows it, not after
    // one more wait for a timer and an idle moment (F873).
    if (pending && pendingDue < performance.now() - 50 && stillLoading()) return run();
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
  // The extractor saw a box that is drawn later in a closed shadow root, which no page change tells (a bot check's widget, F956).
  document.addEventListener("sift-reread", () => schedule(0));

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
    // What the page says about the field the user is in, as they type ("ana is taken", a password's
    // strength): a screen reader says it there when it changes, without any other action.
    const pf = elOf((shadow.activeElement as HTMLElement | null)?.dataset?.ref);
    const pr = pf?.getRootNode() as Document | ShadowRoot | undefined;
    const about = pf ? ["aria-describedby", "aria-errormessage"].flatMap((n) => (pf.getAttribute(n) ?? "").split(/\s+/)).filter(Boolean).map((id) => pr?.getElementById?.(id)).filter((x): x is HTMLElement => !!x) : [];
    const aboutField = (el: Element) => about.some((x) => el.contains(x) || x.contains(el));
    const LIVE = "[role=alert], [aria-live=assertive], [role=status], [aria-live=polite]";
    const typing = about.some((x) => !!x.closest(LIVE) || !!x.querySelector(LIVE));
    const wait = alertsAt + 2000 - performance.now();
    if (!answer && !typing && !alertsFresh && wait > 0) {
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
    for (const el of Array.from(document.querySelectorAll(LIVE))) {
      if (el.closest("sift-root, [data-sift-portal]") || el.getAttribute("aria-live") === "off") continue;
      const text = el.checkVisibility() ? ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim() : "";
      const was = alertsSeen.get(el);
      alertsSeen.set(el, text);
      if (quiet || out || !text || text === was || text === lastToast || /cookie|consent|newsletter|subscribe/i.test(text)) continue;
      if (!el.matches("[role=alert], [aria-live=assertive]") && (!(answer || aboutField(el)) || text.length > 200)) continue;
      out = liveText(el as HTMLElement).slice(0, 300);
    }
    return out;
  }

  /**
   * A live region's text as a screen reader reads it: each control in it by its own name, set
   * apart from the next ("9:00, 9:30"), where innerText glues buttons with nothing between them ("9:009:30").
   */
  function liveText(el: HTMLElement): string {
    const CTRL = "button, a[href], input[type=button], input[type=submit], input[type=reset], [role=button], [role=link], [role=tab], [role=option], [role=menuitem], [role=checkbox], [role=radio], [role=switch]";
    const plain = (e: HTMLElement) => (e.innerText ?? "").replace(/\s+/g, " ");
    if (!el.querySelector(CTRL)) return plain(el).trim();
    let out = "";
    // The last thing written was a control: the next control is a new item of the same list.
    let ctrl = false;
    const walk = (n: HTMLElement) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          const s = c.nodeValue ?? "";
          out += s;
          if (s.trim()) ctrl = false;
          continue;
        }
        if (c.nodeType !== 1) continue;
        const e = c as HTMLElement;
        const cs = getComputedStyle(e);
        if (cs.display === "none" || (cs.display !== "contents" && !e.checkVisibility())) continue;
        // Blocks are apart from what is around them; inline runs are not ("Hel<b>lo</b>").
        const gap = cs.display.startsWith("inline") || cs.display === "contents" ? "" : " ";
        if (e.matches(CTRL)) {
          const name = clean(e.getAttribute("aria-label")) || clean(e.innerText) || accName(e);
          if (!name) continue;
          out += (ctrl ? ", " : " ") + name + " ";
          ctrl = true;
        } else if (e.querySelector(CTRL)) {
          out += gap;
          walk(e);
          out += gap;
        } else {
          const t = plain(e);
          if (!t.trim()) continue;
          out += gap + t + gap;
          ctrl = false;
        }
      }
    };
    walk(el);
    return out.replace(/\s+/g, " ").replace(/ ,/g, ",").trim();
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
   * Social posts the site renders only once they scroll into its own view (La Nación loads X's
   * widget when the article body shows, F830): Sift never scrolls the hidden original, so their
   * fallback quotes would stay quotes, without the post's video. Once the page settles, the
   * original is scrolled to each such post in turn, until its widget replaces it (or 3 s), and
   * then back where it was. The X Post then shows through its portal. Once per post.
   */
  const wokenEmbeds = new WeakSet<Element>();
  /** Next stories the page added while it was scrolled for a post: out of this page's view until the reader reaches its end. */
  const wakeAdded: Element[] = [];
  let wakeTimer = 0;
  let waking = false;
  function wakeEmbeds(page: Page) {
    if (waking || wakeTimer || store.mode !== "sift") return;
    if (!embedQuotes(page.blocks).some((el) => !wokenEmbeds.has(el))) return;
    wakeTimer = window.setTimeout(async () => {
      wakeTimer = 0;
      const url = location.href;
      const els = embedQuotes(store.page?.blocks ?? []).filter((el) => !wokenEmbeds.has(el)).slice(0, 8);
      // Its widget took its place, put a frame in it or beside it, or hid it.
      const done = (el: Element) => !el.isConnected || !visible(el) || !!el.querySelector("iframe") || el.previousElementSibling?.localName === "iframe" || !!el.previousElementSibling?.querySelector("iframe");
      const live = () => store.mode === "sift" && location.href === url;
      if (!els.length || !live()) return;
      waking = true;
      const se = document.scrollingElement ?? document.documentElement;
      const top = se.scrollTop;
      const left = se.scrollLeft;
      // The stories Sift shows: a post is woken only well before its story's end, so a loader of
      // the next story (an observer with a wide margin under the article) never fires (F954).
      const arts: Element[] = [];
      const findArts = (bs: Block[]) => {
        for (const b of bs) {
          const a = b.t === "article" ? elOf(/:(r[0-9a-z]+)$/.exec(b.key)?.[1]) : null;
          if (a) arts.push(a);
          if (b.t === "section" || b.t === "article") findArts(b.blocks);
        }
      };
      findArts(store.page?.blocks ?? []);
      // A next story the page adds after a story while it is scrolled (a loader with a wider margin): no more waking.
      let added = false;
      const mo = new MutationObserver((ms) => {
        for (const m of ms)
          for (const n of Array.from(m.addedNodes)) {
            if (added || !(n instanceof HTMLElement) || !n.isConnected) continue;
            const after = arts.some((a) => a.isConnected && !a.contains(n) && !n.contains(a) && !!(a.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
            if (after && n.querySelector("h1, h2") && Array.from(n.querySelectorAll("p")).reduce((k, p) => k + (p.textContent?.length ?? 0), 0) > 400) {
              added = true;
              wakeAdded.push(n);
              schedule(0);
            }
          }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      try {
        for (const el of els) {
          wokenEmbeds.add(el);
          if (done(el) || !live() || added) continue;
          // Only to the post's own place: its bottom at the view's bottom (its top at the top, when it is taller),
          // and only while a screen and 1000 px of its story (else the page) still lie below the view.
          const y = se.scrollTop;
          const r = el.getBoundingClientRect();
          const art = arts.find((a) => a.contains(el));
          const end = Math.min(se.scrollHeight, art ? art.getBoundingClientRect().bottom + y : Infinity);
          const to = Math.max(0, Math.min(r.top + y, r.bottom + y - innerHeight));
          if (to + innerHeight + innerHeight + 1000 > end) continue;
          se.scrollTo({ top: to, left, behavior: "instant" });
          for (let t = 0; t < 3000 && !done(el) && live() && !added; t += 250) await new Promise((r) => setTimeout(r, 250));
        }
      } finally {
        mo.disconnect();
        se.scrollTo({ top, left, behavior: "instant" });
        waking = false;
      }
    }, 1500);
  }

  /** `bs` without the blocks of a next story waking posts made the page add (F954). */
  function dropWakeAdded(bs: Block[]): Block[] {
    return bs.filter((b) => {
      const el = blockEl(b);
      if (el && wakeAdded.some((n) => n.contains(el))) return false;
      if (b.t === "section" || b.t === "article") b.blocks = dropWakeAdded(b.blocks);
      return true;
    });
  }

  /** The key of the consent wall Sift showed because the reader pressed Play (see playFacade). */
  let consentKey = "";
  /**
   * Play on a player that has not loaded its video (a poster with a big Play button). A player the
   * site builds only once it scrolls into view (the Guardian's YouTube islands, deferuntil=visible)
   * is first brought into the hidden original's view, so its own Play has a handler. A video the
   * page holds back until its consent wall is answered shows that wall, reject first, and Sift says
   * why (F826): the reader answers it, never Sift.
   */
  function playFacade(portal: Element | null, start: HTMLElement) {
    // Where the player sits in the page: a lifted portal is fixed in the top layer.
    const spot = portal?.parentElement ?? start;
    const r = spot.getBoundingClientRect();
    const away = r.bottom < 0 || r.top > innerHeight;
    if (away) spot.scrollIntoView({ block: "center", behavior: "instant" });
    // A site may give its poster a click handler only once the player shows at least half in view
    // (La Nación's JW facades, F924): Sift's box for it comes into view first.
    const box = portal ? boxOf(refOfPortal(portal) ?? "") : null;
    const b = box?.getBoundingClientRect();
    const hidden = !!b && b.height > 0 && (Math.min(b.bottom, innerHeight) - Math.max(b.top, 0)) / b.height < 0.6;
    if (hidden) box!.scrollIntoView({ block: "nearest", behavior: "instant" });
    const loaded = () => !start.isConnected || !start.checkVisibility() || !!portal?.querySelector("iframe, video[src], video source");
    window.setTimeout(() => {
      if (store.mode !== "sift") return;
      proxy.click(start);
      window.setTimeout(() => {
        const wall = store.mode === "sift" && !loaded() ? consentWallUp() : null;
        if (wall) showConsent(wall, "play");
      }, 2500);
    }, away ? 800 : hidden ? 300 : 0);
  }

  /** Shows the page's consent wall as a dialog, reject first, saying what it held back; the reader answers it, never Sift. */
  function showConsent(wall: Element, why: "play" | "click") {
    askConsent(true, why);
    // Asked again after the reader put it away: it shows again.
    for (const [k, ref] of dismissedRefs) if (elOf(ref) === wall) {
      store.dismissed.delete(k);
      dismissedRefs.delete(k);
    }
    consentKey = "dlg:" + refOf(wall);
    schedule(0);
  }

  /**
   * Replays a click and tells whether the page swallowed it before it reached the element: a
   * consent wall (the Mirror's InMobi CMP) stops every click in the capture phase until it is
   * answered (F1034). Seen from the element's parent in the capture phase, so the element's own
   * handlers stopping it do not count.
   */
  function clickSwallowed(el: Element, run: () => void): boolean {
    const at = el.parentNode ?? el;
    let seen = false;
    let reached = false;
    const first = () => (seen = true);
    const near = () => (reached = true);
    window.addEventListener("click", first, true);
    at.addEventListener("click", near, true);
    try {
      run();
    } finally {
      window.removeEventListener("click", first, true);
      at.removeEventListener("click", near, true);
    }
    return seen && !reached;
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
    const inList = !!a?.closest(".sheet.suggest");
    if (inList) a = suggestAnchor();
    const text = !!a && (a.localName === "textarea" || (a.localName === "input" && /^(text|search|email|url|tel)$/.test((a as HTMLInputElement).type)));
    // The page may have put a new field in its place (Wikipedia's typeahead): that one's list.
    // Only reading it: the text goes to the page from the user's own keys (F850).
    const pf = text ? liveField(a!.dataset.ref, false) : null;
    if (!pf) return undefined;
    // Not after a search or an action from it, until the user is back at the field: the
    // page may think its field still has focus (its blur() reaches no real focus). A search
    // box whose results come in under it, the address unchanged (Discourse's Enter), still
    // shows them while the user is in it, or in them (arrowing through the results).
    if (lastTouched(a!) < store.actAt) {
      const panel = (inList || a === shadow.activeElement) && location.href === typedUrl ? fieldPanel(pf) : null;
      return panel ? panelList(panel) : undefined;
    }
    const ids = ["aria-controls", "aria-owns"].flatMap((n) => (pf.getAttribute(n) ?? "").split(/\s+/)).filter(Boolean);
    for (const id of ids) {
      let list = document.getElementById(id);
      // Or the list inside the popup it controls (GitHub's "Go to file": a dialog around its listbox) (F963).
      if (list && !list.matches("[role=listbox], [role=grid], [role=tree], [role=menu]")) list = list.querySelector("[role=listbox], [role=grid], [role=tree], [role=menu]");
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
    if (ids.length) return undefined;
    const panel = fieldPanel(pf);
    return panel ? panelList(panel) : undefined;
  }

  /**
   * What a plain search box shows right under it as it is typed in, with no list it names
   * (Wikipedia's portal typeahead, Discourse's search menu): a part beside the field's own
   * box, in a positioned dropdown or in the positioned panel that holds the field, with
   * links or buttons right under the field, at least one naming what was typed.
   */
  function fieldPanel(pf: Element): Element | null {
    if (!(pf instanceof HTMLInputElement) || !pf.matches(proxy.SEARCH_FIELD)) return null;
    const word = pf.value.trim().toLowerCase().split(/\s+/)[0];
    const fr = pf.getBoundingClientRect();
    if (!word || !fr.width) return null;
    const placed = (e: Element) => /^(absolute|fixed)$/.test(getComputedStyle(e).position);
    const shown = (e: Element) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && e.getClientRects().length > 0;
    // The field's own dropdown panel (Discourse's search menu), not a fixed site header or bar it sits in.
    let inPanel = false;
    for (let a = pf.parentElement, i = 0; a && a !== document.body && i < 8 && !inPanel; a = a.parentElement, i++)
      inPanel = placed(a) && !a.matches("header, nav, [role=banner], [role=navigation]") && a.getBoundingClientRect().width < innerWidth * 0.9;
    let branch: Element = pf;
    for (let a = pf.parentElement, i = 0; a && a !== document.body && i < 6; branch = a, a = a.parentElement, i++) {
      for (const c of Array.from(a.children)) {
        if (c === branch || c.contains(pf)) continue;
        // (A part of the page with many controls, the content under a header, is not a dropdown.)
        const all = c.querySelectorAll("a[href], button, [role=option]");
        if (!all.length || all.length > 60) continue;
        const opts = Array.from(all).filter(shown);
        if (!opts.length) continue;
        const r = opts[0].getBoundingClientRect();
        if (r.top < fr.bottom - 4 || r.top - fr.bottom > 80 || r.left >= fr.right || r.right <= fr.left) continue;
        if (!opts.some((o) => (o.textContent ?? "").toLowerCase().includes(word))) continue;
        // A dropdown (positioned itself or inside), or the field's own panel: not page content under a search form.
        let drop = inPanel;
        for (let e: Element | null = opts[0]; !drop && e && e !== a; e = e.parentElement) drop = placed(e);
        if (drop) return c;
      }
      if (placed(a)) break;
    }
    return null;
  }

  /** A search box's results part as Sift's list under its field: one choice per link or button. */
  function panelList(panel: Element): Page["dialog"] {
    const shown = (e: Element) => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && e.getClientRects().length > 0;
    const opts = Array.from(panel.querySelectorAll("a[href], button, [role=option]")).filter((o, i, all) => shown(o) && !all.some((p, j) => j < i && p.contains(o)));
    const actions = opts
      .slice(0, 20)
      .map((o) => ({ key: "fpa:" + refOf(o), label: (textIn(o) || accName(o)).slice(0, 200), ref: refOf(o) }))
      .filter((x) => x.label);
    return actions.length ? { key: "pop:" + refOf(panel), ref: refOf(panel), title: "", blocks: [{ t: "actions", key: "fp:" + refOf(panel), actions }] } : undefined;
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
    if (pending) clearTimeout(pending);
    pending = 0;
    if (idleRun) cancelIdleCallback(idleRun);
    idleRun = 0;
    if (store.mode !== "sift" || !document.body || ytHold) return;
    // Only a look that read the page counts for spacing the next: one before <body> exists read nothing (F1300).
    lastRunAt = performance.now();
    const gated = byGate;
    byGate = false;
    contentAdded = 0;
    if (checkUrl()) fillTries = lastCount = 0;
    const s = performance.now();
    let page: Page;
    // Until Sift shows this page, a look stops after a moment and shows what it read (a long list's first
    // part), and the next look reads it all: the first view never waits on the whole page (F1220).
    // Shown means some of its content: while the HTML comes in, a first look that found only a title (its first bytes) is no view yet (F1300).
    const budget = (!firstPaint || (document.readyState !== "complete" && viewEmpty())) && !cutLast ? 50 : 0;
    try {
      page = extract(budget);
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
    cutLast = budget > 0 && page.source === "generic" && cutShort();
    const ad = activeAdapter();
    gateSel = !ad ? "" : (ad.contentSel?.(siteUrl()) ?? null);
    // The gate opened on text that was not the content (a menu, a title alone): it waits for more next time.
    if (gated && noContent(page.blocks)) gateMin = Math.min(gateMin * 2, 3200);
    // The rest of the page is read once this first part has shown, spaced like any look while the page loads
    // (a first part that fills the screen while the HTML comes in: as any look at a full view then, perf16).
    if (cutLast) schedule(Math.max(16, lastRunAt + (!ad && document.readyState === "loading" && fullView(page) ? Math.max(300, lastDur * 4) : Math.max(100, lastDur * 3)) - performance.now()));
    watchShadows();
    const runs = +(host.dataset.runs ?? 0) + 1;
    host.dataset.runs = String(runs);
    // Long-lived feeds churn through elements; drop references to removed ones.
    if (runs % 50 === 0) sweepRefs();
    // An adapter can say its page is still loading (YouTube renders lists late).
    page.partial = page.partial || document.readyState === "loading";
    // A fresh YouTube page shows only its loading line at first: drawn before YouTube's own first paint, it put
    // YouTube's results off by about half a second. Sift's boot line stays until entries, a player or a dialog come (perf16).
    if (!store.page && !firstPaint && page.source === "youtube" && page.partial && !page.dialog && performance.now() - loadStart < 4000 && ytWaiting(page.blocks)) return;
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
    if (wakeAdded.length) page.blocks = dropWakeAdded(page.blocks);
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
    wakeEmbeds(page);
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
      titleWait = page.title === prevTitle || page.title === titleFrom.title || !page.title;
      if (titleWait) titleTimer = window.setTimeout(lateTitle, 2500);
      else say(page.title);
    } else if (titleWait && page.title && page.title !== prevTitle && page.title !== titleFrom.title) {
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
    // A choice (a travel mode radio, a select) in the terms its re-rendered twin is found by (F960).
    const choices = (el: Element) => Array.from(el.closest("fieldset")?.querySelectorAll("input") ?? []).map(labelOf).join("|");
    const chose = before instanceof HTMLSelectElement || (before instanceof HTMLInputElement && /^(radio|checkbox)$/.test(before.type)) ? { tag: before.localName, type: (before as HTMLInputElement).type, ref: (before as HTMLElement).dataset.ref, label: labelOf(before), choices: choices(before) } : null;
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
      // A choice that wrote the address (a travel mode radio, a select) keeps focus on its re-rendered twin:
      // the same page element, or the same label among the same choices (the page may rebuild them) (F960).
      const now = shadow.activeElement as HTMLElement | null;
      const twin = !!chose && !!now && now.localName === chose.tag && (now as HTMLInputElement).type === chose.type && (now.dataset.ref === chose.ref || (labelOf(now) === chose.label && choices(now) === chose.choices));
      if (!a || a === document.body || a === document.documentElement || (a === host && (!before || !before.isConnected) && !twin)) main()?.focus({ preventScroll: true });
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
    // A page read in part is read whole in a moment: its text is shortened then, once (F1220).
    // While the page loads, the view's reads of its own size wait for the frame, before its paint, and its text
    // to shorten waits until after it: the first view is drawn first (perf16).
    if (document.readyState !== "complete") {
      const cut = cutLast;
      afterFrame(
        () => {
          if (store.page !== page) return;
          fillScreen(page);
          openAtPost();
        },
        () => {
          if (!cut && store.page === page) processAi(page);
        },
      );
    } else {
      if (!cutLast) processAi(page);
      fillScreen(page);
      openAtPost();
    }
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

  /** Runs `inFrame` in the next frame, before its paint, and `after` once that frame is drawn; a timer stands in for a hidden tab's frames. */
  function afterFrame(inFrame: () => void, after: () => void) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      inFrame();
      setTimeout(after, 0);
    };
    const timer = window.setTimeout(go, 100);
    requestAnimationFrame(go);
  }
  /** YouTube's view has only its loading line (and its chips): no entries, player or panel yet (perf16). */
  function ytWaiting(bs: Block[]): boolean {
    let loading = false;
    let real = false;
    const walk = (xs: Block[]) => {
      for (const b of xs) {
        if (b.key === "yt-loading") loading = true;
        if ((b.t === "items" && b.items.length > 0) || b.t === "portal") real = true;
        if (b.t === "section" || b.t === "article") walk(b.blocks);
      }
    };
    walk(bs);
    return loading && !real;
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
    // A shown map that writes its view into the address's hash as it moves or changes layer
    // (OpenStreetMap's "#map=16/37.79/-122.39&layers=C") is still the same page: the reader stays at the map (F874).
    if (kinds.length && kinds.every((k) => k === "replace") && prev.split("#")[0] === u.split("#")[0] && document.querySelector(".leaflet-container[data-sift-portal], .maplibregl-map[data-sift-portal], .mapboxgl-map[data-sift-portal], gmp-map[data-sift-portal]")) return false;
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
    gateMin = 200;
    loadStart = performance.now();
    // What the reader last had: the next page is not named by it, however long the page keeps it.
    if (!navPending) titleFrom = { title: store.page?.title ?? "", head: headOf(store.page) };
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
        // A name or id written again with the same value changed nothing.
        if ((n === "aria-label" || n === "aria-labelledby" || n === "id") && m.oldValue === (tgt as Element).getAttribute(n)) continue;
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
    if (!any) return;
    if (Date.now() - suggestAt < 4000) {
      if (!listTimer) listTimer = window.setTimeout(() => refreshList(minor), 50);
      return;
    }
    let grew = 0;
    if (!minor && stillLoading())
      for (const n of added) {
        if (q.some((el) => deepContains(el, n))) continue;
        grew += (n.textContent ?? "").length;
        if (grew >= 400) break;
      }
    if (contentAdded < gateMin && gateOpen()) countContent(added);
    schedule(undefined, minor, grew >= 400);
  });
  /**
   * Adds the page's new content to contentAdded (see the gate): the text of each new element's own text nodes,
   * outside the page's bars, menus and hidden parts; a new h1 opens the gate. On an adapter's page, its entries.
   */
  function countContent(added: Node[]) {
    const memo = new Map<Element, boolean>();
    const bar = (el: Element | null): boolean => {
      if (!el || el === document.body || el === document.documentElement) return false;
      let c = memo.get(el);
      if (c === undefined) {
        c = el.matches(GATE_CHROME) || (el.matches("header, footer, aside") && !el.closest("main, article, [role=main]")) || bar(el.parentElement);
        memo.set(el, c);
      }
      return c;
    };
    let n = 0;
    for (const x of added) {
      if (++n > 3000 || contentAdded >= gateMin) break;
      const el = x as Element;
      if (gateSel) {
        if (el.matches(gateSel) || el.querySelector(gateSel)) contentAdded = gateMin;
        continue;
      }
      if (bar(el)) continue;
      // A title inside a form is a search page's, over its filters and results (GOV.UK): its text counts as any.
      if (el.localName === "h1" && !el.closest("form")) {
        contentAdded += gateMin;
        continue;
      }
      for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) contentAdded += (c.nodeValue ?? "").trim().length;
    }
  }
  let listTimer = 0;
  /**
   * The page changed while the user types in a field with suggestions: its new list shows
   * promptly, never the one the page has replaced. A list Sift reads from the field itself
   * (fieldList) is refreshed on its own; the whole page is read again only in routine time.
   * A list only a full look finds (Booking's) gets one, spaced by what a look costs, on a
   * page where looks are cheap; a long page (a Wikipedia article) waits for the pause in typing.
   */
  function refreshList(minor: boolean) {
    listTimer = 0;
    if (store.mode !== "sift" || !store.page) return;
    const inSheet = shadow.activeElement?.closest(".sheet");
    const cur = store.page.dialog;
    const mine = !!cur && /^f[lp]:/.test(cur.blocks[0]?.key ?? "");
    let fl: Page["dialog"];
    if (!inSheet || inSheet.matches(".suggest")) {
      resetCaches();
      fl = fieldList();
    }
    if (fl || mine) {
      if (JSON.stringify(fl) !== JSON.stringify(cur)) {
        const shown = fl?.blocks[0];
        const blocks = shown?.t === "actions" ? dropControls(store.page.blocks, new Set(shown.actions.map((x) => x.ref))) : store.page.blocks;
        store.page = { ...store.page, dialog: fl, blocks };
        changed();
      }
      return schedule(undefined, minor);
    }
    schedule(lastDur < 300 ? Math.max(30, lastRunAt + Math.max(300, lastDur * 3) - performance.now()) : undefined, minor);
  }
  const moOpts: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    // To tell a real change from a page writing the same value again (see noteMutations).
    attributeOldValue: true,
    // Names a page sets after it mounts (React Aria points a date segment's aria-labelledby at its own id a moment later, F1110).
    attributeFilter: ["class", "hidden", "open", "aria-hidden", "aria-expanded", "aria-selected", "aria-checked", "aria-pressed", "aria-disabled", "disabled", "value", "src", "href", "style", "inert", "aria-labelledby", "aria-label", "id"],
  };
  mo.observe(document, moOpts);
  observeRoot = (r) => mo.observe(r, moOpts);
  const nav = (window as any).navigation;
  // The page wrote its own address again (GitHub's replaceState as it loads): read at the pace of its changes (perf16).
  nav?.addEventListener?.("navigatesuccess", () => schedule(pageUrl() === lastUrl ? undefined : 0));
  nav?.addEventListener?.("navigate", (e: any) => navKinds.add(String(e.navigationType)));
  addEventListener("popstate", () => schedule(0));
  // Back/forward cache restores the page without any DOM change.
  addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) schedule(0);
  });
  /**
   * The page finished loading (its HTML, then its images): read it again now, unless the last look took long
   * (over 300 ms) or stopped at its budget: then two looks would freeze the page back to back, and the next
   * waits as any look while the page loads does (F1220).
   */
  const loadedAgain = () =>
    schedule(Math.max(0, lastDur > 300 ? lastRunAt + lastDur * 4 - performance.now() : cutLast ? lastRunAt + Math.max(100, lastDur * 3) - performance.now() : 0));
  document.addEventListener("DOMContentLoaded", () => {
    attach();
    // A page whose content the gate did not see (in pictures, in a bar) is read now, not after a timer its own scripts hold up (perf16).
    if (gateOpen() && !cutLast && lastDur <= 300) run();
    else loadedAgain();
  });
  addEventListener("load", loadedAgain);
  // Inputs change without DOM mutations; catch up after the user acts.
  // Not after a link to a place in the page that changed nothing there (F1411; afterAct looks once it does).
  host.addEventListener("click", () => {
    const jump = performance.now() - jumpAt < 50;
    setTimeout(() => (!jump || pageChangedAt() >= jumpAt) && schedule(0), 120);
  });

  // ---------- infinite lists: scrolling Sift near the end loads more ----------
  let lastNudge = 0;
  /** When Sift last scrolled the original along with the reader (see stepWith). */
  let lastStep = 0;
  /** When the reader last scrolled Sift (wheel, touch, a press, a scrolling key), and where Sift's view was. */
  let userScrollAt = 0;
  /** When the reader last moved focus with Tab: a focus move scrolls Sift's view too, but never loads more. */
  let tabAt = 0;
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
      // The reader reached this story's end: the next story the page loaded early shows now, as on the original.
      if (near && wakeAdded.length && Date.now() - userScrollAt < 1000) {
        wakeAdded.length = 0;
        schedule(0);
      }
      const moved = host.scrollTop - lastTop;
      lastTop = host.scrollTop;
      // Only the reader's own scrolling moves the original along: Sift's view also scrolls when the page redraws.
      const mine = Date.now() - userScrollAt < 1000;
      if (!store.page || Date.now() - lastStep < 1500 || (mine && stepWith(near, Math.sign(moved)))) return;
      if (near) nudgeEnd();
    },
    { passive: true },
  );

  let nudgeTimer = 0;
  /** A long list Sift draws a part at a time is not all drawn yet (aria-busy, see useSlice in app.tsx). */
  const listsDrawing = () => !!shadow.querySelector("[aria-busy=true]");
  /**
   * Sift's view is near its end: the page loads more. One the 1500 ms gate drops (a fast flick reaches the new
   * end within it, and from there no scroll event comes) is checked again once the gate expires (F1060).
   */
  function nudgeEnd() {
    clearTimeout(nudgeTimer);
    if (store.mode !== "sift" || !store.page) return;
    if (host.scrollTop + host.clientHeight <= host.scrollHeight - host.clientHeight * 1.5) return;
    const wait = 1500 - (Date.now() - lastNudge);
    if (wait > 0) {
      nudgeTimer = window.setTimeout(nudgeEnd, wait + 20);
      return;
    }
    // Tabbing through a list's last entries must reach what follows it (Up next before Comments), not keep
    // it growing (F820): there, more loads once the reader scrolls (wheel, touch, a scrolling key, the
    // scrollbar) after Tab. A list nothing follows (home, search, comments at the end) grows as Tab nears
    // its end, as on the original (F920).
    if (tabAt > userScrollAt && !tabInLastList()) return;
    // A list in an open section counts too (a watch page's comments).
    if (!shownItems(store.page.blocks)) return;
    // The end of a long list's part drawn so far is not the list's end: the rest follows (F1220).
    if (listsDrawing()) return;
    // A thread that unloads its posts loads more as it is scrolled (stepWith), never by a jump to its end.
    if (cloakedPosts()) return;
    lastNudge = Date.now();
    askMore();
    loadMore();
  }

  /**
   * Focus is in a list Tab may grow (F920): the page's own feed (home, search: what Sift folds after it, its
   * Shorts, comes from that feed), or a list in a section with nothing focusable after it (comments at the end).
   */
  function tabInLastList(): boolean {
    const m = main();
    const a = shadow.activeElement;
    let list = m && a && m.contains(a) ? a.closest("ul, ol") : null;
    if (!m || !list) return false;
    // The outer list (a comment's replies are a list in its thread).
    for (let up = list.parentElement?.closest("ul, ol"); up && m.contains(up); up = up.parentElement?.closest("ul, ol")) list = up;
    const l = list;
    if (!l.closest("details")) return true;
    return !Array.from(m.querySelectorAll<HTMLElement>(FOCUSABLE)).some(
      (c) => !l.contains(c) && !!(l.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && c.getClientRects().length > 0,
    );
  }

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
    if (tg instanceof Element && tg.closest("input, textarea, select, [contenteditable], [role=listbox], [role=radiogroup], [role=slider], [role=spinbutton], [role=menu], [role=tablist], [role=grid], .layer, .suggest, .media")) return 0;
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
    // At the end of a list that loads more, a wheel, End or PageDown asks for more, as scrolling there does (F1060).
    else if (dir > 0) nudgeEnd();
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
    // A page read in part, or a long list still being drawn, is not short (F1220).
    if (cutLast || listsDrawing()) return;
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
    ytRelease();
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
  /** The address when the user last typed in a field. */
  let typedUrl = "";
  /** The page field Sift entered last, and its selection before that. */
  let entrySel: { el: Element; sel: [number, number] | null; at: number } | null = null;
  /** The page fields of `f`'s kind: same tag, name and type. */
  const kindOf = (f: HTMLInputElement) =>
    (Array.from(document.getElementsByName(f.name)) as HTMLInputElement[]).filter((c) => c.localName === f.localName && c.type === f.type && !c.closest("sift-root"));
  /**
   * Where a page field Sift stands for sat, taken while it is there: in each of its
   * containers, how many fields of its kind and its rank among them; its form's id;
   * and the fields of its kind there were then.
   */
  const places = new WeakMap<Element, { anc: Element[]; n: number[]; at: number[]; form: string; seen: WeakSet<Element> }>();
  function notePlace(f: HTMLInputElement) {
    const all = kindOf(f);
    const anc: Element[] = [];
    const n: number[] = [];
    const at: number[] = [];
    for (let a = f.parentElement; a; a = a.parentElement) {
      const box = a;
      const inside = all.filter((c) => box.contains(c));
      anc.push(box);
      n.push(inside.length);
      at.push(inside.indexOf(f));
    }
    places.set(f, { anc, n, at, form: f.form?.id ?? "", seen: new WeakSet(all) });
  }
  /**
   * The page field `ref` names, or the one the page put in its place: Wikipedia swaps
   * its search box for its typeahead's on first focus, and the keys typed meanwhile
   * must reach the new one. It gets focus if the old one had it, and (`sync`) the
   * text Sift's field holds. Only a clear swap in place (F850): the nearest of the old
   * field's containers still there is its parent or held no other field of its kind,
   * holds as many as before, and at its rank a new one (not there before), shown, in
   * a form of the same id. Never a field that was there all along because it has the
   * same name (the next cart row's quantity, when the page removed this row): Sift's
   * field goes with the repaint.
   */
  function liveField(ref: string | undefined, sync = true): Element | null {
    const el = elOf(ref);
    if (el || !ref) {
      if (plainField(el) && el.name) notePlace(el);
      return el;
    }
    const old = formerOf(ref);
    if (!old || old.isConnected || !plainField(old) || !old.name) return null;
    const place = places.get(old);
    const i = place ? place.anc.findIndex((a) => a.isConnected) : -1;
    if (!place || i < 0) return null;
    // Its row: the container still there held only it, or is its own parent (the same spot in it).
    if (place.n[i] !== 1 && i > 0) return null;
    const like = kindOf(old).filter((c) => place.anc[i].contains(c));
    const now = like[place.at[i]];
    if (like.length !== place.n[i] || !now || place.seen.has(now) || (now.form?.id ?? "") !== place.form || !now.checkVisibility()) return null;
    adopt(ref, now);
    if (pageFocus === old) {
      pageFocus = now;
      proxy.focus(now);
    }
    const mine = shadow.querySelector<HTMLInputElement>(`input[data-ref="${window.CSS.escape(ref)}"], textarea[data-ref="${window.CSS.escape(ref)}"]`);
    // Only text typed since the last action, as carry: after Send, the page's fresh field is empty on purpose (F952).
    if (sync && mine && mine.value !== now.value && lastTyped(mine) > store.actAt) proxy.setValue(now, mine.value);
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

  /**
   * `keep`: the action was inside the popup Sift shows (a box checked there): what opened it stays found.
   * `jump`: a link to a place in the page, which often changes nothing there (HN's "next"): a look, most
   * of a second on a long thread, only once the page did change (F1411).
   */
  const afterAct = (keep = false, jump = false) => {
    const at = (actedAt = performance.now());
    armRecent(2500, keep);
    if (jump) jumpAt = at;
    for (const d of [60, 400, 1200]) setTimeout(() => (!jump || pageChangedAt() >= at) && schedule(0), d);
  };
  /** When the user last followed a link to a place in the page. */
  let jumpAt = -Infinity;
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
   * around it opened, is scrolled to and focused. True when the place is in
   * the page already (a jump, not a link that builds it).
   */
  function followAnchor(href: string | undefined): boolean {
    let u: URL;
    try {
      u = new URL(href ?? "", location.href);
    } catch {
      return false;
    }
    if (u.hash.length < 2 || u.href.split("#")[0] !== location.href.split("#")[0]) return false;
    let id = u.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* not encoded */
    }
    const find = () => document.getElementById(id) ?? document.getElementsByName(id)[0];
    const at = performance.now();
    const there = !!find();
    // The page may build or open the target on the click (a comments feed).
    const show = () => {
      const target = find();
      // The page moved focus there itself (an error link to its field): Sift followed it already.
      if (target && performance.now() - pageFocusAt > 1000) showPlace(target);
    };
    // A place already there that the click changed nothing around (HN's "next"): shown at once,
    // before Sift's next look at the page, as the page starts scrolling there (F1411).
    if (there) setTimeout(() => (pageChangedAt() >= at ? setTimeout(show, 150) : show()), 0);
    else setTimeout(show, 150);
    return there;
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
    const next: Hit[] = [];
    const walk = (bs: Block[], path: Block[]) => {
      for (const b of bs) {
        const el = blockEl(b);
        // Blocks are walked outside in, so the last one around it is the innermost.
        if (el && deepContains(el, target)) found.around = { b, path };
        else if (el && deepContains(target, el)) found.inside ??= { b, path };
        // The first block after it in the page's order, not Sift's (a featured comment Sift shows early).
        else if (el && target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          next.push({ b, path });
          const a = found.after && blockEl(found.after.b);
          if (!a || el.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) found.after = { b, path };
        }
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
    // Strictly, the target's own block counts too (a thank-you heading the page focused after a post, F1013).
    // A target with nothing to show (Tasty Recipes' empty "jump target" span): the browser shows what follows it (F1043).
    const empty = !found.inside && !(target.textContent ?? "").trim() && !target.querySelector("img, picture, video, iframe, canvas, svg, input, select, textarea, button");
    const hit = loose ? found.inside ?? (empty ? found.after : undefined) ?? found.around ?? found.after : found.inside ?? (found.around && blockEl(found.around.b) === target ? found.around : undefined);
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
      const marked = (k: string) => shadow.querySelector<HTMLElement>(`[data-key="${window.CSS.escape(k)}"]`);
      // After an empty target, a block Sift does not mark (the recipe's picture): the first marked one after it.
      const later = () => next.sort((x, y) => (blockEl(x.b)!.compareDocumentPosition(blockEl(y.b)!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((h) => marked(h.b.key)).find(Boolean);
      const el = marked(keys[0]) ?? (empty && hit === found.after ? later() : null) ?? keys.slice(1).map(marked).find(Boolean);
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
    setTimeout(() => followPageFocus(true), 0);
  });
  /** True when it put focus on Sift's control for that place. `early`: before Sift's next look at the page. */
  function followPageFocus(early = false): boolean {
    const to = pageFocusTo;
    if (!to || store.mode !== "sift") return false;
    if (performance.now() - to.at > 2500 || !to.el.isConnected) {
      pageFocusTo = null;
      return false;
    }
    // Sift's control for it, in the open sheet if there is one.
    const layer = shadow.querySelector(".layer");
    const ref = window.CSS.escape(refOf(to.el));
    const ctls = Array.from((layer ?? shadow).querySelectorAll<HTMLElement>(`[data-ref="${ref}"]`)).filter((c) => c.matches(FOCUSABLE) && c.getClientRects().length > 0);
    // The page made the element a field as it focused it (a name renamed in place): Sift's field for it,
    // which the next render shows; not the button still there for it, where typing presses other controls (F1412).
    const typable = (to.el as HTMLElement).isContentEditable || to.el.matches("textarea, input:not([type=button], [type=submit], [type=reset], [type=image], [type=checkbox], [type=radio])");
    const isField = (c: Element) => c.matches("input, textarea, select, [contenteditable]");
    // Before the next look (`early`), only that field; a look that still shows a button for it: the button.
    const ctl = typable ? ctls.find(isField) ?? (early ? undefined : ctls[0]) : ctls[0];
    if (!ctl && ctls.length) return false;
    // A search opened from Sift's bar starts in its box, though the site's panel focuses a button
    // (BBC's menu focuses its "Search" button). A box the page has not enabled yet is waited for.
    if (ctl && layer && performance.now() - searchOpenedAt < 4000 && !ctl.matches("input, textarea")) {
      const box = layer.querySelector<HTMLInputElement>("input[type=search], input[type=text], input:not([type])");
      if (box) {
        if (box.disabled) return false;
        pageFocusTo = null;
        pageFocusAt = performance.now();
        if (shadow.activeElement !== box) box.focus();
        return true;
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
        // An element the page made editable: the caret where the page's selection is in it, else at the
        // end, where a click on the name puts it; not at the start, before the old text (F1412).
        else if ((to.el as HTMLElement).isContentEditable && ctl.localName === "textarea") {
          const f = ctl as HTMLTextAreaElement;
          const s = getSelection();
          let at = f.value.length;
          if (s?.rangeCount && to.el.contains(s.anchorNode)) {
            const r = document.createRange();
            r.selectNodeContents(to.el);
            r.setEnd(s.anchorNode!, s.anchorOffset);
            at = Math.min(at, r.toString().length);
          }
          f.setSelectionRange(at, at);
        }
      }
      return !!ctl;
    }
    return false;
  }

  Object.assign(H, {
    toggle,
    say: (text: string) => say(text),
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
          // A click the page's consent wall swallowed shows that wall, and why (F1034).
          // The page stays inert during the click: a focus() it makes then (a menu's first item, a name
          // turned editable, a popup's button) fails and Sift follows it, without blurring what the page
          // focused, which closes menus and ends edits (F1102). A Copy button that copies with execCommand
          // still copies: the page-world helper gives the copy the text the page selected (F1040).
          // With a shown original <body> is not inert as a whole, and a popup the page appends to it is
          // not inert yet: the page-world helper fails such a focus() while it knows Sift's click runs (F1200).
          document.dispatchEvent(new CustomEvent("sift-click", { detail: "start" }));
          let swallowed = false;
          try {
            swallowed = clickSwallowed(el, () => proxy.click(el));
          } finally {
            document.dispatchEvent(new CustomEvent("sift-click", { detail: "end" }));
          }
          const wall = swallowed && store.mode === "sift" ? consentWallUp() : null;
          if (wall) showConsent(wall, "click");
          flushBlur();
          if (problem) {
            notify(problem);
            focusInvalid((el as HTMLButtonElement).form);
          }
          afterAct(keep, el.localName === "a" && followAnchor((el as HTMLAnchorElement).href));
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
      typedAt = performance.now();
      typedUrl = location.href;
      // Its list Escape closed while the page kept it: what the page shows now for the new text shows again.
      unescapeList(ref);
      // A field with a suggestion list (or a search box the page shows one under): Sift shows the list once
      // the user pauses, not at the next routine look, which on a long page (a Wikipedia article) is seconds away.
      // A plain search box with no list (Python docs' Quick search) costs no extra looks.
      const listed = el.matches("[aria-controls], [aria-owns], [list], [role=combobox]") || (el.matches(proxy.SEARCH_FIELD) && (!!suggestAnchor() || !!fieldPanel(el)));
      if (listed) {
        clearTimeout(typedRun);
        typedRun = window.setTimeout(() => schedule(0), 300);
      }
      if (suggestAnchor() || listed) suggestAt = Date.now();
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
      unescapeList(ref);
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
      unescapeList(ref);
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
      // The field first: text typed before this submit still reaches a field the page swapped in.
      const fieldEl = field ? liveField(field.ref) : null;
      store.actAt = Date.now();
      const form = (elOf(formRef) as HTMLFormElement | null) ?? (fieldEl as HTMLInputElement | null)?.form ?? null;
      const keep = inShownDialog(form ?? fieldEl);
      // Sift's Search button keeps focus in its field (F856). With no form, the page's own button is clicked,
      // and a press there would have ended the field's edit first: change and blur go before the click (F950).
      const btn = elOf(buttonRef);
      if (via !== "enter" && fieldEl && btn && !(form instanceof HTMLFormElement) && !proxy.opensSearch(btn)) leaveField(fieldEl);
      const problem = proxy.submit(fieldEl, btn, form instanceof HTMLFormElement ? form : null, via);
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
          // A player's own Play before it loaded its video (a facade) starts it as playFacade does.
          if (btn(info.play)) portal && !(v && (v.currentSrc || v.readyState > 0)) ? playFacade(portal, btn(info.play) as HTMLElement) : proxy.click(btn(info.play)!);
          else if (v && (v.currentSrc || v.readyState > 0)) v.paused ? v.play().catch(() => {}) : v.pause();
          else {
            // The player has not loaded its video yet (a poster with a big Play
            // button): start it the way a user would, with its own control.
            const start = playControl(portal) ?? (v ? null : posterTarget(portal));
            if (start) playFacade(portal, start);
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
        case "prev":
        case "next":
          if (btn(info[op])) proxy.click(btn(info[op])!);
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
      if (key === consentKey) askConsent(false);
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
    if (store.page && !cutLast) processAi(store.page);
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
