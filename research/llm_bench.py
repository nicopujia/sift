# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx[http2]>=0.27"]
# ///
"""Sift LLM benchmark: latency, cost, and format/fact checks for page-rewrite models.

Usage (from anywhere):
  uv run /home/nico/projects/sift/research/llm_bench.py run --runs 3 --tag main
  uv run /home/nico/projects/sift/research/llm_bench.py run --only haiku-5.5,gpt-6-luna --runs 3 --tag routes
  uv run /home/nico/projects/sift/research/llm_bench.py report main
  uv run /home/nico/projects/sift/research/llm_bench.py show main haiku-5.5 A 1

Keys are read from /home/nico/.env (OPENROUTER_API_KEY, OPENAI_API_KEY). They are never printed.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
import uuid
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
INPUTS = HERE / "llm_bench_inputs"
RESULTS = HERE / "llm_bench_results"
ENV_FILE = Path("/home/nico/.env")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

# ---------------------------------------------------------------------------
# Prompts (the same text Sift would send)
# ---------------------------------------------------------------------------

SYSTEM_A = """You rewrite YouTube video titles into plain, literal descriptions.

Input: a JSON array of videos, each with id, title, channel, duration.

For each video, write one plain line that says what the video is about.
Rules:
- At most 12 words.
- Write each line in the language of that video's title: Spanish title, Spanish line; English title, English line. Never translate.
- No clickbait: no ALL CAPS, no emojis, no hype words, no questions.
- Use only what the title and channel state or clearly imply. Do not invent results, names, numbers, or reasons. If the title hides the topic, say plainly that it is not stated.

Output JSON Lines only: one object per line, {"id": "<id>", "s": "<line>"}, in input order, one line per video.
No code fences. No other text."""

# Variant: the extension detects each title's language (chrome.i18n.detectLanguage) and passes it as "lang".
SYSTEM_A_LANG = """You rewrite YouTube video titles into plain, literal descriptions.

Input: a JSON array of videos, each with id, lang, title, channel, duration.

For each video, write one plain line that says what the video is about.
Rules:
- At most 12 words.
- Write the line in the language given by that video's "lang" field (en = English, es = Spanish). Never translate.
- No clickbait: no ALL CAPS, no emojis, no hype words, no questions.
- Use only what the title and channel state or clearly imply. Do not invent results, names, numbers, or reasons. If the title hides the topic, say plainly that it is not stated.

Output JSON Lines only: one object per line, {"id": "<id>", "s": "<line>"}, in input order, one line per video.
Example lines:
{"id": "x1", "s": "A beginner's guide to baking bread at home"}
{"id": "x2", "s": "Cómo hacer pan casero sin horno"}
No code fences. No other text."""

SYSTEM_B = """Rewrite the article into the shortest form that keeps every important fact: names, roles, numbers, dates, claims, and who said what.

Rules:
- Same language as the article.
- Short, plain sentences.
- Keep the section structure: the title, then one heading per original section, in the same order.
- Cut filler, repetition, and background that adds no facts.
- Do not add facts, opinions, or interpretations.
- Output simple Markdown only: # and ## headings, paragraphs, and "- " bullet lists. No bold, italics, links, tables, quotes blocks, or code fences.
- No preamble and no closing remark."""

# ---------------------------------------------------------------------------
# Candidates. "body" is merged into the request body as-is.
# ---------------------------------------------------------------------------

CANDIDATES: dict[str, dict] = {
    # Anthropic
    "haiku-5.5": {
        "model": "anthropic/claude-haiku-5.5",
        "route": "sort=latency",
        "body": {"reasoning": {"effort": "none"}, "provider": {"sort": "latency"}},
    },
    # OpenAI
    "gpt-6-luna": {
        "model": "openai/gpt-6-luna",
        "route": "sort=latency",
        "body": {"reasoning": {"effort": "none"}, "provider": {"sort": "latency"}},
    },
    # Google
    "gemini-3.5-flash-lite": {
        "model": "google/gemini-3.5-flash-lite",
        "route": "sort=latency",
        "body": {"reasoning": {"effort": "minimal"}, "provider": {"sort": "latency"}},
    },
    "gemini-3.1-flash-lite": {
        "model": "google/gemini-3.1-flash-lite",
        "route": "sort=latency",
        "body": {"reasoning": {"effort": "none"}, "provider": {"sort": "latency"}},
    },
    "gemini-2.5-flash-lite": {
        "model": "google/gemini-2.5-flash-lite",
        "route": "sort=latency",
        "body": {"reasoning": {"enabled": False}, "provider": {"sort": "latency"}},
    },
    # Fast-inference hosts
    "gpt-oss-120b@cerebras": {
        "model": "openai/gpt-oss-120b",
        "route": "only=cerebras",
        "body": {"reasoning": {"effort": "low"}, "provider": {"only": ["cerebras"], "allow_fallbacks": False}},
    },
    "gpt-oss-20b@groq": {
        "model": "openai/gpt-oss-20b",
        "route": "only=groq",
        "body": {"reasoning": {"effort": "low"}, "provider": {"only": ["groq"], "allow_fallbacks": False}},
    },
    "llama-3.3-70b@groq": {
        "model": "meta-llama/llama-3.3-70b-instruct",
        "route": "only=groq",
        "body": {"provider": {"only": ["groq"], "allow_fallbacks": False}},
    },
    "qwen3.8-27b@cerebras": {
        "model": "qwen/qwen3.8-27b",
        "route": "only=cerebras",
        "body": {"reasoning": {"effort": "none"}, "provider": {"only": ["cerebras"], "allow_fallbacks": False}},
    },
    "gemma-4-31b@sambanova": {
        "model": "google/gemma-4-31b-it",
        "route": "only=sambanova",
        "body": {"provider": {"only": ["sambanova"], "allow_fallbacks": False}},
    },
    # ---- route variants (phase 2) ----
    "haiku-5.5:default": {
        "model": "anthropic/claude-haiku-5.5",
        "route": "default load balancing",
        "body": {"reasoning": {"effort": "none"}},
    },
    "haiku-5.5:throughput": {
        "model": "anthropic/claude-haiku-5.5",
        "route": "sort=throughput",
        "body": {"reasoning": {"effort": "none"}, "provider": {"sort": "throughput"}},
    },
    "haiku-5.5@anthropic": {  # fails: his BYOK Anthropic key on OpenRouter has no credit (HTTP 400)
        "model": "anthropic/claude-haiku-5.5",
        "route": "only=anthropic",
        "body": {"reasoning": {"effort": "none"}, "provider": {"only": ["anthropic"], "allow_fallbacks": False}},
    },
    "gpt-6-luna:default": {
        "model": "openai/gpt-6-luna",
        "route": "default load balancing",
        "body": {"reasoning": {"effort": "none"}},
    },
    "gpt-6-luna:nitro": {
        "model": "openai/gpt-6-luna:nitro",
        "route": ":nitro",
        "body": {"reasoning": {"effort": "none"}},
    },
    "gpt-6-luna@openai-direct": {
        "model": "gpt-6-luna",
        "route": "OpenAI API direct",
        "endpoint": "openai",
        "body": {"reasoning_effort": "none"},
    },
    "gpt-oss-120b@groq": {
        "model": "openai/gpt-oss-120b",
        "route": "only=groq",
        "body": {"reasoning": {"effort": "low"}, "provider": {"only": ["groq"], "allow_fallbacks": False}},
    },
    "gemini-3.5-flash-lite:default": {
        "model": "google/gemini-3.5-flash-lite",
        "route": "default load balancing",
        "body": {"reasoning": {"effort": "minimal"}},
    },
    "gemini-3.5-flash-lite:nitro": {
        "model": "google/gemini-3.5-flash-lite:nitro",
        "route": ":nitro",
        "body": {"reasoning": {"effort": "minimal"}},
    },
    "gemini-3.5-flash-lite@ai-studio": {
        "model": "google/gemini-3.5-flash-lite",
        "route": "only=google-ai-studio",
        "body": {"reasoning": {"effort": "minimal"}, "provider": {"only": ["google-ai-studio"], "allow_fallbacks": False}},
    },
    "gemma-4-31b:latency": {
        "model": "google/gemma-4-31b-it",
        "route": "sort=latency",
        "body": {"provider": {"sort": "latency"}},
    },
    "gemma-4-31b:throughput": {
        "model": "google/gemma-4-31b-it",
        "route": "sort=throughput",
        "body": {"provider": {"sort": "throughput"}},
    },
    "gemini-3.1-flash-lite@ai-studio": {
        "model": "google/gemini-3.1-flash-lite",
        "route": "only=google-ai-studio",
        "body": {"reasoning": {"effort": "none"}, "provider": {"only": ["google-ai-studio"], "allow_fallbacks": False}},
    },
}

DEFAULT_SET = [
    "haiku-5.5", "gpt-6-luna", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite",
    "gpt-oss-120b@cerebras", "gpt-oss-20b@groq", "llama-3.3-70b@groq", "qwen3.8-27b@cerebras", "gemma-4-31b@sambanova",
]

# Prices for the OpenAI-direct route, USD per token (OpenAI list price, same as OpenRouter's openai endpoint).
DIRECT_PRICES = {"gpt-6-luna": (0.10e-6, 0.50e-6)}

SPANISH_VIDEO_IDS = {
    "Xm2_pLq8rTe", "Zq-4tYp1LmN", "LkJ8hG6fD4s", "mN5bV2cX9zA", "r4T5yU6iO7P",
    "Vb_8nM1qW2e", "Fg2Hj3Kl4Zx", "Ui8Op9-As0D", "Jk4Lz5Xc6Vb", "As_1Df2Gh3J",
}


def load_keys() -> dict[str, str]:
    keys = {}
    for line in ENV_FILE.read_text().splitlines():
        m = re.match(r"^\s*(?:export\s+)?(OPENROUTER_API_KEY|OPENAI_API_KEY)=(.*)$", line)
        if m:
            keys[m.group(1)] = m.group(2).strip().strip("'\"")
    return keys


def load_tasks() -> dict[str, dict]:
    videos = (INPUTS / "videos.json").read_text()
    videos_lang = json.dumps(
        [{"id": v["id"], "lang": "es" if v["id"] in SPANISH_VIDEO_IDS else "en", **{k: v[k] for k in ("title", "channel", "duration")}}
         for v in json.loads(videos)], ensure_ascii=False, indent=1)
    return {
        "A": {"system": SYSTEM_A, "user": videos, "lang": "mixed"},
        "A_lang": {"system": SYSTEM_A_LANG, "user": videos_lang, "lang": "mixed"},
        "B_en": {"system": SYSTEM_B, "user": (INPUTS / "article_en.md").read_text(), "lang": "en"},
        "B_es": {"system": SYSTEM_B, "user": (INPUTS / "article_es.md").read_text(), "lang": "es"},
    }


# ---------------------------------------------------------------------------
# One streamed call
# ---------------------------------------------------------------------------

def call(client: httpx.Client, keys: dict, cand: dict, task: dict, task_name: str) -> dict:
    nonce = uuid.uuid4().hex[:8]  # breaks prompt caching across repeated runs; production inputs differ per page
    messages = [
        {"role": "system", "content": f"[{nonce}]\n{task['system']}"},
        {"role": "user", "content": task["user"]},
    ]
    endpoint = cand.get("endpoint", "openrouter")
    if endpoint == "openai":
        url = OPENAI_URL
        headers = {"Authorization": f"Bearer {keys['OPENAI_API_KEY']}"}
        body = {"model": cand["model"], "messages": messages, "stream": True,
                "stream_options": {"include_usage": True}, "max_completion_tokens": 4000}
    else:
        url = OPENROUTER_URL
        headers = {"Authorization": f"Bearer {keys['OPENROUTER_API_KEY']}",
                   "HTTP-Referer": "https://github.com/nicopujia/sift", "X-Title": "Sift benchmark"}
        body = {"model": cand["model"], "messages": messages, "stream": True, "max_tokens": 4000}
    body.update(cand.get("body", {}))

    rec = {"task": task_name, "model": cand["model"], "route": cand["route"], "ts": time.time(),
           "ttft": None, "t_first_any": None, "t_first_item": None, "t_last": None, "t_done": None,
           "text": "", "reasoning_chars": 0, "usage": None, "cost": None, "provider": None, "error": None,
           "finish_reason": None}
    buf = []
    pending_line = ""
    t0 = time.perf_counter()
    try:
        with client.stream("POST", url, json=body, headers=headers, timeout=httpx.Timeout(90.0, connect=10.0)) as r:
            if r.status_code != 200:
                rec["error"] = f"HTTP {r.status_code}: {r.read().decode(errors='replace')[:400]}"
                return rec
            for line in r.iter_lines():
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                now = time.perf_counter() - t0
                if chunk.get("error"):
                    rec["error"] = json.dumps(chunk["error"])[:400]
                    break
                if chunk.get("provider"):
                    rec["provider"] = chunk["provider"]
                if chunk.get("usage"):
                    rec["usage"] = chunk["usage"]
                for ch in chunk.get("choices") or []:
                    delta = ch.get("delta") or {}
                    if ch.get("finish_reason"):
                        rec["finish_reason"] = ch["finish_reason"]
                    reasoning = delta.get("reasoning") or delta.get("reasoning_content") or ""
                    content = delta.get("content") or ""
                    if (reasoning or content) and rec["t_first_any"] is None:
                        rec["t_first_any"] = now
                    rec["reasoning_chars"] += len(reasoning)
                    if content:
                        if rec["ttft"] is None:
                            rec["ttft"] = now
                        rec["t_last"] = now
                        buf.append(content)
                        if task_name.startswith("A") and rec["t_first_item"] is None:
                            pending_line += content
                            while "\n" in pending_line and rec["t_first_item"] is None:
                                ln, pending_line = pending_line.split("\n", 1)
                                try:
                                    obj = json.loads(ln.strip())
                                    if isinstance(obj, dict) and "id" in obj and "s" in obj:
                                        rec["t_first_item"] = now
                                except json.JSONDecodeError:
                                    pass
            rec["t_done"] = time.perf_counter() - t0
    except Exception as e:  # network errors, timeouts
        rec["error"] = f"{type(e).__name__}: {e}"[:400]
    rec["text"] = "".join(buf)
    if task_name.startswith("A") and rec["t_first_item"] is None and rec["text"]:
        # single-line or unterminated output: first item is parseable only at the end
        for ln in rec["text"].splitlines():
            try:
                obj = json.loads(ln.strip())
                if isinstance(obj, dict) and "id" in obj:
                    rec["t_first_item"] = rec["t_last"]
                    break
            except json.JSONDecodeError:
                continue
    # cost
    u = rec["usage"] or {}
    if endpoint == "openai":
        pin, pout = DIRECT_PRICES.get(cand["model"], (0, 0))
        rec["cost"] = u.get("prompt_tokens", 0) * pin + u.get("completion_tokens", 0) * pout
        rec["provider"] = "OpenAI (direct)"
    else:
        rec["cost"] = or_cost(u)
    return rec


def or_cost(u: dict) -> float | None:
    """OpenRouter cost. With BYOK (his OpenAI key is attached to the OpenRouter account), usage.cost is 0
    and the real provider charge is in cost_details.upstream_inference_cost."""
    if not u:
        return None
    if u.get("is_byok"):
        return (u.get("cost_details") or {}).get("upstream_inference_cost")
    return u.get("cost")


def rec_cost(r: dict) -> float | None:
    if r.get("provider") == "OpenAI (direct)":
        return r.get("cost")
    return or_cost(r.get("usage") or {})


# ---------------------------------------------------------------------------
# Quality checks
# ---------------------------------------------------------------------------

EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️]")
ES_WORDS = {"el", "la", "los", "las", "de", "del", "que", "en", "y", "un", "una", "por", "para", "con", "su",
            "sus", "sobre", "cómo", "como", "qué", "se", "al", "lo", "es", "mi", "tu", "sin", "días", "más",
            "receta", "historia", "creadora", "creador", "explica", "canal", "comida", "tren", "muestra", "sobre",
            "arresto", "vivo", "debate", "entre", "quién", "mejor", "errores", "batería", "aviones", "mundo"}
EN_WORDS = {"the", "of", "and", "to", "in", "how", "his", "her", "their", "for", "with", "about", "on", "is",
            "what", "why", "this", "that", "from", "an", "at", "it", "creator", "explains", "shows", "video",
            "channel", "tests", "tries", "ranks", "workout", "day", "showing", "shows", "live", "arrest", "without",
            "life", "every", "into", "after", "by", "you", "your", "trick", "food", "history", "recipe", "mistakes",
            "battery", "fastest", "train", "world", "planes", "airplanes", "who", "better", "spicy", "spiciest"}
CAPS_ALLOW = {"ASMR", "NASA", "USA", "DIY"}


def guess_lang(text: str) -> str:
    words = re.findall(r"[a-záéíóúñü]+", text.lower())
    es = sum(w in ES_WORDS for w in words) + 2 * len(re.findall(r"[áéíóúñ¿¡]", text.lower()))
    en = sum(w in EN_WORDS for w in words)
    if es == en:
        return "?"
    return "es" if es > en else "en"


def eval_a(text: str) -> dict:
    videos = json.loads((INPUTS / "videos.json").read_text())
    ids = [v["id"] for v in videos]
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    fenced = any(ln.strip().startswith("```") for ln in lines)
    items, bad_lines = [], []
    for ln in lines:
        s = ln.strip()
        if s.startswith("```"):
            continue
        try:
            obj = json.loads(s)
            if not (isinstance(obj, dict) and set(obj) == {"id", "s"} and isinstance(obj["s"], str)):
                bad_lines.append(s[:80])
                continue
            items.append(obj)
        except json.JSONDecodeError:
            bad_lines.append(s[:80])
    got = [o["id"] for o in items]
    missing = [i for i in ids if i not in got]
    unknown = [i for i in got if i not in ids]
    dupes = len(got) - len(set(got))
    order_ok = [i for i in got if i in ids] == [i for i in ids if i in got]
    over12, emoji, caps, lang_bad, questions = [], [], [], [], []
    for o in items:
        s, vid = o["s"], o["id"]
        if len(s.split()) > 12:
            over12.append(vid)
        if EMOJI_RE.search(s):
            emoji.append(vid)
        if any(len(w) >= 4 and w.isupper() and w not in CAPS_ALLOW for w in re.findall(r"[^\W\d_]+", s)):
            caps.append(vid)
        if "?" in s or "¿" in s:
            questions.append(vid)
        want = "es" if vid in SPANISH_VIDEO_IDS else "en"
        if vid in ids and guess_lang(s) not in (want, "?"):
            lang_bad.append(vid)
    strict = (not fenced and not bad_lines and not missing and not unknown and dupes == 0 and order_ok)
    return {"strict_jsonl": strict, "fenced": fenced, "bad_lines": bad_lines, "n_items": len(items),
            "missing": missing, "unknown": unknown, "dupes": dupes, "order_ok": order_ok, "over12": over12,
            "emoji": emoji, "caps": caps, "questions": questions, "lang_suspect": lang_bad}


def norm(text: str) -> str:
    # gpt-oss writes U+2011 non-breaking hyphens and thin-space thousands ("150 000"); fold them so regexes match
    t = text.lower()
    t = re.sub(r"[    ]", " ", t)
    t = re.sub(r"[‐‑‒–—−]", "-", t)
    t = t.replace("**", "").replace("__", "")
    return t


def numbers_in(text: str) -> set[str]:
    out = set()
    t = re.sub(r"(\d) (?=\d{3}\b)", r"\1", norm(text))
    for m in re.findall(r"\d[\d.,]*", t):
        d = re.sub(r"[.,]", "", m.rstrip(".,"))
        if d:
            out.add(d.lstrip("0") or "0")
    return out


def eval_b(text: str, lang: str) -> dict:
    src = (INPUTS / f"article_{lang}.md").read_text()
    facts = json.loads((INPUTS / f"facts_{lang}.json").read_text())
    t = norm(text)
    lost = [label for label, pats in facts if not all(re.search(p, t) for p in pats)]
    src_sections = len(re.findall(r"^## ", src, re.M))
    out_h2 = len(re.findall(r"^## ", text, re.M))
    out_h1 = len(re.findall(r"^# ", text, re.M))
    flags = []
    if "```" in text:
        flags.append("code-fence")
    if re.search(r"\*\*[^*]+\*\*|__[^_]+__", text):
        flags.append("bold")
    if re.search(r"(?<![\w*])\*[^*\s][^*]*\*(?!\*)|(?<!\w)_[^_\s][^_]*_(?!\w)", text):
        flags.append("italics")
    if re.search(r"^\s*\|.*\|\s*$", text, re.M):
        flags.append("table")
    if re.search(r"\[[^\]]+\]\([^)]+\)", text):
        flags.append("link")
    if re.search(r"^\s*>", text, re.M):
        flags.append("blockquote")
    first = text.strip().splitlines()[0] if text.strip() else ""
    if first and not first.startswith("#"):
        flags.append("preamble/no-title")
    new_numbers = sorted(numbers_in(text) - numbers_in(src))
    lang_out = guess_lang(text)
    return {"facts_total": len(facts), "facts_kept": len(facts) - len(lost), "lost": lost,
            "h1": out_h1, "h2": out_h2, "src_h2": src_sections, "flags": flags,
            "new_numbers": new_numbers, "words_out": len(text.split()), "words_in": len(src.split()),
            "lang_out": lang_out, "lang_ok": lang_out == lang}


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def openrouter_usage(client: httpx.Client, keys: dict) -> float | None:
    try:
        r = client.get("https://openrouter.ai/api/v1/key",
                       headers={"Authorization": f"Bearer {keys['OPENROUTER_API_KEY']}"}, timeout=15)
        return float(r.json()["data"]["usage"])
    except Exception:
        return None


def cmd_run(args):
    keys = load_keys()
    tasks = load_tasks()
    names = args.only.split(",") if args.only else DEFAULT_SET
    task_names = args.tasks.split(",")
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"{args.tag}.jsonl"
    with httpx.Client(http2=True) as client:
        before = openrouter_usage(client, keys)
        # warm the TLS connections so every model sees a reused connection, as an extension would
        client.get("https://openrouter.ai/api/v1/models?limit=1", timeout=15)
        if any(CANDIDATES[n].get("endpoint") == "openai" for n in names):
            client.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {keys['OPENAI_API_KEY']}"}, timeout=15)
        with out.open("a") as f:
            for run in range(1, args.runs + 1):
                for name in names:
                    for tn in task_names:
                        rec = call(client, keys, CANDIDATES[name], tasks[tn], tn)
                        rec["name"], rec["run"] = name, run
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                        f.flush()
                        u = rec["usage"] or {}
                        print(f"run{run} {name:32s} {tn:5s} ttft={fmt(rec['ttft'])} total={fmt(rec['t_last'])} "
                              f"out_tok={u.get('completion_tokens')} prov={rec['provider']} "
                              f"cost={rec['cost']} err={rec['error']}", flush=True)
        after = openrouter_usage(client, keys)
    if before is not None and after is not None:
        print(f"OpenRouter spend this run: ${after - before:.4f} (usage counter may lag a few seconds)")


def fmt(x):
    return "  -  " if x is None else f"{x:5.2f}"


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.fmean(xs) if xs else None


def load_results(tags):
    recs = []
    for tag in tags:
        for line in (RESULTS / f"{tag}.jsonl").read_text().splitlines():
            if line.strip():
                recs.append(json.loads(line))
    return recs


def cmd_report(args):
    recs = load_results(args.tags)
    names = list(dict.fromkeys(r["name"] for r in recs))
    print("| name | model | route | served by | A ttft | A first item | A total | A out tok | B ttft | B total | B out tok | $/1k A | $/1k B | A strict JSONL | A issues | B facts kept | B length | B issues | errors |")
    print("|" + "---|" * 19)
    for n in names:
        rs = [r for r in recs if r["name"] == n]
        a = [r for r in rs if r["task"].startswith("A") and not r["error"]]
        b = [r for r in rs if r["task"].startswith("B") and not r["error"]]
        errs = [r for r in rs if r["error"]]
        provs = sorted({str(r["provider"]) for r in rs if r["provider"]})
        tok = lambda r: (r["usage"] or {}).get("completion_tokens")
        ea = [eval_a(r["text"]) for r in a]
        eb = [eval_b(r["text"], r["task"][2:]) for r in b]
        a_issues = []
        if ea:
            for key in ("over12", "emoji", "caps", "questions", "lang_suspect", "missing"):
                c = sum(len(e[key]) for e in ea)
                if c:
                    a_issues.append(f"{key}:{c}")
            if any(e["fenced"] for e in ea):
                a_issues.append("fenced")
        b_issues = []
        if eb:
            fl = sorted({f for e in eb for f in e["flags"]})
            b_issues += fl
            nn = sorted({x for e in eb for x in e["new_numbers"]})
            if nn:
                b_issues.append("new-numbers:" + "/".join(nn[:6]))
            if not all(e["lang_ok"] for e in eb):
                b_issues.append("lang?")
            if any(e["h2"] < e["src_h2"] for e in eb):
                b_issues.append("sections-dropped")
            dup = sum(e["h1"] > 1 or e["h2"] >= 2 * e["src_h2"] for e in eb)
            if dup:
                b_issues.append(f"duplicated-output:{dup}")
            extra = sum(e["src_h2"] < e["h2"] < 2 * e["src_h2"] for e in eb)
            if extra:
                b_issues.append(f"extra-heading:{extra}")
        kept = f"{mean([e['facts_kept'] / e['facts_total'] for e in eb]) * 100:.0f}%" if eb else "-"
        strict = f"{sum(e['strict_jsonl'] for e in ea)}/{len(ea)}" if ea else "-"
        length = f"{mean([e['words_out'] / e['words_in'] for e in eb]) * 100:.0f}%" if eb else "-"
        cost = lambda xs: f"{mean([rec_cost(r) for r in xs]) * 1000:.3f}" if xs and mean([rec_cost(r) for r in xs]) is not None else "-"
        print(f"| {n} | {rs[0]['model']} | {rs[0]['route']} | {', '.join(provs)} | {fmt(med([r['ttft'] for r in a]))} | "
              f"{fmt(med([r['t_first_item'] for r in a]))} | {fmt(med([r['t_last'] for r in a]))} | {med([tok(r) for r in a])} | "
              f"{fmt(med([r['ttft'] for r in b]))} | {fmt(med([r['t_last'] for r in b]))} | {med([tok(r) for r in b])} | "
              f"{cost(a)} | {cost(b)} | {strict} | {' '.join(a_issues) or 'ok'} | {kept} | {length} | {' '.join(b_issues) or 'ok'} | {len(errs)} |")
    if args.verbose:
        for r in recs:
            if r["error"]:
                print(f"ERROR {r['name']} {r['task']} run{r['run']}: {r['error']}")
            elif r["task"].startswith("A"):
                e = eval_a(r["text"])
                print(f"A {r['name']} run{r['run']}: " + json.dumps({k: v for k, v in e.items() if v}, ensure_ascii=False))
            else:
                e = eval_b(r["text"], r["task"][2:])
                print(f"{r['task']} {r['name']} run{r['run']}: kept {e['facts_kept']}/{e['facts_total']} "
                      f"words {e['words_out']}/{e['words_in']} h2 {e['h2']}/{e['src_h2']} flags={e['flags']} "
                      f"new_numbers={e['new_numbers']} lost={e['lost']}")


def cmd_show(args):
    for r in load_results([args.tag]):
        if r["name"] == args.name and r["task"] == args.task and r["run"] == args.run:
            print(r["error"] or r["text"])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--only", help="comma-separated candidate names (default: main set)")
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--tasks", default="A,B_en,B_es")
    r.add_argument("--tag", default="main")
    r.set_defaults(fn=cmd_run)
    rep = sub.add_parser("report")
    rep.add_argument("tags", nargs="+")
    rep.add_argument("-v", "--verbose", action="store_true")
    rep.set_defaults(fn=cmd_report)
    s = sub.add_parser("show")
    s.add_argument("tag")
    s.add_argument("name")
    s.add_argument("task", choices=["A", "A_lang", "B_en", "B_es"])
    s.add_argument("run", type=int)
    s.set_defaults(fn=cmd_show)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
