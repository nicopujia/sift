# Sift status

Sift is a Chrome extension that opens every page as a clean, readable, usable view. One switch (Alt+Shift+S, or the Sift button) shows the original page. Install it from https://sift.pujia.ar. The README explains how it works.

This file says how Sift was checked against its spec, what passed, and what is still open. Last updated 2026-10-26.

## How it was checked

- Eight rounds of testing. In each round, six testers used real sites, saved pages and hand-made test pages. Three reviewers read the code. A skeptic then tried to reproduce every reported problem. Only reproduced problems counted.
- Fixers worked in parallel copies of the code. Their changes were merged, type-checked, built and smoke-tested, then published.
- Rounds 7 and 8 also ran the spec's "done" checks on each target page, with numbers:
  - **speed:** time to first content, Sift against the original page, 3 runs each, medians
  - **actions:** each needed action, and whether it had the same effect as on the original
  - **language:** the language of Sift's text against the page's
  - **keyboard:** keyboard use
  - **screen reader:** axe-core, control names and landmarks
  - **zoom:** 200% zoom and 400 px width
- Round 7 recorded 339 done checks, and 307 passed. Round 8 recorded 298, and 269 passed. Each failure became a problem to fix.

## Done checks on the target pages (round 8)

These ran on the build before round 8's fixes. The "Fixed" notes below say what changed afterwards.

| Page | Speed: original vs Sift (median) | Actions | Language | Keyboard, screen reader, zoom |
|---|---|---|---|---|
| YouTube home | 3.9 s vs 3.9 s | Topics and infinite scroll match | English and Spanish pass | Pass |
| YouTube search | 3.6 s vs 1.8 s | Search, suggestions, chips, filters match | Spanish lines were mixed (fixed) | Pass |
| YouTube watch | title 6.1 s vs 3.1 s | Play, seek, captions, full screen, like, save, comments, transcript match | Spanish lines were mixed (fixed) | Tab loaded Up next without end (fixed) |
| BBC home and articles | equal (0.5 to 1.2 s) | Menu, search, sign in, video, Show full text | Pass | Pass; Search dialog name was wrong |
| Guardian home and article | equal | Headlines, menu, search; video waited behind a hidden cookie wall (partly fixed) | Pass | Pass |
| Infobae home and article | equal | Live search, video, audio, sign in | Spanish kept | Pass; one invented quote in a Short version (fixed) |
| La Nación | equal; one Short version came late (partly fixed) | Search, filters, video | Spanish kept | Clutter before the text (fixed) |
| Times of India (new) | equal | No search or sign in (fixed) | Pass | Clutter (fixed) |
| Amazon search (saved page) | equal | Sort, filters, next page match the original links | Pass | Pass. Words on screen 4852 to 940, controls 941 to 44 |
| Amazon product (test page) | equal | Color, quantity, Add to Cart, Buy Now match | Pass | Pass |
| Amazon cart (test page) | equal | Plus, minus, Delete, Save for later match | Pass | Pass |
| Gmail (test page) | equal | Open, back, archive, delete, mark, reply, compose, send, search match | Pass | Compose at 200% zoom could be hidden only in Sift (fixed) |

"Equal" means Sift showed its first content at the same moment as the original. On the target pages Sift was equal or faster, except La Nación search, where Sift's first result came a median 0.2 s later. Off the target list, a GitHub code page and weather.com were slower. Both were fixed in round 8.

## Still open

- Amazon was tested only on saved pages and hand-made test pages. Amazon forbids automated agents. Check it by hand in your own Chrome.
- Gmail was tested only on a test page, because testers may not sign in. Check it in your own Chrome: load the extension and paste your OpenRouter key in Options.
- AI wording: a check now drops quotes, speakers and numbers that are not in the source. An invented detail with no quote or number can still get through. The main AI models are out of OpenRouter credit, so calls fall back to a slower model, and some prompt changes were tested only on that model.
- Partly fixed in round 8:
  - the Guardian video consent flow (not confirmed to play after a choice)
  - a Google Maps popup that appeared only under heavy load (could not be reproduced)
  - the OpenStreetMap layers panel (works, but is still long)
  - Short versions on pages that are still loading (they get a fresh AI call)
- Round 9 will rerun the done checks on the build with round 8's fixes.

Research notes, findings and test pages from every round are in `research/`.
