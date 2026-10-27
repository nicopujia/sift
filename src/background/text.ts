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
  let best: { v: RegExpMatchArray; d: number } | null = null;
  for (const v of sentence.matchAll(SAYS)) {
    const vs = v.index!;
    const ve = vs + v[0].length;
    if (ve > at && vs < end) continue;
    const d = ve <= at ? at - ve : vs - end;
    if (!best || d < best.d) best = { v, d };
  }
  return best ? verbSpeaker(sentence, best.v, at, end) : [];
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
  // None there (a pronoun, a quote on its own): the person must be named near it.
  const window = src.slice(Math.max(0, found.index - 300), found.index + found[0].length + 300);
  return named.some((w) => wordIn(w, window));
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

/**
 * What a rewrite states that its source does not, once keepQuotes has put its
 * quotes right: "speaker" (a quote given to someone the source does not tie
 * to it, see speakerNear), "number" (a number in digits the source does not
 * state in any form), or "" when it states neither. Quotation marks keepQuotes
 * had to remove are not a fact: the words stay, as the rewrite's own.
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

/**
 * A Short version without the sentences that give a quote to a speaker, or
 * state a number, its source does not (see unsupported). A sentence whose
 * only fault is a quote the source does not have stays: keepQuotes takes its
 * quotation marks off. Headings and [[B…]] lines stay; a list item keeps its
 * marker; a line left with no sentence goes.
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

/**
 * A paragraph in which the model talks about its task instead of the page. It
 * opens like a note ("Here is the shorter version", "El texto fuente
 * contiene…", "Note:", "I kept…") and talks about the text, the version, or
 * the instructions; or it names the placeholders or the version asked for.
 * Quoted words never count: "I will keep fighting," the president said.
 */
const NOTE_START =
  /^[\s(*_]*(?:here is|here's|here are|below is|below are|aquí (?:está|tienes|va|van)|a continuación|note|nota|n\.b\.|word count|recuento|this is (?:a|the|my) (?:shorter|short|condensed|rewritten|summari[sz]ed|simplified|requested)|esta es (?:la|una) versión|i (?:will|'ll|’ll|have|kept|removed|left|cut|omitted|shortened|rewrote|condensed)\b|i['’]ve\b|he (?:mantenido|conservado|reescrito|resumido|eliminado|omitido|acortado)|mantendré|(?:the |el |la )?(?:source|original) text|(?:el |la )?(?:texto|versión) (?:fuente|original|de origen|corta|abreviada))/iu;
const NOTE_TOPIC =
  /\b(?:text|texto|article|artículo|summary|resumen|version|versión|rewrite|reescritura|instructions?|instrucciones|placeholders?|marcadores|headings?|encabezados|words?|palabras|recuento|links?|enlaces|requested|solicitad[oa]|pedid[oa]|shorter|más corta|condensed|abreviad[oa])\b|\[\[B/iu;
const NOTE_ANYWHERE = /\[\[B[…*.]|versi[oó]n (?:solicitada|pedida)|requested (?:version|rewrite|length)/iu;

/** A Short version without a note of the model's own before or after the text. */
export function stripPreamble(md: string): string {
  const paras = md.split(/\n\s*\n/);
  const meta = (p: string | undefined) => {
    if (!p || /^\s*(?:#|\[\[\s*B\d+\s*\]\]\s*$)/.test(p)) return false;
    const own = p.replace(QUOTED, " ");
    return NOTE_ANYWHERE.test(own) || (NOTE_START.test(own) && NOTE_TOPIC.test(own));
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
 * A Short version made from an earlier text of the same article (`from`: the
 * page had loaded more or less of it, or a promotion came and went), made fit
 * for the text sent now (`to`); null when that text has prose the earlier one
 * did not cover. Its placeholders and link ids are renumbered to the new text;
 * one with no match there goes (the page puts a dropped block back in its
 * place, and lists a dropped link).
 */
export function reuseShort(out: string, from: string, to: string): string | null {
  const had = proseLines(from);
  const now = proseLines(to);
  let all = 0;
  let covered = 0;
  for (const [l, n] of now) {
    all += n;
    if (had.has(l)) covered += n;
  }
  if (now.size < 3 || covered < all * 0.95) return null;
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
    const same = tl.filter(([m, y]) => !usedL.has(m) && y.a === x.a);
    const hit = same.find(([, y]) => y.line === x.line) ?? (same.length === 1 ? same[0] : undefined);
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
