// Usage: bun scripts/tabwalk.ts <url> [count]
// Presses Tab repeatedly and reports where focus lands: inside Sift or in the original page.
import { connect, sleep, tab } from "./lib";
const [url, count = "25"] = process.argv.slice(2);
const browser = await connect();
const page = await tab(browser);
if (url !== "-") { await page.goto(url, { waitUntil: "domcontentloaded" }); await sleep(6000); }
await page.mouse.click(5, 500);
const seen: string[] = [];
for (let i = 0; i < Number(count); i++) {
  await page.keyboard.press("Tab");
  seen.push(await page.evaluate(() => {
    let a: Element | null = document.activeElement;
    // Sift's own shadow root says when focus is in Sift (the page may be told its suggestion field has it).
    const sr = document.querySelector("sift-root")?.shadowRoot;
    if (sr?.activeElement) a = document.querySelector("sift-root");
    const inSift = a?.localName === "sift-root";
    while (a && (a as HTMLElement).shadowRoot?.activeElement) a = (a as HTMLElement).shadowRoot!.activeElement;
    const label = ((a as HTMLElement)?.innerText || a?.getAttribute("aria-label") || (a as HTMLInputElement)?.placeholder || "").replace(/\s+/g, " ").slice(0, 40);
    return `${inSift ? "SIFT" : "PAGE"} <${a?.localName}> ${label}`;
  }));
}
console.log(seen.join("\n"));
await browser.disconnect();
