# Sift status

Sift is a Chrome extension that opens every page as a clean, readable, usable view. One switch (Alt+Shift+S, or the Sift button) shows the original page. Install it from https://sift.pujia.ar. The README explains how it works.

This file says how Sift was checked against its spec, what passed, and what is still open. Last updated 2026-10-27, after round 11.

## How it was checked

- Eleven rounds of testing. In each round, six testers used real sites, saved pages and hand-made test pages. Three reviewers read the code. A skeptic then tried to reproduce every reported problem. Only reproduced problems counted.
- Fixers worked in parallel copies of the code. Their changes were merged, type-checked, built and smoke-tested, then published.
- Rounds 7 to 11 also ran the spec's "done" checks on each target page, with numbers:
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
  | 11 | 342 | 357 |

  On the target pages, these passed:
  - round 9: 98 of 113
  - round 10: 113 of 123
  - round 11: 145 of 155

  Round 11 checked only the target pages and rechecks, with no new sites. Every failure became a problem to fix, and the round 11 fixes are in the published build.

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

**Read the round 12 frame-by-frame section below first.** The older speed numbers in this section come from a script that could record "equal" when Sift was a little slower.

"Equal" means Sift showed its first content at the same moment as the original. By that older script, Sift was equal or faster on every target page in rounds 9 to 11. The frame-by-frame check below corrects this for BBC home and Infobae home. In round 11 on YouTube:

- Search: 2.2 s against 1.3 s.
- Video title: 6.8 s against 1.9 s.
- Playlist page: 2.2 s against 1.0 s.
- Shorts: 2.6 s against 2.1 s.
- Home: equal.

In round 10:

- YouTube search: 4.5 s against 2.6 s.
- YouTube video title: 9.6 s against 3.5 s.
- La Nación search: 7.1 s against 3.6 s.
- Every other target page: equal.

## Speed, checked frame by frame (round 12)

The speed numbers above came from an older `scripts/firstpaint.ts`. It started checking only after the page's HTML was read, and its checks waited while Sift's long task ran. So it often recorded the end of that task as the moment both pages showed content. The "equal" entries above are unreliable where Sift's first task is long.

The script now checks every animation frame from the page's start and reads the results after load (README, Develop). Measured on 2026-10-27 with the round 12 base build: 5 loads with Sift off and 5 with Sift on, alternating in one tab. Times are medians in ms from the start of navigation, with the range in brackets.

- Original: the first frame where the page's own content shows, with Sift off.
- Sift: the first frame where Sift's view shows the same content.
- Loading: Sift's first frame with anything in its view (its Loading line or more).
- The machine ran other tests at the same time (load average 6 to 12), so differences under about 100 ms are noise.

| Page | Content compared | Original | Sift | Loading | Sift minus original |
|---|---|---|---|---|---|
| YouTube home (live) | first video | 2593 (1864-3736) | 2725 (2170-3458) | 875 | +132 |
| YouTube search (live) | first result | 2942 (2083-3391) | 2762 (2081-3922) | 752 | -180 |
| YouTube watch (live) | video title | 6146 (5676-6934) | 865 (763-1225) | 759 | -5281 |
| Amazon search (saved page) | first result | 276 (184-518) | 343 (281-370) | 175 | +67 |
| Amazon product (test page) | product title | 72 (69-135) | 147 (106-229) | 103 | +75 |
| Amazon cart (test page) | first cart line | 67 (56-113) | 108 (72-170) | 73 | +41 |
| Gmail (test page) | first email | 85 (69-136) | 92 (79-152) | 70 | +7 |
| BBC home (live) | first headline | 195 (169-526) | 552 (488-612) | 203 | +357 |
| BBC article (live) | headline | 280 (145-377) | 342 (311-421) | 177 | +62 |
| Infobae home (live) | first headline | 176 (155-319) | 450 (354-701) | 199 | +274 |
| Daily Mail home (saved page) | first headline | 467 (349-735) | 481 (431-823) | 475 | +14 |
| core-buttons3000 (test page, 3000 buttons) | heading | 164 (89-282) | 637 (622-833) | 93 | +473 |

- YouTube watch: Sift shows the player and the title about 5 s before the original shows its title.
- YouTube home and search: Sift's list appeared in the same frame as the original's list in every load.
- BBC home, Infobae home and core-buttons3000: Sift is slower, by 0.27 to 0.47 s. On core-buttons3000 one long task of 0.4 to 0.6 s holds Sift's first view (round 12 finding F1220).
- Every other page: Sift is within 0.1 s of the original.

After round 12's progressive first view (Sift now reads the first screenful within a time budget and draws long lists in slices), the slower pages were measured again on the merged build, 5 runs each side, same method:

- BBC home: original 164 ms, Sift 322 ms (+158), Loading line at 125 ms.
- Infobae home: original 107 ms, Sift 326 ms (+219), Loading line at 112 ms.
- core-buttons3000: original 74 ms, Sift 323 ms (+249), Loading line at 82 ms.

So Sift's white page and Loading line show at about the same moment as the original's content, and its full view follows about 0.15 to 0.25 s later on these pages. Closing that gap is still open.

Commands, all with 5 runs: YouTube home `ytd-rich-item-renderer --sift li.item`, search (`gluten free bread`) `ytd-video-renderer --sift li.item`, watch (dQw4w9WgXcQ) `'ytd-watch-metadata h1'`; amazon-search `'[data-component-type=s-search-result]' --sift li.item --block amazon`; fixtures amazon-product `'#productTitle' --block amazon`, amazon-cart `.sc-list-item --sift li.item --block amazon`, gmail `tr.zA --sift li.item`; BBC home `'main h2'`, BBC article cq62yg6rggj0o `h1`; Infobae home `'main h2'`; dailymail-home `h2`; core-buttons3000 `h1`. On the Amazon pages, `--block amazon` failed every request to an Amazon host (1189 on amazon-search), and none got through.

## Still open

- Speed: on news front pages (BBC home, Infobae home) and pages with thousands of controls, Sift's first full view is 0.15 to 0.25 s later than the original's first content (see above).
- Amazon was tested only on saved pages and hand-made test pages. Amazon forbids automated agents. Check it by hand in your own Chrome.
- Gmail was tested only on a test page, because testers may not sign in. Check it in your own Chrome: load the extension and paste your OpenRouter key in Options.
- AI wording:
  - Checks after the model drop quotes, speakers, numbers, orders of events, swapped people and the wrong language. An invented detail of another kind can still get through.
  - The main AI models are out of OpenRouter credit, so calls fall back to a slower model. Some prompt changes were tested only on that model and on a fake model.
  - Short versions are reused across visits only when the article text is unchanged, so an article that changes costs a new call.
- YouTube: the playlist page's list is the generic view (raw titles, no one-liners). Its header, Settings and Menu now match the other YouTube pages.
- Partly fixed:
  - a Google Maps popup that appeared only under heavy load (not reproduced since round 8)
  - weather.com under 4x CPU slowdown. Sift shows the forecast within about 1 s of the page, but the page's own long tasks can delay what a test measures.

Research notes, findings and test pages from every round are in `research/`.
