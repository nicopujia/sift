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
