// Text helpers for model calls: which language to ask for per list entry, a
// token estimate that works across scripts, and splitting long text in parts.

import { onlyTicks } from "../shared/ticks";

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
 * a line with no letters or when the script is unknown. With `source` (the
 * title it rewrites), letters of a third script fail it: neither `script`,
 * nor Latin (names, brands), nor one the title uses ("Vector در برابر Thanos"
 * for "Vector VS Thanos" on an English page, F1062).
 */
export function scriptFits(text: string, script: string, source?: string): boolean {
  if (!script) return true;
  let all = 0;
  let mine = 0;
  let third = 0;
  for (const [name, re] of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    all += n;
    if (name === script) mine += n;
    else if (source !== undefined && n && name !== "latin" && !source.match(re)) third += n;
  }
  return !all || (third < 2 && mine / all >= (script === "latin" ? 0.5 : 0.3));
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
  const reliable = !!r?.isReliable;
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
  const ours = FUNCTION_WORDS[page] ?? new Set<string>();
  // A written line reliably in a language of the page's script that has no word
  // list (Indonesian, Malay, Tagalog on a Spanish page) is in that language,
  // unless it uses two of the page's common words: Chrome calls a few English
  // or Spanish lines "reliably" Danish or Esperanto (F1122). Not for a page
  // without a word list, nor for a sibling of the page's language.
  if (!theirs && output && reliable && words.length >= 3 && FUNCTION_WORDS[page] && scriptOfLang(found) === script && !SIBLINGS.some((g) => g.includes(found) && g.includes(page)))
    return new Set(words.filter((w) => ours.has(w))).size >= 2 ? page : found;
  if (!theirs || words.length < 3) return page;
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
 * Languages a detection mixes up with each other: Serbian in Latin letters
 * reads as Bosnian, Malay as Indonesian. The last pair only with the page's.
 */
const SIBLINGS = [["sr", "hr", "bs", "sh", "cnr"], ["no", "nb", "nn", "da"], ["ms", "id"], ["gl", "pt"]];

/**
 * The language an article's text is in, to write its Short version in (F1114):
 * as for one entry (see entryLang), but a long text that a reliable detection
 * reads as another language is in that one, word list or not (a Polish
 * article on a page marked lang="en"). When the detection may have mixed it up
 * with a close one (Serbian and Bosnian), "": no language is named, and the
 * model keeps the text's own.
 */
export async function proseLang(text: string, pageLang: string, detect: (t: string) => Promise<Detection | null>): Promise<string> {
  const want = await entryLang(text, pageLang, detect);
  const r = await detect(text.toLowerCase()).catch(() => null);
  const best = r?.isReliable ? [...r.languages].sort((a, b) => b.percentage - a.percentage)[0] : undefined;
  const found = best?.language && best.language !== "und" ? base(best.language) : "";
  const lang = found || want;
  // Serbian in Latin letters: asked for in "Serbian", it would be checked as Cyrillic.
  const script = scriptOf(text);
  if (!lang || (script && langScript(lang) !== script)) return "";
  const page = base(pageLang);
  if (lang === page) return lang;
  const group = SIBLINGS.find((g) => g.includes(lang));
  return group && (group.includes(page) || group !== SIBLINGS[SIBLINGS.length - 1]) ? "" : lang;
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

/** A text without its quoted spans: what a quote says keeps its speaker's words and language. */
export const unquoted = (s: string) => s.replace(QUOTED, " ");

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

/** Words for 0-19, the tens, and ordinals, per language: a source may write in words a number a rewrite writes in digits ("dos muertos", "2 muertos"). */
const NUMBER_WORDS = new Map<string, number>();
for (const list of [
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen",
  "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete dieciocho diecinueve",
  "zero um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze dezesseis dezessete dezoito dezenove",
  "zéro un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize",
  "null eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn",
  "zero uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove",
  "zeroth first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth",
  "_ primero segundo tercero cuarto quinto sexto séptimo octavo noveno décimo undécimo duodécimo",
  "_ primera segunda tercera cuarta quinta sexta séptima octava novena décima",
])
  list.split(" ").forEach((w, i) => w !== "_" && NUMBER_WORDS.set(w, i));
for (const [w, n] of Object.entries({ un: 1, una: 1, uma: 1, une: 1, ein: 1, eine: 1, duas: 2, primer: 1, tercer: 3, dieciseis: 16, dozen: 12, docena: 12, veintiún: 21, veintiun: 21, veintidós: 22, veintitrés: 23, veintiséis: 26 }))
  NUMBER_WORDS.set(w, n);
/** The tens, 20 to 90, in English, Spanish, Portuguese, French, German, Italian, then ordinals. */
const TENS: [number, string][] = [
  [20, "twenty veinte vinte vingt zwanzig venti twentieth vigésimo"],
  [30, "thirty treinta trinta trente dreißig dreissig trenta thirtieth trigésimo"],
  [40, "forty cuarenta quarenta quarante vierzig quaranta fortieth"],
  [50, "fifty cincuenta cinquenta cinquante fünfzig cinquanta fiftieth"],
  [60, "sixty sesenta sessenta soixante sechzig sessanta sixtieth"],
  [70, "seventy setenta setenta _ siebzig settanta seventieth"],
  [80, "eighty ochenta oitenta _ achtzig ottanta eightieth"],
  [90, "ninety noventa noventa _ neunzig novanta ninetieth"],
];
for (const [n, words] of TENS) for (const w of words.split(" ")) if (w !== "_") NUMBER_WORDS.set(w, n);
// One-word compounds: "veinticinco", "venticinque", "fünfundzwanzig".
for (const [u, es, it, de] of [[1, "uno", "uno", "ein"], [2, "dos", "due", "zwei"], [3, "tres", "tre", "drei"], [4, "cuatro", "quattro", "vier"], [5, "cinco", "cinque", "fünf"], [6, "seis", "sei", "sechs"], [7, "siete", "sette", "sieben"], [8, "ocho", "otto", "acht"], [9, "nueve", "nove", "neun"]] as [number, string, string, string][]) {
  NUMBER_WORDS.set("veinti" + es, 20 + u);
  for (const [n, words] of TENS) {
    const ten = words.split(" ");
    const itTen = ten[5].replace(/[ai]$/, u === 1 || u === 8 ? "" : "$&");
    NUMBER_WORDS.set(itTen + it, n + u);
    NUMBER_WORDS.set(de + "und" + ten[4], n + u);
  }
}
/** Words that multiply the number before them ("1.5 million", "dos millones", "$54k"); "mil millones" is a thousand million. */
const SCALES: Record<string, number> = {
  hundred: 100, cien: 100, ciento: 100, cento: 100, cem: 100, cent: 100, hundert: 100,
  thousand: 1e3, mil: 1e3, mille: 1e3, mila: 1e3, tausend: 1e3, k: 1e3,
  million: 1e6, millions: 1e6, millón: 1e6, millones: 1e6, millon: 1e6, milhão: 1e6, milhões: 1e6, milione: 1e6, milioni: 1e6, millionen: 1e6, mio: 1e6, m: 1e6, mn: 1e6, mln: 1e6,
  billion: 1e9, billions: 1e9, bn: 1e9, b: 1e9, milliard: 1e9, milliards: 1e9, miliardo: 1e9, miliardi: 1e9, milliarde: 1e9, milliarden: 1e9, bilhão: 1e9, bilhões: 1e9, mrd: 1e9,
  trillion: 1e12, billón: 1e12, billones: 1e12, tn: 1e12,
};
/** Shares a source writes in words, as the percent a rewrite may give ("nearly a third", "33 %"). */
const SHARES: Record<string, number[]> = { half: [50], mitad: [50], metade: [50], moitié: [50], hälfte: [50], metà: [50], third: [33], tercio: [33], quarter: [25], "two thirds": [66, 67], "dos tercios": [66, 67], "three quarters": [75], "tres cuartos": [75], "tres cuartas": [75] };
const AND = new Set(["y", "e", "et", "and", "und"]);

/** A number as a set key: integers as they are, others to six decimals. */
const numKey = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * The values a number in digits may stand for: "1.500,00" and "1,500" are
 * 1500, "40.00" is 40, "1.5" is 1.5 (and 1500, where "." groups thousands),
 * "40 000" is 40000, "9:30" and "9.30" are one clock time, "70s" is also 1970.
 */
function digitValues(tok: string, suffix: string): string[] {
  const out = new Set<string>();
  const add = (n: number) => Number.isFinite(n) && out.add(numKey(n));
  const clock = /^(\d{1,2})[:.](\d{2})$/.exec(tok);
  if (clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 && (tok.includes(":") || /^\s*(?:[ap]\.?m\b|h\b|hs\b|horas?\b|hrs?\b)/i.test(suffix))) out.add(`t${Number(clock[1])}:${clock[2]}`);
  if (tok.includes(":")) {
    for (const p of tok.split(":")) add(Number(p));
    return [...out];
  }
  const groups = tok.split(/[.,\s   ]/);
  const seps = tok.match(/[.,\s   ]/g) ?? [];
  const tail3 = (gs: string[]) => gs.slice(1).every((g) => g.length === 3);
  let any = false;
  // Every separator groups thousands.
  if (groups.length > 1 && tail3(groups) && new Set(seps).size === 1) [any] = [true, add(Number(groups.join("")))];
  // The last one is a decimal point ("1.500,00", "40.00", "1,5"), any before it group thousands.
  if (groups.length > 1 && /[.,]/.test(seps[seps.length - 1]) && tail3(groups.slice(0, -1))) [any] = [true, add(Number(groups.slice(0, -1).join("") + "." + groups[groups.length - 1]))];
  if (groups.length === 1) [any] = [true, add(Number(tok))];
  // Groups set apart by spaces may also be numbers of their own ("3 100-page reports").
  if (seps.some((c) => /\s/.test(c))) for (const g of groups) add(Number(g));
  // Neither ("1.2.3", a version): each part, and all its digits.
  if (!any) {
    for (const g of groups) add(Number(g));
    add(Number(groups.join("")));
  }
  // A decade: "70s", "'80s" is also 1970, 1980.
  if (groups.length === 1 && /^['’]?s\b/.test(suffix) && Number(tok) % 10 === 0 && Number(tok) < 100) [1900, 2000].forEach((c) => add(c + Number(tok)));
  // A scale after it: "1.5 million", "$54k", "2 mil millones".
  const sc = /^\s?(\p{L}+)(?:\s+(millones|millions))?(?!\p{L})/u.exec(suffix);
  const scale = sc && SCALES[sc[1].toLowerCase()];
  if (scale) for (const v of [...out]) if (!v.startsWith("t")) add(Number(v) * scale * (sc[2] ? 1e6 : 1));
  return [...out];
}

/** Numbers in digits in a text, each with the values it may stand for. Placeholders and link ids are not numbers of the text. */
function numbersOf(s: string): string[][] {
  const text = unlink(s.replace(/\[\[\s*B\d+\s*\]\]/g, " "));
  const out: string[][] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d.,])\d{1,3}(?:[    ]\d{3})+(?![\d.,]\d)|\d+(?:[.,:]\d+)*/gu)) {
    const vals = digitValues(m[0], text.slice(m.index! + m[0].length, m.index! + m[0].length + 24)).filter((v) => v !== "0");
    if (vals.length) out.push(vals);
  }
  return out;
}

/** Number words in a text: "sixteen", "twenty-five", "treinta y dos", "dos millones", "a third". */
function wordNumbers(text: string): number[] {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const pair = words[i] + " " + (words[i + 1] ?? "");
    for (const p of SHARES[pair] ?? SHARES[words[i]] ?? []) out.push(p);
    let n = NUMBER_WORDS.get(words[i]);
    if (n === undefined) {
      // A scale word alone: "a million", "thousands".
      const s = SCALES[words[i]];
      if (s && s >= 100 && words[i].length > 2) out.push(s);
      continue;
    }
    let j = i + 1;
    // "twenty-five", "treinta y dos", "vingt et un".
    if (n >= 20 && n % 10 === 0) {
      const u = NUMBER_WORDS.get(words[j] ?? "");
      const u2 = AND.has(words[j] ?? "") ? NUMBER_WORDS.get(words[j + 1] ?? "") : undefined;
      if (u !== undefined && u > 0 && u < 10) [n, j] = [n + u, j + 1];
      else if (u2 !== undefined && u2 > 0 && u2 < 10) [n, j] = [n + u2, j + 2];
    }
    out.push(n);
    // "two hundred", "tres mil", "dos mil millones".
    for (let s = SCALES[words[j] ?? ""]; s && words[j].length > 2; s = SCALES[words[++j] ?? ""]) out.push((n *= s));
  }
  return out;
}

/**
 * Units a rewrite may convert a source's amount to, by kind (and system) and
 * size in a base unit: "a day" is 24 hours, "one year" 12 months, "5 km" 3.1
 * miles. Within a kind and system only whole results count (8 months is not
 * "34.8 weeks"); across systems only the usual partner, rounded (see PARTNER).
 */
const UNITS = new Map<string, [string, number]>();
for (const [kind, size, words] of [
  ["t", 1, "second seconds sec secs segundo segundos seconde secondes sekunde sekunden secondo secondi"],
  ["t", 60, "minute minutes min mins minuto minutos minuten minuti"],
  ["t", 3600, "hour hours hr hrs h hora horas heure heures stunde stunden ora ore"],
  ["t", 86400, "day days día días dia dias jour jours tag tage tagen giorno giorni"],
  ["t", 604800, "week weeks semana semanas semaine semaines woche wochen settimana settimane"],
  ["t", 1209600, "fortnight fortnights quincena quincenas"],
  ["t", 2628000, "month months mes meses mois monat monate monaten mese mesi"],
  ["t", 31536000, "year years yr yrs año años ano anos année années jahr jahre jahren anno anni"],
  ["t", 315360000, "decade decades década décadas décennie décennies jahrzehnt jahrzehnte decennio decenni"],
  ["t", 3153600000, "century centuries siglo siglos século séculos siècle siècles jahrhundert jahrhunderte secolo secoli"],
  ["l", 0.001, "mm millimetre millimetres millimeter millimeters milímetro milímetros"],
  ["l", 0.01, "cm centimetre centimetres centimeter centimeters centímetro centímetros"],
  ["L", 0.0254, "inch inches pulgada pulgadas"],
  ["L", 0.3048, "foot feet ft"],
  ["L", 0.9144, "yard yards yd yds"],
  ["l", 1, "metre metres meter meters metro metros mètre mètres"],
  ["l", 1000, "km kms kilometre kilometres kilometer kilometers kilómetro kilómetros kilomètre kilomètres kilometro kilometri kph kmh"],
  ["L", 1609.344, "mile miles mi milla millas miglio miglia meile meilen mph"],
  ["m", 1, "g gram grams gramme grammes gramo gramos"],
  ["M", 28.3495, "ounce ounces oz onza onzas"],
  ["M", 453.592, "pound pounds lb lbs libra libras"],
  ["m", 1000, "kg kgs kilo kilos kilogram kilograms kilogramme kilogrammes kilogramo kilogramos"],
  ["m", 1e6, "tonne tonnes tonelada toneladas"],
  ["v", 0.001, "ml millilitre millilitres milliliter milliliters mililitro mililitros"],
  ["v", 1, "l litre litres liter liters litro litros"],
  ["V", 3.78541, "gallon gallons galón galones"],
] as [string, number, string][])
  for (const w of words.split(" ")) UNITS.set(w, [kind, size]);
/** The unit of the other system a rewrite converts to, by size: km and miles, m and feet, cm and inches, kg and pounds, g and ounces, litres and gallons. */
const PARTNER = new Map<string, number>([["l1000", 1609.344], ["L1609.344", 1000], ["l1", 0.3048], ["L0.3048", 1], ["L0.9144", 1], ["l0.01", 0.0254], ["L0.0254", 0.01], ["m1000", 453.592], ["M453.592", 1000], ["m1", 28.3495], ["M28.3495", 1], ["v1", 3.78541], ["V3.78541", 1]]);
/** Unit abbreviations that are words too ("h", "mi", "l"): a unit only after digits. */
const UNIT_ABBR = /^(?:s|sec|secs|min|mins|hr|hrs|h|yr|yrs|mm|cm|ft|yd|yds|km|kms|kph|kmh|mi|mph|g|oz|lb|lbs|kg|kgs|ml|l)$/;
/** Words that make one of the unit after them: "in a day", "per hour", "al año", "cada semana". */
const ONE_OF = new Set("a an one per each every un una uno um uma al por cada ein eine einen einem einer pro par".split(" "));
/** Words that give one of a unit on their own: "daily", "anual". */
const PER_UNIT: Record<string, string> = { daily: "day", diario: "day", diaria: "day", diarios: "day", diarias: "day", diariamente: "day", quotidien: "day", täglich: "day", hourly: "hour", weekly: "week", semanal: "week", semanales: "week", hebdomadaire: "week", wöchentlich: "week", settimanale: "week", monthly: "month", mensual: "month", mensuales: "month", mensuel: "month", monatlich: "month", mensile: "month", yearly: "year", annual: "year", annually: "year", anual: "year", anuales: "year", anualmente: "year", annuel: "year", jährlich: "year", annuale: "year" };
/** Parts of one ("half a day", "medio millón", "a quarter of an hour"). */
const PARTS: Record<string, number> = { half: 0.5, medio: 0.5, media: 0.5, meio: 0.5, quarter: 0.25, cuarto: 0.25 };
/** "nine in ten", "one out of five", "tres de cada cuatro": a share, as a percent. */
const RATIO_WORDS = new Set("in of out every de cada em sur su von auf".split(" "));
/** "doubled", "se triplicó": the times, and the percent of rise and of the old amount. */
const TIMES: [RegExp, number][] = [
  [/^(?:doubl\w*|twice|duplic\w*|dupliqu\w*|dobl\w*|dobr\w*|verdoppel\w*|raddoppi\w*)$/, 2],
  [/^(?:tripl\w*|thrice|verdreifach\w*)$/, 3],
  [/^(?:quadrupl\w*|cuadruplic\w*|quadruplic\w*|vervierfach\w*)$/, 4],
];
/** Noon and midnight, as the clock times a rewrite may give ("12 pm", "00:00"). */
const CLOCK_WORDS: Record<string, string[]> = {
  noon: ["12", "t12:00"], midday: ["12", "t12:00"], mediodía: ["12", "t12:00"], midi: ["12", "t12:00"], mittag: ["12", "t12:00"], mezzogiorno: ["12", "t12:00"],
  midnight: ["12", "24", "t0:00", "t12:00"], medianoche: ["12", "24", "t0:00", "t12:00"], minuit: ["12", "24", "t0:00", "t12:00"], mitternacht: ["12", "24", "t0:00", "t12:00"], mezzanotte: ["12", "24", "t0:00", "t12:00"],
};

/**
 * Numbers a rewrite may give for a source's own in another form: its amounts
 * in another unit ("a day" 24 hours, "one year old" 12 months, "5 km" 3.1
 * miles), its shares as a percent ("nine in ten" 90, "tres de cada cuatro"
 * 75), its rises ("doubled" 100%), a part of a scale ("half a million"), and
 * noon or midnight as a clock time.
 */
function convertedNumbers(source: string): string[] {
  const out: string[] = [];
  /** n, rounded and to one decimal; and down, for a share ("two in three" 66%). */
  const add = (n: number, down = false) => {
    if (!Number.isFinite(n) || n <= 0) return;
    for (const r of [n, Math.round(n), Math.round(n * 10) / 10, down ? Math.floor(n) : 0]) if (r > 0) out.push(numKey(r));
  };
  const toks = [...unlink(source.replace(/\[\[\s*B\d+\s*\]\]/g, " ")).toLowerCase().matchAll(/\d+(?:[.,]\d+)*|\p{L}+/gu)].map((m) => m[0]);
  /** The amount token i states, and the index after it: digits, a number word ("twenty five"), or null. */
  const amount = (i: number): [number[], number] | null => {
    const t = toks[i];
    if (t === undefined) return null;
    if (/^\d/.test(t)) return [digitValues(t, "").filter((v) => !v.startsWith("t")).map(Number), i + 1];
    let n = NUMBER_WORDS.get(t);
    if (n === undefined) return null;
    let j = i + 1;
    const u = NUMBER_WORDS.get(toks[j] ?? "");
    if (n >= 20 && n % 10 === 0 && u !== undefined && u > 0 && u < 10) [n, j] = [n + u, j + 1];
    return [[n], j];
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    for (const c of CLOCK_WORDS[t] ?? []) out.push(c);
    for (const [re, x] of TIMES) if (re.test(t)) [x, (x - 1) * 100, x * 100].forEach((n) => add(n));
    if (t === "halved") add(50);
    // "half a million", "medio millón", "a quarter of a million".
    const part = PARTS[t];
    let j = i + 1;
    while (part && (ONE_OF.has(toks[j] ?? "") || /^(?:of|de)$/.test(toks[j] ?? ""))) j++;
    if (part && SCALES[toks[j] ?? ""] >= 1e3 && toks[j].length > 2) add(part * SCALES[toks[j]]);
    // An amount and its unit: "eight hours", "one year old", "5 km", "a day", "half an hour", "daily".
    let vals: number[] = [];
    let at = -1;
    const a = amount(i);
    if (a) [vals, at] = a;
    else if (ONE_OF.has(t)) [vals, at] = [[1], i + 1];
    else if (part) [vals, at] = [[part], j];
    else if (PER_UNIT[t]) [vals, at] = [[1], -1];
    const unitWord = at < 0 ? PER_UNIT[t] : toks[at];
    const unit = unitWord !== undefined ? UNITS.get(unitWord) : undefined;
    if (vals.length && unit && (at < 0 || !UNIT_ABBR.test(unitWord) || /^\d/.test(t))) {
      const [kind, size] = unit;
      const whole = new Set<number>();
      for (const [, [k, s2]] of UNITS) if (k === kind && s2 !== size) whole.add(s2);
      const partner = PARTNER.get(kind + size);
      for (const v of vals) {
        for (const s2 of whole) if (Number.isInteger(Math.round(((v * size) / s2) * 1e6) / 1e6) && (v * size) / s2 >= 1) add((v * size) / s2);
        if (partner) add((v * size) / partner);
      }
    }
    // "nine in ten", "one out of five", "tres de cada cuatro".
    if (a && a[0].length === 1) {
      let k = a[1];
      let n = 0;
      while (n < 2 && RATIO_WORDS.has(toks[k] ?? "")) [k, n] = [k + 1, n + 1];
      const b = n ? amount(k) : null;
      if (b && b[0].length === 1 && b[0][0] > a[0][0] && b[0][0] <= 1000) add((a[0][0] / b[0][0]) * 100, true);
    }
  }
  return out;
}

let lastSource = "";
let lastNumbers = new Set<string>();

/** Counts a source lists together, whose sum a rewrite may give: "3 dead and 14 hurt", "10 muertos, 7 heridos". */
const LISTED = /(?<![\d.,])(\d+)\s+(?:\p{L}+\s+){0,3}?\p{L}+\s*(?:,|;|\s(?:and|y|e|et|und|plus|más|mais))\s+(?:\p{L}+\s+){0,2}?(\d+)(?![\d.,:]?\d)/gu;

/**
 * The numbers a source states: in digits or in words, and the sum of two
 * counts it lists together (see LISTED): 17 victims for "3 dead and 14 hurt".
 */
function sourceNumbers(source: string): Set<string> {
  if (source === lastSource) return lastNumbers;
  const out = new Set<string>();
  for (const vals of numbersOf(source)) for (const v of vals) out.add(v);
  for (const n of wordNumbers(source)) out.add(numKey(n));
  const text = unlink(source.replace(/\[\[\s*B\d+\s*\]\]/g, " "));
  for (const m of text.matchAll(LISTED)) out.add(numKey(Number(m[1]) + Number(m[2])));
  for (const v of convertedNumbers(source)) out.add(v);
  [lastSource, lastNumbers] = [source, out];
  return out;
}

/** Days and months: capitalized, yet never who said something. */
const WHEN = new Set(
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december lunes martes miércoles jueves viernes sábado domingo enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre today yesterday hoy ayer".split(" "),
);
/** Words that stand for a speaker without naming one: "he said", "dijo". */
const PRONOUNS = new Set("he she they it we i you who which él ella ellos ellas nosotros yo usted ele ela eles il elle ils er sie es lui lei loro".split(" "));
/** Roles that name a speaker by job or tie: "the minister said", "según el portavoz". */
const ROLES = new Set(
  "minister president mayor governor spokesman spokeswoman spokesperson official officials police chief director executive ceo secretary senator judge prosecutor lawyer attorney coach manager leader chairman chairwoman chair owner founder analyst analysts expert experts doctor scientist researcher researchers ambassador king queen prince princess pope commander general sources source insiders insider friends friend sister brother mother father wife husband daughter son residents witnesses neighbours neighbors ministro ministra presidente presidenta alcalde alcaldesa gobernador gobernadora portavoz vocero vocera funcionario funcionarios funcionaria policía jefe jefa directora ejecutivo ejecutiva secretario secretaria senador senadora diputado diputada juez jueza fiscal abogado abogada entrenador técnico líder dueño dueña fundador fundadora analista experto experta médico médica embajador embajadora rey reina papa fuentes fuente hermana hermano madre padre esposa esposo hija hijo vecinos testigos vendedor vendedora".split(" "),
);
/** A verb that ties words to a speaker ("said", "dijo", "according to", "según"). */
const SAYS =
  /(?<![\p{L}\p{N}])(?:said|says|say|told|tells|added|adds|wrote|writes|asked|asks|warned|warns|claimed|claims|insisted|insists|argued|argues|stated|states|explained|explains|noted|notes|announced|announces|declared|declares|admitted|admits|recalled|recalls|called|calls|described|describes|replied|replies|responded|responds|tweeted|posted|urged|urges|vowed|vows|promised|promises|accused|accuses|joked|jokes|revealed|reveals|confirmed|confirms|denied|denies|according to|dijo|dijeron|dice|dicen|decía|afirm(?:ó|a|an|aron)|asegur(?:ó|a|an|aron)|declar(?:ó|a|an|aron)|sostuv(?:o|ieron)|sostien(?:e|en)|señal(?:ó|a|an|aron)|expres(?:ó|a|an|aron)|advirti(?:ó|eron)|adviert(?:e|en)|explic(?:ó|a|an|aron)|calific(?:ó|a|an|aron)|manifest(?:ó|a|an|aron)|agreg(?:ó|a|an|aron)|añad(?:ió|e|en|ieron)|indic(?:ó|a|an|aron)|subray(?:ó|a|an|aron)|remarc(?:ó|a|an|aron)|opin(?:ó|a|an|aron)|admit(?:ió|e|en|ieron)|reconoc(?:ió|e|en|ieron)|pregunt(?:ó|a|an|aron)|respond(?:ió|e|en|ieron)|escrib(?:ió|e|en|ieron)|anunci(?:ó|a|an|aron)|denunci(?:ó|a|an|aron)|acus(?:ó|a|an|aron)|insist(?:ió|e|en|ieron)|llam(?:ó|aron)|cont(?:ó|aron)|relat(?:ó|aron)|confes(?:ó|aron)|según|segun|disse|disseram|diz|dizem|afirmou|declarou|segundo|selon|a déclaré|a dit|sagte|sagt|laut|ha detto|secondo)(?![\p{L}\p{N}])/giu;
const TO_SPEAKER = /^(?:according to|según|segun|segundo|selon|laut|secondo)$/i;

/** The words that name a speaker in a stretch of text: capitalized words other than days, months, and common words, and roles. */
function speakerWords(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
    const w = m[0].replace(/['’]s$/, "");
    const low = w.toLowerCase();
    if (ROLES.has(low) || (/^\p{Lu}/u.test(w) && w.length >= 3 && !COMMON.has(low) && !STARTERS.has(low) && !WHEN.has(low) && !PRONOUNS.has(low))) out.push(w);
  }
  return out;
}

/**
 * Who a sentence gives the words at [at, end) to, from a real attribution: a
 * name or role before or after a speech verb ("Trump said", "dijo el ministro
 * Ruiz", "according to the mayor"). [] when it names no one so (a pronoun, no
 * speech verb, a title in quotation marks).
 */
function speakerOf(sentence: string, at: number, end: number): string[] {
  const v = closestSays(sentence, at, end);
  return v ? verbSpeaker(sentence, v, at, end) : [];
}

/** The speech verb nearest the words at [at, end) of a sentence, outside them. */
function closestSays(sentence: string, at: number, end: number): RegExpMatchArray | null {
  let best: { v: RegExpMatchArray; d: number } | null = null;
  for (const v of sentence.matchAll(SAYS)) {
    const vs = v.index!;
    const ve = vs + v[0].length;
    if (ve > at && vs < end) continue;
    const d = ve <= at ? at - ve : vs - end;
    if (!best || d < best.d) best = { v, d };
  }
  return best?.v ?? null;
}

/**
 * Whether a sentence gives the words at [at, end) to a pronoun: "she said",
 * "dijo él", or a verb with no subject ("—…—, dijo."): a person the text
 * named before.
 */
function saidByPronoun(sentence: string, at: number, end: number): boolean {
  const v = closestSays(sentence, at, end);
  if (!v || TO_SPEAKER.test(v[0])) return false;
  const vs = v.index!;
  const ve = vs + v[0].length;
  const subject = (/[^;:“”"«»„]*$/.exec(sentence.slice(ve <= at ? 0 : end, vs))?.[0] ?? "").split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const after = /^[^,;:.!?“”"«»„]*/.exec(sentence.slice(ve))![0].split(/\s+/).filter(Boolean);
  const head = (subject.length ? subject[subject.length - 1] : after[0] ?? "").replace(/[^\p{L}]/gu, "").toLowerCase();
  return PRONOUNS.has(head) || (!subject.length && !speakerWords(after.slice(0, 5).join(" ")).length);
}

/** Who a speech verb in a sentence ties words to (see speakerOf); the words are at [at, end). */
function verbSpeaker(sentence: string, v: RegExpMatchArray, at: number, end: number): string[] {
  const vs = v.index!;
  const ve = vs + v[0].length;
  /** Up to n words after the verb, before punctuation or a quote. */
  const after = (n: number) => /^[^,;:.!?“”"«»„]*/.exec(sentence.slice(ve))![0].split(/\s+/).filter(Boolean).slice(0, n).join(" ");
  if (TO_SPEAKER.test(v[0])) return speakerWords(after(6));
  // The subject: the words just before the verb, back to the quote, a clause mark, or eight words.
  const left = sentence.slice(ve <= at ? 0 : end, vs);
  const subject = (/[^;:“”"«»„]*$/.exec(left)?.[0] ?? "").split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(-8);
  // None: the verb opens its clause ("…”, said Trump", "dijo el ministro Ruiz").
  if (!subject.length) return speakerWords(after(5));
  // The subject's last word names a person or a role ("Trump", "the minister");
  // a pronoun, or a thing ("a memo says", "the video reveals"), names no one.
  const head = subject[subject.length - 1].replace(/['’]s$/, "").replace(/[^\p{L}'’-]/gu, "");
  if (PRONOUNS.has(head.toLowerCase()) || !speakerWords(head).length) return [];
  return speakerWords(subject.join(" "));
}

const wordIn = (w: string, text: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, "iu").test(text);

/**
 * Whether the person a rewrite gives a quote to may have said it: true unless
 * the rewrite names a speaker by a real attribution ("X said", "según X") and
 * the source gives the quote to someone else by name, or (with no such
 * attribution) does not name that person near it. A role ("the minister")
 * passes when the source uses it anywhere. A speaker found in neither text
 * never blocks.
 */
function speakerNear(out: string, q: { at: number; len: number; inner: string }, source: string): boolean {
  if (SPACELESS.test(q.inner)) return true;
  const qw = qwords(q.inner).slice(0, 4);
  if (!qw.length) return true;
  const start = Math.max(0, out.slice(0, q.at).search(/[^.!?。！？]*$/));
  const endRel = out.slice(q.at + q.len).search(/[.!?。！？](?:\s|$)/);
  const end = endRel < 0 ? out.length : q.at + q.len + endRel;
  const who = speakerOf(out.slice(start, end), q.at - start, q.at + q.len - start);
  if (!who.length) return true;
  const src = source.normalize("NFKC");
  const found = new RegExp(qw.map(escapeRe).join("[^\\p{L}\\p{N}]+"), "iu").exec(src);
  if (!found) return true;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // A role ("the minister") the source uses anywhere may be the person it names there.
  const named = who.filter((w) => !ROLES.has(w.toLowerCase()));
  if (!named.length) return who.some((w) => wordIn(w, src));
  // The source's own attribution of that quote, when it has one, must name the same person.
  const sStart = Math.max(0, src.slice(0, found.index).search(/[^.!?。！？\n]*$/));
  const sEndRel = src.slice(found.index + found[0].length).search(/[.!?。！？](?:\s|$)|\n/);
  const sEnd = sEndRel < 0 ? src.length : found.index + found[0].length + sEndRel;
  const theirs = speakerOf(src.slice(sStart, sEnd), found.index - sStart, found.index + found[0].length - sStart);
  if (theirs.some((t) => !ROLES.has(t.toLowerCase()))) return named.some((w) => theirs.some((t) => same(w, t)));
  // A pronoun ("she said"): the nearest person named before it in its
  // paragraph, so no one else may be named after that person and before the
  // quote (F1117). A paragraph that names no one: the person must be named
  // before it in its section (since the heading before it), at any distance,
  // or near it after.
  const after = found.index + found[0].length + 300;
  if (saidByPronoun(src.slice(sStart, sEnd), found.index - sStart, found.index + found[0].length - sStart)) {
    // Up to the quote's opening mark, without quoted words: they name no one who speaks.
    const para = sentencesOf(unquoted(src.slice(src.lastIndexOf("\n", found.index) + 1, found.index).replace(/[“"«„「『][^“”"«»„「」『』]*$/u, "")));
    let at = -1;
    para.forEach((t, i) => named.some((w) => wordIn(w, t)) && (at = i));
    if (para.slice(at + 1).some(namesPerson)) return false;
    if (at >= 0) return true;
    const head = src.slice(0, found.index).search(/(?:^|\n)#{1,6}\s[^\n]*\n(?![\s\S]*\n#{1,6}\s)/);
    return named.some((w) => wordIn(w, src.slice(Math.max(0, head), after)));
  }
  // A quote on its own: the person must be named near it.
  const window = src.slice(Math.max(0, found.index - 300), after);
  return named.some((w) => wordIn(w, window));
}

/** Words before a place, not a person: "in New York", "desde Buenos Aires". */
const PLACE_BEFORE = new Set("in at from to into across near of en de desde hacia para por em do da à au aux dans vers aus nach bei von zu nel dal".split(" "));

/** Articles: a name after one ("The European Union", "la Casa Rosada") is a body or a place, not a person. */
const NAME_ARTICLE = new Set("the el la los las le les der die das il lo".split(" "));
/** Words that make a name a body, not a person ("Ford Motor Company", "Real Madrid", "Banco Central"). */
const ORG_WORD = new Set(
  "union company corporation corp inc ltd llc plc group bank house party council ministry department university college school hospital club fc cf united real athletic sporting commission agency court office government parliament congress senate committee police service services airlines airways motors motor association federation league institute foundation fund organization organisation authority board centre center network news times post army navy forces airport church museum unión compañía banco partido ministerio gobierno universidad casa policía federación liga fundación instituto congreso senado tribunal comisión empresa".split(" "),
);

/**
 * Whether a sentence names a person: a role after "the", "a" or a possessive
 * ("The plant's director", "el ministro"), or a name of two or more
 * capitalized words not after "in", "from" (a place: "in New York"), nor
 * after or with "the" or a word for a body ("The European Union", "Ford
 * Motor Company", "Real Madrid": F1216).
 */
function namesPerson(s: string): boolean {
  for (const m of s.matchAll(/(?<![\p{L}\p{N}])(?:the|a|an|its|his|her|their|el|la|los|las|un|una|su|sus|o|os|um|uma|le|les|der|die|il|lo)\s+(?:[\p{L}'’-]+\s+)?(\p{L}+)/giu)) if (ROLES.has(m[1].toLowerCase())) return true;
  for (const m of s.matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)+/gu)) {
    if (speakerWords(m[0]).length < 2) continue;
    const words = m[0].toLowerCase().split(/\s+/);
    if (NAME_ARTICLE.has(words[0]) || words.some((w) => ORG_WORD.has(w))) continue;
    const before = /(\p{L}+)\s*$/u.exec(s.slice(0, m.index))?.[1]?.toLowerCase();
    if (!before || !(PLACE_BEFORE.has(before) || NAME_ARTICLE.has(before))) return true;
  }
  return false;
}

/** A verb that says someone spoke words, in the past: "said", "dijo". */
const SPOKE = /(?<![\p{L}\p{N}])(?:said|told|replied|exclaimed|dijo|dijeron|afirmó|aseguró|declaró|exclamó|respondió|disse|afirmou|declarou)(?![\p{L}\p{N}])/giu;

/**
 * A line that has a named person speak ("Maradona dijo una frase memorable")
 * when its source has no words of anyone's: no quotation marks, no speech
 * verb, and no "NAME:" before or after the headline.
 */
export function addsSpeaker(line: string, source: string): boolean {
  const src = source.normalize("NFKC");
  if (quotesIn(src).length || /['‘’]/.test(src.replace(/(?<=\p{L})['’](?=\p{L})/gu, "")) || new RegExp(SAYS.source, "iu").test(src)) return false;
  for (const v of line.matchAll(SPOKE)) {
    const before = line.slice(0, v.index).trim().split(/\s+/);
    const head = (before[before.length - 1] ?? "").replace(/[^\p{L}'’-]/gu, "");
    if (!/^\p{Lu}/u.test(head) || !speakerWords(head).length || ROLES.has(head.toLowerCase())) continue;
    // "RICHARD EDEN: …", "…: AMANDA PLATELL": the writer's own words.
    if (new RegExp(`${escapeRe(head)}[^\\n:]{0,30}:|:\\s*(?:\\p{L}+\\s+){0,3}${escapeRe(head)}\\s*$`, "imu").test(src)) continue;
    return true;
  }
  return false;
}

/** Capitalized words that open a sentence without naming anyone. */
const STARTERS = new Set("según segun tras para ante desde durante after before during while when despite according said says dijo dice afirma aseguró asegura sostuvo explicó".split(" "));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The languages whose number words NUMBER_WORDS knows. */
const NUMBER_LANGS = new Set(["en", "es", "pt", "fr", "de", "it"]);

/**
 * What a rewrite states that its source does not, once keepQuotes has put its
 * quotes right: "speaker" (a quote given to someone the source does not tie
 * to it, see speakerNear), "number" (a number in digits the source does not
 * state in any form), or "" when it states neither. Quotation marks keepQuotes
 * had to remove are not a fact: the words stay, as the rewrite's own.
 * Numbers are checked in every language (F1217): the source's digits always,
 * its number words where Sift knows them (NUMBER_LANGS); dropUnsupported
 * deals with a source that may spell one out in words Sift does not know.
 */
export function unsupported(raw: string, source: string): string {
  const fixed = keepQuotes(raw, source);
  for (const q of quotesIn(fixed)) if (!speakerNear(fixed, q, source)) return "speaker";
  const have = sourceNumbers(source);
  if (numbersOf(fixed).some((vals) => !vals.some((v) => have.has(v)))) return "number";
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

/** A sentence that warns: a limit, a danger, or something never to do ("Never take more than…", "No supere…"). */
const WARNING =
  /(?<![\p{L}\p{N}])(?:never|do not|don['’]t|must not|mustn['’]t|should not|shouldn['’]t|no more than|not more than|at most|maximum|warning|danger|dangerous|avoid|overdose|nunca|no (?:tome|tomes|tomar|debe|deben|supere|superar|exceda|exceder|use|usar|dé|dar)|máximo|máxima|peligro|peligroso|evite|evitar|advertencia|jamais|niemals|nicht mehr als|non (?:superare|assumere|dare))(?![\p{L}\p{N}])/iu;

/** A sentence's words for matching it to the source's; pairs of letters in a script written without spaces. */
function matchTokens(s: string): Set<string> {
  if (!SPACELESS.test(s)) return ctokens(s);
  const out = new Set<string>();
  for (const run of qwords(s)) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  return out;
}

/**
 * The source's own sentence a rewritten one stands for: with at least half of
 * its words (three or more), and a warning too unless `anySentence`; null
 * when none.
 */
function warningOf(s: string, source: string, used: Set<string>, anySentence = false): string | null {
  const want = matchTokens(s);
  let best: string | null = null;
  let most = 0;
  for (const line of source.split("\n")) {
    if (/^\s*#{1,6}\s|^\s*\[\[\s*B\d+\s*\]\]\s*$/.test(line)) continue;
    for (const t of sentencesOf(line.replace(/^\s*(?:[-*•>]|\d+[.)])\s+/, ""))) {
      const have = matchTokens(t);
      let n = 0;
      for (const w of want) if (have.has(w)) n++;
      if (n > most && !used.has(t) && (anySentence || WARNING.test(t))) [best, most] = [t, n];
    }
  }
  if (!best || most < 3 || most < want.size * 0.5) return null;
  used.add(best);
  return best;
}

/**
 * A Short version without the sentences that give a quote to a speaker, or
 * state a number, its source does not (see unsupported). A sentence whose
 * only fault is a quote the source does not have stays: keepQuotes takes its
 * quotation marks off. A warning whose only fault is a number is put back as
 * the source says it (see warningOf). So is any sentence whose only fault is
 * a number when `lang` (the source's language, "" when not known) is one
 * whose number words Sift does not know: the source may spell the number out
 * ("dwudziestu" for 20, F1115), and its own sentence states it right
 * (F1217). Headings and [[B…]] lines stay; a list item keeps its marker; a
 * line left with no sentence goes.
 */
export function dropUnsupported(md: string, source: string, lang?: string): string {
  const spelled = lang !== undefined && !NUMBER_LANGS.has(base(lang));
  const lines: string[] = [];
  const used = new Set<string>();
  for (const line of md.split("\n")) {
    if (/^\s*#{1,6}\s/.test(line) || /^\s*\[\[\s*B\d+\s*\]\]\s*$/.test(line) || !line.trim()) {
      lines.push(line);
      continue;
    }
    const mark = /^\s*(?:[-*•>]|\d+[.)])\s+/.exec(line)?.[0] ?? "";
    const all = sentencesOf(line.slice(mark.length));
    // A warning whose only fault is a number in another form ("in 24 hours"
    // for "in a day") stays, in the source's own words.
    const kept = all.map((s) => (unsupported(s, source) === "number" && (spelled || WARNING.test(s)) ? warningOf(s, source, used, spelled) ?? s : s)).filter((s) => !unsupported(s, source));
    if (kept.length === all.length && kept.every((s, i) => s === all[i])) lines.push(line);
    // "。" ends a sentence with no space after it.
    else if (kept.length) lines.push(mark + kept.join(" ").replace(/(?<=[。！？])\s+/gu, ""));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A Short version that never says the same thing twice (F1100): a sentence of
 * four words or more that repeats an earlier one of its section word for word
 * (case, spacing and punctuation aside) goes, and so does a paragraph left
 * empty. A sentence that differs by any word ("the south district", "Senator
 * Jones", "in the evening") is no repeat (F1215), and a heading starts a new
 * section: the same advice under two headings stays under both. A list item
 * is held only against the items of its own list: two lists (two recipes) may
 * well share one ("200 g de harina").
 */
export function dropRepeats(md: string): string {
  let seen = new Set<string>();
  let list = new Set<string>();
  const lines: string[] = [];
  for (const line of md.split("\n")) {
    const mark = /^\s*(?:[-*•]|\d+[.)])\s+/.exec(line)?.[0] ?? "";
    if (!mark) list = new Set();
    if (/^\s*#{1,6}\s/.test(line)) seen = new Set();
    if (/^\s*#{1,6}\s/.test(line) || /^\s*\[\[\s*B\d+\s*\]\]\s*$/.test(line) || !line.trim()) {
      lines.push(line);
      continue;
    }
    const all = sentencesOf(line.slice(mark.length));
    const kept = all.filter((sentence) => {
      const words = qwords(sentence.replace(/\*\*|__/g, ""));
      // A placeholder's block is put back by the page, wherever its sentence went: never dropped here.
      if (words.length < 4 || /\[\[\s*B\d+\s*\]\]/.test(sentence)) return true;
      const key = words.join(" ");
      const earlier = mark ? list : seen;
      if (earlier.has(key)) return false;
      earlier.add(key);
      return true;
    });
    if (kept.length === all.length) lines.push(line);
    else if (kept.length) lines.push(mark + kept.join(" "));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A paragraph in which the model talks about its task instead of the page. It
 * opens like a note ("Here is the shorter version", "El texto fuente
 * contiene…", "Note:", "I kept…") and talks about the text, the version, or
 * the instructions; or it names the placeholders or the version asked for.
 * Quoted words never count: "I will keep fighting," the president said.
 */
const NOTE_START =
  /^[\s(*_]*(?:here is|here's|here are|below is|below are|aquí (?:está|tienes|va|van)|a continuación|note|nota|n\.b\.|word count|recuento|this is (?:a|the|my) (?:shorter|short|condensed|rewritten|summari[sz]ed|simplified|requested)|esta es (?:la|una) versión|i (?:will|'ll|’ll|have|kept|removed|left|cut|omitted|shortened|rewrote|condensed)\b|i['’]ve\b|he (?:mantenido|conservado|reescrito|resumido|eliminado|omitido|acortado)|mantendré|(?:the |el |la )?(?:source|original) text|(?:el |la )?(?:texto|versión) (?:fuente|original|de origen|corta|abreviada))/iu;
/**
 * Words about the task itself, never about the page's subject: the shorter
 * version, the source text, a word count, the placeholders, the instructions,
 * the links or headings kept or removed. A bare "version", "article", "text",
 * "words" or "links" is what a first-person lead, a review's verdict, or a
 * correction note may talk about ("I have tested every version…", "Note: This
 * article was corrected…"), and does not count.
 */
const NOTE_TOPIC =
  /(?<![\p{L}\p{N}])(?:(?:shorter|short|shortened|condensed|abridged|rewritten|simplified|summari[sz]ed|requested|concise|brief)\s+(?:version|text|rewrite|summary|form)|(?:source|original|input|provided|given)\s+text|word\s+count|\(\s*~?\d+\s+words?\s*\)|(?:has|is|contains|of)\s+(?:about\s+|around\s+|roughly\s+)?\d+\s+words|placeholders?|marcadores|(?:the|these|your|las|tus)\s+instru(?:ctions|cciones)|as\s+(?:requested|asked|instructed)|(?:kept|keep|preserved|retained|removed|omitted|dropped|cut|left\s+out)\s+(?:all\s+)?(?:the\s+)?(?:links|headings|lists|quotes|markers|formatting|structure)|versi[oó]n\s+(?:corta|abreviada|resumida|condensada|reducida|más\s+corta|breve)|texto\s+(?:fuente|original|de\s+origen|resumido|condensado|abreviado|reescrito|proporcionado)|recuento\s+de\s+palabras|(?:tiene|contiene|de)\s+(?:unas\s+)?\d+\s+palabras|como\s+se\s+(?:pidió|solicitó|indicó)|(?:mantenido|conservado|eliminado|omitido|mantuvieron|conservaron|eliminaron)\s+(?:todos\s+)?(?:los\s+|las\s+)?(?:enlaces|encabezados|títulos|listas|citas))(?![\p{L}\p{N}])|\[\[B/iu;
/**
 * "Here is a summary:", "Aquí tienes la versión corta del texto.": a note that
 * hands over the text, and says nothing else. "This is the first version of
 * Android that…" or "This is a summary of the council's decisions" goes on
 * about something of the page's: an article's own paragraph (F1116).
 */
const NOTE_HANDOVER =
  /^[\s(*_]*(?:here is|here's|here are|below is|below are|this is|aquí (?:está|tienes|va|van)|a continuación(?:,)?(?: se presenta| está| va| tienes)?|esta es)\s+(?:(?:a|an|the|my|your|una?|el|la|tu)\s+)?(?:[\p{L}-]+,?\s+){0,3}?(?:version|summary|rewrite|versión|resumen|reescritura)(?:\s+(?:of|for|de|del|para)\s+(?:(?:the|this|that|your|el|la|los|las|este|esta|tu|su)\s+)?(?:(?:source|original|provided|full|fuente|completo)\s+)?(?:text|article|page|source|original|passage|content|post|story|key points|main points|texto|artículo|página|contenido|nota|noticia|fuente|puntos clave|puntos principales)(?:\s+(?:fuente|original|completo))?)?(?:,?\s+(?:in|en|with|con)\s+(?:about\s+|around\s+|unas\s+|alrededor\s+de\s+)?\d+\s+(?:words|palabras))?[\s.:;!*_)]*$/iu;
const NOTE_ANYWHERE = /\[\[B[…*.]|versi[oó]n (?:solicitada|pedida)|requested (?:version|rewrite|length)|^[\s(*_]*~?\d+\s+(?:words|palabras)[\s)*_.]*$/iu;

/** Language names in English, Spanish and Portuguese ("english", "inglés", "inglês"), lowercase. */
let langNames: Set<string> | undefined;
function isLangName(s: string): boolean {
  if (!langNames) {
    langNames = new Set();
    const codes = "af am ar az be bg bn bs ca cs cy da de el en eo es et eu fa fi fil fr ga gl gu ha he hi hr hu hy id ig is it ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk ml mn mr ms mt my nb ne nl nn no pa pl ps pt ro ru rw sd si sk sl sm sn so sq sr st su sv sw ta te tg th tk tl tr ug uk ur uz vi xh yi yo zh zu".split(" ");
    for (const ui of ["en", "es", "pt"]) {
      try {
        const dn = new Intl.DisplayNames([ui], { type: "language" });
        for (const c of codes) langNames.add((dn.of(c) ?? c).toLowerCase());
      } catch {
        /* no display names */
      }
    }
  }
  return langNames.has(s.toLowerCase().trim());
}

const LANG_NAME = String.raw`\p{L}+(?:[ -]\p{L}+){0,2}`;
/** "The text is in English. Write in English.", or its Spanish or Portuguese form: the prompt's language line, echoed (F1137). */
const LANG_PAIR = new RegExp(
  String.raw`[*_]*\s*(?:the text is (?:written )?in|el texto est[áa] (?:escrito )?en|o texto est[áa] (?:escrito )?em|o texto [ée] em)\s+(${LANG_NAME})\s*[.:;]?\s*(?:(?:write|escribe|escriba|escribir|escreva|escreve|escrever)\s+(?:it\s+|lo\s+|o\s+)?(?:only\s+|solo\s+|sólo\s+|solamente\s+|apenas\s+|somente\s+)?(?:in|en|em)\s+(${LANG_NAME})\s*[.!]?)?\s*[*_]*`,
  "giu",
);
/** One sentence of that line, alone on a line of the output: "Write in English.", "Escribe en español." */
const LANG_ONE = new RegExp(
  String.raw`^\s*(?:[-*>]\s+)?[*_]*\s*(?:the text is (?:written )?in|el texto est[áa] (?:escrito )?en|o texto est[áa] (?:escrito )?em|o texto [ée] em|(?:write|escribe|escriba|escreva|escreve)\s+(?:only\s+|solo\s+|sólo\s+|apenas\s+|somente\s+)?(?:in|en|em))\s+(${LANG_NAME})\s*[.!]?\s*[*_]*\s*$`,
  "iu",
);

/**
 * A Short version without the prompt's language line ("The text is in
 * English. Write in English.") echoed by the model, wherever it stands: alone,
 * as a paragraph, or before the first sentence of one (F1137). Only with a
 * language's name, so "Write in pencil." stays.
 */
export function dropLangEcho(md: string, source = ""): string {
  if (!/text|texto|writ|escri|escre/i.test(md)) return md;
  // The page's own words ("Write in English." in an exam's rules) are no echo.
  const flat = (t: string) => " " + (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ") + " ";
  const src = flat(source);
  const own = (t: string) => src.includes(flat(t));
  const first = md.split("\n").findIndex((l) => l.trim());
  const lines = md.split("\n").map((line, i) => {
    const one = LANG_ONE.exec(line);
    if (one && isLangName(one[1]) && !own(one[0])) return null;
    let cut = false;
    const l = line.replace(LANG_PAIR, (m, a: string, b?: string) => {
      if (!isLangName(a) || (b && !isLangName(b)) || own(m)) return m;
      // A sentence of its own: at the line's start or after one that ends.
      // "The text is in Latin." without "Write in …" only where the output starts: it may be the page's.
      const at = line.indexOf(m);
      if (!b && (i !== first || at > 0)) return m;
      if (at > 0 && !/(?:^|[.!?:]\s*|^\s*(?:[-*>]|#{1,6})\s*)$/.test(line.slice(0, at))) return m;
      cut = true;
      return at > 0 && /\S$/.test(line.slice(0, at)) ? " " : "";
    });
    return cut && !l.trim() ? null : cut ? l.replace(/^(\s*(?:[-*>]\s+|#{1,6}\s+)?)\s+/, "$1").replace(/\s+$/, "") : l;
  });
  const out = lines.filter((l) => l !== null).join("\n");
  return out === md ? md : out.replace(/^\s*\n+/, "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

/** A Short version without a note of the model's own before or after the text (`source`: the text it was made from). */
export function stripPreamble(md: string, source = ""): string {
  const paras = dropLangEcho(md, source).split(/\n\s*\n/);
  const meta = (p: string | undefined) => {
    if (!p || /^\s*(?:#|\[\[\s*B\d+\s*\]\]\s*$)/.test(p)) return false;
    const own = p.replace(QUOTED, " ");
    return NOTE_ANYWHERE.test(own) || NOTE_HANDOVER.test(own) || (NOTE_START.test(own) && NOTE_TOPIC.test(own));
  };
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
 * A line that only ticks or labels: "Updated 10:32", "5 min ago", "1,2 M
 * views", "12' minutos de lectura", "Comentarios (12)". A line that also says
 * something ("Doors open at 19:30.", "Pool: closed") is not one, however short.
 */
const ticksOnly = (line: string) => fewWords(line, 8) && onlyTicks(line, TICK);

/**
 * An article's text for its cache key: without lines that only tick or label
 * (a comment count, "12' minutos de lectura", "Actualizado 10:32"), so a
 * revisit of the same article finds its Short version. Any other line stays,
 * however short ("Pool: closed", "Doors open at 20:00."): a change there is a
 * change of the text. Headings, placeholders, and lines with links stay: the
 * saved text refers to them by number.
 */
export function stableText(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const l = line.trim();
      if (!l) return false;
      if (/^#|\[\[\s*B\d+\s*\]\]|\]\(\s*#?L\d+\s*\)/.test(l)) return true;
      return !ticksOnly(l.replace(/^(?:[-*•>]|\d+[.)])\s+/, ""));
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

// ---------- order, cause, and quotes in one-liners ----------

/** Words that put two events in order ("after", "tras") or make one the cause of the other ("because", "porque"). */
const ORDER = /(?<![\p{L}\p{N}])(?:after|before|following|prior to|tras|despu[eé]s de|antes de|luego de|a ra[ií]z de|ap[oó]s|depois de|apr[eè]s|avant de|dopo|prima di)(?![\p{L}\p{N}])/iu;
const CAUSE =
  /(?<![\p{L}\p{N}])(?:because|due to|as a result|thanks to|leading to|led to|which led|caused by|porque|debido a|a causa de|gracias a|por lo que|lo que provoc[oó]|devido a|gra[cç]as a|por causa de|parce que|[àa] cause de|gr[aâ]ce [àa]|weil|wegen|perch[eé]|a causa di)(?![\p{L}\p{N}])/iu;

/**
 * A one-liner that links two facts by order or cause ("X after Y", "X because
 * Y") when its title and context link nothing so: the model saw only those,
 * so the order or the cause is its own guess (a quote in a teaser is not the
 * setting of the story's event).
 */
export function addsLink(line: string, source: string): boolean {
  const own = line.replace(QUOTED, " ");
  return (ORDER.test(own) && !ORDER.test(source)) || (CAUSE.test(own) && !CAUSE.test(source));
}

/** "I", "my", "we" and the like: a quote that has one is its speaker's own words. */
const FIRST_PERSON = /(?<![\p{L}\p{N}])(?:i|i['’]m|i['’]ve|i['’]d|me|my|mine|we|we['’]re|our|ours|yo|mi|mis|m[ií]o|nosotros|nosotras|nos|nuestro|nuestra|nuestros|nuestras|eu|meu|minha|n[oó]s|nosso|nossa|je|j['’]|moi|mon|nous|notre|ich|mein|meine|wir|unser|unsere|io|mio|mia|noi|nostro|nostra)(?![\p{L}\p{N}])/iu;

/**
 * A one-liner that states a first-person quote of its title as a fact of its
 * own, without the quotation marks or the "I" ("‘My death was reported…’"
 * becoming "the singer's death was reported…"): most of the quote's words
 * are in the line outside any quote, and none of its first-person words.
 */
export function quoteAsFact(line: string, title: string): boolean {
  const own = line.replace(QUOTED, " ");
  for (const q of quotesIn(title.replace(/‘([^‘’\n]+)’/g, "“$1”"))) {
    if (!FIRST_PERSON.test(q.inner) || FIRST_PERSON.test(own)) continue;
    const want = ctokens(q.inner);
    if (want.size < 2) continue;
    const have = ctokens(own);
    let both = 0;
    for (const w of want) if (have.has(w)) both++;
    if (both >= 2 && both >= want.size * 0.6) return true;
  }
  return false;
}

/** "sus", "his", "their": a word that ties a noun to someone the text named before. */
const POSSESSIVE = new Set("su sus seu seus sua suas his her their its ses son sa leur leurs suo sua suoi sue sein seine seinen seiner ihr ihre ihren ihrer".split(" "));
const TIE_OF = "de|del|do|da|dos|das|di|of|von";
const ARTICLES = "el|la|los|las|lo|o|a|os|as|the|le|les|il|der|die|das";
/** A capitalized word that names someone or something: not a common word (an article, "Tras", "Los"). */
const NAME_WORD = /\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}[\p{Ll}\p{M}]+)?/gu;
const isName = (w: string) => w.length >= 3 && !COMMON.has(w.toLowerCase()) && !STARTERS.has(w.toLowerCase()) && !WHEN.has(w.toLowerCase());
const stemOf = (w: string) => w.toLowerCase().slice(0, Math.max(4, Math.min(6, w.length - 2)));

/** The names a text gives: capitalized words other than common ones ("Los", "Tras"). */
const namesIn = (text: string) => (text.match(NAME_WORD) ?? []).filter(isName);

/**
 * A one-liner that gives a group, an ally, or a thing to the wrong person: it
 * ties a noun to a name ("los aliados de Bolsonaro", "Bolsonaro's allies")
 * that its title and context never tie so, where they say only "sus aliados"
 * after that name, and it drops another person they name ("Los amigos de
 * Milei. Tras la derrota de Bolsonaro, … al club de sus aliados"): the
 * possessive was read as the nearest name's, not the kicker's subject's.
 */
export function swapsPerson(line: string, source: string): boolean {
  const own = line.replace(QUOTED, " ");
  const ties: { noun: string; name: string }[] = [];
  const nameRun = "\\p{Lu}[\\p{Ll}\\p{M}]+(?:\\s+\\p{Lu}[\\p{Ll}\\p{M}]+){0,2}";
  for (const m of own.matchAll(new RegExp(`([\\p{L}]{4,})\\s+(?:${TIE_OF})\\s+(?:(?:${ARTICLES})\\s+)?(${nameRun})`, "gu"))) ties.push({ noun: m[1], name: m[2] });
  // "Bolsonaro's allies", "Bolsonaro's former allies": the next word or the one after.
  for (const m of own.matchAll(new RegExp(`(${nameRun})['’]s?\\s+([\\p{Ll}]{4,})(?:\\s+([\\p{Ll}]{4,}))?`, "gu"))) for (const noun of [m[2], m[3]]) if (noun) ties.push({ noun, name: m[1] });
  if (!ties.length) return false;
  const lowLine = line.toLowerCase();
  const srcNames = namesIn(source);
  for (const { noun, name } of ties) {
    const last = name.split(/\s+/).filter(isName).pop();
    if (!last || COMMON.has(noun.toLowerCase())) continue;
    const stem = escapeRe(stemOf(noun));
    const who = escapeRe(last);
    // The source ties them so itself: "aliados de Bolsonaro", "Bolsonaro's allies".
    const tied = new RegExp(`${stem}[\\p{L}]*\\s+(?:${TIE_OF})\\s+(?:(?:${ARTICLES})\\s+)?(?:\\p{Lu}[\\p{Ll}\\p{M}]+\\s+){0,2}${who}|${who}['’]s?\\s+(?:[\\p{L}]+\\s+)?${stem}`, "iu");
    if (tied.test(source)) continue;
    // Only "sus aliados" (or "the club of his allies"), after the name.
    const poss = new RegExp(`(?<![\\p{L}])(?:${[...POSSESSIVE].join("|")})\\s+(?:[\\p{L}]+\\s+)?${stem}`, "iu").exec(source);
    if (!poss) continue;
    const at = source.toLowerCase().indexOf(last.toLowerCase());
    if (at < 0 || at > poss.index) continue;
    // Another person the source names, whom the line leaves out: whose the noun may be.
    if (srcNames.some((n) => n.toLowerCase() !== last.toLowerCase() && !name.toLowerCase().includes(n.toLowerCase()) && !lowLine.includes(n.toLowerCase()))) return true;
  }
  return false;
}

/** Words that give a person a role in a crime or a contest: a victim, an accused, a winner, a loser. */
const ROLE_OF = new Map<string, string>();
for (const [role, words] of Object.entries({
  victim: "victim victims died dies dead killed murdered slain stabbed víctima víctimas muerto muerta murió asesinado asesinada vítima vítimas morto morta morreu assassinado assassinada",
  accused: "suspect suspects accused charged arrested convicted jailed killer murderer sospechoso sospechosa acusado acusada imputado imputada detenido detenida arrestado arrestada condenado condenada asesino asesina suspeito suspeita preso presa assassino assassina",
  winner: "winner winners won beat beats defeated defeats ganador ganadora ganó venció derrotó vencedor vencedora venceu derrotou",
  loser: "loser losers lost perdedor perdedora perdió perdeu",
}))
  for (const w of words.split(" ")) ROLE_OF.set(w, role);
const OPPOSITE: Record<string, string> = { victim: "accused", accused: "victim", winner: "loser", loser: "winner" };
/** Verbs whose subject and object take opposite roles: "X killed Y", "X beat Y". */
const ACTIVE: Record<string, [string, string]> = Object.fromEntries([
  ..."killed murdered stabbed shot mató asesinó matou assassinou".split(" ").map((w) => [w, ["accused", "victim"]]),
  ..."beat beats defeated defeats venció derrotó venceu derrotou".split(" ").map((w) => [w, ["winner", "loser"]]),
]);
const ROLE_NAME = String.raw`\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}[\p{Ll}\p{M}]+)?(?:\s+\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}[\p{Ll}\p{M}]+)?){0,2}`;
const ROLE_LINK = String.raw`(?:\s*,)?\s+(?:(?:is|was|has been|had been|es|fue|ha sido|foi|é)\s+)?(?:(?:named|identified|revealed|confirmed|nombrado|nombrada|identificado|identificada|señalado|señalada|apontado|apontada)\s+(?:as|como)\s+)?(?:(?:a|an|the|el|la|un|una|o|um|uma)\s+)?(?:\p{Ll}+\s+)?`;
const ROLE_WORD = `(${[...ROLE_OF.keys(), ...Object.keys(ACTIVE)].join("|")})(?![\\p{L}])`;
const ROLE_AFTER = new RegExp(String.raw`(${ROLE_NAME})${ROLE_LINK}${ROLE_WORD}(?:\s+(?:(?:the|el|la|al|a|o)\s+)?(${ROLE_NAME}))?`, "gu");
const ROLE_BEFORE = new RegExp(String.raw`(?<![\p{L}])(\p{L}+)\s+(${ROLE_NAME})`, "gu");
const DEATH_OF = new RegExp(String.raw`(?<![\p{L}])(?:murder|killing|death|stabbing|asesinato|muerte|crimen|homicidio|assassinato|morte)\s+(?:of|de|do|da)\s+(${ROLE_NAME})`, "giu");
/** Role words that are nouns: "suspect Abotaka" says who the suspect is. */
const ROLE_NOUN = /^(?:victims?|suspects?|accused|killer|murderer|winners?|losers?|víctimas?|sospechos[oa]s?|acusad[oa]|imputad[oa]|asesin[oa]|ganador[a]?|perdedor[a]?|vítimas?|suspeit[oa]s?|vencedor[a]?|assassin[oa])$/;
const lastName = (n: string) => n.split(/\s+/).filter(isName).pop()?.toLowerCase();

/** Who a text gives a role: "Abotaka charged", "suspect Abotaka", "Abotaka killed Barzai", "the murder of Barzai". */
function roleTies(text: string): { name: string; role: string }[] {
  const own = text.replace(QUOTED, " ");
  const ties: { name: string; role: string }[] = [];
  const add = (n: string | undefined, role: string) => {
    const name = n && lastName(n);
    if (name) ties.push({ name, role });
  };
  for (const m of own.matchAll(ROLE_AFTER)) {
    const w = m[2].toLowerCase();
    const act = ACTIVE[w];
    // "X killed Y": X the killer, Y the victim; "X killed in a crash": X the victim.
    if (act && m[3] && m[0].slice(m[1].length).trim().toLowerCase().startsWith(w)) {
      add(m[1], act[0]);
      add(m[3], act[1]);
    } else if (ROLE_OF.has(w) && !act && !(m[3] && ROLE_NOUN.test(w))) add(m[1], ROLE_OF.get(w)!);
    // "X was killed", "X killed in a crash": the victim.
    else if (act?.[0] === "accused" && !m[3]) add(m[1], "victim");
  }
  for (const m of own.matchAll(ROLE_BEFORE)) {
    const w = m[1].toLowerCase();
    const role = ROLE_OF.get(w);
    // Only a role noun names who it is: "suspect Abotaka", not "charged Abotaka".
    if (role && ROLE_NOUN.test(w)) add(m[2], role);
  }
  for (const m of own.matchAll(DEATH_OF)) add(m[1], "victim");
  return ties;
}

/** "Suspect charged", "sospechoso detenido": the source's accused is a person of its own, who did the charged thing. */
const SUSPECT_ACTS = /(?<![\p{L}])(?:suspect|suspects|sospechos[oa]s?|suspeit[oa]s?)\s+(?:(?:is|was|has been|es|fue|ha sido|foi|é)\s+)?(?:charged|arrested|held|detained|jailed|accused|detenid[oa]|arrestad[oa]|imputad[oa]|acusad[oa]|pres[oa])(?![\p{L}])/iu;
/** A dead person said to be the suspect: "A man who died … is named as a murder suspect". */
const DEAD_IS_SUSPECT = new RegExp(
  String.raw`(?<![\p{L}])(?:died|dies|dead|killed|murdered|murió|muert[oa]|asesinad[oa]|morreu|mort[oa]|assassinad[oa])(?![\p{L}])[^.;:!?]*?(?<![\p{L}])(?:(?:is|was|has been|es|fue|ha sido|foi|é)\s+)?(?:(?:named|identified|revealed|confirmed|nombrad[oa]|identificad[oa]|señalad[oa]|apontad[oa])\s+(?:as|como)|(?:is|was|es|fue|foi|é)\s+(?:a|an|the|el|la|un|una|o|um|uma))\s+(?:(?:a|an|the|el|la|un|una|o|um|uma)\s+)?(?:\p{L}+\s+)?(?:suspect|killer|murderer|sospechos[oa]|asesin[oa]|suspeit[oa]|assassin[oa])(?![\p{L}])`,
  "iu",
);
/** The same, with a verb that says so: the source itself makes the dead person the suspect. */
const DEAD_IS_SUSPECT_STATED = new RegExp(DEAD_IS_SUSPECT.source.replace(String.raw`(?:(?:is|was|has been|es|fue|ha sido|foi|é)\s+)?`, String.raw`(?:is|was|has been|es|fue|ha sido|foi|é)\s+`), "iu");

/**
 * A one-liner that swaps people's roles (F1124): it gives a name the opposite
 * role of the one its title and context give it (the victim becomes the
 * suspect, the winner the loser), or it makes someone who died the suspect
 * where the source has a suspect of its own ("Man who died … named as murder
 * suspect charged": the dead man is named, and a suspect is charged).
 */
export function swapsRole(line: string, source: string): boolean {
  const mine = roleTies(line);
  if (mine.length) {
    const theirs = roleTies(source);
    for (const { name, role } of mine) {
      const other = OPPOSITE[role];
      if (theirs.some((t) => t.name === name && t.role === other) && !theirs.some((t) => t.name === name && t.role === role)) return true;
    }
  }
  const own = line.replace(QUOTED, " ");
  return DEAD_IS_SUSPECT.test(own) && SUSPECT_ACTS.test(source) && !DEAD_IS_SUSPECT_STATED.test(source.replace(QUOTED, " "));
}

/** Text right before a quote that sets it beside a noun, as what that noun is ("el triunfo de Lula, un “…”"). */
const APPOSITION = /[\p{L}\p{N})]\s*[,–—]\s*(?:(?:un|una|unos|unas|el|la|los|las|lo|a|an|the|o|os|as|um|uma|le|les|une|des|il|uno|ein|eine)\s+)?$/iu;

/**
 * A one-liner that moves the quote opening its title (a kicker: "“Hubo un
 * gravísimo error”. Guelar analizó el triunfo de Lula…") beside another noun,
 * as if it described it ("…el triunfo de Lula, un “gravísimo error”"): the
 * quote is its speaker's words about something the story tells, not about that noun.
 */
export function movesKicker(line: string, title: string): boolean {
  const t = title.replace(/‘([^‘’\n]+)’/g, "“$1”");
  const first = quotesIn(t)[0];
  // The title opens with the quote (after a short label at most), and it ends a sentence or a kicker.
  if (!first || qwords(t.slice(0, first.at)).length > 3 || !/^\s*[.:!?…]?\s*(?:$|[\p{Lu}¿¡“"«])/u.test(t.slice(first.at + first.len))) return false;
  const kicker = " " + qwords(first.inner).join(" ") + " ";
  for (const q of quotesIn(line)) {
    const w = qwords(q.inner);
    if (w.length < 2 || !kicker.includes(" " + w.join(" ") + " ")) continue;
    if (APPOSITION.test(line.slice(0, q.at))) return true;
  }
  return false;
}

// ---------- Short versions ----------

/** A line of the model's own that echoes the input's "Title:" field (or its translation), as a heading or a paragraph. */
const TITLE_LABEL = /^\s*(?:#{1,6}\s*)?[*_]*\s*(?:title|headline|t[ií]tulo|titular|titre|titel|titolo)\s*[*_]*\s*[:：]\s*[*_]*\s*/iu;

const titleWords = (s: string) => (unlink(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/**
 * A Short version without the page's title echoed as a line of its own: a
 * "Title: …" line (any label the input's field may be translated to), or a
 * heading that only repeats the title when the text sent has no such heading.
 */
export function dropTitleLine(md: string, title: string, text: string): string {
  const t = titleWords(title.replace(/^\s*\(\d+\+?\)\s*/, ""));
  if (!t) return md;
  const own = new Set(text.split("\n").filter((l) => /^\s*#{1,6}\s/.test(l)).map((l) => titleWords(l.replace(/^\s*#+\s*/, ""))));
  const out = md.split("\n").filter((line) => {
    const label = TITLE_LABEL.exec(line);
    const rest = titleWords(label ? line.slice(label[0].length) : /^\s*#{1,6}\s/.test(line) ? line.replace(/^\s*#+\s*/, "") : "");
    if (!rest) return !label;
    // The title, maybe cut or with its "(part 2 of 3)": the input's field, not the page's text.
    const echo = rest === t || (rest.length > 12 && (t.includes(rest) || rest.startsWith(t)));
    return !(echo && (label || !own.has(rest)));
  });
  return out.join("\n").replace(/^\s*\n+/, "").replace(/\n{3,}/g, "\n\n");
}

/** Lines of prose that say something (eight words or more), words and numbers only, without link markup. */
function proseLines(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (/^\s*#{1,6}\s|^\s*\[\[\s*B\d+\s*\]\]\s*$/.test(line)) continue;
    const w = qwords(line);
    if (w.length >= 8) out.set(w.join(" "), w.length);
  }
  return out;
}

/** Each placeholder of a text, by number, with the prose line before and after it (and how many placeholders lie between). */
function anchors(text: string): Map<number, { before: string; after: string }> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = new Map<number, { before: string; after: string }>();
  lines.forEach((l, i) => {
    const m = /^\[\[\s*B(\d+)\s*\]\]$/.exec(l);
    if (!m) return;
    let a = i - 1;
    while (a >= 0 && /^\[\[\s*B\d+\s*\]\]$/.test(lines[a])) a--;
    let b = i + 1;
    while (b < lines.length && /^\[\[\s*B\d+\s*\]\]$/.test(lines[b])) b++;
    out.set(Number(m[1]), { before: `${a >= 0 ? qwords(lines[a]).join(" ") : "^"}#${i - a}`, after: `${b < lines.length ? qwords(lines[b]).join(" ") : "$"}#${b - i}` });
  });
  return out;
}

/** Each link of a text, by number: its words, and the words of its line. */
function linksOf(text: string): Map<number, { a: string; line: string }> {
  const out = new Map<number, { a: string; line: string }>();
  for (const line of text.split("\n")) {
    const plain = qwords(line).join(" ");
    for (const m of line.matchAll(/\[([^[\]]*)\]\(\s*#?L(\d+)\s*\)/g)) out.set(Number(m[2]), { a: qwords(m[1]).join(" "), line: plain });
  }
  return out;
}

/**
 * The lines of a text that say what it is, as words only: the lines its cache
 * key keeps (see stableText), short ones included ("Pool: closed"), without
 * placeholders and link ids (they are renumbered when a block or a link
 * before them comes or goes), nor a one- or two-word link or heading (a
 * promotion, a section that loads late).
 */
function textLines(text: string): string[] {
  return stableText(text)
    .split("\n")
    .filter((l) => !/^\s*\[\[\s*B\d+\s*\]\]\s*$/.test(l))
    .map((l) => ({ w: qwords(l), aside: /^\s*#|\]\(\s*#?L\d+\s*\)/.test(l) }))
    .filter(({ w, aside }) => w.length > (aside ? 2 : 0))
    .map(({ w }) => w.join(" "))
    .sort();
}

/**
 * A Short version made from an earlier text of the same article (`from`: the
 * same lines, but a block or a link before them came or went, so placeholders
 * and link ids differ), made fit for the text sent now (`to`); null when any
 * line of the text changed, came, or went: a Short version of other words
 * may state what the page no longer says, so a new one is made. Its
 * placeholders and link ids are renumbered to the new text; one with no match
 * there goes (the page puts a dropped block back in its place, and lists a
 * dropped link).
 */
export function reuseShort(out: string, from: string, to: string): string | null {
  if (proseLines(to).size < 3) return null;
  const had = textLines(from);
  const now = textLines(to);
  if (had.length !== now.length || had.some((l, i) => l !== now[i])) return null;
  const fa = anchors(from);
  const ta = [...anchors(to)];
  const usedB = new Set<number>();
  const blockMap = new Map<number, number>();
  for (const [n, x] of fa) {
    const hit = ta.find(([m, y]) => !usedB.has(m) && y.before === x.before) ?? ta.find(([m, y]) => !usedB.has(m) && y.after === x.after);
    if (hit) {
      usedB.add(hit[0]);
      blockMap.set(n, hit[0]);
    }
  }
  const fl = linksOf(from);
  const tl = [...linksOf(to)];
  const usedL = new Set<number>();
  const linkMap = new Map<number, number>();
  for (const [n, x] of fl) {
    // Only in the same line: a link with the same words elsewhere goes to another address.
    const hit = tl.find(([m, y]) => !usedL.has(m) && y.a === x.a && y.line === x.line);
    if (hit) {
      usedL.add(hit[0]);
      linkMap.set(n, hit[0]);
    }
  }
  return out
    .replace(/\[\[\s*B(\d+)\s*\]\]/g, (_, n: string) => (blockMap.has(Number(n)) ? `[[B${blockMap.get(Number(n))}]]` : ""))
    .replace(/\[([^[\]]*)\]\(\s*#?L(\d+)\s*\)/g, (_, w: string, n: string) => (linkMap.has(Number(n)) ? `[${w}](L${linkMap.get(Number(n))})` : w))
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
