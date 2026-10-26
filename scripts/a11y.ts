// Usage: bun scripts/a11y.ts <url> [...]
// Runs axe-core on Sift's view (inside its shadow root) and prints violations.
import { readFileSync } from "node:fs";
import { connect, sleep, tab } from "./lib";
const axe = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const browser = await connect();
const page = await tab(browser);
for (const url of process.argv.slice(2)) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(7000);
  await page.evaluate(axe);
  const res: any = await page.evaluate(async () => {
    const r = await (window as any).axe.run({ include: [{ fromShadowDom: ["sift-root", ".sift"] }] } as any, { resultTypes: ["violations"] });
    (window as any).__axePasses = 0;
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, ex: v.nodes.slice(0, 2).map((n: any) => n.html.slice(0, 140)) }));
  });
  console.log(`\n== ${url}: ${res.length} violation types`);
  for (const v of res) console.log(`- [${v.impact}] ${v.id} (${v.n}): ${v.help}\n    ${v.ex.join("\n    ")}`);
}
await browser.disconnect();
