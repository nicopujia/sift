// Shows an original element (a video player, a map, a payment field) inside
// Sift's layout. The element never moves in the DOM, so the site's scripts and
// styles keep working: it is lifted into the browser's top layer as a manual
// popover and placed exactly over a placeholder box in Sift's view.

interface Portal {
  ref: string;
  el: HTMLElement;
  box: HTMLElement | null;
  kind: "video" | "other";
  /** The element's own inline longhands that Sift overwrites, to put back exactly on release. */
  saved: Map<string, { value: string; priority: string }> | null;
  /** The values Sift last set, to tell them apart from the site's own later changes. */
  mine: Map<string, string> | null;
  /** The element's own popover attribute, if it had one. */
  savedPopover: string | null;
  shown: boolean;
  lastW: number;
  lastH: number;
  /** Hidden while Sift shows a menu or a dialog that does not contain it. */
  suspended: boolean;
  /** Sift made it inert (while suspended): released, it must not stay so. */
  madeInert: boolean;
  /** Released so the site can make it full screen. */
  released: boolean;
  releaseTimer: number;
  /** Its own scroll position, when Sift centers content laid out for a bigger box (a map). */
  scroll: [number, number] | null;
  /** The content size Sift last centered for. */
  centered: string;
  /** Where to center that content, as fractions of its size: the part the page left uncovered (a map under a side panel). */
  focus: [number, number] | null;
}

const portals = new Map<string, Portal>();
const boxes = new Map<string, HTMLElement>();
let scroller: HTMLElement | null = null;
let headerEl: (() => Element | null) | null = null;
let toggleEl: (() => Element | null) | null = null;
let parked = false;
let frame = 0;
let wheelOn = false;
/** A page modal dialog or full screen is open (kept by the controller; a :modal query each frame is slow on big pages). */
let modal = false;

export function setModalOpen(on: boolean) {
  if (modal === on) return;
  modal = on;
  schedule();
}

// A [popover] gets UA styles (border, padding, colors); keep the element's own look.
const FROZEN = [
  "color", "background-color", "box-shadow",
  ...["top", "right", "bottom", "left"].flatMap((s) => [`padding-${s}`, `border-${s}-width`, `border-${s}-style`, `border-${s}-color`]),
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
];
const SET_PROPS = [
  ...FROZEN, "position", "inset", "left", "top", "width", "height", "margin", "min-width", "min-height",
  "max-width", "max-height", "box-sizing", "transform", "overflow", "visibility", "opacity", "clip-path",
];
const FULLSCREEN_CONTROL =
  '[aria-label*="full screen" i], [aria-label*="fullscreen" i], [title*="full screen" i], [title*="fullscreen" i], [aria-label*="pantalla completa" i], .ytp-fullscreen-button, .vjs-fullscreen-control, .jw-icon-fullscreen';
const CONTROL = "button, [role=button], [role=slider], [role=menuitem], [role=checkbox], [role=switch], input, select, textarea, a[href]";
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"]), iframe, [contenteditable=""], [contenteditable=true]';

/** Every longhand behind SET_PROPS, so saving and restoring never goes through a shorthand. */
let longhands: string[] | null = null;
function setLonghands(): string[] {
  if (longhands) return longhands;
  const s = document.createElement("div").style;
  for (const k of SET_PROPS) s.setProperty(k, "initial");
  longhands = Array.from({ length: s.length }, (_, i) => s.item(i));
  return longhands;
}

export function initPortals(scroll: HTMLElement, header: () => Element | null, toggle: () => Element | null) {
  scroller = scroll;
  headerEl = header;
  toggleEl = toggle;
  scroll.addEventListener("scroll", schedule, { passive: true });
  // Dialog sheets inside Sift scroll on their own; portals inside them follow.
  scroll.shadowRoot?.addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule, { passive: true });
  document.addEventListener("fullscreenchange", onFullscreen);
  document.addEventListener("fullscreenerror", () => {
    for (const p of portals.values()) cancelRelease(p.ref);
  });
  // An element showing as a popover cannot go full screen. When the user asks a
  // player for full screen (its button, a double click on the picture, the "f"
  // key), release it first.
  addEventListener("click", (e) => releaseFor(e, (t) => !!t.closest(FULLSCREEN_CONTROL)), true);
  addEventListener("dblclick", (e) => releaseFor(e, (t) => !t.closest(CONTROL), "video"), true);
  addEventListener(
    "keydown",
    (e) => {
      const k = e as KeyboardEvent;
      if ((k.key === "f" || k.key === "F") && !k.ctrlKey && !k.metaKey && !k.altKey) releaseFor(e, (t) => !editable(t), "video");
    },
    true,
  );
}

function editable(t: Element): boolean {
  return !!t.closest("input, textarea, select, [contenteditable=''], [contenteditable=true], [contenteditable=plaintext-only]");
}

/** The node a page event is really for, inside shadow roots (players are often web components). */
function targetOf(e: Event): Element | null {
  const t = e.composedPath()[0];
  return t instanceof Element ? t : null;
}

/** `node` is inside `root`, looking through shadow roots. */
export function deepContains(root: Element, node: Node | null): boolean {
  for (let n: Node | null = node; n; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)) if (n === root) return true;
  return false;
}

function releaseFor(e: Event, test: (t: Element) => boolean, kind?: "video") {
  const t = targetOf(e);
  if (!t) return;
  for (const p of portals.values()) {
    if (p.shown && (!kind || p.kind === kind) && deepContains(p.el, t) && test(t)) releaseForFullscreen(p.ref);
  }
}

/**
 * Wheel over a video should scroll Sift, as it would scroll a normal page. So
 * should wheel over a map the user has not entered (Enter, or a click in it),
 * as on an embedded map; Ctrl+wheel still zooms it, and inside one the user
 * works in, or over a part that scrolls itself, the wheel is the page's.
 */
function onWheel(e: WheelEvent) {
  // Ctrl+wheel and pinch zoom the page (or the map); never take them.
  if (parked || !scroller || document.fullscreenElement || e.ctrlKey || e.metaKey) return;
  const t = targetOf(e);
  for (const p of portals.values()) {
    if (!p.shown || !deepContains(p.el, t)) continue;
    if (p.kind === "video" || (entered !== p.ref && !scrollsItself(t, p.el, e))) {
      e.preventDefault();
      // A map zooms on the wheel whatever the default: it must not get it.
      if (p.kind !== "video") e.stopImmediatePropagation();
      scroller.scrollBy({ top: e.deltaY, left: 0 });
    }
    return;
  }
}

/** Something under the pointer, inside the shown original, scrolls this way itself (an editor, a list). */
function scrollsItself(t: Element | null, root: Element, e: WheelEvent): boolean {
  for (let n: Element | null = t; n; n = n === root ? null : n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)) {
    const s = getComputedStyle(n);
    if (e.deltaY && /auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 && (e.deltaY > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0)) return true;
    if (e.deltaX && /auto|scroll/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

/** A non-passive wheel listener slows scrolling everywhere; keep it only while a video or another original is shown. */
function syncWheel() {
  const need = !parked && Array.from(portals.values()).some((p) => p.shown);
  if (need === wheelOn) return;
  wheelOn = need;
  if (need) addEventListener("wheel", onWheel, { capture: true, passive: false });
  else removeEventListener("wheel", onWheel, { capture: true });
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    layout();
  });
}

/** Declare which originals should be portaled right now. */
export function setPortals(list: { ref: string; el: Element; kind: "video" | "other"; focus?: [number, number] }[]) {
  const want = new Set(list.map((p) => p.ref));
  for (const [ref, p] of portals) {
    if (!want.has(ref) || !p.el.isConnected) {
      release(p);
      restoreStops(p);
      clearTimeout(p.releaseTimer);
      portals.delete(ref);
      if (entered === ref) entered = null;
    }
  }
  for (const { ref, el, kind, focus } of list) {
    const old = portals.get(ref);
    if (old) old.focus = focus ?? null;
    if (old || !(el instanceof HTMLElement)) continue;
    portals.set(ref, {
      ref, el, box: null, kind, saved: null, mine: null, savedPopover: null, shown: false, lastW: 0, lastH: 0,
      suspended: false, madeInert: false, released: false, releaseTimer: 0, scroll: null, centered: "", focus: focus ?? null,
    });
  }
  schedule();
}

export function bindBox(ref: string, box: HTMLElement | null) {
  if (box) boxes.set(ref, box);
  else boxes.delete(ref);
  schedule();
}

export function portalElements(): Element[] {
  return Array.from(portals.values()).map((p) => p.el);
}

/** The shown portal element that holds `target` (looking through shadow roots). */
export function portalOf(target: Node): HTMLElement | null {
  for (const p of portals.values()) if (p.shown && deepContains(p.el, target)) return p.el;
  return null;
}

export function boxOf(ref: string): HTMLElement | null {
  return boxes.get(ref) ?? null;
}

export function refOfPortal(el: Element): string | null {
  for (const p of portals.values()) if (p.el === el) return p.ref;
  return null;
}

/** The site moved or re-showed a portal element (its popover closed): it needs layout and a fresh shield. */
export function portalsDisplaced(added: Node[]): boolean {
  for (const p of portals.values()) {
    if (p.shown && !p.el.matches(":popover-open")) return true;
    if (added.some((n) => n === p.el || n.contains(p.el))) return true;
  }
  return false;
}

/**
 * Hide portals while Sift shows its own menu or dialog on top. Portals inside
 * that dialog (`keep`) stay visible.
 */
export function suspendPortals(on: boolean, keep: Set<string> = new Set()) {
  for (const p of portals.values()) p.suspended = on && !keep.has(p.ref);
  schedule();
}

/** Release every portal (Sift view switched off). */
export function parkPortals(on: boolean) {
  parked = on;
  if (on) for (const p of portals.values()) release(p);
  if (on) restoreStops();
  entered = null;
  syncWheel();
  if (!on) schedule();
}

/** Show every portal again above Sift (after Sift's root went back on top). Styles stay as they are. */
export function reraisePortals() {
  for (const p of portals.values()) {
    if (!p.shown) continue;
    try {
      p.el.hidePopover();
      p.el.showPopover();
    } catch {
      release(p);
    }
  }
  schedule();
}

/** Let the site make this element full screen; it comes back after full screen ends. */
export function releaseForFullscreen(ref: string) {
  const p = portals.get(ref);
  if (!p) return;
  release(p);
  p.released = true;
  clearTimeout(p.releaseTimer);
  // A stray "f", a double click that was not for full screen, or a refused
  // request: if full screen does not follow, show the element again.
  p.releaseTimer = window.setTimeout(() => cancelRelease(ref), 1200);
}

/** Show a released element again unless it is full screen now. */
export function cancelRelease(ref: string) {
  const p = portals.get(ref);
  if (!p || !p.released) return;
  clearTimeout(p.releaseTimer);
  const fs = document.fullscreenElement;
  if (fs && (fs === p.el || fs.contains(p.el) || p.el.contains(fs))) return;
  p.released = false;
  schedule();
}

function show(p: Portal) {
  if (p.shown) return;
  const el = p.el;
  const cs = getComputedStyle(el);
  const keep = FROZEN.map((k) => [k, cs.getPropertyValue(k)] as const);
  p.saved = new Map(setLonghands().map((k) => [k, { value: el.style.getPropertyValue(k), priority: el.style.getPropertyPriority(k) }]));
  p.mine = null;
  // Content the site laid out for the whole window (a map) is centered in the
  // box, unless the element scrolls on its own (an editor, a list).
  p.scroll = p.kind === "other" && !/auto|scroll/.test(cs.overflowX + cs.overflowY) ? [el.scrollLeft, el.scrollTop] : null;
  p.savedPopover = el.getAttribute("popover");
  try {
    el.setAttribute("popover", "manual");
    el.setAttribute("data-sift-portal", "");
    for (const [k, v] of keep) el.style.setProperty(k, v, "important");
    if (p.kind === "video") el.style.setProperty("background-color", "#000", "important");
    el.showPopover();
    p.shown = true;
    if (p.ref !== entered) hideStops(p);
    demoteInside(p);
  } catch {
    restore(p);
  }
}

function restore(p: Portal) {
  const el = p.el;
  if (el.matches(":popover-open")) {
    try {
      el.hidePopover();
    } catch {
      /* not a popover any more */
    }
  }
  if (p.savedPopover === null) el.removeAttribute("popover");
  else el.setAttribute("popover", p.savedPopover);
  el.removeAttribute("data-sift-portal");
  if (p.madeInert && el.inert) el.inert = false;
  p.madeInert = false;
  restoreStops(p);
  restoreLandmarks(p);
  if (p.scroll) [el.scrollLeft, el.scrollTop] = p.scroll;
  p.centered = "";
  // Put back only what Sift changed; the site's own later style changes stay.
  if (p.saved) {
    for (const [k, v] of p.saved) {
      if (p.mine && p.mine.has(k) && el.style.getPropertyValue(k) !== p.mine.get(k)) continue;
      if (v.value) el.style.setProperty(k, v.value, v.priority);
      else el.style.removeProperty(k);
    }
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
  p.saved = null;
  p.mine = null;
}

function release(p: Portal) {
  if (!p.shown) return;
  restore(p);
  p.shown = false;
  p.lastW = p.lastH = 0;
  // Players and maps size themselves on window resize: back in their own place, they fit it again.
  dispatchEvent(new Event("resize"));
}

function onFullscreen() {
  const fs = document.fullscreenElement;
  for (const p of portals.values()) {
    // If the site made an ancestor (or the element) full screen, let it render there.
    if (fs && (fs === p.el || fs.contains(p.el) || p.el.contains(fs))) {
      release(p);
      p.released = true;
      clearTimeout(p.releaseTimer);
    }
    if (!fs) p.released = false;
  }
  schedule();
}

/** The part of the viewport where a portal may show: below Sift's bar, inside its scroll container. */
function clipBounds(box: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  const head = headerEl?.()?.getBoundingClientRect();
  let top = head ? Math.max(0, head.bottom) : 0;
  let bottom = innerHeight;
  let left = 0;
  let right = innerWidth;
  // Inside a dialog sheet: clip to the sheet, below its sticky head (the Close button).
  const sheet = box.closest(".sheet");
  if (sheet) {
    const r = sheet.getBoundingClientRect();
    const sh = sheet.querySelector(".sheet-head")?.getBoundingClientRect();
    top = Math.max(r.top, sh ? sh.bottom : r.top);
    bottom = r.bottom;
    left = r.left;
    right = r.right;
  }
  return { top, bottom, left, right };
}

export function layout() {
  if (!scroller) return;
  if (!portals.size) return syncWheel();
  const fs = document.fullscreenElement;
  const tg = toggleEl?.()?.getBoundingClientRect();
  for (const p of portals.values()) {
    if (parked || p.released) continue;
    if (fs && (fs === p.el || fs.contains(p.el) || p.el.contains(fs))) continue;
    const box = (p.box = boxes.get(p.ref) ?? null);
    if (!box || !box.isConnected || !p.el.isConnected) {
      release(p);
      continue;
    }
    const r = box.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      release(p);
      continue;
    }
    // The browser closes a popover when the site moves the element; show it again.
    if (p.shown && !p.el.matches(":popover-open")) {
      restore(p);
      p.shown = false;
    }
    // Shown now, a portal would paint over a page modal dialog that is open.
    if (modal && !p.shown) continue;
    show(p);
    if (!p.shown) continue;
    // Hidden ones also leave the tab order and the accessibility tree.
    if (p.el.inert !== p.suspended) {
      p.el.inert = p.suspended;
      p.madeInert = p.suspended;
    }
    const s = p.el.style;
    const set = (k: string, v: string) => s.setProperty(k, v, "important");
    set("position", "fixed");
    set("inset", "auto");
    set("left", r.left + "px");
    set("top", r.top + "px");
    set("width", r.width + "px");
    set("height", r.height + "px");
    set("margin", "0");
    set("min-width", "0");
    set("min-height", "0");
    set("max-width", "none");
    set("max-height", "none");
    set("box-sizing", "border-box");
    set("transform", "none");
    set("overflow", "hidden");
    set("visibility", "visible");
    set("opacity", "1");
    if (p.suspended) {
      set("clip-path", "inset(50%)");
    } else {
      const c = clipBounds(box);
      const ct = Math.max(0, Math.min(r.height, c.top - r.top));
      const cb = Math.max(0, Math.min(r.height, r.bottom - c.bottom));
      const cl = Math.max(0, Math.min(r.width, c.left - r.left));
      const cr = Math.max(0, Math.min(r.width, r.right - c.right));
      set("clip-path", clipPath(r, ct, cr, cb, cl, box.closest(".sheet") ? undefined : tg));
    }
    p.mine = new Map(setLonghands().map((k) => [k, s.getPropertyValue(k)]));
    if (p.scroll) center(p);
    if (Math.abs(p.lastW - r.width) > 1 || Math.abs(p.lastH - r.height) > 1) {
      p.lastW = r.width;
      p.lastH = r.height;

      // Players and maps size themselves on window resize.
      setTimeout(() => dispatchEvent(new Event("resize")), 0);
    }
  }
  syncWheel();
}

/** Show the middle of content laid out for a bigger box (a map sized for the whole window), or of its uncovered part. */
function center(p: Portal) {
  const el = p.el;
  const [fx, fy] = p.focus ?? [0.5, 0.5];
  const size = `${el.scrollWidth}x${el.scrollHeight}x${el.clientWidth}x${el.clientHeight}x${fx}x${fy}`;
  if (size === p.centered) return;
  p.centered = size;
  if (el.scrollWidth < el.clientWidth * 1.2 && el.scrollHeight < el.clientHeight * 1.2) return;
  // The browser keeps these inside the content.
  el.scrollLeft = fx * el.scrollWidth - el.clientWidth / 2;
  el.scrollTop = fy * el.scrollHeight - el.clientHeight / 2;
}

/**
 * The visible part of a portal: inside the clip bounds, with a hole where
 * Sift's switch sits, so the switch is never covered.
 */
function clipPath(r: DOMRect, ct: number, cr: number, cb: number, cl: number, hole?: DOMRect): string {
  const inset = `inset(${ct}px ${cr}px ${cb}px ${cl}px)`;
  if (!hole || hole.width < 1) return inset;
  const pad = 6;
  const hl = Math.max(cl, hole.left - pad - r.left);
  const ht = Math.max(ct, hole.top - pad - r.top);
  const hr = Math.min(r.width - cr, hole.right + pad - r.left);
  const hb = Math.min(r.height - cb, hole.bottom + pad - r.top);
  if (hr <= hl || hb <= ht) return inset;
  const R = r.width - cr;
  const B = r.height - cb;
  return `path(evenodd, "M${cl} ${ct}H${R}V${B}H${cl}Z M${hl} ${ht}H${hr}V${hb}H${hl}Z")`;
}

// ---------- keyboard: a portal's own tab stops ----------
// A lifted element sits in the page's DOM after Sift, so its controls would be
// reached by Tab after Sift's last one (offscreen, or before the user chose to
// enter it). They leave the tab order until the user enters the portal: Enter
// on its box, or a click inside it.

let entered: string | null = null;
/** Tab stops Sift took out of the tab order: their own tabindex, and the portal they belong to. */
const stops = new Map<HTMLElement, { orig: string | null; ref: string }>();

function shadowRootOf(el: Element): ShadowRoot | null {
  const open = (el as HTMLElement).shadowRoot;
  if (open) return open;
  if (!el.localName.includes("-")) return null;
  try {
    return (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement) as ShadowRoot | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * A video inside `root` (or `root` itself), looking through shadow roots:
 * players are often web components. With `playing`, only one that plays now
 * (an ad before the video often plays in a second element).
 */
export function videoIn(root: Element | null, playing = false): HTMLVideoElement | null {
  if (!root) return null;
  const ok = (v: HTMLVideoElement) => !playing || (!v.paused && !v.ended);
  if (root instanceof HTMLVideoElement) return ok(root) ? root : null;
  const find = (r: Element | ShadowRoot): HTMLVideoElement | null => {
    for (const v of Array.from(r.querySelectorAll("video"))) if (ok(v)) return v;
    for (const el of Array.from(r.querySelectorAll("*"))) {
      const sr = shadowRootOf(el);
      const x = sr ? find(sr) : null;
      if (x) return x;
    }
    return null;
  };
  const sr = shadowRootOf(root);
  return find(root) ?? (sr ? find(sr) : null);
}

const lastPlayed = new WeakMap<Element, HTMLVideoElement>();

/**
 * The video Sift's controls act on in a player: the one playing now (an ad
 * before the video plays in its own element), else the last one that played
 * there (a paused ad resumes, not the video behind it), else the site's own.
 */
export function mediaOf(player: Element | null, own: Element | null): HTMLVideoElement | null {
  const now = videoIn(player, true);
  if (now && player) lastPlayed.set(player, now);
  const last = player ? lastPlayed.get(player) : undefined;
  return now ?? (last && last.isConnected && !last.ended ? last : null) ?? (own instanceof HTMLVideoElement ? own : null) ?? videoIn(player);
}

/** Sequential focus stops inside `root` (and `root` itself), through shadow roots, in order. */
function tabStopsIn(root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const add = (el: Element) => {
    // An editing host (a code editor) is a stop too, though Chrome gives it tabIndex -1.
    const host = el instanceof HTMLElement && el.isContentEditable && !el.hasAttribute("tabindex") && !el.parentElement?.isContentEditable;
    if (el instanceof HTMLElement && el.matches(FOCUSABLE) && (el.tabIndex >= 0 || host)) out.push(el);
  };
  const walk = (r: Element | ShadowRoot) => {
    for (const el of Array.from(r.querySelectorAll("*"))) {
      add(el);
      const sr = shadowRootOf(el);
      if (sr) walk(sr);
    }
  };
  add(root);
  walk(root);
  const sr = shadowRootOf(root);
  if (sr) walk(sr);
  return out;
}

function hideStops(p: Portal) {
  const list = tabStopsIn(p.el);
  // Its ancestors stay out of `inert` so it works; a focusable one would be a stop too.
  for (let n = p.el.parentNode; n && n !== document.body; n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)) {
    if (n instanceof HTMLElement && n.matches(FOCUSABLE) && n.tabIndex >= 0) list.push(n);
  }
  for (const el of list) {
    if (!stops.has(el)) stops.set(el, { orig: el.getAttribute("tabindex"), ref: p.ref });
    el.setAttribute("tabindex", "-1");
  }
}

function restoreStops(p?: Portal) {
  for (const [el, { orig, ref }] of stops) {
    if (p && ref !== p.ref) continue;
    // The site may have set its own value since; leave that.
    if (el.getAttribute("tabindex") === "-1") {
      if (orig === null) el.removeAttribute("tabindex");
      else el.setAttribute("tabindex", orig);
    }
    stops.delete(el);
  }
}

/** Take the tab stops of every portal the user has not entered out of the tab order (sites add controls any time). */
export function hidePortalStops() {
  for (const [el] of stops) if (!el.isConnected) stops.delete(el);
  for (const p of portals.values()) if (p.shown && p.ref !== entered) hideStops(p);
  for (const p of portals.values()) if (p.shown) demoteInside(p);
}

// ---------- landmarks inside a portal ----------
// A lifted player or code runner may hold its own <header> or <nav>; next to
// Sift's they would be a second banner or navigation. They are plain
// containers while shown: role=generic, since role=none is ignored on an
// element with a label.

const LANDMARK = "header, footer, nav, main, aside, form, section[aria-label], section[aria-labelledby], [role=banner], [role=navigation], [role=main], [role=contentinfo], [role=complementary], [role=region], [role=search], [role=form]";
const ROLE_MARK = "data-sift-prole";
/** Elements demoted inside each portal, by portal ref. */
const demotedIn = new Map<string, Set<Element>>();

function demoteInside(p: Portal) {
  let set = demotedIn.get(p.ref);
  if (!set) demotedIn.set(p.ref, (set = new Set()));
  const walk = (r: Element | ShadowRoot) => {
    for (const el of Array.from(r.querySelectorAll("*"))) {
      if (!set!.has(el) && el.matches(LANDMARK) && el.getAttribute("role") !== "generic") {
        el.setAttribute(ROLE_MARK, el.getAttribute("role") ?? "");
        el.setAttribute("role", "generic");
        set!.add(el);
      }
      const sr = shadowRootOf(el);
      if (sr) walk(sr);
    }
  };
  walk(p.el);
  const sr = shadowRootOf(p.el);
  if (sr) walk(sr);
}

function restoreLandmarks(p: Portal) {
  const set = demotedIn.get(p.ref);
  if (!set) return;
  for (const el of set) {
    const orig = el.getAttribute(ROLE_MARK);
    // The site may have set its own role since; leave that.
    if (el.getAttribute("role") === "generic") {
      if (orig) el.setAttribute("role", orig);
      else el.removeAttribute("role");
    }
    el.removeAttribute(ROLE_MARK);
  }
  demotedIn.delete(p.ref);
}

/** The user works inside this portal now: its own tab order applies. */
export function enterPortalStops(ref: string) {
  if (entered === ref) return;
  if (entered) leavePortalStops();
  const p = portals.get(ref);
  if (!p) return;
  entered = ref;
  restoreStops(p);
}

export function leavePortalStops() {
  if (!entered) return;
  entered = null;
  hidePortalStops();
}

export function enteredPortal(): string | null {
  return entered;
}

/** The portal's tab stops while entered, visible ones only, in order. */
export function portalStops(el: HTMLElement): HTMLElement[] {
  return tabStopsIn(el).filter((s) => s.checkVisibility());
}
