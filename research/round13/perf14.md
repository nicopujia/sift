# Round 13 findings: perf14

## F1300 (medium, speed): Sift's first full view is 0.15 to 0.25 s later than the original's first content on news front pages and very long pages

Measured on the merged round 12 build with the rebuilt scripts/firstpaint.ts (frame probe, Sift off and on in turns, 5 runs each side), see STATUS.md "Speed, checked frame by frame (round 12)":
- BBC home (https://www.bbc.com/news, 'main h2'): original 164 ms, Sift 322 ms (+158). Sift's Loading line at 125 ms. DOMContentLoaded 214 ms with Sift off, 359 ms with Sift on; one long task of 136 ms before Sift's content.
- Infobae home (https://www.infobae.com/america/, 'main h2'): original 107 ms, Sift 326 ms (+219). One long task of 89 ms.
- core-buttons3000 (fx, 'h1'): original 74 ms, Sift 323 ms (+249). Two long tasks (235 ms, longest 168 ms).

Round 12's perf13 fixer added a 120 ms budget to the first look and sliced list rendering (see /home/nico/projects/.sift-tools/r12-fixes.txt, perf13 notes).

Policy: the owner's spec says Sift must feel fast and a slow Sift is worse than the original. Get Sift's first content view to within about 100 ms of the original's first content on these three pages, without losing anything once the page is complete. Profile first (where do the 150-250 ms go: content-script work during parsing that delays DOMContentLoaded, the first look's budget and what it reads, Preact's first render, styles, fonts, the shield or portal setup), then fix the biggest causes. Measure before and after with `bun scripts/firstpaint.ts <url> <selector> 5`, and also check YouTube home, search and watch, the Amazon fixtures and snapshot (--block amazon) and the Gmail fixture do not get slower.
