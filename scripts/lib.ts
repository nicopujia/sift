// Shared helpers for the test scripts: connect to the test Chrome and read Sift.
import puppeteer, { type Browser, type Page, type Target } from "puppeteer-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const port = process.env.SIFT_PORT ?? "9444";

export async function connect(): Promise<Browser> {
  return puppeteer.connect({ browserURL: "http://127.0.0.1:" + port, defaultViewport: null });
}

const idOf = (t: Target): string => (t as any)._targetId ?? "";

/**
 * The test tab. SIFT_TAB=<name> (default "0") gives each tester its own tab.
 * The tab's target id is kept in .chrome/tab-<port>-<name>, so the same tab is
 * found again however many tabs others open or close (an index would shift).
 * New tabs open in their own window: a background tab gets no animation
 * frames, and many sites (YouTube) stop rendering without them. The tab is
 * brought to the front: Chrome fires no focus events in an unfocused window.
 */
export async function tab(browser: Browser): Promise<Page> {
  const name = (process.env.SIFT_TAB ?? "0").replace(/[^\w.-]/g, "_");
  const dir = new URL("../.chrome/", import.meta.url).pathname;
  const file = `${dir}tab-${port}-${name}`;
  const saved = (await readFile(file, "utf8").catch(() => "")).trim();
  const mine = saved && browser.targets().find((t) => t.type() === "page" && idOf(t) === saved);
  const page = mine ? await mine.page() : null;
  if (page) {
    await page.bringToFront();
    return page;
  }
  const cdp = await browser.target().createCDPSession();
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", newWindow: true });
  await cdp.detach();
  const target = await browser.waitForTarget((t) => idOf(t) === targetId, { timeout: 10000 });
  await mkdir(dir, { recursive: true });
  await writeFile(file, targetId);
  const fresh = (await target.page())!;
  await fresh.bringToFront();
  return fresh;
}

/** Sift's rendered text, read from its shadow root. */
export async function siftText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector("sift-root")?.shadowRoot;
    if (!root) return "(no sift-root)";
    const el = root.querySelector(".sift") as HTMLElement | null;
    return el ? el.innerText : "(no .sift)";
  });
}

/** Sift's view as an indented outline: headings, links, buttons, fields. */
export async function siftOutline(page: Page, limit = 400): Promise<string> {
  return page.evaluate((limit) => {
    const root = document.querySelector("sift-root")?.shadowRoot;
    if (!root) return "(no sift-root)";
    const out: string[] = [];
    const walk = (el: Element, depth: number) => {
      for (const c of Array.from(el.children)) {
        if (out.length >= limit) return;
        const tag = c.localName;
        const txt = (c as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
        const pad = "  ".repeat(Math.min(depth, 6));
        if (/^h[1-6]$/.test(tag)) out.push(`${pad}${tag.toUpperCase()} ${txt}`);
        else if (tag === "a") out.push(`${pad}[link] ${txt}`);
        else if (tag === "button") out.push(`${pad}[button] ${txt || c.getAttribute("aria-label")}`);
        else if (tag === "input" || tag === "select" || tag === "textarea") out.push(`${pad}[${tag}${(c as HTMLInputElement).type ? ":" + (c as HTMLInputElement).type : ""}] ${(c as HTMLInputElement).value ?? ""} ${c.getAttribute("placeholder") ?? ""}`);
        else if (tag === "p" || tag === "li" || tag === "dd" || tag === "dt" || tag === "figcaption" || tag === "td" || tag === "th") {
          if (c.querySelector("a,button,input,select,ul,ol,p")) walk(c, depth + 1);
          else if (txt) out.push(`${pad}${tag}: ${txt.slice(0, 220)}`);
        } else if (tag === "img") out.push(`${pad}[img] ${c.getAttribute("alt") ?? ""}`);
        else if (c.classList.contains("portal")) out.push(`${pad}[PORTAL] ${c.getAttribute("aria-label")}`);
        else walk(c, depth + (["ol", "ul", "section", "article", "form", "details", "fieldset"].includes(tag) ? 1 : 0));
      }
    };
    const main = root.querySelector(".sift");
    if (main) walk(main, 0);
    return out.join("\n");
  }, limit);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Compares the code the extension's service worker is running with
 * <SIFT_OUT>/background.js on disk (F923: Chrome restarted on an old profile
 * keeps the old worker script while content scripts are new). Wakes a sleeping
 * worker with a harmless "config" message from Sift's Options page. The marker
 * is PROMPT_VERSION plus a short hash of the whole script.
 */
export async function workerCheck(browser: Browser, id: string): Promise<{ ok: boolean; running: string; disk: string }> {
  const root = new URL("..", import.meta.url).pathname;
  const disk = await readFile(root + (process.env.SIFT_OUT ?? "dist") + "/background.js", "utf8");
  const origin = `chrome-extension://${id}/`;
  const isWorker = (t: Target) => t.type() === "service_worker" && t.url().startsWith(origin);
  let worker = browser.targets().find(isWorker);
  if (!worker) {
    const page = await browser.newPage();
    await page.goto(origin + "options.html").catch(() => {});
    await page.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ type: "config" })).catch(() => {});
    worker = await browser.waitForTarget(isWorker, { timeout: 10000 }).catch(() => undefined);
    await page.close().catch(() => {});
  }
  const mark = (src: string) => `PROMPT_VERSION ${src.match(/PROMPT_VERSION = (\d+)/)?.[1] ?? "?"}, ${Bun.hash(src).toString(16).slice(0, 10)} (${src.length} chars)`;
  if (!worker) return { ok: false, running: "no service worker", disk: mark(disk) };
  const cdp = await worker.createCDPSession();
  const scripts: { scriptId: string; url: string }[] = [];
  cdp.on("Debugger.scriptParsed", (e) => scripts.push(e));
  await cdp.send("Debugger.enable");
  let running = "";
  for (let i = 0; i < 40 && !running; i++) {
    const s = scripts.find((x) => x.url === origin + "background.js");
    if (s) running = (await cdp.send("Debugger.getScriptSource", { scriptId: s.scriptId })).scriptSource;
    else await sleep(100);
  }
  await cdp.send("Debugger.disable").catch(() => {});
  await cdp.detach().catch(() => {});
  if (!running) return { ok: false, running: "background.js not found in the worker", disk: mark(disk) };
  return { ok: running === disk, running: mark(running), disk: mark(disk) };
}

// `bun scripts/lib.ts worker <extension id>`: prints the check, exits 1 when the worker is stale.
if (import.meta.main && process.argv[2] === "worker") {
  const browser = await connect();
  const r = await workerCheck(browser, process.argv[3] ?? "");
  browser.disconnect();
  console.log(r.ok ? `service worker = dist: ${r.running}` : `SERVICE WORKER IS STALE: running ${r.running}; dist has ${r.disk}`);
  process.exit(r.ok ? 0 : 1);
}
