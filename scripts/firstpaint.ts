// Usage: bun scripts/firstpaint.ts <url> <origSelector> [runs]
// Compares when the original page first shows content (origSelector visible) with when Sift does.
import { connect, sleep, tab } from "./lib";
const [url, sel, runsArg] = process.argv.slice(2);
const browser = await connect();
const page = await tab(browser);
await page.setViewport({ width: 1280, height: 900 });
for (let r = 0; r < Number(runsArg ?? 3); r++) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  let orig = -1, sift = -1;
  while (Date.now() - t0 < 15000 && (orig < 0 || sift < 0)) {
    const [o, s] = await page.evaluate((sel) => {
      const e = document.querySelector(sel) as HTMLElement | null;
      const o = !!e && e.getBoundingClientRect().height > 0;
      const m = document.querySelector("sift-root")?.shadowRoot?.querySelector("main") as HTMLElement | null;
      const s = !!m && !m.querySelector(".loading") && m.innerText.trim().length > 20;
      return [o, s];
    }, sel).catch(() => [false, false]);
    if (o && orig < 0) orig = Date.now() - t0;
    if (s && sift < 0) sift = Date.now() - t0;
    await sleep(100);
  }
  console.log(`run ${r + 1}: original ${orig} ms, sift ${sift} ms`);
}
process.exit(0);
