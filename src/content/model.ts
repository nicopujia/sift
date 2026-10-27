// The Sift page model. Extractors (generic and per-site adapters) turn the live
// original DOM into a Page; the UI renders a Page. Anything interactive carries
// `ref`, the registry id of the original element that Sift acts on.

export type Inline =
  | string
  | {
      a: string; href?: string; ref?: string; /** A toggle's state (a table cell that opens its details). */ expanded?: boolean;
      /** A button in a cell (Edit, Delete, a calendar's day): shown as a button, not a link. */ btn?: boolean;
      /** Its name when its visible words say less ("Edit" for "Edit order 1006", "3" for "November 3, 2026"). */ name?: string;
      /** Chosen (aria-pressed, or aria-selected on a calendar's day). */ pressed?: boolean;
      /** The page disables it (a booked day). */ disabled?: boolean;
      /** A checkbox in a cell (a row's select box), shown as a checkbox named `a`: its state. */ checked?: boolean | "mixed";
    }
  | { b: string }
  | { i: string }
  | { code: string }
  | { br: true };

export interface Img {
  src: string;
  alt: string;
  w?: number;
  h?: number;
}

export interface Action {
  key: string;
  label: string;
  ref: string;
  href?: string;
  kind?: "primary" | "normal" | "danger" | "quiet";
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  /** Optional count or state shown after the label, e.g. a cart count. */
  badge?: string;
}

export type FieldKind =
  | "text" | "search" | "email" | "password" | "number" | "tel" | "url"
  | "date" | "time" | "datetime-local" | "month" | "week" | "color" | "range"
  | "textarea" | "select" | "checkbox" | "radio" | "editable" | "file"
  /** A page's own role=spinbutton: its value, min and max, and keys that go to the page (F902). */
  | "spinbutton";

export interface Option {
  value: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
}

export interface Field {
  key: string;
  ref: string;
  kind: FieldKind;
  label: string;
  value: string;
  name?: string;
  placeholder?: string;
  checked?: boolean;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  options?: Option[];
  multiple?: boolean;
  min?: string;
  max?: string;
  step?: string;
  autocomplete?: string;
  accept?: string;
  /** The page field's own limits (maxlength, minlength, pattern): Sift's field keeps them, as typing there would. */
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  /** The page field is a combobox (role=combobox, a datalist): its aria-autocomplete, or "none" (F804). */
  combo?: string;
  /** Ref of a button that submits this field when there is no <form>. */
  submit?: string;
  /** A slider's or spinbutton's value as words ("12 pt", "18:00"). */
  valueText?: string;
  /** The page marks the value as wrong (aria-invalid). */
  invalid?: boolean;
  /** What the page says is wrong with it (its error message). */
  error?: string;
  /** What else describes it on the page (aria-describedby, less the error): a hint, a live "is taken" message. */
  desc?: string;
  /** The visible words on the page's own submit button (an Arabic page's "بحث"), shown on Sift's button. */
  submitLabel?: string;
  /** Buttons in the field's own box (a password's Show button), shown right after it. */
  after?: Action[];
  /** The named group it belongs to (a fieldset's legend, a radio group's name: "Payment method"), shown as its fieldset. */
  group?: { ref: string; label: string };
  /** A choice drawn as a card (a plan): the rest of its card (price, text, feature list), shown under its short label (F1011). */
  detail?: Block[];
  /**
   * Buttons the page uses as fields (a custom select, a Yes/No toggle group, with the group's name),
   * that sit right before this field on the page: shown there, not after the form (F1012).
   */
  before?: { ref: string; label?: string; actions: Action[] }[];
}

export interface Item {
  key: string;
  title: string;
  href?: string;
  ref?: string;
  image?: Img;
  meta: string[];
  /** The meta parts with their links (an author, a tag, a pdf), same order as meta; set when one has a link. */
  metaInline?: Inline[][];
  text?: string;
  badge?: string;
  actions?: Action[];
  /** Extra context for the AI one-line rewrite (channel, snippet, ...). */
  context?: string;
  unread?: boolean;
  /** Shown before the title, e.g. the sender of an email. */
  lead?: string;
  /** The title is a name (a channel, a playlist, a person, a product): shown as is, never rewritten. */
  keepTitle?: boolean;
  /** Entries that answer this one (comment replies), shown as a list nested inside it. */
  replies?: Item[];
  /** Reply level in a thread of comments: 0 for a top-level comment, 1 for a reply to it, and so on. */
  depth?: number;
  /** The entry's own text in full, with its paragraphs, links and code (a comment's body). */
  body?: Block[];
}

export interface MediaInfo {
  /** Ref of the <video> element, for Sift's own accessible controls. */
  video?: string;
  /** Refs of the site's own player buttons, when known. */
  play?: string;
  captions?: string;
  fullscreen?: string;
  /** On a playlist or Mix: the player's own Previous and Next buttons. */
  prev?: string;
  next?: string;
}

export type Block =
  | { t: "h"; key: string; level: number; text: string; href?: string; ref?: string }
  | { t: "p"; key: string; content: Inline[]; small?: boolean; /** Ref of the page scroll box whose text this block ends: the reader reaching it in Sift scrolls that box to its end. */ scrollEnd?: string }
  | { t: "ul" | "ol"; key: string; items: Inline[][]; /** The list's own name ("Checkout steps"). */ label?: string; /** The entry the page marks current (a checkout's step), with its aria-current value. */ current?: { at: number; as: string }; /** Ref of the page scroll box whose text this block ends (terms to scroll to the end of): the reader reaching it in Sift scrolls that box to its end. */ scrollEnd?: string }
  | { t: "quote"; key: string; content: Inline[]; /** A social post's fallback quote (X's blockquote.twitter-tweet): one post, kept whole. */ embed?: boolean }
  | { t: "pre"; key: string; text: string }
  | { t: "img"; key: string; img: Img; caption?: string; href?: string; ref?: string }
  | { t: "portal"; key: string; ref: string; ratio: number; label: string; media?: MediaInfo; maxWidth?: number; /** A working surface (a map, an editor, a canvas, a payment form), not an embedded video or post. */ tool?: boolean; /** The middle of the part the page leaves uncovered (a map under a side panel), as fractions of its size. */ focus?: [number, number]; /** A chart shown as it is (a seat chart): read as a picture, its numbers in its label. */ chart?: boolean }
  | { t: "items"; key: string; title?: string; items: Item[]; thumbs?: boolean; /** oneliner: the title becomes a plain line. summary: the snippet does. */ rewrite?: "oneliner" | "summary"; aiMode?: "about" | "gist" | "news"; more?: Action }
  | { t: "form"; key: string; ref?: string; title?: string; fields: Field[]; actions: Action[] }
  | { t: "actions"; key: string; actions: Action[]; /** The name of the page's navigation this row is (a pager): Sift shows it as a navigation landmark. */ nav?: string }
  | { t: "facts"; key: string; rows: { k: string; v: Inline[] }[] }
  | {
      t: "table"; key: string; caption?: string; head: string[]; rows: Inline[][][];
      /** The header cells' own controls (a sort button) and sort state (aria-sort), same order as head; null for a plain header. */
      heads?: ({ ref?: string; href?: string; sort?: string; /** A select-all checkbox named by its head: its state. */ checked?: boolean | "mixed" } | null)[];
    }
  | {
      t: "section"; key: string; title: string; blocks: Block[]; collapsed?: boolean; level?: number; reveal?: string;
      /** Its open or closed state survives a move inside the site to a page with the same section (a playlist while its videos play). */
      keep?: boolean;
    }
  | {
      t: "article"; key: string; blocks: Block[]; words: number;
      /** Set by the generic extractor: true for running prose that may be condensed, false for structure (a thread, results, a recipe with its controls, a reference page). Unset in adapters. */
      prose?: boolean;
    }
  | { t: "note"; key: string; text: string; tone?: "info" | "warn" | "error" | "success" };

export interface Dialog {
  key: string;
  /** The original dialog or popup element, for closing it with Escape. */
  ref?: string;
  title: string;
  blocks: Block[];
  close?: Action;
  /** A page modal with no close of its own (a consent wall, an age gate): Sift offers no Close; the page's own choices answer it. */
  blocking?: boolean;
  /** The page dialog's role when it is an alert dialog (a session warning, a delete confirm). */
  role?: "alertdialog";
  /** The page dialog's description (its aria-describedby text): the warning or the consequence. */
  desc?: string;
  /** Ref of the control the page focused in its dialog, where Sift's sheet starts. */
  focus?: string;
  /**
   * A suggestion list with no roles (jQuery Autocomplete's rows) that its field's arrow keys
   * move through: Sift replays ArrowDown and ArrowUp on the page field as it moves through the
   * list, so the page highlights the same row.
   */
  arrows?: boolean;
}

export interface Page {
  url: string;
  title: string;
  site: string;
  lang: string;
  /** The site's search box, shown in Sift's top bar. */
  search?: Field;
  /** Site navigation, shown behind a "Menu" button. */
  nav?: Action[];
  /** A few important site-wide actions: cart, account, sign in. */
  top?: Action[];
  blocks: Block[];
  /** A site popup, menu, or dialog that is open right now. */
  dialog?: Dialog;
  /** Which extractor produced this page, for debugging and stats. */
  source: string;
  /** True while the page is still loading and the result may be partial. */
  partial?: boolean;
}

export function textOf(content: Inline[]): string {
  return content
    .map((c) => (typeof c === "string" ? c : "a" in c ? c.a : "b" in c ? c.b : "i" in c ? c.i : "code" in c ? c.code : "\n"))
    .join("");
}

/** Scripts written without spaces between words: a run of letters there is a whole clause. */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const SEA = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

export function wordCount(s: string): number {
  const m = s.match(/[\p{L}\p{N}]+/gu);
  if (!m) return 0;
  let n = 0;
  for (const w of m) {
    if (!NO_SPACES.test(w)) {
      n++;
      continue;
    }
    // Counted as the language's own words, so Chinese, Japanese and Thai
    // articles clear the same length gates as others: about two characters a
    // word in Chinese and Japanese, four in Thai (as Intl.Segmenter counts,
    // which is too slow for every extraction).
    const c = w.match(CJK)?.length ?? 0;
    const t = w.match(SEA)?.length ?? 0;
    n += Math.max(1, Math.round(c / 2 + t / 4) + (w.length > c + t ? 1 : 0));
  }
  return n;
}

export function blocksText(blocks: Block[]): string {
  const out: string[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      switch (b.t) {
        case "h": out.push(b.text); break;
        case "p": case "quote": out.push(textOf(b.content)); break;
        case "ul": case "ol": for (const it of b.items) out.push("- " + textOf(it)); break;
        case "pre": out.push(b.text); break;
        case "section": out.push(b.title); walk(b.blocks); break;
        case "article": walk(b.blocks); break;
        case "img": if (b.caption) out.push(b.caption); break;
        case "facts": for (const r of b.rows) out.push(r.k + ": " + textOf(r.v)); break;
        default: break;
      }
    }
  };
  walk(blocks);
  return out.join("\n");
}
