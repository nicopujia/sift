// Text helpers for model calls: which language to ask for per list entry, a
// token estimate that works across scripts, and splitting long text in parts.

export interface Detection {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

// ---------- scripts ----------

const SCRIPTS: [string, RegExp][] = [
  ["latin", /\p{Script=Latin}/gu],
  ["cyrillic", /\p{Script=Cyrillic}/gu],
  ["greek", /\p{Script=Greek}/gu],
  ["arabic", /\p{Script=Arabic}/gu],
  ["hebrew", /\p{Script=Hebrew}/gu],
  ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ["hangul", /\p{Script=Hangul}/gu],
  ["thai", /\p{Script=Thai}/gu],
  ["devanagari", /\p{Script=Devanagari}/gu],
  ["bengali", /\p{Script=Bengali}/gu],
  ["tamil", /\p{Script=Tamil}/gu],
  ["telugu", /\p{Script=Telugu}/gu],
  ["kannada", /\p{Script=Kannada}/gu],
  ["malayalam", /\p{Script=Malayalam}/gu],
  ["gujarati", /\p{Script=Gujarati}/gu],
  ["gurmukhi", /\p{Script=Gurmukhi}/gu],
  ["sinhala", /\p{Script=Sinhala}/gu],
  ["khmer", /\p{Script=Khmer}/gu],
  ["lao", /\p{Script=Lao}/gu],
  ["myanmar", /\p{Script=Myanmar}/gu],
  ["georgian", /\p{Script=Georgian}/gu],
  ["armenian", /\p{Script=Armenian}/gu],
  ["ethiopic", /\p{Script=Ethiopic}/gu],
];

const LANG_SCRIPT: Record<string, string> = {
  ru: "cyrillic", uk: "cyrillic", bg: "cyrillic", sr: "cyrillic", mk: "cyrillic", be: "cyrillic", kk: "cyrillic", ky: "cyrillic", mn: "cyrillic", tg: "cyrillic",
  el: "greek",
  ar: "arabic", fa: "arabic", ur: "arabic", ps: "arabic", ug: "arabic", sd: "arabic",
  he: "hebrew", iw: "hebrew", yi: "hebrew",
  zh: "cjk", ja: "cjk",
  ko: "hangul",
  th: "thai",
  hi: "devanagari", mr: "devanagari", ne: "devanagari", sa: "devanagari",
  bn: "bengali", as: "bengali",
  ta: "tamil", te: "telugu", kn: "kannada", ml: "malayalam", gu: "gujarati", pa: "gurmukhi", si: "sinhala",
  km: "khmer", lo: "lao", my: "myanmar", ka: "georgian", hy: "armenian", am: "ethiopic", ti: "ethiopic",
};

/** Scripts written by one main language. */
const SCRIPT_LANG: Record<string, string> = {
  greek: "el", hebrew: "he", hangul: "ko", thai: "th", bengali: "bn", tamil: "ta", telugu: "te", kannada: "kn", malayalam: "ml",
  gujarati: "gu", gurmukhi: "pa", sinhala: "si", khmer: "km", lao: "lo", myanmar: "my", georgian: "ka", armenian: "hy",
};

/** The script most letters of the text are written in, or "" when it has no letters. */
export function scriptOf(text: string): string {
  let best = "";
  let max = 0;
  for (const [name, re] of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    if (n > max) [best, max] = [name, n];
  }
  return best;
}

const scriptOfLang = (lang: string) => LANG_SCRIPT[lang] ?? "latin";

/** The script a language is written in ("latin" for most). */
export const langScript = (lang: string) => scriptOfLang(base(lang));

/**
 * Whether a line is written in `script`: most of its letters for Latin, a fair
 * share for other scripts (a Japanese line keeps Latin brand names). True for
 * a line with no letters or when the script is unknown.
 */
export function scriptFits(text: string, script: string): boolean {
  if (!script) return true;
  let all = 0;
  let mine = 0;
  for (const [name, re] of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    all += n;
    if (name === script) mine += n;
  }
  return !all || mine / all >= (script === "latin" ? 0.5 : 0.3);
}

// ---------- per-entry language ----------

// Frequent short words per language. Language detection on a short title is
// often wrong ("Make the softest GLUTEN FREE bread" comes back as German), so a
// title switches away from the page's language only when it also uses several
// words that belong to the other language and not to the page's.
const FUNCTION_WORDS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries({
    en: "the a an and or of to in on at for with without from by is are was were be been has have had do does this that these it its you your my our we he she they his her their how why what when who not no new into about after over under out up more than all can will just vs",
    es: "el la los las un una unos unas y o a de del al en con por para que es son fue se su sus como más pero sin sobre entre hasta desde cuando qué cómo muy ya lo le les nos este esta no tras ante",
    pt: "o a os as um uma uns umas e ou de do da dos das no na nos nas em com por para que é são foi se seu sua como mais mas sem sobre entre até quando não muito já pelo pela ao à após",
    fr: "le la les un une des et ou de du au aux en dans avec par pour que qui est sont était se son sa ses comme plus mais sans sur entre quand ne pas ce cette il elle après",
    de: "der die das den dem des ein eine einen einem und oder von zu im in mit für auf ist sind war sich sein ihre wie mehr aber ohne über nicht auch nach bei aus vom zum zur",
    it: "il lo la i gli le un una e o di del della dei delle in con per che è sono era si suo sua come più ma senza su tra quando non anche nel nella al alla dopo",
    nl: "de het een en of van in op met voor dat die is zijn was zich als meer maar zonder over niet ook naar bij uit dit deze",
    ca: "el la els les un una i o de del al en amb per que és són va es seu seva com més però sense sobre entre fins quan no molt ja als pel",
    gl: "o a os as un unha e ou de do da dos das no na nos nas en con por para que é son foi se seu súa como máis pero sen sobre entre ata cando non moi xa polo pola ao á",
  }).map(([k, v]) => [k, new Set(v.split(" "))]),
);

const base = (lang: string) => (lang || "").toLowerCase().split(/[-_]/)[0];

/**
 * The language to ask for when rewriting one list entry. The page's language,
 * unless the entry is clearly in another one: another script, or a reliable
 * detection backed by that language's common words. "" means unknown: the
 * model keeps the entry's own language.
 *
 * `output`: checking a line the model wrote instead. Chrome calls nearly every
 * line of a few words unreliable, so the top guess counts when it is at least
 * half sure; the common-words rule still has to agree, and a guess of a
 * language without a word list (Luxembourgish, Frisian) counts as unknown.
 * A wrong drop only keeps the original title.
 */
export async function entryLang(text: string, pageLang: string, detect: (t: string) => Promise<Detection | null>, output = false): Promise<string> {
  const page = base(pageLang);
  const lower = text.toLowerCase();
  let found = "";
  let pct = 0;
  const r = await detect(lower).catch(() => null);
  if (r) {
    const best = [...r.languages].sort((a, b) => b.percentage - a.percentage)[0];
    if (best?.language && best.language !== "und" && (r.isReliable || (output && best.percentage >= 50))) [found, pct] = [base(best.language), best.percentage];
    if (output && !r.isReliable && found && !FUNCTION_WORDS[found] && scriptOfLang(found) === "latin") found = "";
  }
  if (!page) return found;
  const script = scriptOf(text);
  if (!script || found === page) return page;
  if (script !== scriptOfLang(page)) {
    // A Japanese title on an English page: keep the title's language.
    if (found && scriptOfLang(found) === script) return found;
    return SCRIPT_LANG[script] ?? "";
  }
  if (!found) return page;
  const words = lower.match(/\p{L}+/gu) ?? [];
  const theirs = FUNCTION_WORDS[found];
  if (!theirs || words.length < 3) return page;
  const ours = FUNCTION_WORDS[page] ?? new Set<string>();
  const uniq = new Set(words);
  let them = 0;
  let us = 0;
  for (const w of uniq) {
    if (theirs.has(w) && !ours.has(w)) them++;
    else if (ours.has(w) && !theirs.has(w)) us++;
  }
  // Two distinct function words of the other language, more than the page's own.
  // One is not enough: names carry them ("King Von", "Die Antwoord").
  if (them >= 2 && them > us) return found;
  void pct;
  return page;
}

/**
 * The language a list's lines are written in: the page's, unless its titles,
 * read together, are clearly in another one (a site that marks Spanish pages
 * lang="en"): a reliable detection backed by that language's common words or
 * script, as for one entry. One language for the whole list, never per title.
 * "" when neither the page's language nor the titles' is known.
 */
export async function listLang(titles: string[], pageLang: string, detect: (t: string) => Promise<Detection | null>): Promise<string> {
  const text = titles.join("\n");
  if (!text.trim()) return base(pageLang);
  return entryLang(text, pageLang, detect);
}

// ---------- quotes ----------

/** A quoted span: “…”, „…“, «…», 「…」, 『…』 or "…" (the words are the first group that matched). */
const QUOTED = /“([^“”\n]+)”|„([^„“”\n]+)[“”]|«([^«»\n]+)»|「([^「」\n]+)」|『([^『』\n]+)』|(?<![\p{L}\p{N}])"(?=\S)([^"\n]+?)(?<=\S)"(?![\p{L}\p{N}])/gu;
/** Text whose links, if any, are whole: a quote that starts or ends inside a link is left alone. */
const WHOLE_LINKS = /^(?:[^[\]]|\[[^[\]]*\]\(\s*#?L\d+\s*\))*$/;
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const unlink = (md: string) => md.replace(/\[([^[\]]*)\]\(\s*#?L\d+\s*\)/g, "$1");
const qwords = (s: string) => unlink(s).toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];

function quotesIn(md: string): { at: number; len: number; inner: string }[] {
  return [...md.matchAll(QUOTED)].map((m) => ({ at: m.index!, len: m[0].length, inner: m.slice(1).find((x) => x !== undefined)! }));
}

/** Longer words, and pairs of characters in scripts written without spaces: what two quotes share. */
function qtokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of qwords(s)) {
    if (SPACELESS.test(w)) for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
    else if (w.length >= 3) out.add(w);
  }
  return out;
}

/** Words that say "not": a quote that has one and a source quote that lacks it say opposite things. */
const NEGATION = /(?:^|[^\p{L}])(?:not|no|never|nothing|none|nobody|nunca|nada|nadie|ni|jamás|jamas|não|nao|nem|ninguém|ne|pas|jamais|rien|nicht|kein|keine|keinen|nie|niemals|nichts|non|mai|niente|nessuno|niet|geen|nooit|niets|ningú)(?![\p{L}])|n['’]t(?![\p{L}])/iu;
/** Words common to any sentence ("the", "for", "este"): two quotes on one topic share them, so they say nothing about which quote is which. */
const COMMON = new Set([...Object.values(FUNCTION_WORDS).flatMap((s) => [...s])].filter((w) => !NEGATION.test(w)));

/** A quote's distinctive words (qtokens without the common ones). */
const ctokens = (s: string) => new Set([...qtokens(s)].filter((w) => !COMMON.has(w)));

/** Whether a quote's words stand in the source as they are, piece by piece (a cut at punctuation or "…" is fine) and in order. */
function verbatim(inner: string, words: string, tight: string): boolean {
  let from = 0;
  let fromTight = 0;
  for (const piece of unlink(inner).split(/\.\.\.|…|[.!?;:,—–()¿¡。、，！？]/)) {
    const w = qwords(piece);
    if (!w.length) continue;
    if (SPACELESS.test(piece)) {
      const i = tight.indexOf(w.join(""), fromTight);
      if (i < 0) return false;
      fromTight = i + w.join("").length;
    } else {
      const i = words.indexOf(" " + w.join(" ") + " ", from);
      if (i < 0) return false;
      from = i + w.join(" ").length + 1;
    }
  }
  return true;
}

/**
 * A rewrite's quotes say what the source says, word for word. A quote the
 * model changed only a little is put back as the source has it (that quote,
 * or one sentence of it); any other loses its quotation marks, so the rewrite
 * never presents its own words as someone's. Another quote on the same topic
 * (another speaker's, often) is never swapped in: the source quote must share
 * most of the model's distinctive words, agree on "not", and clearly beat
 * every other source quote. Short quotes (a name, a title, a scare quote)
 * stay as they are.
 */
export function keepQuotes(out: string, source: string): string {
  const mine = quotesIn(out);
  if (!mine.length) return out;
  const all = qwords(source);
  const words = " " + all.join(" ") + " ";
  const tight = all.join("");
  const theirs = quotesIn(source).flatMap((q, n) => {
    // A long quote is also offered one sentence at a time, so a quote the model cut is not given back whole.
    const parts = q.inner.split(/(?<=[.!?。！？])\s+/).filter((s) => qwords(s).length);
    return (parts.length > 1 ? [q.inner, ...parts] : [q.inner]).map((text) => ({ text, n }));
  });
  let res = "";
  let last = 0;
  for (const q of mine) {
    const w = qwords(q.inner);
    const small = SPACELESS.test(q.inner) ? w.join("").length < 4 : w.length < 3;
    if (small || !WHOLE_LINKS.test(q.inner) || verbatim(q.inner, words, tight)) continue;
    const want = ctokens(q.inner);
    const neg = NEGATION.test(q.inner);
    let best = { text: "", n: -1 };
    let score = 0;
    let recall = 0;
    // The best score of a quote other than the best one (its own sentences do not count).
    let other = 0;
    const scores = theirs.map((t) => {
      const have = ctokens(t.text);
      let both = 0;
      for (const x of want) if (have.has(x)) both++;
      const s = NEGATION.test(t.text) !== neg ? 0 : (2 * both) / ((want.size + have.size) || 1);
      if (s > score) [best, score, recall] = [t, s, both / (want.size || 1)];
      return s;
    });
    for (const [i, t] of theirs.entries()) if (t.n !== best.n && t.text.trim() !== best.text.trim()) other = Math.max(other, scores[i]);
    const span = out.slice(q.at, q.at + q.len);
    // The source's words, ending as the model's quote did ("…," he said).
    const kept = best.text.trim().replace(/[\s,;:]+$/, "");
    const tail = /[.!?…]$/.test(kept) ? "" : (/[,.!?;:…]+$/.exec(q.inner.trim())?.[0] ?? "");
    const same = score >= 0.5 && recall >= 0.7 && score - other >= 0.15;
    res += out.slice(last, q.at) + (same ? span[0] + kept + tail + span[span.length - 1] : q.inner.trim());
    last = q.at + q.len;
  }
  return res + out.slice(last);
}

// ---------- token estimates ----------

/**
 * Tokens a text takes, roughly and on the high side. Latin text runs about 4
 * characters per token; Cyrillic, Greek, Arabic, and Hebrew about 2.5; Chinese,
 * Japanese, Korean, and Thai about 1; Indic and other scripts often more than 1
 * token per character (Tamil measured 0.9 characters per token).
 */
/** Tokens one character takes, roughly (a fraction for most scripts). */
function charWeight(c: number): number {
  if (c < 0x250 || (c >= 0x1e00 && c <= 0x206f)) return 0.25; // Latin, punctuation
  if (c < 0x900) return 0.4; // Greek, Cyrillic, Armenian, Hebrew, Arabic
  if ((c >= 0x3040 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0x0e00 && c <= 0x0e7f)) return 1;
  return 1.2;
}

/** Tokens a text takes, unrounded. */
function weight(text: string): number {
  let n = 0;
  for (const ch of text) n += charWeight(ch.codePointAt(0)!);
  return n;
}

export function estTokens(text: string): number {
  return Math.ceil(weight(text) - 1e-6);
}

/**
 * Splits text at line breaks into parts of about equal size, each at most
 * `maxTokens`. A line longer than that is cut at a sentence end or a space.
 */
export function splitText(text: string, maxTokens: number): string[] {
  const total = estTokens(text);
  if (total <= maxTokens) return [text];
  const target = total / Math.ceil(total / maxTokens);
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    let rest = line;
    while (estTokens(rest) > maxTokens) {
      // Cut where the estimate reaches the target, at the last sentence end or space before it.
      // Add up fractional weights; rounding each character up would cut far too early.
      let cut = 0;
      let t = 0;
      for (const ch of rest) {
        if (t >= target) break;
        t += charWeight(ch.codePointAt(0)!);
        cut += ch.length;
      }
      const head = rest.slice(0, cut);
      const at = Math.max(head.lastIndexOf(". "), head.lastIndexOf("。"), head.lastIndexOf("। "));
      const end = at > cut / 2 ? at + 1 : head.lastIndexOf(" ") > cut / 2 ? head.lastIndexOf(" ") : cut;
      lines.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    lines.push(rest);
  }
  const parts: string[] = [];
  let cur: string[] = [];
  let curTokens = 0;
  const sizes: number[] = [];
  for (const line of lines) {
    // Fractional weights, rounded only per part: rounding each short line up
    // (a bullet, a line of code) made far more parts than planned.
    const t = weight(line) + 0.25;
    if (cur.length && curTokens + t > Math.min(maxTokens, target * 1.05)) {
      parts.push(cur.join("\n"));
      sizes.push(curTokens);
      cur = [];
      curTokens = 0;
    }
    cur.push(line);
    curTokens += t;
  }
  if (cur.length) {
    // A small last part goes with the one before it when both still fit: one model call fewer.
    if (parts.length && curTokens < target * 0.25 && sizes[sizes.length - 1] + curTokens <= maxTokens) parts[parts.length - 1] += "\n" + cur.join("\n");
    else parts.push(cur.join("\n"));
  }
  return parts;
}
