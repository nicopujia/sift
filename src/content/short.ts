// The Short version of an article. The model gets the article as text in which
// every part that is not prose (code, buttons, link lists, tables, images,
// video, forms, small print) is a placeholder line "[[B3]]" and every link is
// "[words](L3)". When the short text comes back, the original blocks and links
// are put back where their placeholders are, headings the source does not have
// are dropped, and anything the model left out is put back in its place.

import type { Block, Inline } from "./model";
import { textOf, wordCount } from "./model";

export interface Link {
  a: string;
  href?: string;
  ref?: string;
}

/** One part of the article, in reading order. */
interface Unit {
  /** h: a heading; b: a block kept as it is (a placeholder); p: prose the model rewrites. */
  kind: "h" | "b" | "p";
  block: Block;
  /** Plain text of a heading or prose part. */
  plain: string;
  words: number;
}

/** An article as the model sees it. */
export interface ShortSource {
  /** What is sent to the model. */
  text: string;
  units: Unit[];
  /** Placeholder blocks by number: [[B3]] is blocks[3]. */
  blocks: Block[];
  /** Links by number: [words](L3) is links[3]. */
  links: Link[];
  /** Words of prose (placeholders not counted). */
  words: number;
  /** Hashes of the longer prose parts: tells whether two texts are the same article. */
  fp: number[];
  /** Per unit, a hash of a longer prose part's words and numbers (-1 for other units): tells which paragraphs changed. */
  dfp: number[];
  /** The text was too long and was cut: units, blocks and links past these were not sent. */
  partial: boolean;
  sentUnits: number;
  sentBlocks: number;
  sentLinks: number;
}

/** What a Short version was made from, kept with it. */
export interface ShortMeta {
  /** Block key of each placeholder, by number. */
  keys: string[];
  links: Link[];
  fp: number[];
  /** Hashes of the longer prose parts sent, with their numbers (see ShortSource.dfp). */
  dfp: number[];
  /** The text of each of those parts, by the same index: tells which sentence of the Short version was about a part that changed since. */
  dplain?: string[];
  words: number;
  sentLinks: number;
  partial: boolean;
}

/** Longest text sent; the background condenses long text in parts. */
const MAX_CHARS = 120_000;

const memo = new WeakMap<Block[], ShortSource>();

// ---------- what stays whole ----------

function linkStats(c: Inline[]) {
  let total = 0;
  let link = 0;
  let starts: boolean | null = null;
  for (const x of c) {
    const s = typeof x === "string" ? x : "a" in x ? x.a : "b" in x ? x.b : "i" in x ? x.i : "code" in x ? x.code : " ";
    const n = s.trim().length;
    if (n && starts === null) starts = typeof x === "object" && "a" in x;
    total += n;
    if (typeof x === "object" && "a" in x && (x.href || x.ref)) link += n;
  }
  return { total, link, starts: !!starts, has: link > 0 };
}

/**
 * A block shown as it is in the Short version: anything but running prose. A
 * paragraph that is mostly a link is a call to action or a pointer, and a list
 * whose entries are links (see also, related stories, tags) is there to be
 * followed, so both stay whole too.
 */
function keepWhole(b: Block): boolean {
  switch (b.t) {
    case "h":
      return false;
    case "quote":
      // A social post quoted whole (an X post before its widget loads) is shown as it is, its links with it.
      return !!b.embed;
    case "p": {
      if (b.small) return true;
      const s = linkStats(b.content);
      return s.has && s.link >= s.total * 0.6;
    }
    case "ul":
    case "ol": {
      const st = b.items.map(linkStats);
      const n = st.length;
      if (!n) return true;
      const starting = st.filter((s) => s.has && s.starts).length;
      const mostly = st.filter((s) => s.has && s.link >= s.total * 0.5).length;
      // A long list whose entries nearly all carry links is references or further reading: nothing to shorten.
      const linked = st.filter((s) => s.has).length;
      return starting >= Math.max(1, n * 0.8) || mostly >= Math.max(1, n * 0.6) || (n >= 6 && linked >= n * 0.7);
    }
    default:
      return true;
  }
}

// ---------- text for the model ----------

function inline(c: Inline[], links: Link[]): { md: string; plain: string } {
  let md = "";
  let plain = "";
  for (const x of c) {
    if (typeof x === "string") {
      md += x;
      plain += x;
    } else if ("a" in x) {
      const a = x.a.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
      if (!a) continue;
      const lead = /^\s/.test(x.a) ? " " : "";
      const trail = /\s$/.test(x.a) ? " " : "";
      md += lead + (x.href || x.ref ? `[${a}](L${links.push({ a, href: x.href, ref: x.ref }) - 1})` : a) + trail;
      plain += lead + a + trail;
    } else if ("b" in x) {
      md += x.b;
      plain += x.b;
    } else if ("i" in x) {
      md += x.i;
      plain += x.i;
    } else if ("code" in x) {
      md += "`" + x.code + "`";
      plain += x.code;
    } else {
      md += " ";
      plain += " ";
    }
  }
  // "[[" in the page's own text must not read as a placeholder.
  return { md: md.replace(/\[\[/g, "[ [").replace(/\s+/g, " ").trim(), plain: plain.replace(/\s+/g, " ").trim() };
}

const normWords = (s: string) => (s.toLowerCase().match(/\p{L}+/gu) ?? []).join(" ");
/** Words and numbers: a paragraph whose count or date changed is a changed paragraph. */
const normText = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
/** A prose part this long is a paragraph that matters, not a line that ticks (a time, a counter). */
const LONG = 8;
/**
 * A short line that ticks: a clock time, "5 min ago", "Updated", a view count.
 * Any other short line of a few words ("The death toll rose to 31.") is news
 * when it changes, like a longer paragraph.
 */
const TICK =
  /\d{1,2}(?::|h)\d{2}(?!\d)|(?<!\p{L})(?:ago|just now|geleden|temu|назад)(?!\p{L})|(?<!\p{L})hace\s+(?:\d|un[oa]?s?\s|pocos?\s)|\d+\s*(?:s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|segundos?|minutos?|horas?|secondes?|heures?|sekunden|minuten|stunden|secondi|minuti|ore)(?!\p{L})|\d[\d.,]*\s*[kmb]?\s+(?:\p{L}+\s+){0,2}(?:views?|viewers?|watching|likes?|comments?|shares?|reads?|vistas?|visitas?|viendo|reproducciones|visualizaciones|comentarios?|vues|commentaires?|aufrufe|kommentare|visualizzazioni|commenti)(?!\p{L})/iu;
/** Whether a prose part counts as one whose change matters: a longer one, or a short one of a few words that does not tick. */
const counts = (u: Unit) => u.kind === "p" && (u.words >= LONG || (normWords(u.plain).split(" ").length >= 3 && !TICK.test(u.plain)));

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The article as the model sees it (cached per extraction). */
export function shortSource(blocks: Block[]): ShortSource {
  const hit = memo.get(blocks);
  if (hit) return hit;
  const units: Unit[] = [];
  const pieces: { s: string; tight: boolean; links: number }[] = [];
  const placed: Block[] = [];
  const links: Link[] = [];
  let words = 0;
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === "article") {
        walk(b.blocks);
        continue;
      }
      if (b.t === "h") {
        const text = b.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        units.push({ kind: "h", block: b, plain: text, words: 0 });
        pieces.push({ s: "#".repeat(Math.min(4, Math.max(2, b.level))) + " " + text, tight: false, links: links.length });
      } else if (keepWhole(b)) {
        units.push({ kind: "b", block: b, plain: "", words: 0 });
        pieces.push({ s: `[[B${placed.push(b) - 1}]]`, tight: false, links: links.length });
      } else if (b.t === "p" || b.t === "quote") {
        const { md, plain } = inline(b.content, links);
        if (!plain) continue;
        const n = wordCount(plain);
        units.push({ kind: "p", block: b, plain, words: n });
        pieces.push({ s: (b.t === "quote" ? "> " : "") + md, tight: false, links: links.length });
        words += n;
      } else if (b.t === "ul" || b.t === "ol") {
        let first = true;
        for (const [i, it] of b.items.entries()) {
          const { md, plain } = inline(it, links);
          if (!plain) continue;
          const n = wordCount(plain);
          units.push({ kind: "p", block: b, plain, words: n });
          pieces.push({ s: (b.t === "ol" ? `${i + 1}. ` : "- ") + md, tight: !first, links: links.length });
          words += n;
          first = false;
        }
      }
    }
  };
  walk(blocks);
  let text = "";
  let sentUnits = 0;
  for (const [i, p] of pieces.entries()) {
    const next = (i ? (p.tight ? "\n" : "\n\n") : "") + p.s;
    if (i && text.length + next.length > MAX_CHARS) break;
    text += next;
    sentUnits = i + 1;
  }
  const long = units.filter((u) => u.kind === "p" && u.words >= LONG);
  const fp = (long.length ? long : units.filter((u) => u.kind === "p")).map((u) => hash(normWords(u.plain)));
  const src: ShortSource = {
    text,
    units,
    blocks: placed,
    links,
    words,
    fp,
    dfp: units.map((u) => (counts(u) ? hash(normText(u.plain)) : -1)),
    partial: sentUnits < units.length,
    sentUnits,
    sentBlocks: units.slice(0, sentUnits).filter((u) => u.kind === "b").length,
    sentLinks: sentUnits ? pieces[sentUnits - 1].links : 0,
  };
  memo.set(blocks, src);
  return src;
}

export function shortMeta(src: ShortSource): ShortMeta {
  const sent = src.dfp.slice(0, src.sentUnits).flatMap((h, i) => (h >= 0 ? [i] : []));
  const dfp = sent.map((i) => src.dfp[i]);
  const dplain = sent.map((i) => src.units[i].plain);
  return { keys: src.blocks.map((b) => b.key), links: src.links, fp: src.fp, dfp, dplain, words: src.words, sentLinks: src.sentLinks, partial: src.partial };
}

/** Prose parts of the article that count (sent ones) that a Short version made from `meta` does not cover: new or changed since. */
function freshUnits(meta: ShortMeta, src: ShortSource): Set<number> {
  const had = new Set(meta.dfp);
  const out = new Set<number>();
  for (let i = 0; i < src.sentUnits; i++) if (src.dfp[i] >= 0 && !had.has(src.dfp[i])) out.add(i);
  return out;
}

/** Whether the article's paragraphs that count changed since a Short version was made from `meta`: new, edited, or gone. */
export function proseChanged(meta: ShortMeta, src: ShortSource): boolean {
  if (freshUnits(meta, src).size) return true;
  const now = new Set(src.dfp.slice(0, src.sentUnits));
  return meta.dfp.some((h) => !now.has(h));
}

/**
 * Whether a Short version made from `meta` belongs to this article: most of its
 * longer paragraphs are the same and its length is about the same. A site that
 * reuses an element for the next story fails this, so that story never shows
 * the last one's Short version; a changed time or counter does not.
 */
export function sameArticle(meta: ShortMeta, src: ShortSource): boolean {
  if (!meta.fp.length || !src.fp.length) return false;
  const have = new Set(src.fp);
  let both = 0;
  for (const h of new Set(meta.fp)) if (have.has(h)) both++;
  return both / Math.max(new Set(meta.fp).size, have.size) >= 0.7 && Math.abs(src.words - meta.words) <= meta.words * 0.3;
}

// ---------- putting it back together ----------

export type Seg = { md: string } | { block: Block };

export interface ShortPlan {
  segs: Seg[];
  /** Links the model dropped with their sentence, listed after the short text. */
  extra: Link[];
  /** The link each [words](Ln) of the short text means now (see linkNow). */
  links: Link[];
}

/**
 * The link a Short version's [words](Ln) means now. The page may have
 * re-rendered the article since (new elements, same text): the link with the
 * same words and address in the current extraction carries a live ref.
 */
function linkNow(meta: ShortMeta, src: ShortSource, i: number): Link | undefined {
  const old = meta.links[i];
  if (!old) return undefined;
  const same = (l: Link | undefined) => !!l && l.a === old.a && (l.href ?? "") === (old.href ?? "");
  if (same(src.links[i])) return src.links[i];
  return src.links.find(same) ?? old;
}

/** Words for matching: longer words, and pairs of characters in scripts written without spaces. */
function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(w)) {
      for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
    } else if (w.length >= 3) out.add(w);
  }
  return out;
}

const mdPlain = (md: string) =>
  md.replace(/\[([^[\]]*)\]\(\s*#?L\d+\s*\)/g, "$1").replace(/^\s*(?:[-*•>]|\d+[.)])\s+/gm, "").replace(/[*_`]/g, "");

/** Every link address inside a block (to leave out of the extra list what is already shown). */
function hrefsIn(v: unknown, out: Set<string>) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) hrefsIn(x, out);
    return;
  }
  for (const [k, x] of Object.entries(v)) {
    if (k === "href" && typeof x === "string") out.add(x);
    else if (typeof x === "object") hrefsIn(x, out);
  }
}

const FOOTNOTE = /^\W*(\d+|[a-z]|note \d+|ref)\W*$/i;

/** Whether the words a Short version puts on a link say what the page's own words for it say: the same, or a longer word or two words in common. */
function sameWords(words: string, a: string): boolean {
  const x = normText(mdPlain(words));
  if (x === normText(a)) return true;
  const want = tokens(x);
  const have = tokens(a);
  let both = 0;
  for (const w of want) {
    if (!have.has(w)) continue;
    if (w.length >= 4) return true;
    both++;
  }
  return both >= 2 || (both > 0 && both === want.size);
}

const dice = (a: Set<string>, b: Set<string>) => {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return (2 * both) / ((a.size + b.size) || 1);
};

/** Numbers in a text, without their separators ("1,204" and "1204" are one). */
const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));

/**
 * Whether a sentence of a Short version made from `meta` is about a paragraph
 * that changed since: one gone from the article that a fresh paragraph, with
 * most of its words, replaces (a new number, a corrected name). A sentence
 * that states a number such a paragraph had and the article no longer has
 * is too ("The storm killed 12" after "The death toll rose to 12" became 31).
 * Null when no paragraph changed so. `about` holds the words of the changed
 * paragraphs, old and new: the rest of a dropped sentence is about others.
 */
function staleAbout(meta: ShortMeta, src: ShortSource, fresh: Set<number>): { test: (sentence: string) => boolean; about: Set<string> } | null {
  const old = meta.dplain;
  if (!fresh.size || !old || old.length !== meta.dfp.length) return null;
  const now = new Set(src.dfp.slice(0, src.sentUnits));
  const freshTokens = [...fresh].map((i) => tokens(src.units[i].plain));
  const oldTokens = old.map(tokens);
  const changed = new Set<number>();
  meta.dfp.forEach((h, j) => {
    if (!now.has(h) && oldTokens[j].size >= 2 && freshTokens.some((t) => dice(oldTokens[j], t) >= 0.5)) changed.add(j);
  });
  if (!changed.size) return null;
  const have = new Set(src.units.slice(0, src.sentUnits).flatMap((u) => numbers(u.plain)));
  const gone = new Set([...changed].flatMap((j) => numbers(old[j])).filter((n) => !have.has(n)));
  // The old paragraph a sentence shares the most words with, as for placing text (planShort).
  const index = new Map<string, number[]>();
  oldTokens.forEach((ts, j) => {
    for (const w of ts) {
      const at = index.get(w);
      if (at) at.push(j);
      else index.set(w, [j]);
    }
  });
  const common = Math.max(8, old.length / 10);
  const about = new Set([...changed].flatMap((j) => [...oldTokens[j]]).concat(freshTokens.flatMap((t) => [...t])));
  const test = (sentence: string) => {
    if (gone.size && numbers(mdPlain(sentence)).some((n) => gone.has(n))) return true;
    const want = tokens(mdPlain(sentence));
    if (want.size < 2) return false;
    const both = new Map<number, number>();
    for (const w of want) {
      const at = index.get(w);
      if (!at || at.length > common) continue;
      for (const j of at) both.set(j, (both.get(j) ?? 0) + 1);
    }
    let best = -1;
    let score = 0;
    for (const [j, n] of both) if (n >= 2 && n / want.size > score) [best, score] = [j, n / want.size];
    return score >= 0.2 && changed.has(best);
  };
  return { test, about };
}

/** A line split into sentences, never inside a link's words. */
function sentences(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (!depth && /[.!?。！？]/.test(c)) {
      let j = i + 1;
      while (j < line.length && /[”’"»)]/.test(line[j])) j++;
      if (j < line.length && !/\s/.test(line[j]) && !/[。！？]/.test(c)) continue;
      out.push(line.slice(start, j).trim());
      start = j;
      i = j - 1;
    }
  }
  out.push(line.slice(start).trim());
  return out.filter(Boolean);
}

/** Markdown without the sentences `drop` picks; "" when none is left. A list item keeps its marker. */
function withoutSentences(md: string, drop: (sentence: string) => boolean): string {
  const lines: string[] = [];
  for (const line of md.split("\n")) {
    const mark = /^\s*(?:[-*•>]|\d+[.)])\s+/.exec(line)?.[0] ?? "";
    const all = sentences(line.slice(mark.length));
    const kept = all.filter((s) => !drop(s));
    if (kept.length === all.length) lines.push(line);
    else if (kept.length) lines.push(mark + kept.join(" "));
  }
  return lines.join("\n").trim();
}

/** Words a reader reads in a block of text (a heading, a paragraph, a quote, a list); other blocks count as none. */
function blockWords(b: Block): number {
  if (b.t === "h") return wordCount(b.text);
  if (b.t === "p" || b.t === "quote") return wordCount(textOf(b.content));
  if (b.t === "ul" || b.t === "ol") return b.items.reduce((n, it) => n + wordCount(textOf(it)), 0);
  return 0;
}

/** The Short version as shown, put back parts included, must save at least a quarter of the words, or the full text shows. */
const MAX_SHOWN = 0.75;

/**
 * Puts the model's short text and the article's own blocks together: each
 * placeholder becomes its block, the source's headings stay and no others,
 * and a placeholder or heading the model dropped goes back where it was.
 * Null when the result is not much shorter than the full text.
 */
export function planShort(out: string, meta: ShortMeta, src: ShortSource): ShortPlan | null {
  // Where each block of this article is now, by key: the page may have
  // re-rendered since, so a placeholder number is looked up by its block's key.
  const byKey = new Map<string, number[]>();
  src.units.forEach((u, i) => {
    if (u.kind === "b") byKey.set(u.block.key, [...(byKey.get(u.block.key) ?? []), i]);
  });
  const used = new Set<number>();
  type S = { md: string; pos?: number } | { unit: number; pos: number };
  const segs: S[] = [];
  let md: string[] = [];
  const flush = () => {
    const s = md.join("\n").trim();
    if (s) segs.push({ md: s });
    md = [];
  };
  const place = (i: number) => {
    used.add(i);
    segs.push({ unit: i, pos: i });
  };
  const headingAt = (text: string): number => {
    const n = normWords(text.replace(/[*_`]/g, ""));
    if (!n) return -1;
    const want = tokens(n);
    let best = -1;
    let score = 0;
    src.units.forEach((u, i) => {
      if (u.kind !== "h" || used.has(i)) return;
      const m = normWords(u.plain);
      let s = m === n ? 1 : 0;
      if (!s) {
        const have = tokens(m);
        let both = 0;
        for (const w of want) if (have.has(w)) both++;
        s = (2 * both) / ((want.size + have.size) || 1);
      }
      if (s > score) [best, score] = [i, s];
    });
    return score >= 0.75 ? best : -1;
  };
  for (const raw of out.replace(/\r/g, "").split("\n")) {
    const parts = raw.split(/(\[\[\s*B\d+\s*\]\])/);
    for (const part of parts) {
      const ph = /^\[\[\s*B(\d+)\s*\]\]$/.exec(part);
      if (ph) {
        flush();
        const key = meta.keys[Number(ph[1])];
        const at = key === undefined ? undefined : byKey.get(key)?.find((i) => !used.has(i));
        if (at !== undefined) place(at);
        continue;
      }
      const atx = parts.length === 1 ? /^\s*#{1,6}\s+(.+?)\s*#*\s*$/.exec(part) : null;
      const h = atx ?? (parts.length === 1 ? /^\s*\*\*([^*]{2,80})\*\*:?\s*$/.exec(part) : null);
      if (h) {
        // Only the page's own headings: one the model made up is dropped. A
        // whole sentence in bold (a warning, a link) is no heading: its text
        // stays, as a paragraph of its own. So does a bold line of five words
        // or more, or with a comma or colon inside ("Do not pay the fee twice").
        const at = headingAt(h[1]);
        const said = h[1].trim();
        const sentence = !atx && (wordCount(said) >= 5 || /[,;:，；：、]./.test(said));
        if (at < 0 && (/\]\(\s*#?L\d+\s*\)/.test(h[1]) || /[.!。！]$/.test(said) || sentence)) {
          flush();
          md.push(h[1].trim());
          flush();
          continue;
        }
        flush();
        if (at >= 0) place(at);
        continue;
      }
      if (!part.trim()) {
        // A blank line ends a paragraph or list; a placeholder split the line otherwise.
        if (parts.length === 1) flush();
        continue;
      }
      md.push(part);
    }
  }
  flush();

  // A paragraph that changed since the Short version was asked for is shown in
  // full (below) until the new Short version is whole, or for good once the
  // page changed too often. The model's sentences about its old text go, so
  // the Short version never states both the old value and the new one.
  const fresh = freshUnits(meta, src);
  const stale = staleAbout(meta, src, fresh);
  // A dropped sentence may also state facts of paragraphs that did not change
  // ("The storm killed 12 and left 5,000 homeless"): such a paragraph goes back
  // in full too, unless the rest of the Short version still says what it held.
  const restore = new Set<number>();
  if (stale) {
    const prose = src.units.slice(0, src.sentUnits).map((u, i) => (u.kind === "p" && !fresh.has(i) ? tokens(u.plain) : null));
    const df = new Map<string, number>();
    for (const ts of prose) if (ts) for (const w of ts) df.set(w, (df.get(w) ?? 0) + 1);
    const rare = Math.max(2, prose.length / 4);
    const also: { i: number; words: string[]; nums: string[] }[] = [];
    const drop = (sentence: string) => {
      if (!stale.test(sentence)) return false;
      const plain = mdPlain(sentence);
      const rest = [...tokens(plain)].filter((w) => !stale.about.has(w) && (df.get(w) ?? 0) <= rare);
      const nums = numbers(plain);
      prose.forEach((ts, i) => {
        if (!ts) return;
        const words = rest.filter((w) => ts.has(w));
        if (words.length < 2) return;
        const own = new Set(numbers(src.units[i].plain));
        also.push({ i, words, nums: nums.filter((n) => own.has(n)) });
      });
      return true;
    };
    for (let k = segs.length - 1; k >= 0; k--) {
      const s = segs[k];
      if (!("md" in s)) continue;
      const kept = withoutSentences(s.md, drop);
      if (kept) s.md = kept;
      else segs.splice(k, 1);
    }
    const left = segs.map((s) => ("md" in s ? mdPlain(s.md) : "")).join(" ");
    const leftWords = tokens(left);
    const leftNums = new Set(numbers(left));
    for (const { i, words, nums } of also) {
      if (words.filter((w) => !leftWords.has(w)).length >= 2 || nums.some((n) => !leftNums.has(n))) restore.add(i);
    }
  }

  // Where each piece of short text came from: the source paragraph it shares
  // the most words with. Words found in many paragraphs say little about where.
  const index = new Map<string, number[]>();
  src.units.forEach((u, i) => {
    if (u.kind !== "p") return;
    for (const w of tokens(u.plain)) {
      const at = index.get(w);
      if (at) at.push(i);
      else index.set(w, [i]);
    }
  });
  const common = Math.max(8, src.units.length / 10);
  for (const s of segs) {
    if (!("md" in s)) continue;
    const want = tokens(mdPlain(s.md));
    if (want.size < 2) continue;
    const both = new Map<number, number>();
    for (const w of want) {
      const at = index.get(w);
      if (!at || at.length > common) continue;
      for (const i of at) both.set(i, (both.get(i) ?? 0) + 1);
    }
    let best = -1;
    let score = 0;
    for (const [i, n] of both) if (n >= 2 && n / want.size > score) [best, score] = [i, n / want.size];
    if (score >= 0.2) s.pos = best;
  }

  // What the model dropped goes back: each block and heading of the part that
  // was sent goes between the kept blocks and headings around it, before the
  // first piece of text there that comes after it in the source. A summary
  // line that matched the wrong paragraph moves nothing past those anchors.
  // So does, in full, a paragraph that is new or changed since the Short
  // version was asked for (it is asked for again; until then nothing is hidden),
  // and one whose facts left with a sentence about a changed one.
  const freshBlocks = new Set<Block>();
  for (let i = 0; i < src.sentUnits; i++) {
    const u = src.units[i];
    if (used.has(i)) continue;
    if (u.kind === "p") {
      // A list item stands for its whole list: shown once.
      if ((!fresh.has(i) && !restore.has(i)) || freshBlocks.has(u.block)) continue;
      freshBlocks.add(u.block);
    }
    let lo = 0;
    segs.forEach((s, k) => {
      if ("unit" in s && s.pos < i) lo = k + 1;
    });
    let hi = segs.findIndex((s, k) => k >= lo && "unit" in s && s.pos > i);
    if (hi < 0) hi = segs.length;
    let at = segs.findIndex((s, k) => k >= lo && k < hi && "md" in s && s.pos !== undefined && s.pos > i);
    if (at < 0) at = hi;
    segs.splice(at, 0, { unit: i, pos: i });
    used.add(i);
  }

  // A heading with nothing under it (its text was cut) is dropped.
  const level = (s: S) => ("unit" in s && src.units[s.unit].kind === "h" ? (src.units[s.unit].block as Extract<Block, { t: "h" }>).level : 0);
  for (let i = segs.length - 1; i >= 0; i--) {
    const l = level(segs[i]);
    if (!l) continue;
    const next = segs[i + 1];
    if (!next || (level(next) && level(next) <= l)) segs.splice(i, 1);
  }

  // Links that left with their sentence, unless the short version shows them anyway.
  const links = meta.links.map((_, i) => linkNow(meta, src, i)!);
  // A link id the model put on other words than the page's would do what its
  // words do not say: those words stay without the link, which is listed below.
  const kept = new Set<number>();
  for (const s of segs) {
    if (!("md" in s)) continue;
    s.md = s.md.replace(/\[([^[\]]+)\]\(\s*#?L(\d+)\s*\)/g, (all, words: string, n: string) => {
      const l = links[Number(n)];
      if (l && !sameWords(words, l.a)) return words;
      kept.add(Number(n));
      return all;
    });
  }
  const shown = new Set<string>();
  for (const i of kept) if (links[i]?.href) shown.add(links[i].href!);
  for (const s of segs) if ("unit" in s) hrefsIn(src.units[s.unit].block, shown);
  const distinct = new Set(meta.links.map((l) => l.href ?? l.a));
  const extra: Link[] = [];
  // A text full of links (an encyclopedia) keeps them in the full text; a list of them all would be noise.
  if (distinct.size <= 30) {
    const seen = new Set<string>();
    for (let i = 0; i < meta.sentLinks && extra.length < 12; i++) {
      const l = links[i];
      if (!l || kept.has(i) || FOOTNOTE.test(l.a) || l.a.length < 2) continue;
      // A hashtag or a post's photo link ("#LaLiga", "pic.twitter.com/…") says nothing on its own.
      if (/^#\S/.test(l.a.trim()) || /^(https?:\/\/)?pic\.(twitter|x)\.com\//i.test(l.a.trim())) continue;
      const id = l.href ?? l.a;
      if (seen.has(id) || (l.href && shown.has(l.href))) continue;
      seen.add(id);
      extra.push(l);
    }
  }
  // Counted as the reader sees both: the part of the article that was sent, in
  // full and in short. A block kept whole (references, a link list) reads the
  // same in both, so it counts in neither: a long reference list would
  // otherwise hide that the prose was cut by half (Wikipedia).
  const sentBlocks = new Set(src.units.slice(0, src.sentUnits).filter((u) => u.kind !== "b").map((u) => u.block));
  let full = 0;
  for (const b of sentBlocks) full += blockWords(b);
  let read = 0;
  for (const s of segs) read += "md" in s ? wordCount(mdPlain(s.md)) : src.units[s.unit].kind === "b" ? 0 : blockWords(src.units[s.unit].block);
  if (full && read > full * MAX_SHOWN) return null;
  return {
    segs: segs.map((s) => ("md" in s ? { md: s.md } : { block: src.units[s.unit].block })),
    extra,
    links,
  };
}

/** Words of prose in a short text or its source, without placeholders and link ids. */
export function proseOf(md: string): string {
  return mdPlain(md.replace(/\[\[\s*B\d+\s*\]\]/g, " ")).replace(/^#+\s+/gm, "");
}
