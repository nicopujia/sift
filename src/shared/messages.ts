// Messages between content scripts and the background service worker.

export interface LineInput {
  /** Caller's id for the entry. */
  id: string;
  /** Title or main text of the entry. */
  t: string;
  /** Context: channel, sender, price, snippet. */
  c?: string;
}

export type AiRequestBody =
  | { task: "lines"; lang: string; items: LineInput[]; mode?: "about" | "gist" | "news"; private?: boolean }
  | {
      task: "condense"; lang: string; title: string; text: string;
      /** From a signed-in page (email, an account): its result is kept for a short time only. */
      private?: boolean;
    };

export type AiTask = AiRequestBody["task"];

/**
 * A request, or the page saying it no longer needs one (the worker stops it),
 * or that it turned out to be signed-in after it asked (its results are kept
 * for the short time only).
 */
export type AiRequest = (AiRequestBody & { id: number }) | { task: "cancel"; id: number } | { task: "private" };

export type AiReply =
  | { id: number; item: string; text: string }
  | { id: number; delta: string }
  | { id: number; full: string }
  | { id: number; done: true }
  | {
      id: number;
      error: string;
      /** refused: every model in the chain was refused (out of credit, bad key). */
      code?: "nokey" | "http" | "network" | "off" | "refused";
      status?: number;
      /** Asking again for the same text would fail the same way (output limit, safety stop). */
      final?: boolean;
      /** The user was already told about this (no key, every model refused) in this browser session. */
      quiet?: boolean;
    };

export type StatName =
  | "page" | "toOriginal" | "toSift" | "action" | "error" | "aiLines" | "aiCondense" | "loadMore";

export type RuntimeMsg =
  | { type: "toggle" }
  | { type: "stat"; name: StatName; n?: number; ms?: number }
  | { type: "config" }
  /** From Options: delete every saved rewrite and Short version. */
  | { type: "clearCache" };

export interface ModelCfg {
  model: string;
  /** Extra JSON fields merged into each request (provider routing, reasoning). */
  extra: string;
}

export interface Settings {
  apiKey: string;
  baseUrl: string;
  /** One-line rewrites of list entries. */
  lines: ModelCfg;
  linesFallback: ModelCfg;
  /** Condensing long text. */
  condense: ModelCfg;
  condenseFallback: ModelCfg;
  /** Last model for both tasks, tried when the others fail or are out of credit. */
  lastResort: ModelCfg;
  ai: boolean;
  scale: number;
  neverSift: string[];
  analytics: boolean;
}

export const MODEL_KEYS = ["lines", "linesFallback", "condense", "condenseFallback", "lastResort"] as const;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  baseUrl: "https://openrouter.ai/api/v1",
  // Chosen by measurement on 2026-10-24 (research/llm-bench.md).
  lines: {
    model: "google/gemini-3.5-flash-lite",
    extra: '{"reasoning":{"effort":"minimal"},"provider":{"order":["google-ai-studio"],"allow_fallbacks":true}}',
  },
  linesFallback: {
    model: "openai/gpt-6-luna",
    extra: '{"reasoning":{"effort":"none"},"provider":{"sort":"latency"}}',
  },
  condense: {
    model: "qwen/qwen3.8-27b",
    extra: '{"reasoning":{"effort":"none"},"provider":{"only":["cerebras"],"allow_fallbacks":false}}',
  },
  condenseFallback: {
    model: "google/gemini-3.5-flash-lite",
    extra: '{"reasoning":{"effort":"minimal"},"provider":{"order":["google-ai-studio"],"allow_fallbacks":true}}',
  },
  // Served only by OpenAI (its priority tier first), so it also runs on an
  // OpenAI key added to the OpenRouter account (bring your own key) when the
  // account has no credit. Measured 2026-10-24: first text 0.7 s, a 900-word
  // article condensed in 3.9 s.
  lastResort: {
    model: "openai/gpt-6-luna",
    extra: '{"reasoning":{"effort":"none"},"provider":{"order":["openai/fast","openai"],"allow_fallbacks":false}}',
  },
  ai: true,
  scale: 1.125,
  neverSift: [],
  analytics: true,
};

/**
 * Model settings that were once the default for each slot. Options used to save
 * every field, so a saved copy of one of these means "the default", not a choice.
 * When a default changes, add the old one here.
 */
const PAST_DEFAULTS: Record<(typeof MODEL_KEYS)[number], ModelCfg[]> = {
  // The defaults of 2026-10-24.
  lines: [{ model: "google/gemini-3.5-flash-lite", extra: '{"reasoning":{"effort":"minimal"},"provider":{"order":["google-ai-studio"],"allow_fallbacks":true}}' }],
  linesFallback: [{ model: "openai/gpt-6-luna", extra: '{"reasoning":{"effort":"none"},"provider":{"sort":"latency"}}' }],
  condense: [{ model: "qwen/qwen3.8-27b", extra: '{"reasoning":{"effort":"none"},"provider":{"only":["cerebras"],"allow_fallbacks":false}}' }],
  condenseFallback: [{ model: "google/gemini-3.5-flash-lite", extra: '{"reasoning":{"effort":"minimal"},"provider":{"order":["google-ai-studio"],"allow_fallbacks":true}}' }],
  lastResort: [],
};

const sameCfg = (a: ModelCfg, b: ModelCfg) => a.model.trim() === b.model.trim() && a.extra.trim() === b.extra.trim();

/** Saved settings over the defaults. Empty or past-default models follow the current defaults. */
export function mergeSettings(saved: Partial<Settings>): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...saved };
  for (const k of MODEL_KEYS) {
    const cfg = saved[k];
    if (!cfg?.model?.trim() || PAST_DEFAULTS[k].some((d) => sameCfg(d, { model: cfg.model, extra: cfg.extra ?? "" }))) s[k] = DEFAULT_SETTINGS[k];
  }
  return s;
}

/** Only what differs from the defaults is saved, so later default changes reach every user. */
export function settingsToSave(s: Settings): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(s) as (keyof Settings)[]) {
    if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULT_SETTINGS[k])) (out as Record<string, unknown>)[k] = s[k];
  }
  for (const k of MODEL_KEYS) if (out[k] && sameCfg(out[k]!, DEFAULT_SETTINGS[k])) delete out[k];
  return out;
}
