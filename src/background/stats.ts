// Anonymous usage counts. Kept per day in local storage, and sent once a day
// as plain counters to Sift's own endpoint: no URLs, no page content, no
// site names, and no lasting id (the server logs no IP or browser either).
// Turn off in Sift's options.

import type { StatName } from "../shared/messages";

const ENDPOINT = "https://sift.pujia.ar/e";
/**
 * The only counts sent. The privacy text in README.md, Options and the install
 * page lists exactly these: a new count is sent only once it is added here and there.
 */
const SENT: readonly string[] = ["page", "toOriginal", "toSift", "action", "error", "aiLines", "aiCondense", "loadMore", "msTotal", "msCount"] satisfies (StatName | "msTotal" | "msCount")[];
type Day = Record<string, number>;

let buffer: Record<string, Day> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let enabled = true;

// Nothing is recorded while counts are turned off in Options.
chrome.storage.local.get("settings").then((r) => (enabled = (r.settings as { analytics?: boolean } | undefined)?.analytics !== false));
chrome.storage.onChanged.addListener((ch) => {
  if (ch.settings) enabled = (ch.settings.newValue as { analytics?: boolean } | undefined)?.analytics !== false;
});

const today = () => new Date().toISOString().slice(0, 10);

export function bump(name: StatName, n = 1, ms?: number) {
  if (!enabled) return;
  const d = (buffer[today()] ??= {});
  d[name] = (d[name] ?? 0) + n;
  if (ms !== undefined) {
    d.msTotal = (d.msTotal ?? 0) + ms;
    d.msCount = (d.msCount ?? 0) + 1;
  }
  clearTimeout(timer);
  timer = setTimeout(save, 2000);
}

async function save() {
  const add = buffer;
  buffer = {};
  const { stats = {} } = (await chrome.storage.local.get("stats")) as { stats?: Record<string, Day> };
  for (const [day, counts] of Object.entries(add)) {
    const d = (stats[day] ??= {});
    for (const [k, v] of Object.entries(counts)) d[k] = (d[k] ?? 0) + v;
  }
  // Keep 60 days.
  const days = Object.keys(stats).sort();
  for (const day of days.slice(0, Math.max(0, days.length - 60))) delete stats[day];
  await chrome.storage.local.set({ stats });
  flushStats();
}

export async function flushStats() {
  const { stats = {}, sent = {}, settings = {}, reportIds = {} } = (await chrome.storage.local.get(["stats", "sent", "settings", "reportIds"])) as {
    stats?: Record<string, Day>;
    sent?: Record<string, boolean>;
    settings?: { analytics?: boolean };
    reportIds?: Record<string, string>;
  };
  // Older versions kept one id for the life of the install.
  chrome.storage.local.remove("installId").catch(() => {});
  if (settings.analytics === false) return;
  const now = today();
  for (const [day, counts] of Object.entries(stats as Record<string, Day>)) {
    if (day >= now || sent[day]) continue;
    // A fresh random id per day's report, only so a retried report is not
    // counted twice. Nothing links one day's report to another's.
    const id = (reportIds[day] ??= crypto.randomUUID());
    await chrome.storage.local.set({ reportIds });
    const q = new URLSearchParams({ v: chrome.runtime.getManifest().version, i: id, d: day });
    for (const [k, v] of Object.entries(counts)) if (SENT.includes(k)) q.set(k, String(Math.round(v)));
    try {
      const r = await fetch(ENDPOINT + "?" + q, { method: "GET", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (r.ok || r.status === 204) {
        sent[day] = true;
        delete reportIds[day];
      }
    } catch {
      break;
    }
  }
  // Forget sent days that are no longer kept in the counts.
  for (const day of Object.keys(sent)) if (!stats[day]) delete sent[day];
  await chrome.storage.local.set({ sent, reportIds });
}
