// Usage: bun scripts/visit.ts <url> [name] [--wait ms] [--tall px] [--text] [--keep]
// Navigates the test tab, waits, then saves research/shots/<name>.png and .txt (Sift outline).
import { mkdir, writeFile } from "node:fs/promises";
import { connect, siftOutline, siftText, sleep, tab } from "./lib";

const args = process.argv.slice(2);
const url = args[0];
const name = args[1] && !args[1].startsWith("--") ? args[1] : new URL(url).hostname.replace(/\W+/g, "-");
const opt = (k: string, d: number) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const wait = opt("--wait", 6000);
const tall = opt("--tall", 1800);

const browser = await connect();
const page = await tab(browser);
const logs: string[] = [];
page.on("console", (m) => { const t = m.text(); if (/sift|error|Uncaught/i.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
await page.setViewport({ width: 1280, height: 900 });
const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => logs.push("goto: " + e.message));
// Time until Sift shows content (not the loading line).
let firstMs = -1;
while (Date.now() - t0 < wait) {
  const ready = await page.evaluate(() => {
    const r = document.querySelector("sift-root")?.shadowRoot;
    const m = r?.querySelector("main");
    return !!m && !m.querySelector(".loading") && (m as HTMLElement).innerText.trim().length > 20;
  }).catch(() => false);
  if (ready && firstMs < 0) firstMs = Date.now() - t0;
  await sleep(150);
}
await page.setViewport({ width: 1280, height: tall });
await sleep(600);
await mkdir("research/shots", { recursive: true });
await page.screenshot({ path: `research/shots/${name}.png` });
const outline = await siftOutline(page, 600);
await writeFile(`research/shots/${name}.txt`, outline);
await page.setViewport({ width: 1280, height: 900 });
console.log(`url: ${page.url()}\nfirst sift content: ${firstMs} ms\nlogs:\n${logs.slice(0, 20).join("\n")}\n--- outline (${outline.split("\n").length} lines) ---`);
console.log(args.includes("--text") ? await siftText(page) : outline.split("\n").slice(0, 80).join("\n"));
await browser.disconnect();
