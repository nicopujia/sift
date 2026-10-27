// Asks the background worker to rewrite text: one-line descriptions for lists
// and a Short version of articles. Results go to the UI store.

import type { AiReply, AiRequestBody, AiTask, LineInput } from "../shared/messages";
import { t } from "./i18n";
import type { Block, Item, Page } from "./model";
import { proseChanged, rewritten, sameArticle, shortMeta, shortSource, type ShortMeta, type ShortSource } from "./short";
import { changed, lineKey, store, type AiResult } from "./ui/store";

let port: chrome.runtime.Port | null = null;
let nextId = 1;
let ready = false;
/** After an error, wait before asking again (rate limits, outages). Per task, so a failing short version does not stop one-line rewrites. */
const pauseUntil: Record<AiTask, number> = { lines: 0, condense: 0 };
/** Failures in a row per task: each one doubles the pause. */
const fails: Record<AiTask, number> = { lines: 0, condense: 0 };
/**
 * An article whose Short version failed this many times (each may be paid for)
 * is not asked for again. Counted by its longer paragraphs (ShortMeta.fp), so a
 * ticking time or counter in it does not make it a new article.
 */
const MAX_TRIES = 3;
const tries = new Map<string, number>();
/** Failed tries per list entry (by line key): one that failed MAX_TRIES times is not asked for again. */
const lineTries = new Map<string, number>();
/**
 * An article whose prose changed after its Short version was asked for is
 * asked for again once it holds still: at most this many times per page, and
 * this far apart, since a live page may change all the time.
 */
const MAX_REFRESH = 4;
const REFRESH_MS = 15000;
const refreshes = new Map<string, number>();
/** A refresh waiting for its article to hold still: the latest extraction, and its longer paragraphs. */
const pending = new Map<string, { sig: string; page: Page; a: Extract<Block, { t: "article" }>; src: ShortSource }>();
/** The notice that AI is unavailable is shown once per tab. */
let told = "";
let toldOnce = false;
/** Fewer prose words than this are short enough already. */
const MIN_WORDS = 150;
const handlers = new Map<number, (r: AiReply) => void>();
const requested = new Set<string>();
const articleWords = new Map<string, number>();
const articleTimers = new Map<string, number>();
const articleFirstSeen = new Map<string, number>();
/** Bumped on every new page: replies to an older page's requests are dropped. */
let gen = 0;

/** One Short version asked for. Articles with the same text (the page re-rendered one under a new key) share it. */
interface Job {
  id: number;
  gen: number;
  text: string;
  keys: Set<string>;
  meta: ShortMeta;
  state: AiResult;
  /** Still being written. */
  busy: boolean;
  /** When it was asked for (performance.now()). */
  at: number;
  /** It ended in an error that a new try of about the same text would end in too (not much shorter, a filter, a limit). */
  final?: boolean;
}
/** Jobs by the exact text sent. */
const jobs = new Map<string, Job>();
/** The job behind each article's "condense:" entry. */
const keyJob = new Map<string, Job>();

/** Settings arrived: model calls may start (and respect "AI off"). */
export function setAiReady() {
  ready = true;
}

const allowed = (task: AiTask) => ready && !store.aiOff && store.mode === "sift" && performance.now() > pauseUntil[task];

function connect(): chrome.runtime.Port | null {
  if (port) return port;
  try {
    port = chrome.runtime.connect({ name: "sift-ai" });
  } catch {
    return null; // extension was reloaded; this page's script is orphaned
  }
  const p = port;
  p.onMessage.addListener((r: AiReply) => {
    const h = handlers.get(r.id);
    if (!h) return;
    h(r);
    if ("done" in r || "error" in r) handlers.delete(r.id);
  });
  p.onDisconnect.addListener(() => {
    if (port !== p) return;
    port = null;
    // Unfinished work may be asked again later.
    for (const [id, h] of handlers) h({ id, error: "disconnected", code: "network" });
    handlers.clear();
  });
  return p;
}

/** Sends a request; its id, or 0 when the worker cannot be reached. */
function send(req: AiRequestBody, onReply: (r: AiReply) => void): number {
  const p = connect();
  if (!p) return 0;
  const id = nextId++;
  handlers.set(id, onReply);
  try {
    p.postMessage({ ...req, id });
  } catch {
    handlers.delete(id);
    return 0;
  }
  return id;
}

/** Tells the worker a request is no longer needed, so it stops paying for it. */
function cancel(id: number) {
  handlers.delete(id);
  try {
    port?.postMessage({ task: "cancel", id });
  } catch {
    /* port closed */
  }
}

export function resetAi() {
  gen++;
  // A new page: the old page's requests stop. The worker aborts them when the
  // port closes (a port closed from this side fires no onDisconnect here).
  if (port) {
    try {
      port.disconnect();
    } catch {
      /* already closed */
    }
    port = null;
  }
  handlers.clear();
  // No Short version of the old page may show on the new one.
  for (const k of [...store.ai.keys()]) if (k.startsWith("condense:")) store.ai.delete(k);
  jobs.clear();
  keyJob.clear();
  // A new page in a single-page app: try again, unless AI is off or has no key.
  pauseUntil.lines = pauseUntil.condense = 0;
  fails.lines = fails.condense = 0;
  refreshes.clear();
  pending.clear();
  privateTold = null;
  if (told && store.notice === told) store.notice = "";
  told = "";
  requested.clear();
  articleWords.clear();
  for (const tm of articleTimers.values()) clearTimeout(tm);
  articleTimers.clear();
  articleFirstSeen.clear();
}

/**
 * A byline ("Por Cecilia Castro", "By Jane Doe") at the end of an entry's
 * context names the writer; sent along, the model takes the writer for a
 * speaker. Only the context loses it: in a title, "por Javier Milei" is the actor.
 */
const BYLINE = /(?:^|\s)(?:By|Por|Par|Von|Door|Di)\s+\p{Lu}[\p{L}'’.-]+(?:\s+(?:(?:de|del|da|das|do|dos|la|le|van|von|der|den|y|e|and)\s+)*\p{Lu}[\p{L}'’.-]*)+\s*$/u;

/** A dateline ("Desde Managua", "From Kyiv") at the end of a context part: where the writer is, not news. */
const DATELINE = /(?:^|[\s|·])(?:Desde|From|Depuis|Aus|Da|Dalla)\s+\p{Lu}[\p{L}'’.-]*(?:,?\s+(?:(?:de|del|la|el|d’|di)\s+)?\p{Lu}[\p{L}'’.-]*){0,3}\s*$/u;

function lineInput(it: Item, mode: string): LineInput {
  let c = it.context ?? [it.lead, ...it.meta].filter(Boolean).join(" · ");
  if (mode === "news")
    c = c
      .split(" · ")
      .map((x) => x.replace(DATELINE, "").replace(/[\s|]+$/, "").replace(BYLINE, "").replace(/[\s|]+$/, "").trim())
      .filter(Boolean)
      .join(" · ");
  return { id: lineKey(it), t: it.title, c: c.slice(0, 200) };
}

/** Says once, in the page's language, why there is no short text. */
function tell(msg: string) {
  if (toldOnce) return;
  toldOnce = true;
  told = msg;
  store.notice = msg;
  store.announce = msg;
  changed();
}

function onError(r: AiReply, task: AiTask) {
  if (!("error" in r)) return;
  if (r.code === "off") store.aiOff = true;
  else if (r.code === "nokey") {
    store.aiOff = true;
    // Once per browser session, not on every page: running without a key is supported.
    if (!r.quiet) tell(t("noKey"));
  } else if (r.code === "refused") {
    // Every model refused (out of credit, key refused): stop this task until the page changes.
    pauseUntil[task] = Infinity;
    if (!r.quiet) tell(t("aiUnavailable"));
  } else if (!r.final) {
    // A failure that may pass (rate limit, outage, the worker stopped mid-answer):
    // wait, twice as long after each failure in a row, up to 8 minutes.
    fails[task]++;
    pauseUntil[task] = performance.now() + Math.min(30000 * 2 ** (fails[task] - 1), 480000);
  }
}

/** Signed-in pages (mail, an account): their results are kept only for a short time. */
const SIGN_OUT = /^(sign|log) ?(out|off)$|^cerrar sesi[oó]n$|^salir$|^sair$|^terminar sess[aã]o$|^abmelden$|^se d[ée]connecter$|^d[ée]connexion$|^esci$|^disconnetti$/i;
/**
 * The page found signed-in: once it is, it stays so. A page not found so is
 * checked again on every pass (a cheap query): the first ones run while it
 * is still loading, and some headers come late.
 */
let privateFor = "";
function privatePage(page: Page): boolean {
  if (privateFor === page.url) return true;
  const labels = [...(page.top ?? []), ...(page.nav ?? [])].map((a) => a.label.trim());
  const is =
    page.source === "gmail" ||
    labels.some((l) => SIGN_OUT.test(l)) ||
    !!document.querySelector(
      'a[href*="logout" i], a[href*="signout" i], a[href*="sign_out" i], a[href*="sign-out" i], a[href*="log_out" i], a[href*="log-out" i], form[action*="logout" i], form[action*="signout" i]',
    );
  if (is) privateFor = page.url;
  return is;
}

/** The port already told that this page is signed-in. */
let privateTold: chrome.runtime.Port | null = null;
/** Tells the worker, once, that this page is signed-in, so what it saved before is kept for the short time only. */
function tellPrivate() {
  if (!port || privateTold === port) return;
  privateTold = port;
  try {
    port.postMessage({ task: "private" });
  } catch {
    /* port closed */
  }
}

/**
 * A page of search results: its search box holds the query its address asked
 * for, the top bar's or one in the page (MoinMoin's, F1044). Its results are never condensed.
 */
function searchResults(page: Page): boolean {
  const qs = new Set<string>();
  const add = (f: { kind: string; value: string }) => {
    const v = f.value?.trim().toLowerCase();
    if (v && v.length >= 2 && (f.kind === "search" || f.kind === "text")) qs.add(v);
  };
  if (page.search) add(page.search);
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === "form") b.fields.forEach(add);
      else if (b.t === "section" || b.t === "article") walk(b.blocks);
    }
  };
  walk(page.blocks);
  if (!qs.size) return false;
  try {
    for (const v of new URL(page.url).searchParams.values()) if (qs.has(v.trim().toLowerCase())) return true;
  } catch {
    /* not a URL */
  }
  return false;
}

export function processAi(page: Page) {
  const lines = allowed("lines");
  const condenseOk = allowed("condense") && !searchResults(page);
  if (!lines && !condenseOk) return;
  const byMode = { about: [] as LineInput[], gist: [] as LineInput[], news: [] as LineInput[] };
  const articles: Extract<Block, { t: "article" }>[] = [];
  const walk = (blocks: Block[], inAnswer: boolean, inArticle: boolean) => {
    for (const b of blocks) {
      if (b.t === "items" && b.rewrite && lines) {
        const mode = b.aiMode ?? (b.rewrite === "summary" ? "gist" : "about");
        for (const it of b.items) {
          // A name (a channel, a service) is never replaced by a description.
          if (it.keepTitle) continue;
          const k = lineKey(it);
          if (requested.has(k) || store.ai.has(k)) continue;
          requested.add(k);
          byMode[mode].push(lineInput(it, mode));
        }
      } else if (b.t === "article") {
        // Only prose is condensed: a Q&A thread, a result list, or a recipe with
        // its controls keeps its structure (the extractor marks those prose: false),
        // and so does an answer in a thread.
        const take = b.prose !== false && !inAnswer && !inArticle;
        if (take && condenseOk) articles.push(b);
        // An article inside one that is condensed is part of its text.
        walk(b.blocks, inAnswer, inArticle || take);
      } else if (b.t === "section") walk(b.blocks, inAnswer || b.key.startsWith("ans:"), inArticle);
    }
  };
  walk(page.blocks, false, false);
  const priv = privatePage(page);
  if (priv) tellPrivate();
  const batches: [LineInput[], "about" | "gist" | "news"][] = [];
  for (const mode of ["about", "gist", "news"] as const) {
    const list = byMode[mode];
    const size = mode === "about" ? 25 : 20;
    for (let i = 0; i < list.length; i += size) batches.push([list.slice(i, i + size), mode]);
  }
  for (const [batch, mode] of batches) {
    const g = gen;
    const ok = send({ task: "lines", lang: page.lang, items: batch, mode, private: priv || mode === "gist" || undefined }, (r) => {
      if (g !== gen) return;
      if ("item" in r) {
        fails.lines = 0;
        store.ai.set(r.item, { text: r.text, done: true });
        changed();
      } else if ("error" in r) {
        // A final error (a filter, an output limit) would end the same way:
        // those entries stay asked for on this page. Others are asked again
        // after the pause, a few times at most.
        for (const it of batch) {
          if (store.ai.has(it.id) || r.final) continue;
          const n = (lineTries.get(it.id) ?? 0) + 1;
          lineTries.set(it.id, n);
          if (n < MAX_TRIES) requested.delete(it.id);
        }
        onError(r, "lines");
      }
    });
    if (!ok) for (const it of batch) requested.delete(it.id);
  }
  for (const a of articles) {
    const k = "condense:" + a.key;
    const src = shortSource(a.blocks);
    const job = keyJob.get(k);
    // Asked for this article already (waiting, done, or failed for good).
    if (job && sameArticle(job.meta, src)) {
      // Its prose was rewritten since (a fourth or more of it): ask again once
      // it holds still. Meanwhile, and for good after a smaller change (a new
      // paragraph, a new number), the Short version shows with the changed
      // paragraphs in full: it is not replaced under the reader.
      if (job.text !== src.text && proseChanged(job.meta, src) && rewritten(job.meta, src)) refresh(page, a, src);
      else if (pending.delete(k)) clearTimeout(articleTimers.get(a.key));
      continue;
    }
    // The site put another article under this key (it reused the element): the old one's Short version goes.
    if (job) detach(k, job);
    else if (store.ai.get(k)?.short && !sameArticle(store.ai.get(k)!.short!, src)) store.ai.delete(k);
    if (share(page, a, src)) continue;
    if (src.words < MIN_WORDS) continue;
    // Wait until the article has stopped growing, so we condense all of it:
    // ask once its size held for a moment (a static page never re-extracts), or
    // after 2.5 s at most, since some pages never stop changing (live counters).
    const now = performance.now();
    if (!articleFirstSeen.has(a.key)) articleFirstSeen.set(a.key, now);
    const prev = articleWords.get(a.key);
    articleWords.set(a.key, a.words);
    const steady = prev !== undefined && Math.abs(prev - a.words) <= Math.max(3, a.words * 0.03);
    clearTimeout(articleTimers.get(a.key));
    if ((steady && !page.partial) || now - articleFirstSeen.get(a.key)! > 2500) {
      condense(page, a, src);
      continue;
    }
    const g = gen;
    articleTimers.set(
      a.key,
      window.setTimeout(() => {
        if (g === gen && !keyJob.has(k) && allowed("condense") && !share(page, a, src)) condense(page, a, src);
      }, 600),
    );
  }
}

/**
 * The site replaced an article's element (a new key) and changed something
 * small: the new key shows the Short version already asked for under the old
 * key, and a change in its prose is asked for again like any other, instead
 * of the full text showing until a second, paid, Short version is whole.
 */
function share(page: Page, a: Extract<Block, { t: "article" }>, src: ShortSource): boolean {
  const k = "condense:" + a.key;
  let best: Job | undefined;
  for (const [key, j] of keyJob) if (key !== k && j.gen === gen && (!best || j.at > best.at) && sameArticle(j.meta, src)) best = j;
  if (!best) return false;
  attach(k, best);
  // The refresh limit is per article, not per element.
  for (const key of best.keys) refreshes.set(k, Math.max(refreshes.get(k) ?? 0, refreshes.get(key) ?? 0));
  if (best.text !== src.text && proseChanged(best.meta, src) && rewritten(best.meta, src)) refresh(page, a, src);
  return true;
}

/** Shows a job's state under each article key that uses it. */
function publish(job: Job) {
  for (const k of job.keys) if (keyJob.get(k) === job) store.ai.set(k, job.state);
  changed();
}

function attach(k: string, job: Job) {
  // The same article under a new element: the reader's choice (full text or
  // Short version, or reading before it came) goes with it.
  const now = k.slice("condense:".length);
  for (const old of job.keys) {
    for (const p of ["art:", "art-late:"]) {
      const from = p + old.slice("condense:".length);
      if (old !== k && store.local.has(from) && !store.local.has(p + now)) store.local.set(p + now, store.local.get(from));
    }
  }
  job.keys.add(k);
  keyJob.set(k, job);
  store.ai.set(k, job.state);
  changed();
}

/** An article key no longer shows this job; a job nobody waits for is stopped. */
function detach(k: string, job: Job, keep = false) {
  job.keys.delete(k);
  keyJob.delete(k);
  if (!keep) store.ai.delete(k);
  if (!job.keys.size && job.busy) {
    if (job.id) cancel(job.id);
    jobs.delete(job.text);
  }
}

/**
 * Asks again for an article whose prose changed since its Short version was
 * asked for, once its longer paragraphs held for 2 s (a new change in them
 * waits anew; a ticking time in a short line does not), at most MAX_REFRESH
 * times per page and REFRESH_MS apart.
 */
function refresh(page: Page, a: Extract<Block, { t: "article" }>, src: ShortSource) {
  const k = "condense:" + a.key;
  const n = refreshes.get(k) ?? 0;
  if (n >= MAX_REFRESH) return;
  const job = keyJob.get(k);
  if (!job || stuck(job, src)) return;
  const sig = src.dfp.join(",");
  const was = pending.get(k);
  pending.set(k, { sig, page, a, src });
  if (was?.sig === sig) return;
  clearTimeout(articleTimers.get(a.key));
  const g = gen;
  const wait = Math.max(2000, job.at + REFRESH_MS - performance.now());
  const fire = () => {
    const p = pending.get(k);
    const now = keyJob.get(k);
    if (g !== gen || !p || !now || now.text === p.src.text || stuck(now, p.src) || store.aiOff || pauseUntil.condense === Infinity) {
      pending.delete(k);
      return;
    }
    // The last Short version is still being written, or AI is paused after an
    // error: the refresh waits for it instead of being dropped (a page that
    // then holds still would never ask again).
    if (now.busy || !allowed("condense")) {
      articleTimers.set(a.key, window.setTimeout(fire, Math.max(2000, pauseUntil.condense - performance.now())));
      return;
    }
    pending.delete(k);
    refreshes.set(k, n + 1);
    // The old Short version stays on screen until the new one is whole.
    detach(k, now, true);
    condense(p.page, p.a, p.src);
  };
  articleTimers.set(a.key, window.setTimeout(fire, wait));
}

/**
 * A job that ended in a final error (not much shorter, a filter) is asked for
 * again only when its article grew by a fifth or more: a changed number or
 * time in it gets the same answer, paid for again.
 */
const stuck = (job: Job, src: ShortSource) => !!job.final && !job.busy && src.words < job.meta.words * 1.2;

/** Lets every article of a failed job ask again later. */
function release(job: Job) {
  if (jobs.get(job.text) === job) jobs.delete(job.text);
  for (const k of job.keys) if (keyJob.get(k) === job) keyJob.delete(k);
}

function condense(page: Page, a: Extract<Block, { t: "article" }>, src: ShortSource) {
  if (!allowed("condense")) return;
  const k = "condense:" + a.key;
  const twin = jobs.get(src.text);
  if (twin && twin.gen === gen) {
    // The same article under a new key (the page re-rendered it): share the first request.
    attach(k, twin);
    return;
  }
  const meta = shortMeta(src);
  // A Short version of this same article (asked for before its text changed)
  // stays on screen until the new one is whole.
  const prev = store.ai.get(k);
  const old = prev?.short && prev.done && !prev.error && prev.text ? prev : undefined;
  const job: Job = { id: 0, gen, text: src.text, keys: new Set(), meta, state: old ?? { text: "", done: false, short: meta }, busy: true, at: performance.now() };
  jobs.set(src.text, job);
  attach(k, job);
  // The Short version shows only once it is whole: it may turn out too long to
  // be worth it, and dropped placeholders are put back from the whole text.
  let buf = "";
  job.id = send({ task: "condense", lang: page.lang, title: page.title, text: src.text, private: privatePage(page) || undefined }, (r) => {
    if (job.gen !== gen) return;
    if ("delta" in r) buf += r.delta;
    else if ("full" in r) buf = r.full;
    else if ("done" in r) {
      job.busy = false;
      fails.condense = 0;
      job.state = { text: buf, done: true, short: meta };
      publish(job);
    } else if ("error" in r) {
      job.busy = false;
      job.final = !!r.final;
      // Not shorter, cut at an output limit, or stopped by a filter: the full
      // text stays (or the older Short version), and only a try that could end
      // differently is made again, a few times at most for one text.
      job.state = old ?? { text: "", done: true, error: r.error, short: meta };
      publish(job);
      const id = meta.fp.join(",");
      const n = (tries.get(id) ?? 0) + 1;
      tries.set(id, n);
      if (!r.final && n < MAX_TRIES) release(job);
      onError(r, "condense");
    }
  });
  if (!job.id) {
    job.busy = false;
    release(job);
    for (const key of job.keys) if (!old) store.ai.delete(key);
  }
}
