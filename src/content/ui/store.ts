// Shared state between the controller and the UI. The controller fills in the
// handlers and calls `changed()`; the UI reads from here.

import type { Action, Field, MediaInfo, Page } from "../model";
import type { ShortMeta } from "../short";

export interface AiResult {
  text: string;
  done: boolean;
  error?: string;
  /** For a Short version: what it was made from (placeholders, links, which article). */
  short?: ShortMeta;
}

export interface Handlers {
  toggle(): void;
  act(ref: string | undefined, href?: string): void;
  input(ref: string, value: string): void;
  commit(ref: string): void;
  /** Sift's field was focused: the page field is entered too. */
  focus(ref: string): void;
  /** Sift's field lost focus (to `to`): the page field is left, with change if it changed. */
  leave(ref: string, to: EventTarget | null): void;
  /** A press on Sift's field: the page field gets the click (pickers open on it). */
  fieldClick(ref: string): void;
  check(ref: string, checked: boolean): void;
  select(ref: string, value: string | string[]): void;
  files(ref: string, files: FileList): void;
  /** `via`: Enter in the field, or Sift's own submit button (the default). */
  submit(field: Field | null, formRef?: string, buttonRef?: string, via?: "enter" | "button"): void;
  media(op: "play" | "back" | "fwd" | "mute" | "captions" | "fullscreen", info: MediaInfo, portalRef: string): void;
  closeDialog(key: string, closeRef?: string, dialogRef?: string): void;
  loadMore(ref?: string): void;
  menu(open: boolean): void;
  /** Bring an original element into view so the site loads it (comments). */
  reveal(ref: string): void;
  /** Move keyboard focus into a shown original element (a map, an editor). */
  enterPortal(ref: string): void;
  /** Say `text` politely through Sift's one live region (the number of suggestions shown). */
  say(text: string): void;
}

export const H = {} as Handlers;

export const store = {
  page: null as Page | null,
  mode: "sift" as "sift" | "original",
  booting: true,
  notice: "" as string,
  /** The buttons of a page notice that has them (a toast's Undo), shown with it. */
  noticeActions: [] as Action[],
  ai: new Map<string, AiResult>(),
  /** Per-page UI state: open sections, article view choices. */
  local: new Map<string, unknown>(),
  dismissed: new Set<string>(),
  menuOpen: false,
  aiOff: false,
  /** Polite announcement for screen readers (new page, new items). */
  announce: "",
  /** A page modal dialog is open: it is on top and answered directly, so Sift shows no sheet for it. */
  pageModal: false,
  /** When the user last acted (a click replayed on the page), so fields can follow what the page did. */
  actAt: 0,
};

/** Keyboard handlers for Sift's own elements (see the key guard). */
export const onEnter = new WeakMap<Element, (e: KeyboardEvent) => void>();
/** Other keys for a group of Sift's controls, pressed on any control in it (a video's bar). */
export const onKeys = new WeakMap<Element, (e: KeyboardEvent) => void>();

let render: (() => void) | null = null;
let queued = false;
let lastRender = -Infinity;
/** Shortest time between two renders in a burst (a reply streamed as many messages). */
const GAP = 100;

export function setRenderer(fn: () => void) {
  render = fn;
}

export function changed() {
  if (queued) return;
  queued = true;
  const go = () => {
    queued = false;
    lastRender = performance.now();
    render?.();
  };
  // A change after a quiet moment renders at once; a burst renders at most every GAP ms.
  const since = performance.now() - lastRender;
  if (since >= GAP) queueMicrotask(go);
  else setTimeout(go, GAP - since);
}

export function local<T>(key: string, def: T): T {
  return (store.local.has(key) ? store.local.get(key) : def) as T;
}

export function setLocal(key: string, v: unknown) {
  store.local.set(key, v);
  changed();
}

/** Key for an item's one-line rewrite: tied to its text, not its element. */
export function lineKey(it: { title: string; context?: string }): string {
  return "line:" + it.title + "|" + (it.context ?? "");
}
