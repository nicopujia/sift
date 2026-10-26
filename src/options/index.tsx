import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ModelCfg, RuntimeMsg, Settings } from "../shared/messages";
import { MODEL_KEYS, mergeSettings, settingsToSave } from "../shared/messages";

function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Record<string, Record<string, number>>>({});
  const [saved, setSaved] = useState("");
  const [hasLocalKey, setHasLocalKey] = useState(false);
  const [never, setNever] = useState("");
  const [cleared, setCleared] = useState("");

  useEffect(() => {
    chrome.storage.local.get(["settings", "stats"]).then((r) => {
      const merged = mergeSettings((r.settings ?? {}) as Partial<Settings>);
      setS(merged);
      setNever(merged.neverSift.join("\n"));
      setStats((r.stats ?? {}) as Record<string, Record<string, number>>);
    });
    fetch(chrome.runtime.getURL("local-key.json")).then((r) => setHasLocalKey(r.ok)).catch(() => {});
  }, []);
  if (!s) return null;
  const up = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const save = async (e: Event) => {
    e.preventDefault();
    for (const k of MODEL_KEYS) {
      if (!s[k].extra.trim()) continue;
      try {
        JSON.parse(s[k].extra);
      } catch {
        setSaved("Extra request fields must be valid JSON.");
        return;
      }
    }
    // Site names, as the address bar has them: lowercase, no scheme, path, port, or "www.".
    const neverSift = [
      ...new Set(
        never
          .split(/\s+/)
          .map((d) => d.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d*$/, "").replace(/^www\./, ""))
          .filter(Boolean),
      ),
    ];
    setNever(neverSift.join("\n"));
    // Only changes are saved, so models keep following Sift's defaults.
    await chrome.storage.local.set({ settings: settingsToSave({ ...s, neverSift }) });
    setSaved("Saved.");
    setTimeout(() => setSaved(""), 2500);
  };
  const clear = async () => {
    const ok = await chrome.runtime.sendMessage({ type: "clearCache" } satisfies RuntimeMsg).catch(() => false);
    setCleared(ok ? "Saved summaries cleared." : "Could not clear saved summaries. Try again.");
    setTimeout(() => setCleared(""), 4000);
  };
  const days = Object.keys(stats).sort().reverse().slice(0, 7);
  return (
    <form onSubmit={save}>
      <h1>Sift options</h1>

      <h2>Text rewriting</h2>
      <label class="check">
        <input type="checkbox" checked={s.ai} onChange={(e) => up({ ai: e.currentTarget.checked })} />
        Shorten and rewrite text with a language model
      </label>
      <label>
        API key
        <input type="password" autocomplete="off" value={s.apiKey} onInput={(e) => up({ apiKey: e.currentTarget.value })} placeholder={hasLocalKey ? "Using the key bundled with this install" : "sk-…"} />
        <span class="hint">Page text is sent to this provider to be shortened. The key stays in this browser.</span>
      </label>
      <p class="hint">Short versions and one-line descriptions are saved in this browser, so they are not paid for twice. Those from signed-in pages, such as email, are deleted after 7 days; all others after 30 days.</p>
      <p>
        <button type="button" onClick={clear}>Clear saved summaries</button>
        <span role="status" style="margin-left:.8em;font-weight:600">{cleared}</span>
      </p>
      <label>
        API address (OpenAI-compatible)
        <input type="url" value={s.baseUrl} onInput={(e) => up({ baseUrl: e.currentTarget.value })} />
      </label>
      <details>
        <summary>Models</summary>
        <p class="hint">Each task tries its model, then its fallback, then the last resort. Models you leave as they are follow Sift's defaults; clear a model to go back to the default.</p>
        {(
          [
            ["lines", "One-line descriptions"],
            ["linesFallback", "One-line descriptions, fallback"],
            ["condense", "Short versions of long text"],
            ["condenseFallback", "Short versions, fallback"],
            ["lastResort", "Last resort, for both"],
          ] as [keyof Settings, string][]
        ).map(([k, label]) => {
          const cfg = s[k] as ModelCfg;
          return (
            // The task names the group, so its two fields are told apart from the other tasks' ones.
            <fieldset style="border:0;padding:0;margin:0 0 .8em">
              <legend style="font-weight:700;padding:0;margin-top:.6em">{label}</legend>
              <label>
                Model
                <input type="text" aria-label={`${label}: model`} value={cfg.model} onInput={(e) => up({ [k]: { ...cfg, model: e.currentTarget.value } } as Partial<Settings>)} />
              </label>
              <label>
                Extra request fields (JSON)
                <input type="text" aria-label={`${label}: extra request fields (JSON)`} value={cfg.extra} onInput={(e) => up({ [k]: { ...cfg, extra: e.currentTarget.value } } as Partial<Settings>)} />
              </label>
            </fieldset>
          );
        })}
      </details>

      <h2>Reading</h2>
      <label>
        Text size
        <select value={String(s.scale)} onChange={(e) => up({ scale: Number(e.currentTarget.value) })}>
          {[1, 1.125, 1.25, 1.375, 1.5, 1.75, 2].map((v) => (
            <option value={String(v)}>{Math.round(v * 100)}%</option>
          ))}
        </select>
        <span class="hint">Relative to your browser's default font size.</span>
      </label>
      <label>
        Never sift these sites (one per line)
        <textarea value={never} onInput={(e) => setNever(e.currentTarget.value)} />
      </label>

      <h2>Usage counts</h2>
      <label class="check">
        <input type="checkbox" checked={s.analytics} onChange={(e) => up({ analytics: e.currentTarget.checked })} />
        Send anonymous daily counts. No addresses, no content, no lasting id.
      </label>
      <p class="hint">
        Sent once a day to sift.pujia.ar: the Sift version, the date, a random id used for that one report, and that day's counts of pages shown,
        switches to the original and back to Sift, actions, errors, list entries sent for one-line descriptions, Short versions asked for, uses of
        "load more", and the total and number of times to first view (for the average).
      </p>
      {days.length > 0 && (
        <table>
          <thead><tr><th>Day</th><th>Pages</th><th>To original</th><th>Actions</th><th>Avg first view</th></tr></thead>
          <tbody>
            {days.map((d) => {
              const c = stats[d];
              return (
                <tr>
                  <td>{d}</td>
                  <td>{c.page ?? 0}</td>
                  <td>{c.toOriginal ?? 0}</td>
                  <td>{c.action ?? 0}</td>
                  <td>{c.msCount ? Math.round(c.msTotal / c.msCount) + " ms" : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p>
        <button type="submit">Save</button>
        <span id="status" role="status">{saved}</span>
      </p>
    </form>
  );
}

render(<Options />, document.getElementById("app")!);
