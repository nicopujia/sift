// Usage: bun scripts/firstpaint.ts <url> <origSelector> [runs] [--sift css] [--wait ms] [--block amazon|<patterns>] [--json]
//
// Time to first content: the original page with Sift switched off, against Sift.
// `runs` is per side (default 3), plus one warm-up load that is not counted.
//
// Method (F1221: polling from Node after DOMContentLoaded stalls while Sift's
// long task runs, so it recorded when that task ended and called pages "equal"):
// - A probe is injected before the page's own scripts and Sift's content
//   scripts (Page.addScriptToEvaluateOnNewDocument). From the page's start it
//   checks every animation frame and records, in page time (ms since
//   navigation start, performance.now() in the frame):
//     original: the first frame where `origSelector` matches an element with height
//     sift:     the first frame where Sift's view shows content: more than 20
//               characters and no "Loading" line, or, with --sift <css>, an
//               element in Sift's view that matches css and has text (use
//               `--sift li.item` where the original selector is a list entry:
//               a YouTube adapter page shows its title and a "Loading…" line
//               before the list, which the default counts as content)
//     loading:  the first frame where Sift's view shows anything, its "Loading"
//               line or more
//   plus long tasks (PerformanceObserver), first-contentful-paint,
//   DOMContentLoaded and load. The values are read after load, so a busy main
//   thread delays only the reading, never the numbers.
// - Runs alternate Sift off and Sift on in the same tab (ABBA order: off on,
//   on off, ...). The probe switches Sift per run through its tab-and-site
//   setting (sessionStorage "sift:mode", the one Alt+Shift+S sets) before
//   Sift starts, then the script puts the setting back as it was. A run where
//   Sift did not end in the asked mode is reported and left out.
// - It prints each run, then medians: the original's selector frame with Sift
//   off, Sift's first content and its "Loading" line with Sift on, and FCP for both.
// - --block fails matching requests in this tab (Fetch domain, comma-separated
//   wildcard URL patterns; only matching requests are paused, so others keep
//   their timing). `--block amazon` blocks Amazon's hosts: use it for the
//   Amazon snapshots and fixtures, which must never reach Amazon. It prints how
//   many requests it blocked and any that got through.
import { connect, sleep, tab } from "./lib";

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--wait", "--block", "--sift"].includes(args[i - 1])));
const [url, sel, runsArg] = pos;
if (!url || !sel) {
  console.log("Usage: bun scripts/firstpaint.ts <url> <origSelector> [runs] [--sift css] [--wait ms] [--block amazon|<patterns>] [--json]");
  process.exit(2);
}
const runs = Math.max(1, Number(runsArg ?? 3));
const wi = args.indexOf("--wait");
const wait = wi >= 0 ? Number(args[wi + 1]) : 15000;
const MODE_KEY = "sift:mode";
const AMAZON = ["amazon.*", "*.amazon.*", "*.media-amazon.com", "*.ssl-images-amazon.com", "*.images-amazon.com", "*.amazon-adsystem.com", "*.cloudfront.net"].map((h) => `*://${h}/*`);
const bi = args.indexOf("--block");
const si = args.indexOf("--sift");
const siftSel = si >= 0 ? (args[si + 1] ?? "") : "";
const block = bi < 0 ? [] : args[bi + 1] === "amazon" ? AMAZON : (args[bi + 1] ?? "").split(",").filter(Boolean);

type Mode = "on" | "off";
type Probe = {
  mode: Mode;
  prev: string | null;
  orig: number;
  sift: number;
  loading: number;
  first: string;
  shown: string;
  fcp: number;
  dcl: number;
  load: number;
  long: number[][];
  url: string;
};

const browser = await connect();
const page = await tab(browser);
await page.setViewport({ width: 1280, height: 900 });
const blocked = { n: 0, leaked: [] as string[] };
if (block.length) {
  const cdp = await page.createCDPSession();
  cdp.on("Fetch.requestPaused", (e) => {
    blocked.n++;
    cdp.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" }).catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: block.map((urlPattern) => ({ urlPattern })) });
  const re = new RegExp("^(" + block.map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")).join("|") + ")$");
  page.on("response", (r) => {
    if (re.test(r.url())) blocked.leaked.push(r.url());
  });
}

/** Runs in the page before any of its scripts: switch Sift for this load, then watch every frame. */
function probe(mode: Mode, sel: string, key: string, siftSel: string) {
  if (window !== window.top) return;
  const w = window as any;
  let prev: string | null = null;
  try {
    prev = sessionStorage.getItem(key);
    if (mode === "off") sessionStorage.setItem(key, "original");
    else sessionStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
  const fp = (w.__siftFP = { mode, prev, orig: -1, sift: -1, loading: -1, first: "", long: [] as number[][] });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) fp.long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
  } catch {
    /* no long task timing */
  }
  const tick = () => {
    const now = Math.round(performance.now());
    if (fp.orig < 0) {
      const e = document.querySelector(sel);
      if (e && e.getBoundingClientRect().height > 0) fp.orig = now;
    }
    if (mode === "on" && fp.sift < 0) {
      const m = document.querySelector("sift-root")?.shadowRoot?.querySelector("main") as HTMLElement | null;
      if (m && (m.textContent ?? "").trim()) {
        if (fp.loading < 0 && m.innerText.trim()) fp.loading = now;
        const hit = siftSel
          ? Array.from(m.querySelectorAll<HTMLElement>(siftSel)).some((e) => e.innerText.trim().length > 0)
          : !m.querySelector(".loading") && (m.textContent ?? "").trim().length > 20 && m.innerText.trim().length > 20;
        if (hit) {
          fp.sift = now;
          fp.first = m.innerText.replace(/\s+/g, " ").trim().slice(0, 100);
        }
      }
    }
    const done = fp.orig >= 0 && (mode === "off" || fp.sift >= 0);
    if (!done && now < 120000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The probe's results, once the page has loaded. */
const read = () =>
  page.evaluate(() => {
    const w = window as any;
    const fp = w.__siftFP;
    if (!fp) return null;
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const host = document.querySelector("sift-root");
    const style = host?.getAttribute("style") ?? "";
    return {
      ...fp,
      long: fp.long.slice(),
      shown: !host ? "none" : /inset: 0/.test(style) ? "sift" : "original",
      fcp: fcp ? Math.round(fcp.startTime) : -1,
      dcl: n ? Math.round(n.domContentLoadedEventStart) : -1,
      load: n ? Math.round(n.loadEventStart) : -1,
      url: location.href,
    };
  }) as Promise<Probe | null>;

let restoreTo: { prev: string | null; url: string } | null = null;
/** Put the tab's Sift setting for this site back as it was before the first run. */
async function restore() {
  if (!restoreTo) return;
  const { prev } = restoreTo;
  restoreTo = null;
  await page
    .evaluate(
      (key, prev) => {
        if (prev === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, prev);
      },
      MODE_KEY,
      prev,
    )
    .catch(() => console.log("could not restore the Sift setting for", page.url()));
}
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await restore();
    process.exit(130);
  });

async function load(mode: Mode): Promise<Probe | null> {
  const { identifier } = await page.evaluateOnNewDocument(probe, mode, sel, MODE_KEY, siftSel);
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 45000 }).catch((e) => console.log("goto:", String(e.message ?? e).slice(0, 100)));
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(identifier).catch(() => {});
  }
  let r: Probe | null = null;
  while (Date.now() - t0 < wait) {
    r = await read().catch(() => null);
    if (r && r.orig >= 0 && (mode === "off" || r.sift >= 0)) break;
    await sleep(250);
  }
  // Long tasks are reported a little after they end.
  await sleep(300);
  return (await read().catch(() => null)) ?? r;
}

const long = (r: Probe, until: number) => {
  const before = r.long.filter(([s]) => until < 0 || s < until);
  return { n: before.length, total: before.reduce((a, [, d]) => a + d, 0), max: before.reduce((a, [, d]) => Math.max(a, d), 0) };
};
const fmt = (ms: number) => (ms < 0 ? "-" : `${ms} ms`);

const warm = await load("on");
if (warm) restoreTo = { prev: warm.prev, url: warm.url };
console.log(`warm-up (not counted): ${warm ? `Sift ${warm.shown}, original ${fmt(warm.orig)}, sift ${fmt(warm.sift)}` : "no probe result"}`);

const order: Mode[] = [];
for (let i = 0; order.length < runs * 2; i++) order.push(...((i % 2 ? ["on", "off"] : ["off", "on"]) as Mode[]));
const res: Record<Mode, Probe[]> = { on: [], off: [] };
try {
  for (const [i, mode] of order.entries()) {
    const r = await load(mode);
    if (!r) {
      console.log(`run ${i + 1} ${mode}: no probe result (page did not load?)`);
      continue;
    }
    const want = mode === "on" ? "sift" : "original";
    const lt = long(r, mode === "on" ? r.sift : r.orig);
    const tail = `fcp ${fmt(r.fcp)}, dcl ${fmt(r.dcl)}, load ${fmt(r.load)}, long tasks before it ${lt.n} (${lt.total} ms, longest ${lt.max} ms)`;
    if (r.shown !== want && !(mode === "off" && r.shown === "none")) {
      console.log(`run ${i + 1} ${mode}: SKIPPED, Sift showed "${r.shown}" instead of "${want}"`);
      continue;
    }
    res[mode].push(r);
    if (mode === "off") console.log(`run ${i + 1} off: original ${fmt(r.orig)}; ${tail}`);
    else console.log(`run ${i + 1} on:  sift ${fmt(r.sift)}, loading ${fmt(r.loading)} (original under Sift ${fmt(r.orig)}); ${tail}`);
  }
} finally {
  await restore();
}

const median = (xs: number[]) => {
  const v = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  if (!v.length) return -1;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const miss = (xs: number[]) => xs.filter((x) => x < 0).length;
const off = res.off, on = res.on;
const s = {
  url,
  selector: sel,
  siftSelector: siftSel || null,
  runs: { off: off.length, on: on.length },
  original: median(off.map((r) => r.orig)),
  originalFcp: median(off.map((r) => r.fcp)),
  sift: median(on.map((r) => r.sift)),
  siftLoading: median(on.map((r) => r.loading)),
  siftFcp: median(on.map((r) => r.fcp)),
  missing: { original: miss(off.map((r) => r.orig)), sift: miss(on.map((r) => r.sift)) },
  range: {
    original: [Math.min(...off.map((r) => r.orig)), Math.max(...off.map((r) => r.orig))],
    sift: [Math.min(...on.map((r) => r.sift)), Math.max(...on.map((r) => r.sift))],
  },
};
const diff = s.original >= 0 && s.sift >= 0 ? ` Sift - original: ${s.sift - s.original} ms (${(s.sift / Math.max(1, s.original)).toFixed(1)}x).` : "";
console.log(
  `medians (${off.length} off, ${on.length} on): original ${fmt(s.original)} (fcp ${fmt(s.originalFcp)}${s.missing.original ? `, ${s.missing.original} never matched` : ""}); ` +
    `Sift ${fmt(s.sift)}, loading ${fmt(s.siftLoading)} (fcp ${fmt(s.siftFcp)}${s.missing.sift ? `, ${s.missing.sift} never showed content` : ""}).${diff}`,
);
if (on.length) console.log(`Sift's first content (last run on): "${on[on.length - 1].first}"`);
if (block.length) console.log(`blocked ${blocked.n} requests; got through: ${blocked.leaked.length ? blocked.leaked.slice(0, 5).join(" ") : "none"}`);
if (args.includes("--json")) console.log(JSON.stringify(s));
browser.disconnect();
process.exit(0);
