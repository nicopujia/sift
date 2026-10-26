// Sift's background service worker: calls the language model (streaming),
// caches results, relays the toolbar button and shortcut, and keeps
// anonymous usage counts.

import type { AiReply, AiRequest, LineInput, ModelCfg, RuntimeMsg, Settings } from "../shared/messages";
import { mergeSettings } from "../shared/messages";
import { cacheClear, cacheGet, cacheSet } from "./cache";
import { bump, flushStats } from "./stats";
import { entryLang, estTokens, keepQuotes, langScript, listLang, scriptFits, scriptOf, splitText } from "./text";

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
const PROMPT_VERSION = 8;

const LINES_INTRO = `You rewrite entries from a list on a web page into plain, literal one-line descriptions, for people who need pages to be simple and fast to read: low vision, ADHD, dyslexia, older users.

Input: a JSON array of entries, each with id, title, usually lang, and sometimes context (channel, sender, price, snippet).`;

const LINES_RULES = `- Write the line in the language given by the entry's "lang" field. Never use any other language. If an entry has no "lang", use the language of its title.
- No clickbait: no ALL CAPS, no emojis, no hype words, no questions.
- Use only what the title and context state or clearly imply. Do not invent results, names, numbers, or reasons.
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
- A name after "By" or "Por" is the writer of the piece. Never present the writer as a speaker or as the source of a quote or claim.
- Keep exactly who did what to whom. Never swap the actor (fans are not teammates), and never drop a negation or a word that sets the relation, such as "not", "against", "contra", "sin", "sobre".
- Keep the words that set when, how, or how sure: "then-19", "former", "forced to", "allegedly", "reportedly". An age or a role at the time of the events stays with them.
- A dateline such as "Desde Managua" or "WASHINGTON —" only says where the writer is. Never put it in the line.
- Keep a short label that carries news, such as "Absuelto", "Live", "Opinion", or "Análisis", at the start, followed by a colon.
- Drop teaser openings ("You won't believe", "De no creer", "A horas de") and hype, never the facts.
- If the headline does not say what happened (a question, a column title, or a teaser), keep its own words, made plain, and not as a question.
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
async function withChain(s: Settings, chain: ModelCfg[], c: Call, firstTokenMs: number) {
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
    try {
      return await tryModel(s, m, wrapped, firstTokenMs * (i ? 3 : 1));
    } catch (e) {
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

/** What a line's quotes must come from: its entry's title and context. */
const quoteSource = (it: LineInput) => it.t + "\n" + (it.c ?? "");

async function doLines(req: Extract<AiRequest, { task: "lines" }>, reply: Reply, signal: AbortSignal, useCache: boolean, site: string, pc: PortCtx) {
  const s = await settings();
  const mode = req.mode ?? "about";
  // One language for every line on the page: the one its text is written in.
  // The lang attribute is a hint: titles clearly in another language (a site
  // that marks Spanish pages "en") win. Settled once per page on enough
  // titles, so a later list matches the first, and a batch sent with the first
  // waits for its decision instead of making its own. Only when neither is known does
  // each title decide, and then the title alone: context is often a name
  // ("King Von") that looks foreign.
  const page = knownLang(req.lang);
  let langP = pc.lang;
  if (!langP) {
    langP = listLang(req.items.map((it) => it.t), page, detect);
    if (req.items.length >= 4) pc.lang = langP;
  }
  const list = await langP;
  const langs = list ? req.items.map(() => list) : await Promise.all(req.items.map((it) => entryLang(it.t, req.lang, detect)));
  // Keyed by site, so one site can neither read nor plant another site's lines.
  const keys = await Promise.all(req.items.map((it, i) => hash(`lines|${PROMPT_VERSION}|${site}|${mode}|${s.lines.model}|${langs[i]}|${it.t}|${it.c ?? ""}`)));
  const misses: { it: LineInput; key: string; lang: string }[] = [];
  for (const [i, it] of req.items.entries()) {
    const hit = useCache ? await cacheGet(keys[i]) : undefined;
    if (hit && !ttlOf(req, pc)) pc.saved.set(keys[i], hit);
    if (hit === KEEP_TITLE) continue;
    if (hit) reply({ id: req.id, item: it.id, text: keepQuotes(hit, quoteSource(it)) });
    else misses.push({ it, key: keys[i], lang: langs[i] });
  }
  if (!misses.length) return reply({ id: req.id, done: true });
  if (!s.apiKey) return reply({ id: req.id, error: "No API key", code: "nokey", quiet: await toldBefore("nokey") });
  // Short ids keep the prompt small; map them back afterwards.
  const byShort = new Map(misses.map((m, i) => [String(i + 1), m]));
  const input = misses.map((m, i) => ({ id: String(i + 1), lang: m.lang || undefined, title: m.it.t, context: m.it.c || undefined }));
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
      // A quote stays word for word, as the title or context has it.
      let text = keepQuotes(o.s.trim(), quoteSource(m.it)).replace(/[.。]$/, "");
      // In news mode, an empty line means "not a story" (a promo), and a line
      // about the headline instead of the news is no better: keep the title.
      if (mode === "news" && (!text || META.test(text))) text = m.it.t;
      if (!text) return;
      done.add(String(o.id));
      // A line that only wraps the title ("A video titled X") says nothing more: the title stays.
      if (mode !== "news" && wrapsTitle(text, m.it.t)) {
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
  bump("aiLines", misses.length);
  const perItem = mode === "about" ? 50 : 70;
  let err: unknown;
  try {
    await withChain(
    s,
    [s.lines, s.linesFallback, s.lastResort],
    {
      system: mode === "gist" ? GIST_SYSTEM : mode === "news" ? NEWS_SYSTEM : LINES_SYSTEM,
      user: JSON.stringify(input),
      maxTokens: 120 + misses.length * perItem,
      minTokens: 60 + misses.length * Math.round(perItem / 2),
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
    );
  } catch (e) {
    err = e;
  } finally {
    // Every line goes out before "done" or the error: the page stops listening after either.
    emit(buf);
    await Promise.allSettled(checks);
  }
  if (err) {
    // A filter or an output limit would stop the same batch again: its
    // entries with no line keep their titles for a day, so a revisit does not pay again.
    if (finalIncomplete(err) && useCache) for (const [id, m] of byShort) if (!done.has(id)) cacheSet(m.key, KEEP_TITLE, Math.min(ttlOf(req, pc) ?? DAY, DAY));
    throw err;
  }
  reply({ id: req.id, done: true });
}

/**
 * A one-line rewrite is in the language asked for: written in its script
 * (or, with no language given, the title's own), and not clearly another
 * language of the same script.
 */
async function lineFits(text: string, want: string, title: string): Promise<boolean> {
  if (!scriptFits(text, want ? langScript(want) : scriptOf(title))) return false;
  if (!want) return true;
  const got = await entryLang(text, want, detect, true);
  return !got || got === want;
}

/** A news line that talks about the headline or article instead of the news. */
const META =
  /\b(the|this) (headline|title|article|story|piece|report|feature) (says|asks|claims|alleges|describes|reports|invites|explains|suggests|teases|notes|reviews|raises|poses|questions|wonders|highlights|details|discusses|examines|looks at|argues|warns|states|mentions|reveals|tells|lists|covers|focuses)\b|\b(el titular|el título|la nota|el artículo|la noticia|la columna|a manchete|o título|o artigo|a notícia|a matéria) (dice|pregunta|informa|repasa|explica|analiza|afirma|describe|invita|plantea|cuenta|detalla|señala|destaca|aborda|advierte|sugiere|revela|muestra|indica|recoge|diz|pergunta|questiona|mostra|aponta|destaca|revela)\b/i;

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

async function doCondense(req: Extract<AiRequest, { task: "condense" }>, reply: Reply, signal: AbortSignal, useCache: boolean, site: string, pc: PortCtx) {
  const s = await settings();
  const key = await hash(`condense|${PROMPT_VERSION}|${site}|${s.condense.model}|${req.title}|${req.text}`);
  const hit = useCache ? await cacheGet(key) : undefined;
  if (hit && !ttlOf(req, pc)) pc.saved.set(key, hit);
  if (hit === NO_SHORT) return reply({ id: req.id, error: "no short version for this text", code: "http", final: true });
  // A saved Short version passes the same checks as a new one: it may have
  // been saved before they existed.
  if (hit) return finish(keepQuotes(hit, req.text));
  if (!s.apiKey) return reply({ id: req.id, error: "No API key", code: "nokey", quiet: await toldBefore("nokey") });
  bump("aiCondense");
  let all = "";
  const parts = splitText(req.text, PART_TOKENS);
  try {
    for (const [i, part] of parts.entries()) {
      if (i) all += "\n\n";
      // The output is at most about as long as the input; size it by script.
      const est = estTokens(part);
      // Models keep far more than asked unless given a number.
      const words = proseWords(part, req.lang);
      await withChain(
        s,
        [s.condense, s.condenseFallback, s.lastResort],
        {
          system: i ? CONDENSE_PART_SYSTEM : CONDENSE_SYSTEM,
          user: `Title: ${req.title}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}\nThe text has ${words} words. Write about ${Math.max(30, Math.round(words * 0.35))} words, and never more than ${Math.max(30, Math.round(words * 0.5))}, not counting heading and [[B…]] lines.\n\n${part}`,
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
    }
  } catch (e) {
    // "This text has no Short version" is kept for good only when the main
    // model itself ended that way; a fallback's stop is kept for a day, so the
    // main model tries again once it is back.
    if (finalIncomplete(e) && useCache) {
      const main = !(e instanceof ChainError) || e.link === linkId(s.condense);
      if (main) save(pc, req, key, NO_SHORT);
      else cacheSet(key, NO_SHORT, Math.min(ttlOf(req, pc) ?? DAY, DAY));
    }
    throw e;
  }
  // Quotes stay word for word: a changed one is put back as the source has it.
  all = keepQuotes(all, req.text);
  if (all.trim() && useCache) save(pc, req, key, tooLong(all) ? NO_SHORT : all);
  finish(all);

  function finish(out: string) {
    // A "Short version" that is barely shorter is not worth reading instead of the original.
    if (tooLong(out)) return reply({ id: req.id, error: "not much shorter than the full text", code: "http", final: true });
    if (out.trim()) reply({ id: req.id, full: out });
    reply({ id: req.id, done: true });
  }
  /** Too long to be worth it, by length and by words: a rewrite in shorter words can be much shorter yet hardly fewer. */
  function tooLong(out: string) {
    return proseTokens(out) > proseTokens(req.text) * MAX_RATIO || proseWords(out, req.lang) > proseWords(req.text, req.lang) * MAX_WORD_RATIO;
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
