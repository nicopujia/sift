# Sift status

Sift is a Chrome extension that opens every page as a clean, readable, usable view. One switch (Alt+Shift+S, or the Sift button) shows the original page. Install it from https://sift.pujia.ar. The README explains how it works.

This file says how Sift was checked against its spec, what passed, and what is still open. Last updated 2026-10-27, after round 10.

## How it was checked

- Ten rounds of testing. In each round, six testers used real sites, saved pages and hand-made test pages. Three reviewers read the code. A skeptic then tried to reproduce every reported problem. Only reproduced problems counted.
- Fixers worked in parallel copies of the code. Their changes were merged, type-checked, built and smoke-tested, then published.
- Rounds 7 to 10 also ran the spec's "done" checks on each target page, with numbers:
  - **speed:** time to first content, Sift against the original page, 3 runs each, medians
  - **actions:** each needed action, and whether it had the same effect as on the original
  - **language:** the language of Sift's text against the page's
  - **keyboard:** keyboard use
  - **screen reader:** axe-core, control names and landmarks
  - **zoom:** 200% zoom and 400 px width
- Done checks that passed:

  | Round | Passed | Recorded |
  |---|---|---|
  | 7 | 307 | 339 |
  | 8 | 269 | 298 |
  | 9 | 253 | 281 |
  | 10 | 291 | 316 |

  On the target pages, 98 of 113 passed in round 9 and 113 of 123 in round 10. Every failure became a problem to fix, and the round 10 fixes are in the published build.

## Done checks on the target pages (round 9)

These ran on the build before round 9's fixes. The notes say what changed afterwards.

| Page | Speed: original vs Sift (median) | Actions | Language | Keyboard, screen reader, zoom |
|---|---|---|---|---|
| YouTube home | 5.6 s vs 5.6 s | Topics and scrolling match | English and Spanish pass | Tab did not load more (fixed) |
| YouTube search | 3.5 s vs 2.3 s | Search, suggestions, chips, filters match | Spanish lines were mixed (fixed) | Tab did not load more (fixed) |
| YouTube watch | title 7.3 s vs 2.7 s; player equal | Play, seek, captions, full screen, like, save, comments, transcript match; search typed during load was lost (fixed) | Spanish lines were mixed (fixed) | Pass, axe 0 |
| BBC home and articles | equal (0.5 to 1.5 s) | Menu, search, sign in, video, Show full text | Pass | Pass |
| Guardian home and article | equal | Headlines, menu, search | Pass | One invented headline line and a stray 'Title:' line (fixed) |
| Infobae home and article | equal | Live search, video, audio, sign in | Spanish kept | Pass |
| La Nación search and article | search 2.9 s vs 1.6 s; article equal | Lead video did not play (fixed) | Spanish kept | Seat charts lost their numbers (fixed) |
| Globo G1 (new site) | equal | Feed missing, no sign in (both fixed) | Controls mixed English and Spanish (fixed, now Portuguese) | Unnamed summary (fixed) |
| Amazon search (saved page) | equal | Sort, filters, next page match the original links | Pass | Pass. Words on screen 4852 to 940, controls 941 to 44 |
| Amazon product (test page) | equal | Color, quantity, Add to Cart, Buy Now match | Pass | Pass |
| Amazon cart (test page) | equal | Plus, minus, Delete, Save for later match | Pass | Pass |
| Gmail (test page) | equal | Open, back, archive, delete, mark, reply, compose, send, search, Undo match | Pass | Pass |

"Equal" means Sift showed its first content at the same moment as the original. In rounds 9 and 10, Sift was equal or faster on every target page. In round 10:

- YouTube search: 4.5 s against 2.6 s.
- YouTube video title: 9.6 s against 3.5 s.
- La Nación search: 7.1 s against 3.6 s.
- Every other target page: equal.

## Still open

- Amazon was tested only on saved pages and hand-made test pages. Amazon forbids automated agents. Check it by hand in your own Chrome.
- Gmail was tested only on a test page, because testers may not sign in. Check it in your own Chrome: load the extension and paste your OpenRouter key in Options.
- AI wording:
  - Checks after the model drop quotes, speakers, numbers, orders of events, swapped people and the wrong language. An invented detail of another kind can still get through.
  - The main AI models are out of OpenRouter credit, so calls fall back to a slower model. Some prompt changes were tested only on that model and on a fake model.
  - Short versions are reused across visits only when the article text is unchanged, so an article that changes costs a new call.
- YouTube: the playlist page's list is the generic view (raw titles, no one-liners). Its header and Settings work.
- Partly fixed:
  - a Google Maps popup that appeared only under heavy load (not reproduced since round 8)
  - weather.com under 4x CPU slowdown. Sift shows the forecast within about 1 s of the page, but the page's own long tasks can delay what a test measures.

Research notes, findings and test pages from every round are in `research/`.
