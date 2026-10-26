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

/** Fewest titles that can move a list away from its page's language. */
const LIST_SAMPLE = 4;
/** Share of titles, each read alone, that must be clearly in another language for the list to be in it. */
const LIST_OTHER = 0.8;

/**
 * The language a list's lines are written in: the page's, unless nearly all
 * its titles are clearly in another one (a site that marks Spanish pages
 * lang="en"): read together, and each alone, a reliable detection backed by
 * that language's common words or script, as for one entry. A few titles, or
 * a mixed list (English songs on a Spanish YouTube page), keep the page's
 * language. One language for the whole list, never per title. "" when neither
 * the page's language nor the titles' is known.
 */
export async function listLang(titles: string[], pageLang: string, detect: (t: string) => Promise<Detection | null>): Promise<string> {
  const page = base(pageLang);
  const text = titles.join("\n");
  if (!text.trim()) return page;
  const all = await entryLang(text, pageLang, detect);
  if (!page || !all || all === page) return all;
  if (titles.length < LIST_SAMPLE) return page;
  const each = await Promise.all(titles.map((t) => entryLang(t, pageLang, detect)));
  return each.filter((l) => l === all).length >= titles.length * LIST_OTHER ? all : page;
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
 * every other source quote. A short quote (a name, a title, a scare quote)
 * stays only when the source has its words as they are: a word or two the
 * source never says ("fraudulentas" for "fraude") loses its marks.
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
    if (!WHOLE_LINKS.test(q.inner) || verbatim(q.inner, words, tight)) continue;
    if (small) {
      res += out.slice(last, q.at) + q.inner.trim();
      last = q.at + q.len;
      continue;
    }
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

// ---------- facts the source does not state ----------

/** Number words a source may use for a number a rewrite writes in digits ("dos muertos", "2 muertos"). */
const NUMBER_WORDS = new Map<string, string>();
for (const list of [
  "zero one two three four five six seven eight nine ten eleven twelve",
  "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce",
  "zero um dois três quatro cinco seis sete oito nove dez onze doze",
  "zéro un deux trois quatre cinq six sept huit neuf dix onze douze",
  "null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf",
  "zero uno due tre quattro cinque sei sette otto nove dieci undici dodici",
  "zeroth first second third fourth fifth sixth seventh eighth ninth tenth",
  "_ primero segundo tercero cuarto quinto sexto séptimo octavo noveno décimo",
  "_ primera segunda tercera cuarta quinta sexta séptima octava novena décima",
])
  list.split(" ").forEach((w, i) => w !== "_" && NUMBER_WORDS.set(w, String(i)));
for (const [w, n] of Object.entries({ un: "1", una: "1", uma: "1", une: "1", ein: "1", eine: "1", duas: "2", primer: "1", tercer: "3", dozen: "12", docena: "12", veinte: "20", twenty: "20", treinta: "30", thirty: "30", cien: "100", hundred: "100", mil: "1000", thousand: "1000" }))
  NUMBER_WORDS.set(w, n);

/** Numbers in a text, without separators and leading zeros ("1,204", "1.204" and "1204" are one). Placeholders and link ids are not numbers of the text. */
function numbersOf(s: string): string[] {
  const text = unlink(s.replace(/\[\[\s*B\d+\s*\]\]/g, " "));
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, "").replace(/^0+(?=\d)/, "")).filter((n) => n !== "0");
}

/** The numbers a source states, in digits or (small ones) in words. */
function sourceNumbers(source: string): Set<string> {
  const out = new Set(numbersOf(source));
  for (const w of source.toLowerCase().match(/\p{L}+/gu) ?? []) {
    const n = NUMBER_WORDS.get(w);
    if (n) out.add(n);
  }
  return out;
}

/** Capitalized words that may name a speaker. */
const NAMEISH = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]*\p{L}/gu;
/** Capitalized words that open a sentence without naming anyone. */
const STARTERS = new Set("según segun tras para ante desde durante after before during while when despite according said says dijo dice afirma aseguró asegura sostuvo explicó".split(" "));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether the person a rewrite gives a quote to is named near that quote in
 * the source: the name closest to the quote in the rewrite's sentence. True
 * when the rewrite names no one there, or the quote cannot be placed.
 */
function speakerNear(out: string, q: { at: number; len: number; inner: string }, source: string): boolean {
  if (SPACELESS.test(q.inner)) return true;
  const qw = qwords(q.inner).slice(0, 4);
  if (!qw.length) return true;
  const src = source.normalize("NFKC");
  const found = new RegExp(qw.map(escapeRe).join("[^\\p{L}\\p{N}]+"), "iu").exec(src);
  if (!found) return true;
  const window = src.slice(Math.max(0, found.index - 300), found.index + found[0].length + 300);
  // The rewrite's sentence around the quote.
  const start = Math.max(0, out.slice(0, q.at).search(/[^.!?。！？]*$/));
  const endRel = out.slice(q.at + q.len).search(/[.!?。！？](?:\s|$)/);
  const end = endRel < 0 ? out.length : q.at + q.len + endRel;
  let best = "";
  let dist = Infinity;
  for (const m of out.slice(start, end).matchAll(NAMEISH)) {
    const at = start + m.index!;
    if (at >= q.at && at < q.at + q.len) continue;
    const w = m[0];
    if (COMMON.has(w.toLowerCase()) || STARTERS.has(w.toLowerCase()) || w.length < 3) continue;
    const d = at < q.at ? q.at - (at + w.length) : at - (q.at + q.len);
    if (d < dist) [best, dist] = [w, d];
  }
  if (!best) return true;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(best)}(?![\\p{L}\\p{N}])`, "iu").test(window);
}

/**
 * What a rewrite states that its source does not: "quote" (words in quotation
 * marks the source does not have, even after keepQuotes), "speaker" (a quote
 * given to someone the source does not name near it), "number" (a number the
 * source does not state), or "" when it states none of these.
 */
export function unsupported(raw: string, source: string): string {
  const fixed = keepQuotes(raw, source);
  const quotes = quotesIn(fixed);
  if (quotes.length < quotesIn(raw).length) return "quote";
  for (const q of quotes) if (!speakerNear(fixed, q, source)) return "speaker";
  const have = sourceNumbers(source);
  if (numbersOf(fixed).some((n) => !have.has(n))) return "number";
  return "";
}

/** Words a "." follows inside a sentence: titles before a name ("Mr. Lopez", "Dr. Ruiz"), or before a number ("No. 10"). */
const NO_END = new Set(
  "Mr Mrs Ms Mx Dr Dra Drs Prof Profa St Sr Sra Srta Sres Jr Gen Gov Sen Rep Lt Col Capt Sgt Cmdr Adm Rev Hon Pres Supt Mt Ft Mme Mlle Mgr Hr Lic Ing Av Avda Ud Uds Vd Vds Dña vs cf approx aprox vgl bzw ca No no Nos Nr nr núm Núm pág págs pp Fig fig Vol vol Art art Ch ch Sec sec Jan Feb Aug Sep Sept Oct Nov Dec ene abr ago dic".split(" "),
);

/** A line split into sentences, never inside a link's words, nor after an initial or an abbreviation. */
function sentencesOf(line: string): string[] {
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
      if (c === "." && j === i + 1) {
        const w = /\p{L}+$/u.exec(line.slice(start, i))?.[0] ?? "";
        if (w.length === 1 || NO_END.has(w)) continue;
      }
      out.push(line.slice(start, j).trim());
      start = j;
      i = j - 1;
    }
  }
  out.push(line.slice(start).trim());
  return out.filter(Boolean);
}

/**
 * A Short version without the sentences that state a quote, a speaker, or a
 * number its source does not (see unsupported). Headings and [[B…]] lines stay;
 * a list item keeps its marker; a line left with no sentence goes.
 */
export function dropUnsupported(md: string, source: string): string {
  const lines: string[] = [];
  for (const line of md.split("\n")) {
    if (/^\s*#{1,6}\s/.test(line) || /^\s*\[\[\s*B\d+\s*\]\]\s*$/.test(line) || !line.trim()) {
      lines.push(line);
      continue;
    }
    const mark = /^\s*(?:[-*•>]|\d+[.)])\s+/.exec(line)?.[0] ?? "";
    const all = sentencesOf(line.slice(mark.length));
    const kept = all.filter((s) => !unsupported(s, source));
    if (kept.length === all.length) lines.push(line);
    else if (kept.length) lines.push(mark + kept.join(" "));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A paragraph in which the model talks about its task instead of the page: "El texto fuente contiene…", "Here is the shorter version". */
const PREAMBLE =
  /texto (?:fuente|de origen)|(?:the )?source text|versi[oó]n (?:solicitada|pedida)|requested (?:version|rewrite|length)|\[\[B[…*.]|\bmantendré\b|\bI(?:'ll| will) (?:keep|rewrite|shorten)\b|^\s*(?:here is|here's|aquí (?:está|tienes|va)) (?:the|a|an|la|el|una?) /iu;

/** A Short version without a note of the model's own before or after the text. */
export function stripPreamble(md: string): string {
  const paras = md.split(/\n\s*\n/);
  const meta = (p: string | undefined) => !!p && !/^\s*(?:#|\[\[\s*B\d+\s*\]\]\s*$)/.test(p) && PREAMBLE.test(p);
  while (paras.length > 1 && meta(paras[0])) paras.shift();
  while (paras.length > 1 && meta(paras[paras.length - 1])) paras.pop();
  return paras.join("\n\n");
}

// ---------- cache keys ----------

/**
 * A short part that ticks: a clock time, "12h ago", "hace 3 horas", a view,
 * comment, or reading-time count. It changes between visits and says nothing
 * about what the text is.
 */
const TICK =
  /\d{1,2}(?::|h)\d{2}(?!\d)|(?<!\p{L})(?:ago|just now|geleden|temu|назад)(?!\p{L})|(?<!\p{L})hace\s+(?:\d|un[oa]?s?\s|pocos?\s)|\d+\s*['’]?\s*(?:s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|segundos?|minutos?|horas?|d[ií]as?|secondes?|heures?|jours?|sekunden|minuten|stunden|tage|secondi|minuti|ore|giorni)(?!\p{L})|\d[\d.,]*\s*[kmb]?\s+(?:\p{L}+\s+){0,2}(?:views?|viewers?|watching|likes?|comments?|shares?|reads?|vistas?|visitas?|viendo|reproducciones|visualizaciones|comentarios?|vues|commentaires?|aufrufe|kommentare|visualizzazioni|commenti)(?!\p{L})/iu;

const fewWords = (s: string, n: number) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length <= n;

/** An entry's context for its cache key: without the parts that tick ("12h ago", "1,2 M views"), so a revisit finds the same line. */
export function stableContext(c: string): string {
  return c
    .split(" · ")
    .filter((p) => !(fewWords(p, 6) && TICK.test(p)))
    .join(" · ");
}

/**
 * An article's text for its cache key: without short lines that carry no
 * prose or tick (a share button's "Compartir", a comment count, "12' minutos
 * de lectura"), so a revisit of the same article finds its Short version.
 * Headings, placeholders, and lines with links stay: the saved text refers to them by number.
 */
export function stableText(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      if (!l) return false;
      if (/^#|\[\[\s*B\d+\s*\]\]|\]\(\s*#?L\d+\s*\)/.test(l)) return true;
      if (fewWords(l, 2)) return false;
      return !(fewWords(l, 8) && TICK.test(l));
    })
    .join("\n");
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

// ---------- teasers ----------

/**
 * A headline cut off right where its answer would be: "We weighed all angles
 * and the answer is …", "And the winner is…", "El motivo…". A trailing "…"
 * after a full statement (a tabloid habit) does not count.
 */
const HELD_BACK =
  /(?<![\p{L}\p{N}])(?:is|are|was|were|it['’]s|es|son|fue|era|será|é|são|foi|est|sont|ist|sind|è|sono|answer|reason|verdict|result|winner|secret|truth|respuesta|motivo|razón|veredicto|resultado|ganador|secreto|verdad|resposta|razão|segredo)\s*:?\s*["'‘“«]?\s*(?:…|\.{3})\s*["'’”»]?\s*$/iu;

const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/**
 * A headline that holds back its answer, with no sentence in its context that
 * could give it (only labels: a section, a time, "comments"). The model can only
 * guess the answer or say it is missing, and both are false: its own words stay.
 */
export function heldBack(title: string, context = ""): boolean {
  return HELD_BACK.test(title.trim()) && context.split(" · ").every((p) => wordCount(p) <= 5);
}

/** A line that says the story leaves something out: "does not give the answer", "remains unanswered", "no se indica". */
const NO_ANSWER = new RegExp(
  [
    // English
    String.raw`\b(?:does|do|did|is|are|was|were|has|have|had|will|would|can|could)(?:n['’]t|\s+not)\s+(?:yet\s+)?(?:say|said|state|stated|give|given|reveal|revealed|specify|specified|explain|explained|disclose|disclosed|answer|answered|provide|provided|mention|mentioned|tell|told|indicate|indicated|clarify|clarified|known|clear|confirm|confirmed)\b`,
    String.raw`\bwithout\s+(?:saying|giving|revealing|stating|specifying|explaining|disclosing|answering|providing|an answer|the answer)\b`,
    String.raw`\b(?:remains?|remained|left|stays?|still|is|are|was|were|goes|went)\s+(?:largely\s+|still\s+)?(?:unanswered|unknown|unclear|unexplained|unresolved|unstated|unspecified|undisclosed|unsaid|a mystery|an open question)\b`,
    String.raw`\b(?:no|not an?)\s+(?:answer|verdict|conclusion)\b|\bnot\s+(?:given|stated|revealed|specified|disclosed)\b`,
    String.raw`\b(?:withholds?|withheld|withholding|holds?\s+back|held\s+back|keeps?\s+back)\b`,
    // Spanish
    String.raw`\bno\s+(?:se\s+)?(?:indica|dice|sabe|aclara|precisa|especifica|revela|detalla|explica|informa|menciona|conoce|responde)\b`,
    String.raw`\bno\s+(?:da|ofrece)\s+(?:la\s+|una\s+)?respuesta\b|\bno\s+(?:está|queda)\s+claro\b|\bse\s+desconoce\b|\bincógnita\b`,
    String.raw`\bsin\s+(?:indicar|decir|aclarar|precisar|especificar|revelar|detallar|explicar|responder|respuesta|dar\s+(?:la\s+)?respuesta)\b`,
    String.raw`\b(?:sigue|siguen|queda|quedan|permanece|permanecen)\s+(?:sin\s+(?:respuesta|resolver|aclarar)|en\s+(?:duda|el\s+aire)|un\s+misterio)\b`,
    // Portuguese
    String.raw`\bnão\s+(?:se\s+)?(?:diz|indica|informa|revela|explica|especifica|esclarece|sabe|responde|detalha)\b|\bnão\s+está\s+claro\b|\bdesconhece-se\b`,
    String.raw`\bsem\s+(?:dizer|indicar|revelar|explicar|especificar|esclarecer|resposta)\b`,
    // French, German, Italian
    String.raw`\bne\s+(?:dit|précise|révèle|indique|explique|donne)\s+pas\b|\bsans\s+(?:dire|préciser|révéler|répondre|réponse)\b|\breste\s+(?:sans\s+réponse|inconnu|flou|un\s+mystère)\b`,
    String.raw`\b(?:sagt|nennt|verrät|erklärt|beantwortet)\s+(?:\S+\s+)?nicht\b|\bbleibt\s+(?:offen|unklar|unbeantwortet|ein\s+Rätsel)\b`,
    String.raw`\bnon\s+(?:dice|indica|rivela|precisa|spiega|risponde)\b|\bresta\s+(?:senza\s+risposta|un\s+mistero|da\s+chiarire)\b`,
  ].join("|"),
  "giu",
);

/** Words in a title or context that say something is not known or not said, so a line may say it too. */
const ABSENCE = /\b(?:unknown|unclear|unanswered|unexplained|myster|refus|declin|won['’]t|no comment|desconoc|desconhec|misterio|mistério|incógnita|unklar|unbekannt|inconnu|ignoto)/giu;

const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

/**
 * A line that claims the story does not give something, more often than its
 * title and context say so (a title's own "I don't give a damn" does not cover
 * an added "does not give the answer"): the model saw only those, not the story,
 * so the claim is a guess, and usually false, since the story gives the answer
 * its teaser holds back.
 */
export function claimsNoAnswer(line: string, source: string): boolean {
  // A word of absence in the source covers a line that uses it too ("unknown"
  // for "unknown"); one about something else ("refuse" to tip) covers nothing.
  const low = line.toLowerCase();
  const covered = (source.match(ABSENCE) ?? []).filter((w) => low.includes(w.toLowerCase())).length;
  return count(NO_ANSWER, line) > count(NO_ANSWER, source) + covered;
}
