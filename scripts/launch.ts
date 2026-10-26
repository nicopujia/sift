// Launches the sandboxed system Chrome with Sift installed, and keeps it alive.
// Other scripts connect on port 9444. Send SIGUSR1 to reinstall from dist/
// after a rebuild. Run inside tmux: `bun scripts/launch.ts`.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const dist = root + (process.env.SIFT_OUT ?? "dist");
const sfx = process.env.SIFT_OUT && process.env.SIFT_OUT !== "dist" ? "-" + process.env.SIFT_OUT : "";
const profile = root + ".chrome/profile" + sfx;
mkdirSync(profile, { recursive: true });
await Bun.write(root + ".chrome/launch" + sfx + ".pid", String(process.pid));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: profile,
  defaultViewport: null,
  args: [
    "--remote-debugging-port=" + (process.env.SIFT_PORT ?? "9444"),
    "--window-size=1280,900",
    "--lang=en-US",
    "--mute-audio",
    "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    // Keep pages in background windows fully alive while testing.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
let id = await browser.installExtension(dist);
console.log("chrome up; extension", id);
process.on("SIGUSR1", async () => {
  try {
    await browser.uninstallExtension(id);
  } catch {}
  id = await browser.installExtension(dist);
  console.log("reinstalled", id, new Date().toISOString());
});
browser.on("disconnected", () => process.exit(1));
await new Promise(() => {});
