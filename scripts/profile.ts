// Usage: bun scripts/profile.ts <url>
// CPU-profiles Sift re-extracting the page (toggle off and on) and prints the
// hottest functions by self time.
import { connect, sleep, tab } from "./lib";
const url = process.argv[2];
const browser = await connect();
const page = await tab(browser);
await page.goto(url, { waitUntil: "domcontentloaded" });
await sleep(6000);
const cdp = await page.createCDPSession();
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await cdp.send("Profiler.start");
// The switch answers only trusted input (a page script must not switch Sift off): press the shortcut.
async function toggle() {
  await page.keyboard.down("Alt");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyS");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Alt");
}
for (let i = 0; i < 3; i++) {
  await toggle();
  await sleep(200);
  await toggle();
  await sleep(900);
}
const { profile } = (await cdp.send("Profiler.stop")) as any;
const self = new Map<string, number>();
const dt = new Map<number, number>();
for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
for (const n of profile.nodes) {
  const f = n.callFrame;
  const name = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  self.set(name, (self.get(name) ?? 0) + (dt.get(n.id) ?? 0) / 1000);
}
const top = [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, v] of top) console.log(v.toFixed(1).padStart(8), "ms ", k);
console.log("runs:", await page.evaluate(() => document.querySelector("sift-root")!.getAttribute("data-runs")), "last ms:", await page.evaluate(() => document.querySelector("sift-root")!.getAttribute("data-ms")));
await browser.disconnect();
