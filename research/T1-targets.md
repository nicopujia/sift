# T1 targets: YouTube, Gmail stand-in, Amazon (2026-10-24)

Screenshots and outlines: `research/shots/T1-*.png|.txt`. Stand-ins under `/fx/` are synthetic; findings that rest on them say so.

Harness note: `SIFT_TAB=n` picks `browser.pages()[n]`, and that order changes when any tester opens or closes a tab (a new tab was inserted at index 2 mid-run; my first tab moved from index 2 to 1). I ran pinned-by-target-id copies of the scripts from my scratchpad. I created and closed one extra tab once at the start, which may have shifted other testers' indices for a few seconds.

## Blocking for every tester

- OpenRouter account is nearly out of credit. Every `condense` call (main qwen/qwen3.8-27b, fallback google/gemini-3.5-flash-lite) returns HTTP 402 "can only afford 239/142 tokens". `lines` calls fail on the main model (402) and only work through the fallback openai/gpt-6-luna. No "Short version" can appear anywhere right now.
- Then `onError` sets `store.aiOff = true` on any 402, and SPA navigation (`resetAi`) never clears it. So after a YouTube watch page (its description is condensed and gets 402), all later pages in the tab get no one-liners. Repro: open the watch page, type "gluten free tortillas" in Sift's search, Enter, wait 33 s: raw titles. A full load of the same results URL gets one-liners in under 20 s. Nothing in the UI says AI stopped.

## YouTube

- One-liners in the wrong language: 8 of 38 English results on `results?search_query=gluten+free+bread` are German, West Frisian, Italian, Spanish, or Portuguese. Example: "Make the softest GLUTEN FREE sandwich bread in under 4 hours!" -> "Rezept für weiches glutenfreies Sandwichbrot in unter vier Stunden". Cause (checked): `detectLang()` trusts `chrome.i18n.detectLanguage`, which returns isReliable=true de/fy/it/es for these English titles (ALL CAPS, `|`, emoji), and that per-entry lang overrides the page's `en`.
- Shorts chip: results are hidden in a collapsed "Shorts" section (the page looks empty), and every Short is listed twice (480 rows, 240 unique hrefs). Cause: `qa("ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model")` matches the nested pair. Same doubling on the home Shorts section. No one-liners on Shorts (raw caps, emoji, hashtags).
- Filters dialog: options (Under 3 minutes, This week, 4K…) are plain text, not controls. Group names are links to one arbitrary option: clicking "Duration" applied "Under 3 minutes" (`sp=EgIYBA`). 360°, 3D, HDR, Location, Purchased are missing. Dialog name is the page title, h2 empty.
- Watch page: description URLs (linktr.ee, Spotify, Apple Music… 11 links in the original) are plain text. "……more", "...more", "Show less" leak as text.
- Captions button disappears at 400 px width (YouTube hides `.ytp-subtitles-button`); Sift's Captions has no pressed state.
- Tab after the Sift switch goes into the portaled player's own controls (Close, unnamed button, Seek slider, Settings, Theater mode…) at y=-1745: invisible focus.
- Sign-in popups (Like, Subscribe, Save): shown as dialog, Escape closes both (works). But the dialog's accessible name is the video title, h2 is empty, and focus is not returned to the button.
- After Full screen and exit, Sift showed for ~5 s a header without Sign in and only "Save to playlist" instead of Subscribe/Like/Dislike/Save.
- Bot check after Up next click: shown as a notice (good) plus a modal sheet with the same text; the 8,243 comments the original still shows are dropped.
- Loading: for ~2 s Sift shows "Nothing to show yet." on the results page; results appear ~900 ms after the original's (2.9 s vs 2.0 s).
- Home snapshot: topic chips collapsed in "Topics" (intended); 10 Shorts dropped into a collapsed section, doubled.

Worked: chips All/Videos, scroll-to-load (38 -> 49 -> 54 rows), Pause/Play, Back/Ahead 10 s, Mute/Unmute, Full screen, Captions toggle, Up next click (SPA updates, Back restores), search box from watch and results pages. axe: 0 violations on the watch page.

## Gmail stand-in (synthetic)

- Focus is lost to `body` after Archive or Delete by keyboard (same on the cart stand-in).
- "Message sent" confirmation from the original is not shown after reply.
- Unread vs read differs only by font-weight 800 vs 600; no text or screen-reader cue.
- Compose "Discard draft ‪(Ctrl-Shift-D)‬" label keeps the shortcut and U+202A/U+202C marks.

Worked: inbox list with gists, Archive, open message, Reply + Send (`__sent` has the body), Compose + Send (to, subject, body). axe: 0 violations.

## Amazon

- Search snapshot filters: the Price group is titled "$1" (slider min label) and merges Deals & Discounts; the min/max price fields are gone. Customer Review option reads "& Up" (the "4 Stars" icon text is dropped).
- Pagination only "Next" + "Page 1" (original: Previous 1 2 3 … 20 Next).
- Cart stand-in: quantity buttons are labeled "Decrease quantity by one"/"Increase quantity by one" (long), Decrease stays active at Qty 1.

Worked: sort select, sponsored results removed, product stand-in color (unavailable White disabled), quantity, Add to Cart and Buy Now (`__added` qty 2), cart increase/delete/checkout (`__checkout` true).

## Earlier site-sweep items now fixed (rechecked)

- HN: "Hacker Newsnew" glue, stray rank paragraphs, YC promo.
- Stack Overflow: question title and body shown, H1 correct. Still not fixed: "Copyfunction" in all 40 code blocks.
