// Usage: bun scripts/act.ts <step> [<step> ...]
// Steps (run in order, on the current test tab, with trusted input events):
//   click:<text or css>     click the Sift element whose text or aria-label contains <text>
//   type:<css>=><text>      click a Sift field (css inside Sift's shadow root) and type
//   press:<Key>             press a key (Enter, Escape, Tab, ...), with modifiers as Shift+Tab, Control+f
//   wait:<ms>               wait
//   goto:<url>              navigate
//   eval:<js>               run JS in the page's main world and print the result
//   shot:<name>             screenshot to research/shots/<name>.png
//   outline                 print Sift's outline
//   url                     print the current URL
import { mkdir } from "node:fs/promises";
import { connect, siftOutline, sleep, tab } from "./lib";

const browser = await connect();
const page = await tab(browser);
page.on("pageerror", (e) => console.log(`[pageerror] ${String(e).slice(0, 200)}`));

async function locate(q: string) {
  return page.evaluate((q) => {
    const root = document.querySelector("sift-root")?.shadowRoot;
    if (!root) return null;
    let el: Element | null = null;
    try {
      el = root.querySelector(q);
    } catch {}
    if (!el) {
      const all = Array.from(root.querySelectorAll("a, button, summary, input, select, textarea, label, [role=switch]"));
      const lc = q.toLowerCase();
      el =
        all.find((e) => ((e as HTMLElement).innerText || e.getAttribute("aria-label") || "").trim().toLowerCase() === lc) ??
        all.find((e) => ((e as HTMLElement).innerText || e.getAttribute("aria-label") || "").toLowerCase().includes(lc)) ??
        null;
    }
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    // Aim at the first line box: a link that wraps has a hole in its bounding box.
    const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.localName, text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").slice(0, 80) };
  }, q);
}

/** A key with optional modifiers: "Shift+Tab", "Control+f". */
async function press(combo: string) {
  const keys = combo.length > 1 ? combo.split("+") : [combo];
  const main = keys.pop() || "+";
  for (const m of keys) await page.keyboard.down(m as any);
  await page.keyboard.press(main as any);
  for (const m of keys.reverse()) await page.keyboard.up(m as any);
}

for (const step of process.argv.slice(2)) {
  const i = step.indexOf(":");
  const [cmd, arg] = i < 0 ? [step, ""] : [step.slice(0, i), step.slice(i + 1)];
  if (cmd === "click") {
    const p = await locate(arg);
    if (!p) { console.log(`click: not found: ${arg}`); continue; }
    await sleep(150);
    const p2 = (await locate(arg)) ?? p;
    await page.mouse.click(p2.x, p2.y);
    console.log(`clicked <${p2.tag}> "${p2.text}"`);
  } else if (cmd === "type") {
    const [sel, ...rest] = arg.split("=>");
    const p = await locate(sel);
    if (!p) { console.log(`type: not found: ${sel}`); continue; }
    await page.mouse.click(p.x, p.y);
    await page.keyboard.type(rest.join("=>"), { delay: 20 });
    console.log(`typed into <${p.tag}>`);
  } else if (cmd === "press") {
    await press(arg);
    console.log(`pressed ${arg}`);
  } else if (cmd === "wait") {
    await sleep(Number(arg));
  } else if (cmd === "goto") {
    await page.goto(arg, { waitUntil: "domcontentloaded" }).catch((e) => console.log("goto:", e.message));
  } else if (cmd === "eval") {
    console.log(JSON.stringify(await page.evaluate(arg).catch((e) => String(e))));
  } else if (cmd === "shot") {
    await mkdir("research/shots", { recursive: true });
    await page.screenshot({ path: `research/shots/${arg}.png` });
    console.log(`shot research/shots/${arg}.png`);
  } else if (cmd === "outline") {
    console.log((await siftOutline(page, 300)).split("\n").slice(0, 70).join("\n"));
  } else if (cmd === "url") {
    console.log(page.url());
  }
}
await browser.disconnect();
