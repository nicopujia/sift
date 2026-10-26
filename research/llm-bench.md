# Sift LLM benchmark

Measured 2026-10-24 through OpenRouter, streaming, from the `pujia` VM. Script: [llm_bench.py](llm_bench.py). Raw results: [llm_bench_results/](llm_bench_results/). Inputs and fact checklists: [llm_bench_inputs/](llm_bench_inputs/).

## Recommendation

Use two models, one per task. Both start showing text in about half a second.

### One-liners (Task A): Gemini 3.5 Flash-Lite, AI Studio first

```json
{
  "model": "google/gemini-3.5-flash-lite",
  "stream": true,
  "max_tokens": 1500,
  "reasoning": { "effort": "minimal" },
  "provider": { "order": ["google-ai-studio"], "allow_fallbacks": true },
  "messages": [
    { "role": "system", "content": "<SYSTEM_A_LANG in llm_bench.py>" },
    { "role": "user", "content": "[{\"id\":\"…\",\"lang\":\"es\",\"title\":\"…\",\"channel\":\"…\",\"duration\":\"…\"}, …]" }
  ]
}
```

- Send a `lang` field per video. Detect it in the extension (for example `chrome.i18n.detectLanguage` on the title). Use the `SYSTEM_A_LANG` prompt, which includes two example lines.
- Without `lang`, this model wrote English lines for all Spanish titles in 4 of 12 runs. With `lang`, it had zero wrong-language lines in 9 of 9 runs (180 lines).
- Measured on AI Studio with `lang` (6 runs): time to first token (TTFT) 0.51 s, first parsed line 0.62 s, all 20 lines 1.64 s. Cost $2.03 per 1,000 calls.
- `reasoning.effort: "minimal"` is the lowest this model allows. Reasoning cannot be turned off.
- I measured `only: ["google-ai-studio"]`. The `order` form above keeps Vertex as a backup. Vertex measured slower: 1.69 to 1.89 s for all 20 lines.

### Condense (Task B): Qwen3.8 27B on Cerebras

```json
{
  "model": "qwen/qwen3.8-27b",
  "stream": true,
  "max_tokens": 4000,
  "reasoning": { "effort": "none" },
  "provider": { "only": ["cerebras"], "allow_fallbacks": false },
  "messages": [
    { "role": "system", "content": "<SYSTEM_B in llm_bench.py>" },
    { "role": "user", "content": "<article as Markdown>" }
  ]
}
```

- Measured over 10 calls (English and Spanish): TTFT 0.27 s, full rewrite 0.77 s. Cost $2.80 per 1,000 calls.
- Best fact retention of any fast model: 96% of checklist facts, at 68% of the original length. Every quote I checked was attributed to the right person.
- Fallbacks are off on purpose. Cerebras is the only fast host for this model. If it fails, switch models instead.

### Fallbacks

Fall back in the extension when the request errors or no content token arrives within about 1.5 s.

- Condense fallback: `google/gemini-3.5-flash-lite` with the same `reasoning` and `provider` fields as Task A. AI Studio: TTFT 0.47 s, total 2.18 s, $2.40 per 1,000 calls, 86% of facts.
- One-liners fallback: `openai/gpt-6-luna` with `"reasoning": {"effort": "none"}` and `"provider": {"sort": "latency"}`. It is a different vendor, so a Google outage does not take out both. With `lang` (6 runs): TTFT 0.90 s, first line 1.09 s, all lines 5.0 s, $0.46 per 1,000 calls, 4 wrong-language lines out of 120. It is slow to finish, but the first lines arrive in about 1 s.

If you want a single model, use Gemini 3.5 Flash-Lite for both tasks. It meets the speed target (A 1.6 s, B 2.2 s). On condense it keeps about 10 points fewer facts than Qwen, drops roles ("gobernador", "CEO"), and misattributed or merged claims in some runs.

## Setup

- Calls ran one at a time over one reused HTTP/2 connection. A warm-up request opened the connection first, as a long-lived extension would.
- 3 runs per task per model. Task B is 3 runs on an English article (898 words) plus 3 on a Spanish one (894 words). Task B medians cover all 6.
- TTFT is time to the first visible content token. Reasoning tokens do not count as visible. "First line" is the first complete JSON Lines (JSONL) object parsed from the stream. "Total" is the last content token.
- A random 8-character tag starts each system prompt. This blocks prompt caching across repeated runs, since real pages differ. Cached tokens were 0 on every call.
- Costs come from OpenRouter's `usage.cost`. gpt-6-luna runs through a bring-your-own-key (BYOK) OpenAI key on this OpenRouter account. For those calls OpenRouter reports $0 and the script uses `cost_details.upstream_inference_cost`, which OpenAI bills. Cost per 1,000 calls is the mean cost per call times 1,000.
- The VM is in Beauharnois, Quebec (OVH). Users in San Francisco will see different network time to OpenRouter.
- Total spend: about $0.29 ($0.26 OpenRouter, $0.03 OpenAI) for 227 calls.

## Main results (prompts as specified, no `lang` field)

Times are medians in seconds. Prices are USD per 1M tokens (input/output) on the route used. "Wrong lang" counts lines in the wrong language out of 60 (3 runs × 20). Facts are the share of 45 English and 47 Spanish checklist facts kept. Length is output words over input words.

| Model | Route (served by) | Price in/out | A TTFT | A first line | A total | B TTFT | B total | $/1k A | $/1k B | Quality notes |
|---|---|---|---|---|---|---|---|---|---|---|
| anthropic/claude-haiku-5.5 | sort=latency (Claude Platform on AWS) | 0.10 / 0.50 | 0.96 | 1.25 | 4.30 | 0.87 | 5.26 | 0.65 | 0.88 | A: JSONL 3/3, wrong lang 9, 4 lines over 12 words. Most careful about "not stated". B: 87% facts, 66% length, faithful. Slow to finish. |
| openai/gpt-6-luna | sort=latency (OpenAI, BYOK) | 0.10 / 0.50 | 1.06 | 1.23 | 5.26 | 0.85 | 8.69 | 0.44 | 0.72 | A: JSONL 3/3, wrong lang 1 (best). B: 100% facts but barely shortens (about 80% length). One run printed the whole rewrite twice. Slowest. |
| google/gemini-3.5-flash-lite | sort=latency (Google Vertex) | 0.30 / 2.50 | 0.58 | 0.65 | 1.69 | 0.62 | 2.62 | 1.93 | 2.38 | A: JSONL 3/3, wrong lang 9 (one run translated every Spanish title). Terse and literal. B: 86% facts, 59% length. Drops roles and quotes. |
| google/gemini-3.1-flash-lite | sort=latency (AI Studio) | 0.25 / 1.50 | 0.86 | 0.91 | 2.14 | 0.67 | 1.97 | 1.25 | 1.17 | A: wrong lang 11. Invented "related to the future of Earth" once. B: over-cuts (59% facts, 40% length). Stated a derived "$180 million" as fact. |
| google/gemini-2.5-flash-lite | sort=latency (AI Studio) | 0.10 / 0.40 | 0.58 | 0.77 | 2.02 | 0.51 | 2.51 | 0.37 | 0.46 | A: wrong lang 30 (all Spanish titles, every run). Keeps clickbait and questions. Corrupted one id (JSONL 2/3). B: 75% facts. |
| openai/gpt-oss-120b | only=cerebras | 0.35 / 0.75 | 0.73 | 0.73 | 0.86 | 0.37 | 0.71 | 1.77 | 1.02 | A: wrong lang 26. Keeps hype ("terrifying"). Spends about 1,200 reasoning tokens even at effort "low". B: 76% facts. Derived "$180 million". |
| openai/gpt-oss-20b | only=groq | 0.075 / 0.30 | 0.51 | 0.47 | 1.10 | 0.47 | 1.47 | 0.34 | 0.37 | A: one run put all 20 objects on one line (JSONL 2/3). One run wrote every line in Spanish. B: 89% facts, 71% length. Cheapest. |
| meta-llama/llama-3.3-70b-instruct | only=groq | 0.59 / 0.79 | 0.64 | 0.82 | 1.61 | 0.35 | 1.48 | 1.19 | 1.30 | A: lowercase fragments. Wrote "not stated" as a whole line. B: 49% facts. Over-cuts badly. |
| qwen/qwen3.8-27b | only=cerebras | 0.99 / 1.49 | 0.25 | 0.28 | 0.42 | 0.29 | 0.76 | 1.82 | 2.79 | A: 2 of 3 runs were plain text, not JSON (JSONL 1/3). Ignores the language rule. B: best (96% facts, 67% length, correct attribution). Fastest. |
| google/gemma-4-31b-it | only=sambanova | 0.38 / 1.15 | 3.06 | 3.09 | 3.86 | 1.91 | 3.21 | 1.16 | 1.35 | A: the only model with 0 wrong-language lines, plain and literal. B: 86% facts. Misattributed one claim and merged two quotes. SambaNova is slow to first token. |

## Task A with a `lang` field per video (3 runs each)

Same models, same routes. The input adds `"lang": "en"` or `"es"`. The prompt says to use that field and shows two example lines.

| Model | Route | TTFT | First line | Total | JSONL valid | Wrong lang (of 60) | Notes |
|---|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | sort=latency | 0.56 | 0.64 | 1.75 | 3/3 | 0 | Plus 6 more runs on AI Studio: 6/6 valid, 0 of 120 wrong. |
| gemini-3.1-flash-lite | sort=latency | 0.62 | 0.73 | 1.69 | 3/3 | 1 | |
| gpt-oss-120b | only=cerebras | 0.76 | 0.76 | 0.92 | 3/3 | 1 | Still copies "my" and hype from titles. |
| gemma-4-31b-it | only=sambanova | 3.40 | 3.43 | 4.21 | 3/3 | 0 | Too slow on this host. |
| gpt-6-luna | sort=latency | 1.08 | 1.27 | 5.15 | 3/3 | 3 | Wrote Spanish for 2 English titles. |
| llama-3.3-70b | only=groq | 0.47 | 0.54 | 1.47 | 3/3 | 6 | |
| gpt-oss-20b | only=groq | 0.34 | 0.38 | 1.00 | 2/3 | 15 | One run broke JSONL again. |
| qwen3.8-27b | only=cerebras | 0.29 | 0.31 | 0.57 | 3/3 | 22 | The example lines fixed the format, but it ignores `lang`. |
| gemini-2.5-flash-lite | sort=latency | 0.52 | 0.76 | 2.09 | 3/3 | 29 | Ignores `lang`. |
| claude-haiku-5.5 | sort=latency | 0.95 | 1.11 | 4.05 | 1/3 | 9 in run 1 | Ignored `lang` in run 1. Copied the `lang` key into its output in runs 2 and 3, which broke the JSONL schema. |

## Route comparison (3 runs, prompts as specified)

| Model | Route (served by) | A TTFT | A total | B TTFT | B total | $/1k A | $/1k B |
|---|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | only=google-ai-studio | 0.52 | 1.55 | 0.47 | 2.18 | 1.89 | 2.40 |
| gemini-3.5-flash-lite | sort=latency (Vertex) | 0.58 | 1.69 | 0.62 | 2.62 | 1.93 | 2.38 |
| gemini-3.5-flash-lite | default (Vertex) | 0.63 | 1.89 | 0.59 | 2.59 | 1.92 | 2.43 |
| gemini-3.5-flash-lite | `:nitro` (Vertex, AI Studio) | 0.55 | 1.77 | 0.53 | 2.35 | 3.54 | 4.23 |
| gpt-6-luna | sort=latency (OpenAI, BYOK) | 1.06 | 5.26 | 0.85 | 8.69 | 0.44 | 0.72 |
| gpt-6-luna | `:nitro` (OpenAI, billed at about 2x) | 1.44 | 3.21 | 0.58 | 3.82 | 0.88 | 1.30 |
| gpt-6-luna | OpenAI API direct | 0.89 | 5.06 | 0.88 | 7.43 | 0.41 | 0.61 |
| claude-haiku-5.5 | default (Claude Platform on AWS) | 0.90 | 4.23 | 0.72 | 5.37 | 0.65 | 0.89 |
| claude-haiku-5.5 | sort=throughput (Vertex) | 0.75 | 3.89 | 0.83 | 5.27 | 0.63 | 0.91 |
| gemma-4-31b-it | sort=latency (DeepInfra) | 0.32 | 8.69 | 0.30 | 10.26 | 0.47 | 0.56 |
| gemma-4-31b-it | sort=throughput (DeepInfra) | 0.24 | 9.15 | 0.26 | 10.32 | 0.47 | 0.56 |
| gpt-oss-120b | only=groq | 2.37 | 3.49 | 0.29 | 1.66 | 1.18 | 0.61 |

- `:nitro` nearly doubles Gemini's cost for no clear gain. It does speed up gpt-6-luna's total time, at twice the price.
- Gemma 4 31B starts fast on DeepInfra but generates at about 65 tokens per second, so it takes 9 to 10 s to finish.
- `only: ["anthropic"]` for Haiku failed with HTTP 400. The BYOK Anthropic key on this OpenRouter account has no credit. Default routing still served Haiku through AWS with no visible delay. Error record: [routes-anthropic-byok-error.jsonl](llm_bench_results/routes-anthropic-byok-error.jsonl).

## How quality was judged

- Task A checks, all automatic: every line parses as JSON with exactly `id` and `s`; all 20 ids appear once and in order; no code fences, no extra text, at most 12 words, no emojis, no ALL CAPS words, no questions; and the language matches the title. The language check is a word-list guess. I read at least one full output per model and every flagged run to confirm. Hand reading found one miss, which was then fixed in the script.
- Task A by hand: invented facts and kept hype. Haiku and gpt-6-luna were the most literal. They often said "not stated" for "SE ACABÓ", "LO ARRESTARON EN VIVO", and the Antarctica title. Gemini 3.5 Flash-Lite was literal but very short. It wrote "An iPhone trick from Apple" in 2 runs, which misreads the title. gpt-oss models and Gemini 2.5 Flash-Lite carried hype ("terrifying", "Apple does not want you to know").
- Task B, automatic: a regex checklist of 45 English and 47 Spanish facts (names, roles, numbers, dates, quotes). Also: numbers in the output that are not in the source, banned Markdown (bold, tables, links, fences), and heading count against the source.
- Task B, by hand: I read full Spanish and English outputs from Qwen, Gemini 3.5 Flash-Lite, Haiku, and Gemma. Errors found:
  - Gemini 3.5 Flash-Lite turned Ellison's "Fifteen percent is a promise, not a guarantee" into "15 percent overruns are not guaranteed".
  - Gemini 3.5 Flash-Lite and Gemma credited the government's "14 reuniones" claim to minister Basualdo.
  - Gemini 3.5 Flash-Lite and Gemma merged "before the end of the decade" with Pike's separate 2035 quote.
  - Several models turned "about $500 million … the rest" into "$180 million from developer fees". This is a derived number stated as fact.
  - Most models turned "fin de la década" into "2030". I count this as minor.
- Qwen's style is telegraphic ("Pike: …") and mostly bullets. Facts and attributions were right.

## Prompt findings

- The first prompt said "Same language as the title." In a 3-model smoke test, every model wrote English for all Spanish titles ([prompt-v1-smoke.jsonl](llm_bench_results/prompt-v1-smoke.jsonl)). The final spec prompt says "Spanish title, Spanish line; English title, English line. Never translate." Most models still slip on mixed-language lists.
- A per-item `lang` field fixed Gemini 3.5 Flash-Lite completely. It made Haiku worse.
- One example JSONL line in the prompt fixed Qwen's format (plain text lines in 2 of 3 runs before) but not its language.
- Haiku 5.5's tokenizer counts about 40% more tokens for the same input (1,846 vs about 1,300). That is part of why it finishes slowly.

## Rerun

```bash
uv run /home/nico/projects/sift/research/llm_bench.py run --runs 3 --tag main           # 10 models, tasks A, B_en, B_es
uv run /home/nico/projects/sift/research/llm_bench.py run --tasks A_lang --tag alang     # lang-field variant
uv run /home/nico/projects/sift/research/llm_bench.py run --only gemini-3.5-flash-lite@ai-studio,qwen3.8-27b@cerebras --tag check
uv run /home/nico/projects/sift/research/llm_bench.py report main        # add -v for per-run detail
uv run /home/nico/projects/sift/research/llm_bench.py show main qwen3.8-27b@cerebras B_es 1
```

Model lists change often. Check `GET https://openrouter.ai/api/v1/models` and the per-model `/endpoints` before trusting these names. A full `main` run costs about $0.08 and takes about 5 minutes.
