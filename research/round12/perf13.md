# Round 12 findings: perf13

Each was reproduced by a skeptic. F12xx are new in round 12; older ids are findings a round 12 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F1220 (high): On long-list stress fixtures, Sift shows its first content 3 to 6 times later than the original page shown with Sift switched off

Found by: T6-fixtures. Where: http://127.0.0.1:8799/fx/core-budget.html, core-buttons3000.html, core-nav3000.html, core-buttonsli3000.html, core-buttons1000.html (and, less clearly, r5ext-wall3000 and r6ext7-wallul3000)

Evidence: Measured with firstpaint.ts using selector 'h1', in runs that alternate Sift on and Sift off at the same time. Medians, Sift on vs original with Sift off: core-budget 10328 ms vs 2261 ms (on 7066-12478, off 1470-2664, 5 and 8 runs). core-buttons3000 1618 vs 373 ms. core-nav3000 3003 vs 555 ms. core-buttonsli3000 3036 vs 567 ms. core-buttons1000 599 vs 194 ms. r5ext-wall3000 is 7673/16660 vs 5056/11541 ms, and r6ext7-wallul3000 is 13660/20269 vs 12290/14509 ms; both are noisy. With Sift on, the original's h1 and Sift's view first answer in the same poll, because the main thread is busy until Sift renders. That is why earlier rounds, which measured both in the same Sift-on load, recorded these pages as equal. Not a regression: extraction-only times are the same in the round 10, round 11 and merged bundles (core-buttons3000 495/272, 439/380, 373/276 ms; core-nav3000 489/367, 289/206, 432/262 ms). core-budget is back at its round 10 time (3693/2751 vs 3960/2880 ms), and the round 10 build took 21-23 s for first content there.

Repro: SIFT_PORT=9466 ./scripts/chrome.sh start. Sift on: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/firstpaint.ts http://127.0.0.1:8799/fx/core-buttons3000.html h1 3 gives about 1.2-3.1 s, both columns equal. Next, load http://127.0.0.1:8799/fx/r5-faq.html and run bun scripts/act.ts press:Alt+Shift+S, which switches the whole 127.0.0.1:8799 site to the original. Run the same firstpaint.ts again: the original column reads 0.18-0.49 s (Sift -1). Repeat for core-budget (about 10 s vs 2.3 s) and core-nav3000. Then press Alt+Shift+S again on r5-faq to switch Sift back on.

Suspected cause: Sift's first view waits for a full extraction and render of the whole page, and that blocks the page's own first paint. In the extension, profile.ts on core-budget shows visitEl at 2.8 s self time, with the last extraction at 7.5 s. The extraction alone takes 2.9-4.0 s in a plain headless Chrome. On core-buttons3000 the gap (about 1.2 s) is larger than the extraction time (0.3-0.4 s), so rendering thousands of controls probably adds to it.

Skeptic: Partly confirmed. Sift really does show its first view several times later than the original page on pages with thousands of controls. But the claim's numbers and its 'high' severity come mostly from a flaw in the test script. Medium severity at most.

Why the script misleads: firstpaint.ts waits for DOMContentLoaded (the moment the page's HTML is fully read) before it starts polling. Its page.evaluate calls then stall while Sift's long task runs. So its 'Sift on' column marks when that task ends, not when Sift first painted.

How I measured instead: my own probe (scratchpad fp/probe.ts) checks every animation frame from the page's start, records long tasks, and records first-contentful-paint. Chrome on port 9466, tab 'skeptic', Sift switched off and on with Alt+Shift+S on r5-faq. I repeated each state twice where it mattered.

firstpaint.ts alone did match the claim's shape:
- core-buttons3000: on 771-1171 ms, off 162-231 ms
- core-budget: on 6.0-8.9 s, off 1.7-2.3 s
- core-nav3000: on 1.2-1.6 s, off 0.3-0.9 s
- core-buttonsli3000: on 1.0-2.0 s, off 0.54-0.70 s
- core-buttons1000: on 0.36-1.1 s, off 0.10-0.12 s

Frame-accurate first content, Sift on vs original with Sift off:
- core-buttons3000: 627-894 ms vs 94-186 ms (6 runs each)
- core-nav3000: 468-775 vs 134-181 ms
- core-buttonsli3000: 1002-1225 vs 100-158 ms
- core-buttons1000: 294-419 vs 110-174 ms
- So the 3-8x ratio holds, but Sift adds only about 0.2-1.1 s. Sift's 'Loading' line itself appears at 80-280 ms.

core-budget: the claimed 10 s vs 2.3 s is wrong. Sift shows the article start (a partial view taken while the page is still loading) at 626-1264 ms, against the original's h1 at 87-712 ms. Then, at DOMContentLoaded (about 2-3 s), one long task of 3.7-6.6 s freezes the page until the full view lands. That freeze is real, but it is extraction cost (about 2.9 s), not first content.

r5ext-wall3000 and r6ext7-wallul3000 are not slower: Sift 0.88-1.22 s vs the original 0.95-1.96 s.

Real pages:
- Snapshots: Sift was not slower. Daily Mail home 0.42-0.67 s vs the original 0.64-1.09 s. Infobae home 0.36-0.43 vs 0.24-0.37 s. Amazon search (0.35-0.65 s) and YouTube search (0.41-0.63 s) I timed only with Sift on, and both were in the same range.
- Live Wikipedia 'List of towns in England' (1634 links): Sift 0.46-0.65 s vs the original 0.10-0.21 s. That is about 3x, but only 0.3-0.45 s added.

Cause: on a small file the parser delivers the whole DOM before Sift's first run. That first run reads all 3000 controls (330-700 ms in the extension) and renders them in one task (530-950 ms long task). Nothing shows until both finish. A second full run follows right after (another 0.3-1.1 s freeze).

The earlier 'equal' entries in works.md, measured with Sift on, are indeed unreliable for this reason.

Skeptic's fix lead: Split Sift's first view so it never waits on the whole page. In src/content/index.ts run(), let the first extraction stop after a time or element budget. extract() in src/content/extract/generic.ts would return the blocks found so far with page.partial = true, and later runs finish the job. In src/content/ui/app.tsx, render long item and action lists in slices: the first screenful now, the rest in idle callbacks. Also, in schedule(), while loading, space the next full run by more than lastDur*3 after a run that took over 300 ms. That avoids the immediate second freeze.
