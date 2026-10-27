// Sift's background service worker: calls the language model (streaming),
// caches results, relays the toolbar button and shortcut, and keeps
// anonymous usage counts.

import type { AiReply, AiRequest, LineInput, ModelCfg, RuntimeMsg, Settings } from "../shared/messages";
import { mergeSettings } from "../shared/messages";
import { cacheClear, cacheGet, cacheSet } from "./cache";
import { bump, flushStats } from "./stats";
import { addsLink, addsSpeaker, claimsNoAnswer, dropTitleLine, dropUnsupported, entryLang, estTokens, heldBack, keepQuotes, langScript, listLang, movesKicker, quoteAsFact, reuseShort, scriptFits, scriptOf, splitText, stableContext, stableText, stripPreamble, swapsPerson, unquoted, unsupported } from "./text";

// ---------- settings ----------

let settingsP: Promise<Settings> | null = null;

async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get("settings");
  const s = mergeSettings((r.settings ?? {}) as Partial<Settings>);
  if (!s.apiKey) {
    // Development installs can ship a local key file (never committed).
    try {
      const res = await fetch(chrome.runtime.getURL("local-key.json"));
      if (res.ok) Object.assign(s, await res.json());
    } catch {
      /* no local key */
    }
  }
  return s;
}

function settings(): Promise<Settings> {
  return (settingsP ??= loadSettings());
}

chrome.storage.onChanged.addListener((ch) => {
  if (ch.settings) settingsP = null;
});

// ---------- prompts ----------

// 7: Short versions keep placeholders, links and the page's own headings, at half the length or less.
// 8: Short versions aim at a third of the length and never guess a job; one-liners keep variant details
// (color, size), never wrap the title ("A video titled X"), and keep "then-19" or "forced to" without datelines.
// 9: A teaser headline keeps its own words (it may stay a question), and no line says the story leaves something unanswered.
// 10: No line names who said, did, or chose something its title and context leave unnamed.
// 11: No line puts facts in an order or a cause its title and context do not state (a teaser's quote is not the story's setting).
// 12: Short versions are asked for in the page's language by name; a news line keeps a kicker's subject ("sus aliados" are
// the kicker's person's) and never sets a kicker's quote beside another noun.
const PROMPT_VERSION = 12;

const LINES_INTRO = `You rewrite entries from a list on a web page into plain, literal one-line descriptions, for people who need pages to be simple and fast to read: low vision, ADHD, dyslexia, older users.

Input: a JSON array of entries, each with id, title, usually lang, and sometimes context (channel, sender, price, snippet).`;

const LINES_RULES = `- Write the line in the language given by the entry's "lang" field. Never use any other language. If an entry has no "lang", use the language of its title.
- No clickbait: no ALL CAPS, no emojis, no hype words, no questions.
- Use only what the title and context state or clearly imply. Do not invent results, names, numbers, or reasons.
- Never say who said, did, or chose something unless the title or context names that person for it. "A phrase for posterity" stays "a phrase", not "X said a memorable phrase".
- Never put two facts in an order or make one the cause of the other ("after", "before", "because", "tras", "porque") unless the title or context does so.
- Keep names, brands, models, and numbers that identify the entry, and the details that tell similar entries apart, such as color, size, capacity, edition, or pack count.`;

const LINES_OUTPUT = `Output JSON Lines only: one object per line, {"id": "<id>", "s": "<line>"}, in input order, one line per entry.
No code fences. No other text.`;

const LINES_SYSTEM = `${LINES_INTRO}

The entries are videos, products, posts, or links. For each entry, write one plain line that says what it is about.
Rules:
- At most 12 words.
${LINES_RULES}
- If the title hides the topic, say plainly what is known.
- If the title is already plain and short, keep it almost as is.
- Never write "A video titled …", "Video titulado …", or the like. If nothing more than the title is known, write the title as it is.

${LINES_OUTPUT}
Example lines:
{"id": "x1", "s": "A beginner's guide to baking bread at home"}
{"id": "x2", "s": "Cómo hacer pan casero sin horno"}`;

const GIST_SYSTEM = `${LINES_INTRO}

The entries are messages (emails, notifications). For each one, write one plain line with its main point: what happened or what is asked, with any deadline, amount, or warning it states.
Rules:
- At most 20 words.
${LINES_RULES}

${LINES_OUTPUT}
Example lines:
{"id": "x1", "s": "Your electricity bill of $84 is due on March 3"}
{"id": "x2", "s": "Tu pedido llega mañana entre las 9 y las 13"}`;

const NEWS_SYSTEM = `${LINES_INTRO}

The entries are headlines from a news site. For each one, write one plain line that tells the news itself: who did what, with the key names, numbers, and claims the headline and context state.
Rules:
- At most 18 words.
${LINES_RULES}
- Say the news directly, the way a plain news line would. Never mention the headline, title, article, note, report, or story itself: never write "The headline says", "The article explains", "A report on", "El artículo informa", "El título pregunta", "La nota repasa", or the like. Wrong: "The headline claims a leaked list names five replacements". Right: "A leaked list names five possible replacements".
- Keep who said what: a claim stays a claim of its source ("X says", "según X"), never a fact. Keep a direct quote in quotation marks, with who said it.
- A quote that opens a headline and the story's event stay apart: the quote is not when, where, or why the event happened, and never what a thing in the headline is. Wrong: "The band made the song after the singer's death was reported" for "‘My death was reported’: how the band made the song". Right: "‘My death was reported’: how the band made the song". Wrong: "Guelar analyzed Lula's win, a “grave error”" for "“There was a grave error”. Guelar analyzed Lula's win". Right: "“There was a grave error”: Guelar analyzed Lula's win".
- A kicker before the headline ("Milei's friends.", "Los amigos de Milei.") says whose story it is. A possessive or pronoun in the headline ("sus aliados", "his allies") belongs to that person, not to the nearest other name. Keep the person the kicker names. Wrong: "Elections test Bolsonaro's allies after his defeat" for "Milei's friends. After Bolsonaro's defeat, the elections that test the club of his allies". Right: "Elections test Milei's allies after Bolsonaro's defeat".
- A name after "By" or "Por" is the writer of the piece. Never present the writer as a speaker or as the source of a quote or claim. Keep "I" and "we" as the headline has them: never turn them into a role such as "the writer", "the speaker", or "the authors".
- Keep exactly who did what to whom. Never swap the actor (fans are not teammates), and never drop a negation or a word that sets the relation, such as "not", "against", "contra", "sin", "sobre".
- Keep the words that set when, how, or how sure: "then-19", "former", "forced to", "allegedly", "reportedly". An age or a role at the time of the events stays with them.
- A dateline such as "Desde Managua" or "WASHINGTON —" only says where the writer is. Never put it in the line.
- Keep a short label that carries news, such as "Absuelto", "Live", "Opinion", or "Análisis", at the start, followed by a colon.
- Drop teaser openings ("You won't believe", "De no creer", "A horas de") and hype, never the facts.
- A question or a teaser that holds back its point ("the answer is …", "cuánto puede remontar", "here's why") is answered in the story, which you do not see. If the context gives the answer, say it. If not, write the headline in its own words, as it is; this is the one case where a line may be a question. Never restate it as a claim, and never add who asks, wonders, explains, says, or does it.
- Never say or hint that the story leaves something out, unanswered, unknown, or unclear: never write "does not give the answer", "remains unanswered", "it is unclear", "no se indica", "no se sabe", or the like, unless the headline or context says so itself.
- A column title that does not say what happened keeps its own words, made plain.
- If an entry is not a news story (an ad, a promotion, a call to action such as "Sign up", "Enter your zip code", or "Explore the collection", or a link to a section, newsletter, podcast, or app), write "s": "" for it.

${LINES_OUTPUT}
Example lines:
{"id": "x1", "s": "Senate passes the 2027 budget 52 to 48 after an all-night session"}
{"id": "x2", "s": "Absuelto: la Justicia libera al exintendente acusado de fraude"}
{"id": "x3", "s": ""}`;

const CONDENSE_FORMAT = `How the text is written:
- Lines that start with "## " or "### " are the page's own headings.
- A line such as [[B3]] stands for a part of the page that is not text: a code block, a button, a form, a table, an image, a video, small print, or a list of links. You do not see its content.
- [words](L3) is a link on those words.`;

const CONDENSE_RULES = `Rules:
- Same language as the text. Never translate.
- Keep what matters: names, roles, numbers, dates, places, prices, claims, who said what, causes and consequences, instructions and steps.
- Keep every warning, caveat, condition, exception, and statement of uncertainty, especially about health, safety, money, and law. Never make a claim stronger, weaker, or more general than the source does.
- Cut filler, repetition, background that adds no facts, side stories, promotions, and quotes that only repeat a point already made.
- Do not add facts, opinions, or interpretations. Never state a result, a reply, a role, or who said something unless the source states it. Describe people only with the names, jobs, roles, and ages the source states in words. Never give someone a job or title from what they do or where they stand (someone selling meat is not "a butcher" unless the source says so).
- Short, plain sentences. Common words. Active voice.
- Keep every [[B…]] line exactly as written, alone on its own line, in the same order as in the source. Never drop, change, merge, or move one.
- When you keep a sentence that has a link, keep the link on the same words, written as [words](L3). Never invent a link or a link id.
- Keep the page's own heading lines exactly as written, in the same order. Never add a heading of your own: if the source has no headings, write none.
- Write paragraphs and "- " bullet lists only, besides those heading and [[B…]] lines. No title, no bold, no tables, no code.
- No preamble and no closing remark.`;

const CONDENSE_SYSTEM = `Rewrite the web page text below into a much shorter version that keeps its full meaning, for people who need text to be simple and fast to read: low vision, ADHD, dyslexia, older users.

${CONDENSE_FORMAT}

${CONDENSE_RULES}
- Length: about a third of the words of the source text, never more than half. Shorten by leaving out, not only by rewording: drop scene-setting, background the reader does not need, points made twice, and quotes that only add color. Keep each fact the reader needs, in one short sentence.
- Start with one sentence that states the main point.`;

/** Later parts of a long text, condensed one after another and joined. */
const CONDENSE_PART_SYSTEM = `Rewrite the web page text below into a much shorter version that keeps its full meaning, for people who need text to be simple and fast to read: low vision, ADHD, dyslexia, older users. The text is a later part of a longer page; your rewrite is appended to the rewrite of the earlier parts.

${CONDENSE_FORMAT}

${CONDENSE_RULES}
- Length: about a third of the words of this part, never more than half. Shorten by leaving out, not only by rewording: drop scene-setting, background the reader does not need, points made twice, and quotes that only add color. Keep each fact the reader needs, in one short sentence.
- Continue directly: no summary sentence, no introduction.`;

// ---------- model calls ----------

interface Call {
  system: string;
  user: string;
  maxTokens: number;
  /** The smallest output budget still worth asking for (after a credit error). */
  minTokens: number;
  signal: AbortSignal;
  onText: (delta: string) => void;
}

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

class SlowStart extends Error {}

/** No data for this long in the middle of an answer: the stream is stuck. */
const STALL_MS = 60_000;
class Stalled extends Error {}

/**
 * The model stopped before the end: at its output limit, at a safety filter,
 * or the stream closed early. `final` means asking again would end the same way.
 */
class Incomplete extends Error {
  constructor(msg: string, public final: boolean) {
    super(msg);
  }
}

const REFUSED = [401, 402, 403];

/** A 403 for one input (moderation, a guardrail) rather than for the account. */
const BLOCKED_INPUT = /moderat|flagged|guardrail|content polic|safety/i;

// Models that just failed for credit or availability are skipped for a while,
// so every request does not pay for the same refusal first. Kept for the
// browser session, since the worker restarts often.
const SKIP_MS: Record<number, number> = { 402: 10 * 60_000, 404: 60 * 60_000 };
let skip: Record<string, { until: number; status: number }> = {};
const skipLoaded = chrome.storage.session
  .get("modelSkip")
  .then((r) => (skip = { ...(r.modelSkip as typeof skip | undefined), ...skip }))
  .catch(() => {});

/** A model and its routing: the same model on another provider may still work. */
const linkId = (m: ModelCfg) => m.model + " " + m.extra.trim();

// A new key or new models may work at once.
chrome.storage.onChanged.addListener((ch) => {
  if (!ch.settings) return;
  skip = {};
  chrome.storage.session.remove("modelSkip").catch(() => {});
  // A new key may work: say so again if it does not.
  told = {};
  chrome.storage.session.remove("told").catch(() => {});
});

function skipModel(id: string, status: number) {
  skip[id] = { until: Date.now() + SKIP_MS[status], status };
  chrome.storage.session.set({ modelSkip: skip }).catch(() => {});
}

async function streamChat(s: Settings, cfg: ModelCfg, c: Call, firstTokenMs: number): Promise<void> {
  if (c.signal.aborted) throw new DOMException("aborted", "AbortError");
  let extra: Record<string, unknown> = {};
  try {
    extra = cfg.extra ? JSON.parse(cfg.extra) : {};
  } catch {
    /* ignore bad extra JSON */
  }
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  c.signal.addEventListener("abort", abort);
  let started = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    if (!started) ctrl.abort(new SlowStart("slow start"));
  }, firstTokenMs);
  try {
    const res = await fetch(s.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + s.apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sift.pujia.ar",
        "X-Title": "Sift",
      },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        temperature: 0.2,
        max_tokens: c.maxTokens,
        messages: [
          { role: "system", content: c.system },
          { role: "user", content: c.user },
        ],
        ...extra,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      // A flagged input ends this request only; the account is fine.
      if (res.status === 403 && BLOCKED_INPUT.test(body)) throw new Incomplete("blocked by a content filter", true);
      throw new HttpError(res.status, body);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let finish = "";
    // The worker is kept alive while a request runs, so a stream that goes
    // silent would otherwise wait forever.
    const stall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => ctrl.abort(new Stalled("stalled")), STALL_MS);
    };
    stall();
    const check = () => {
      // Only a normal stop means the text is complete.
      if (finish === "stop" || finish === "end_turn") return;
      if (finish === "length") throw new Incomplete("output limit reached", true);
      if (finish === "content_filter") throw new Incomplete("stopped by a safety filter", true);
      throw new Incomplete("stopped early: " + (finish || "no finish reason"), false);
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return check();
      stall();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return check();
        let j: any;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        if (j.error) {
          const msg = String(j.error.message ?? j.error);
          if (Number(j.error.code) === 403 && BLOCKED_INPUT.test(msg)) throw new Incomplete("blocked by a content filter", true);
          throw new HttpError(Number(j.error.code) || 500, msg);
        }
        const d = j.choices?.[0]?.delta?.content;
        if (d) {
          started = true;
          c.onText(d);
        }
        finish = j.choices?.[0]?.finish_reason || finish;
        if (finish === "length") throw new Incomplete("output limit reached", true);
      }
    }
  } catch (e) {
    if (ctrl.signal.reason instanceof SlowStart) throw ctrl.signal.reason;
    if (ctrl.signal.reason instanceof Stalled) throw new Incomplete("stopped early: no data for a minute", false);
    throw e;
  } finally {
    clearTimeout(timer);
    clearTimeout(stallTimer);
    c.signal.removeEventListener("abort", abort);
  }
}

/** One model; after a credit error, once more with a smaller output budget if that is still useful. */
async function tryModel(s: Settings, cfg: ModelCfg, c: Call, firstTokenMs: number) {
  let sent = false;
  const watched = { ...c, onText: (d: string) => ((sent = true), c.onText(d)) };
  try {
    await streamChat(s, cfg, watched, firstTokenMs);
  } catch (e) {
    // Text already shown cannot be taken back, so a retry would repeat it.
    if (!(e instanceof HttpError) || e.status !== 402 || sent) throw e;
    // OpenRouter says how many tokens the balance still covers. With nothing
    // left it names no amount, and a smaller budget cannot help.
    const afford = /afford (\d+)/.exec(e.message);
    if (!afford) throw e;
    const smaller = Math.min(Number(afford[1]), c.maxTokens - 1);
    if (smaller < c.minTokens || smaller >= c.maxTokens) throw e;
    try {
      await streamChat(s, cfg, { ...c, maxTokens: smaller }, firstTokenMs);
    } catch (e2) {
      // Running out of the smaller budget says nothing about the text itself.
      if (e2 instanceof Incomplete && e2.final && /output limit/.test(e2.message)) throw new Incomplete(e2.message, false);
      throw e2;
    }
  }
}

/** The error after every model failed: "refused" when each one was refused (credit, key). */
class ChainError extends Error {
  /** `link`: the model and route whose error is `last`. */
  constructor(public last: unknown, public refused: boolean, public status?: number, public link?: string) {
    super(String((last as Error)?.message ?? last));
  }
}

/**
 * Tries each model in turn, on an error or a slow start before any text. A
 * model that refused for credit is skipped for a while. Text already shown
 * cannot be taken back, so an error after the first text ends the chain.
 */
async function withChain(s: Settings, chain: ModelCfg[], c: Call, firstTokenMs: number, tried?: { m: ModelCfg; e?: unknown }[]) {
  await skipLoaded;
  const seen = new Set<string>();
  const links = chain.filter((m) => m.model && !seen.has(linkId(m)) && seen.add(linkId(m)));
  let any = false;
  const wrapped = { ...c, onText: (d: string) => ((any = true), c.onText(d)) };
  let last: unknown = new Error("no model");
  let refused = true;
  let status: number | undefined;
  let link: string | undefined;
  for (const [i, m] of links.entries()) {
    const sk = skip[linkId(m)];
    link = linkId(m);
    if (sk && sk.until > Date.now()) {
      last = new HttpError(sk.status, `${m.model} skipped after HTTP ${sk.status}`);
      status = sk.status;
      refused &&= REFUSED.includes(sk.status);
      continue;
    }
    const t: { m: ModelCfg; e?: unknown } = { m };
    tried?.push(t);
    try {
      return await tryModel(s, m, wrapped, firstTokenMs * (i ? 3 : 1));
    } catch (e) {
      t.e = e;
      if (c.signal.aborted) throw e;
      if (any) throw new ChainError(e, false, e instanceof HttpError ? e.status : undefined, link);
      last = e;
      bump("error");
      const st = e instanceof HttpError ? e.status : undefined;
      status = st;
      refused &&= st !== undefined && REFUSED.includes(st);
      if (st && SKIP_MS[st]) skipModel(linkId(m), st);
    }
  }
  throw new ChainError(last, refused, status, link);
}

async function hash(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const detect = (text: string) => chrome.i18n.detectLanguage(text).catch(() => null);

const DAY = 24 * 60 * 60_000;
/** Results from signed-in pages (email gists, Short versions of private pages) are kept this long only. */
const PRIVATE_TTL = 7 * DAY;

// What the user was already told in this browser session: that there is no
// key, or that every model refused. Told once, not on every page.
let told: Record<string, boolean> = {};
const toldLoaded = chrome.storage.session
  .get("told")
  .then((r) => (told = { ...(r.told as typeof told | undefined), ...told }))
  .catch(() => {});

async function toldBefore(what: "nokey" | "refused"): Promise<boolean> {
  await toldLoaded;
  if (told[what]) return true;
  told[what] = true;
  chrome.storage.session.set({ told }).catch(() => {});
  return false;
}

/** Cached instead of a short version that cannot be made, so it is not paid for again. */
const NO_SHORT = "\u0000no-short";
/** Cached for a one-line rewrite that came back in the wrong language: the title stays. */
const KEEP_TITLE = "\u0000keep-title";

/** The final error behind a failed chain, if the text itself cannot be done. */
function finalIncomplete(e: unknown): Incomplete | null {
  const inner = e instanceof ChainError ? e.last : e;
  return inner instanceof Incomplete && inner.final ? inner : null;
}

// ---------- tasks ----------

type Reply = (r: AiReply) => void;

/** One page's connection: whether the page turned out to be signed-in, and what it saved before that was known. */
interface PortCtx {
  private: boolean;
  saved: Map<string, string>;
  /** The language of this page's lines, once settled (see doLines): a promise, so batches sent together share one decision. */
  lang?: Promise<string>;
  /** Calls this page spent asking again for list entries a filter or an output limit stopped (see doLines). */
  lineRetries?: number;
}

/** How long a result is kept: short for a signed-in page, even one found to be so after it asked. */
function ttlOf(req: { private?: boolean }, pc: PortCtx): number | undefined {
  return req.private || pc.private ? PRIVATE_TTL : undefined;
}

/** Saves a result, remembering one kept for the full time in case the page turns out to be signed-in. */
function save(pc: PortCtx, req: { private?: boolean }, key: string, v: string) {
  const ttl = ttlOf(req, pc);
  cacheSet(key, v, ttl);
  if (!ttl) pc.saved.set(key, v);
}

/** The page's language, or "" when it is not known. */
const knownLang = (lang: string) => {
  const b = (lang || "").trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(b) && b !== "und" && b !== "mul" && b !== "zxx" ? b : "";
};

/** A filler line that only names the kind of entry and its title: "A video titled X", "Video titulado X". */
const FILLER =
  /^(?:(?:a|an|the|this|new)\s+)?(?:video|clip|song|short|film|movie|episode|stream|livestream|podcast|post|track|music video|product|item|listing|story|article|email|message)\s+(?:titled|called|named|entitled)\b|^(?:(?:un|una|el|la|este|esta|nuevo|nueva)\s+)?(?:video|vídeo|clip|canción|corto|película|episodio|directo|podcast|publicación|tema|producto|artículo|nota|correo|mensaje)\s+(?:titulad[oa]|llamad[oa]|denominad[oa])\b|^(?:(?:um|uma|o|a)\s+)?(?:vídeo|video|clipe|música|canção|filme|episódio|produto|mensagem)\s+(?:intitulad[oa]|chamad[oa])\b/iu;
const plainWords = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * A line that says no more than the title: filler around it ("A video titled
 * X"), or the title word for word with at most a few words added.
 */
function wrapsTitle(line: string, title: string): boolean {
  if (FILLER.test(line.trim())) return true;
  const l = plainWords(line);
  const t = plainWords(title);
  if (t.length < 2 || l.length < t.length) return false;
  return ` ${l.join(" ")} `.includes(` ${t.join(" ")} `) && l.length - t.length <= 4;
}

/** Most calls per page spent asking again, in smaller batches, for list entries a filter or an output limit stopped. */
const MAX_LINE_CALLS = 12;
/** How long entries left unsettled at that limit keep their titles, so a revisit does not pay for the same search again. */
const UNSETTLED_MS = 6 * 60 * 60_000;

/** What a line's quotes must come from: its entry's title and context. */
const quoteSource = (it: LineInput) => it.t + "\n" + (it.c ?? "");

async function doLines(req: Extract<AiRequest, { task: "lines" }>, reply: Reply, signal: AbortSignal, useCache: boolean, site: string, pc: PortCtx) {
  const s = await settings();
  const mode = req.mode ?? "about";
  // One language for every line on the page: the page's, unless nearly all
  // titles are clearly in another one (a site that marks Spanish pages "en").
  // Settled once per page, by the first batch however small when the page's
  // language is known (a few titles keep it), so a later list matches the
  // first, and a batch sent with the first waits for its decision instead of
  // making its own. Only when neither is known does each title decide, and
  // then the title alone: context is often a name ("King Von") that looks foreign.
  // Names of videos, songs, and products, and messages, are often in another
  // language than the page (English songs on a Spanish YouTube): their lines
  // are always in the page's language when it is known. Only headlines may
  // move a list away from it (a news site that marks Spanish pages "en").
  const page = knownLang(req.lang);
  let langP = page && mode !== "news" ? Promise.resolve(page) : pc.lang;
  if (!langP) {
    langP = listLang(req.items.map((it) => it.t), page, detect);
    if (page || req.items.length >= 4) pc.lang = langP;
  }
  const list = await langP;
  const langs = list ? req.items.map(() => list) : await Promise.all(req.items.map((it) => entryLang(it.t, req.lang, detect)));
  // Keyed by site, so one site can neither read nor plant another site's lines;
  // and without the context's ticking parts ("12h ago"), so a revisit does not pay again.
  const keys = await Promise.all(req.items.map((it, i) => hash(`lines|${PROMPT_VERSION}|${site}|${mode}|${s.lines.model}|${langs[i]}|${it.t}|${stableContext(it.c ?? "")}`)));
  const misses: { it: LineInput; key: string; lang: string }[] = [];
  for (const [i, it] of req.items.entries()) {
    // A teaser that holds back its answer, with nothing in its context that
    // could give it: any rewrite would guess the answer or call it missing.
    // Its own words stay, and nothing is paid for.
    if (mode === "news" && heldBack(it.t, it.c)) continue;
    const hit = useCache ? await cacheGet(keys[i]) : undefined;
    if (hit && !ttlOf(req, pc)) pc.saved.set(keys[i], hit);
    if (hit === KEEP_TITLE) continue;
    // A saved line passes the same checks as a new one (it may have been saved
    // before they existed, or for an older context); one that fails keeps the title.
    const shown = hit && (hit === it.t ? hit : scriptFits(hit, langs[i] ? langScript(langs[i]) : scriptOf(it.t), it.t) && vetLine(hit, it, mode));
    if (shown) reply({ id: req.id, item: it.id, text: shown });
    else if (!hit) misses.push({ it, key: keys[i], lang: langs[i] });
  }
  if (!misses.length) return reply({ id: req.id, done: true });
  if (!s.apiKey) return reply({ id: req.id, error: "No API key", code: "nokey", quiet: await toldBefore("nokey") });
  bump("aiLines", misses.length);
  const perItem = mode === "about" ? 50 : 70;
  /** About the longest line, in characters (12 words, or 18 to 20). */
  const lineChars = mode === "about" ? 100 : 140;
  type Miss = (typeof misses)[number];
  /** One call for some of the entries: the error it ended in, if any, and the entries it gave no line for. */
  const ask = async (part: Miss[], chain: ModelCfg[], tried?: { m: ModelCfg; e?: unknown }[]): Promise<{ err: unknown; left: Miss[] }> => {
    // Short ids keep the prompt small; map them back afterwards.
    const byShort = new Map(part.map((m, i) => [String(i + 1), m]));
    const input = part.map((m, i) => ({ id: String(i + 1), lang: m.lang || undefined, title: m.it.t, context: m.it.c || undefined }));
    let buf = "";
    const done = new Set<string>();
    const checks: Promise<void>[] = [];
    const emit = (line: string) => {
      const l = line.trim().replace(/^```(json)?|```$/g, "").trim();
      if (!l.startsWith("{")) return;
      try {
        const o = JSON.parse(l);
        const m = byShort.get(String(o.id));
        if (!m || typeof o.s !== "string" || done.has(String(o.id))) return;
        // In news mode, an empty line means "not a story" (a promo), and a line
        // that fails the checks (see vetLine) is no better: keep the title, as the line.
        let text = vetLine(o.s, m.it, mode);
        if (mode === "news" && !text) text = m.it.t;
        if (!text && !o.s.trim()) return;
        done.add(String(o.id));
        // Elsewhere such a line keeps the title, remembered so it is not paid for again.
        if (!text) {
          if (useCache) save(pc, req, m.key, KEEP_TITLE);
          return;
        }
        const want = m.lang;
        // Models sometimes ignore the language they were given (an English title
        // came back in German, a Russian one in Persian). A line in another
        // script or clearly in another language is dropped and the original
        // title stays, remembered so it is not paid for again.
        checks.push(lineFits(text, want, m.it.t).then((ok) => {
          if (!ok) {
            if (useCache) save(pc, req, m.key, KEEP_TITLE);
            return;
          }
          reply({ id: req.id, item: m.it.id, text });
          if (useCache) save(pc, req, m.key, text);
        }));
      } catch {
        /* partial or malformed line */
      }
    };
    // A line in a script that takes many tokens (Tamil, Hindi) needs more than
    // the flat budget: sized by its title's tokens per character, at a line's length.
    const budget = part.reduce((n, m) => n + Math.max(perItem, Math.ceil((estTokens(m.it.t) / Math.max(1, m.it.t.length)) * Math.min(m.it.t.length, lineChars)) + 20), 0);
    let err: unknown;
    try {
      await withChain(
      s,
      chain,
      {
        system: mode === "gist" ? GIST_SYSTEM : mode === "news" ? NEWS_SYSTEM : LINES_SYSTEM,
        user: JSON.stringify(input),
        maxTokens: 120 + budget,
        minTokens: 60 + Math.round(budget / 2),
        signal,
        onText(d) {
          buf += d;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            emit(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        },
      },
        2500,
        tried,
      );
    } catch (e) {
      err = e;
    } finally {
      // Every line goes out before "done" or the error: the page stops listening after either.
      emit(buf);
      await Promise.allSettled(checks);
    }
    return { err, left: [...byShort].flatMap(([id, m]) => (done.has(id) ? [] : [m])) };
  };
  // A filter or an output limit stops a batch, not each entry: the entries it
  // left are asked again in halves, so one flagged title, or lines in a script
  // that takes many tokens, cost no other entry its line. The halves go to the
  // first model that stopped so, one call each; the other models are asked
  // only for an entry that fails alone, last. Such an entry keeps its title,
  // for a day, so a revisit does not pay again. The calls spent so are capped
  // per page: entries left then keep their titles for a few hours.
  const chain = [s.lines, s.linesFallback, s.lastResort];
  let unsettled: unknown;
  let one: ModelCfg[] = chain;
  /** Entries that failed alone, with the models already asked for each. */
  const alone: { m: Miss; asked: ModelCfg[] }[] = [];
  // Calls spent after a filter count per page; after an output limit (each
  // call still brings lines), per batch.
  let batchCalls = 0;
  const spent = () => pc.lineRetries ?? 0;
  const keepTitle = (m: Miss, ms: number) => useCache && cacheSet(m.key, KEEP_TITLE, Math.min(ttlOf(req, pc) ?? ms, ms));
  // Larger parts first, so the calls the cap allows settle the most entries.
  const queue: { part: Miss[]; why?: unknown }[] = [{ part: misses }];
  for (let q = queue.shift(); q; q = queue.shift()) {
    const { part, why } = q;
    const filtered = why !== undefined && /filter/.test(finalIncomplete(why)?.message ?? "");
    if (why !== undefined && (filtered ? spent() : batchCalls) >= MAX_LINE_CALLS) {
      unsettled = why;
      for (const m of part) keepTitle(m, UNSETTLED_MS);
      continue;
    }
    const tried: { m: ModelCfg; e?: unknown }[] = [];
    const r = await ask(part, why === undefined ? chain : one, tried);
    if (filtered) pc.lineRetries = spent() + tried.length;
    else if (why !== undefined) batchCalls += tried.length;
    if (!r.err) continue;
    if (!finalIncomplete(r.err) || signal.aborted) throw r.err;
    if (!r.left.length) continue;
    if (why === undefined) one = [tried.find((t) => finalIncomplete(t.e))?.m ?? chain[0]];
    if (part.length === 1) {
      alone.push({ m: part[0], asked: tried.map((t) => t.m) });
      continue;
    }
    const half = Math.ceil(r.left.length / 2);
    queue.push({ part: r.left.slice(0, half), why: r.err });
    if (half < r.left.length) queue.push({ part: r.left.slice(half), why: r.err });
  }
  // An entry that failed alone is asked of the other models, while calls are
  // left; refused by them too (or with no calls left), it keeps its title.
  for (const { m, asked } of alone) {
    if (signal.aborted) break;
    const rest = chain.filter((c) => c.model && !asked.some((a) => linkId(a) === linkId(c)));
    if (rest.length && spent() < MAX_LINE_CALLS) {
      const tried: { m: ModelCfg; e?: unknown }[] = [];
      const r = await ask([m], rest, tried);
      pc.lineRetries = spent() + tried.length;
      // Not refused, only failed (a busy model): asked again on a later visit.
      if (!r.err || !r.left.length || !finalIncomplete(r.err)) continue;
    }
    keepTitle(m, DAY);
  }
  if (unsettled) throw unsettled;
  reply({ id: req.id, done: true });
}

/**
 * A one-line rewrite is in the language asked for: written in its script
 * (or, with no language given, the title's own), and not clearly another
 * language of the same script.
 */
async function lineFits(text: string, want: string, title: string): Promise<boolean> {
  if (!scriptFits(text, want ? langScript(want) : scriptOf(title), title)) return false;
  if (!want) return true;
  const got = await entryLang(text, want, detect, true);
  return !got || got === want;
}

/**
 * A model's line for a list entry as it may be shown, its quotes as the title
 * and context have them; null when the title should stay instead. The model
 * saw only the title and context, so a line fails when it states a quote, a
 * speaker, or a number they do not; when it says the story or video leaves
 * something unanswered (a guess; a message's gist may rightly say "you did not
 * provide…"), or has a named person say something they tie no words to; in news mode, when it talks about the headline instead of the
 * news; elsewhere, when it only wraps the title ("A video titled X").
 */
function vetLine(raw: string, it: LineInput, mode: string): string | null {
  const src = quoteSource(it);
  const text = keepQuotes(raw.trim(), src).replace(/[.。]$/, "");
  if (!text || unsupported(raw.trim(), src)) return null;
  if (mode !== "gist" && (claimsNoAnswer(text, src) || addsSpeaker(text, src) || addsLink(text, src) || quoteAsFact(text, it.t))) return null;
  // A group or an ally given to the wrong person, or a kicker's quote set beside another noun (F1036).
  if (mode !== "gist" && (swapsPerson(text, src) || movesKicker(text, it.t) || movesKicker(text, it.c ?? ""))) return null;
  if (mode === "news" ? META.test(text) : wrapsTitle(text, it.t)) return null;
  return text;
}

/** A news line that talks about the headline or article instead of the news. */
const META =
  /\b(the|this) (headline|title|article|story|piece|report|feature) (says|asks|claims|alleges|describes|reports|invites|explains|suggests|teases|notes|reviews|raises|poses|questions|wonders|highlights|details|discusses|examines|looks at|argues|warns|states|mentions|reveals|tells|lists|covers|focuses|weighs|considers|ponders|withholds|leaves)\b|\b(el titular|el título|la nota|el artículo|la noticia|la columna|a manchete|o título|o artigo|a notícia|a matéria) (dice|pregunta|informa|repasa|explica|analiza|afirma|describe|invita|plantea|cuenta|detalla|señala|destaca|aborda|advierte|sugiere|revela|muestra|indica|recoge|diz|pergunta|questiona|mostra|aponta|destaca|revela)\b/i;

/** Longest part of a text condensed in one call; longer text goes in parts. */
const PART_TOKENS = 6000;

/** A Short version must be at least this much shorter than its source, or the full text is shown. */
const MAX_RATIO = 0.7;
/** And it must have at most this share of the source's words (readers count words, not characters). */
const MAX_WORD_RATIO = 0.75;

/** The prose of a text sent to condense or of its rewrite: no placeholders, link ids, or headings. */
const proseText = (md: string) => md.replace(/\[\[\s*B\d+\s*\]\]/g, " ").replace(/\[([^[\]]*)\]\(\s*#?L\d+\s*\)/g, "$1").replace(/^#{1,6}\s.*$/gm, "");

const proseTokens = (md: string) => estTokens(proseText(md));

/** Words of prose, also in languages written without spaces. */
function proseWords(md: string, lang: string): number {
  const text = proseText(md);
  try {
    let n = 0;
    for (const sg of new Intl.Segmenter(lang || undefined, { granularity: "word" }).segment(text)) if (sg.isWordLike) n++;
    return n;
  } catch {
    return (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  }
}

/** A language's English name, to tell the model which one to write in ("Portuguese" for "pt"). */
function langName(lang: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

/**
 * The language a Short version is written in: the page's, unless its text is
 * clearly in another one (a Spanish page marked "en"). "" when neither is known.
 */
const condenseLang = (req: { lang: string; text: string }) => entryLang(proseText(req.text).slice(0, 6000), req.lang, detect);

/**
 * A Short version in the language asked for (F1035): written in its script,
 * and neither as a whole nor in any paragraph of a dozen words or more clearly
 * in another language. Quotes are left out: they keep their speaker's words.
 */
async function condenseFits(out: string, want: string): Promise<boolean> {
  if (!want) return true;
  const prose = unquoted(proseText(out));
  if (!scriptFits(prose, langScript(want))) return false;
  for (const p of [prose, ...prose.split(/\n+/).filter((p) => (p.match(/\p{L}+/gu)?.length ?? 0) >= 12)]) {
    const got = await entryLang(p, want, detect, true);
    if (got && got !== want) return false;
  }
  return true;
}

async function doCondense(req: Extract<AiRequest, { task: "condense" }>, reply: Reply, signal: AbortSignal, useCache: boolean, site: string, pc: PortCtx) {
  const s = await settings();
  // Keyed by the article's own text: a share button, a comment count, a
  // reading time, or a count in the tab's title differ between visits of the
  // same article, and must not make it a new one (paid for again).
  const title = req.title.replace(/^\s*\(\d+\+?\)\s*/, "");
  const key = await hash(`condense|${PROMPT_VERSION}|${site}|${s.condense.model}|${title}|${stableText(req.text)}`);
  // The latest Short version of this article, with the text it was made from:
  // the page may have loaded more or less of it this time, or shown a
  // promotion that came and went, and the text sent differs from the last visit's.
  const artKey = await hash(`condense-article|${PROMPT_VERSION}|${site}|${s.condense.model}|${title}`);
  const hit = useCache ? await cacheGet(key) : undefined;
  if (hit && !ttlOf(req, pc)) pc.saved.set(key, hit);
  if (hit === NO_SHORT) return reply({ id: req.id, error: "no short version for this text", code: "http", final: true });
  // Always the page's language, named to the model: an output in another one is never shown or saved (F1035).
  const want = await condenseLang(req);
  /** What a Short version may state: the title and the text. */
  const source = req.title + "\n" + req.text;
  // A saved Short version passes the same checks as a new one: it may have
  // been saved before they existed, or from a text whose numbers changed since.
  // One in another language (saved before this check) is made again.
  if (hit && (await condenseFits(hit, want))) return finish(checked(hit));
  // One made from an earlier text of the same article that covers all of this
  // one's prose: renumbered to this text, checked against it, and measured
  // against the text it was made from.
  const prior = useCache ? await cacheGet(artKey) : undefined;
  if (prior) {
    try {
      const p = JSON.parse(prior) as { text: string; out: string };
      const reused = reuseShort(p.out, p.text, req.text);
      if (reused && !tooLong(reused, p.text) && (await condenseFits(reused, want))) {
        if (!ttlOf(req, pc)) pc.saved.set(artKey, prior);
        const out = checked(reused);
        save(pc, req, key, out);
        return finish(out, p.text);
      }
    } catch {
      /* an older or broken entry: made again */
    }
  }
  if (!s.apiKey) return reply({ id: req.id, error: "No API key", code: "nokey", quiet: await toldBefore("nokey") });
  bump("aiCondense");
  let all = "";
  const parts = splitText(req.text, PART_TOKENS);
  // A failed call saves nothing (it throws): a later visit asks again. A text
  // every model stopped at a filter or an output limit is remembered for a day,
  // so a revisit does not pay for the same stop again.
  try {
  for (const [i, part] of parts.entries()) {
    if (i) all += "\n\n";
    const from = all.length;
    // The output is at most about as long as the input; size it by script.
    const est = estTokens(part);
    // Models keep far more than asked unless given a number.
    const words = proseWords(part, req.lang);
    // A rewrite that came back hardly shorter is asked for once more, told how
    // long it was: a slow fallback model often keeps nearly everything at first.
    let note = "";
    for (let again = 0; again < 2; again++) {
      all = all.slice(0, from);
      await withChain(
        s,
        [s.condense, s.condenseFallback, s.lastResort],
        {
          system: i ? CONDENSE_PART_SYSTEM : CONDENSE_SYSTEM,
          user: `Title: ${req.title}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}\n${want ? `The text is in ${langName(want)}. Write in ${langName(want)}.\n` : ""}The text has ${words} words. Write about ${Math.max(30, Math.round(words * 0.35))} words, and never more than ${Math.max(30, Math.round(words * 0.5))}, not counting heading and [[B…]] lines.${note}\n\n${part}`,
          maxTokens: Math.min(8000, 300 + est),
          minTokens: Math.min(8000, 300 + Math.round(est * 0.7)),
          signal,
          // The page shows the Short version only once it is whole, so nothing streams.
          onText(d) {
            all += d;
          },
        },
        2000,
      );
      // A note of the model's own about its task ("El texto fuente contiene…") is not part of the text.
      all = all.slice(0, from) + stripPreamble(all.slice(from));
      const got = all.slice(from);
      // A rewrite in another language (an English one of a Portuguese article) is asked for once more, told so; never shown or saved.
      if (!(await condenseFits(got, want))) {
        if (again) return reply({ id: req.id, error: "the Short version came back in another language", code: "http", final: true });
        note = ` A first rewrite was not in ${langName(want)}. Write only in ${langName(want)}, the language of the text. Never translate.`;
        continue;
      }
      if (!(proseTokens(got) > proseTokens(part) * MAX_RATIO || proseWords(got, req.lang) > words * MAX_WORD_RATIO)) break;
      note = ` A first rewrite had ${proseWords(got, req.lang)} words: far too many. Leave out more.`;
    }
  }
  } catch (e) {
    if (finalIncomplete(e) && useCache) cacheSet(key, NO_SHORT, Math.min(ttlOf(req, pc) ?? DAY, DAY));
    throw e;
  }
  all = checked(all);
  // "Not much shorter" is kept for a day at most, whichever model wrote it: a
  // slow fallback's long answer must not block the article for a month.
  if (all.trim() && useCache) {
    if (tooLong(all)) cacheSet(key, NO_SHORT, Math.min(ttlOf(req, pc) ?? DAY, DAY));
    else {
      save(pc, req, key, all);
      save(pc, req, artKey, JSON.stringify({ text: req.text, out: all }));
    }
  }
  finish(all);

  /**
   * A Short version as it may be shown: no note of the model's own, quotes word
   * for word (a changed one is put back as the source has it), and no sentence
   * that states a quote, a speaker, or a number the source does not.
   */
  function checked(out: string) {
    // The input's "Title:" field echoed as a line is no part of the text.
    return keepQuotes(dropUnsupported(stripPreamble(dropTitleLine(out, req.title, req.text)), source), source);
  }

  /** `from`: the text the Short version was made from. */
  function finish(out: string, from = req.text) {
    // A "Short version" that is barely shorter is not worth reading instead of the original.
    if (tooLong(out, from)) return reply({ id: req.id, error: "not much shorter than the full text", code: "http", final: true });
    if (out.trim()) reply({ id: req.id, full: out });
    reply({ id: req.id, done: true });
  }
  /** Too long to be worth it, by length and by words: a rewrite in shorter words can be much shorter yet hardly fewer. */
  function tooLong(out: string, from = req.text) {
    return proseTokens(out) > proseTokens(from) * MAX_RATIO || proseWords(out, req.lang) > proseWords(from, req.lang) * MAX_WORD_RATIO;
  }
}

/** The site a page belongs to, for cache keys. */
function siteOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostIn(url: string | undefined, list: string[]): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    // Entries saved before Options normalized them may have capitals, a "www." or a port.
    return list.some((e) => {
      const d = e.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
      return !!d && (h === d || h.endsWith("." + d));
    });
  } catch {
    return false;
  }
}

// Chrome stops a worker that makes no extension call for 30 s, even in the
// middle of a model's answer (reading a fetch does not count), and the answer
// is lost. While any request runs, a cheap call every 20 s keeps it alive.
let running = 0;
let keepAlive: ReturnType<typeof setInterval> | undefined;
function busy(on: boolean) {
  running = Math.max(0, running + (on ? 1 : -1));
  if (on && running === 1) keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20_000);
  if (!running) clearInterval(keepAlive);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sift-ai") return;
  const ctrl = new AbortController();
  /** Each request's own abort, for a page that no longer needs it. */
  const reqs = new Map<number, AbortController>();
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
    ctrl.abort();
  });
  const reply = (r: AiReply) => {
    if (open) port.postMessage(r);
  };
  // Incognito pages are never written to the on-disk cache.
  const useCache = !port.sender?.tab?.incognito;
  const site = siteOf(port.sender?.url);
  const pc: PortCtx = { private: false, saved: new Map() };
  port.onMessage.addListener(async (req: AiRequest) => {
    if (req.task === "private") {
      // The page turned out to be signed-in (its header came late): what it
      // already saved is saved again for the short time only.
      pc.private = true;
      for (const [key, v] of pc.saved) cacheSet(key, v, PRIVATE_TTL);
      pc.saved.clear();
      return;
    }
    if (req.task === "cancel") {
      reqs.get(req.id)?.abort();
      reqs.delete(req.id);
      return;
    }
    const rc = new AbortController();
    const stop = () => rc.abort();
    ctrl.signal.addEventListener("abort", stop);
    reqs.set(req.id, rc);
    busy(true);
    const end = () => {
      reqs.delete(req.id);
      ctrl.signal.removeEventListener("abort", stop);
      busy(false);
    };
    // The settings are enforced here too, not only in the page.
    const s = await settings();
    if (!s.ai || hostIn(port.sender?.url, s.neverSift)) {
      end();
      return reply({ id: req.id, error: "off", code: "off" });
    }
    const run = req.task === "lines" ? doLines(req, reply, rc.signal, useCache, site, pc) : doCondense(req, reply, rc.signal, useCache, site, pc);
    run
      .catch(async (e: unknown) => {
        if (rc.signal.aborted) return;
        bump("error");
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        if (e instanceof ChainError) {
          const status = e.status;
          const final = !!finalIncomplete(e) || undefined;
          if (e.refused) return reply({ id: req.id, error: msg, code: "refused", status, quiet: await toldBefore("refused") });
          // A model that stopped at a filter or a limit answered: that is not a network failure.
          return reply({ id: req.id, error: msg, code: e.last instanceof HttpError || e.last instanceof Incomplete ? "http" : "network", status, final });
        }
        if (e instanceof Incomplete) return reply({ id: req.id, error: msg, code: "http", final: e.final });
        reply({ id: req.id, error: msg, code: e instanceof HttpError ? "http" : "network", status: e instanceof HttpError ? e.status : undefined });
      })
      .finally(end);
  });
});

// ---------- toggle: toolbar button and keyboard shortcut ----------

async function toggleTab(tabId?: number) {
  if (tabId === undefined) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: "toggle" } satisfies RuntimeMsg).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => toggleTab(tab.id));
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === "toggle-view") toggleTab();
});

chrome.runtime.onMessage.addListener((msg: RuntimeMsg, sender, sendResponse) => {
  if (msg.type === "stat") bump(msg.name, msg.n ?? 1, msg.ms);
  if (msg.type === "clearCache") {
    // Only Sift's own pages (Options) may clear the saved rewrites, not a content script.
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
    cacheClear().then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
  if (msg.type === "config") {
    // Pages get only what they need; the API key never leaves the worker.
    settings().then((s) => sendResponse({ scale: s.scale, ai: s.ai, never: hostIn(sender.url, s.neverSift) }));
    return true;
  }
});

// Content scripts must not read storage (the API key lives there).
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => flushStats());
chrome.runtime.onStartup.addListener(() => flushStats());
