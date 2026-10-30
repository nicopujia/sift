# perf15 fixer report (F1315, not fixed)

Change: No change shipped. index.ts and generic.ts are byte-identical to the base. I traced the likely cause, but my two candidate fixes either made Amazon worse or would undo perf14's BBC and Infobae gains, and the machine was too loaded (load average 13 to 24) to prove a third.

Verified: Per-look marks from a temporary debug build on the Amazon search snapshot, BBC home and Infobae home, plus an A/B that switched each perf14 change per load in one tab. The A/B medians lean toward a perf14 cause but are inside the noise, and the 300 ms timing gap is not confirmed. Final bun run typecheck is clean and bun run build passes (with local-key.json restored).

I changed no files. My copy's src matches its starting state, so there is nothing to merge from perf15. Note that the main tree's generic.ts and some other files have changed since my copy was made, from other merges.

What I found on the Amazon search snapshot (http://127.0.0.1:8799/amazon-search). A probe logged each look and a temporary debug build added a performance.mark per run and per schedule (since removed):
- Sift's looks go like this: (1) one or two looks over Amazon's header, before .s-main-slot exists. These look at the header in the "amazon-generic" branch, which calls extractGeneric() with no budget (adapters/amazon.ts, the branch for a page with no results block). They find no blocks and cost 12 to 290 ms each under load. (2) A title look that shows "form+p" (the sort select and the count line). (3) The first look with results.
- Because the header looks find nothing, viewEmpty() is true. So perf14's `soon` rule spaces them by max(16, 3x the last look) instead of max(100, 3x). The header looks therefore come more often, and the title look runs as soon as .s-main-slot appears, before the results are parsed.
- The "form+p" title view is not thinView (it has a form block), so the next look is held max(100, 3x the title look's length) after it. The results look then often waits on that gap and on the parser's own task.
- Round 12, with 100 ms spacing in the header phase, more often lands its first adapter look after the results are in, and so skips the title view. This is a matter of when the looks fall, not a designed property.
- Once results are in, the lag is mostly the results look itself: extraction of 58 to 123 ms, then 30 to 100 ms of render and post-extraction work in run(). That cost is the same on both builds.
- The budget change (50 instead of 120) does not matter here. The Amazon adapter ignores the budget, and cutLast never fired (the source is "amazon" or "amazon-generic", never "generic").

What I tried:
- The A/B switched each perf14 change per load in one tab: lastRunAt placement, the 16 ms floor, and the budget.
  - First A/B, 8 rounds at load about 10 to 18. Results look minus original in the same load: current 199 ms, round-12 scheduling 90 ms.
  - Second A/B, at load about 20 to 24. Looks and Sift time before the first result: current 4 looks and 285 ms, round-12 scheduling 3 looks and 135 ms.
  - Both lean toward the 16 ms floor, but they are not clean at that load.
- Fix 1 (rejected): look sooner, after 1x instead of 3x, when the page just added more than 400 characters of text while the view is empty, with form-only views counted as empty. It made Amazon much worse. The header's hidden menus also count as added text, so the header phase got 4 to 5 full extractions, up to 286 ms each, and the first result came 2.9 to 3.1 s after navigation in 2 of 3 loads.
- Fix 2 (rejected): use the 16 ms floor only after a look that found something. It removes the extra Amazon header look, but it would undo perf14's gain. On BBC home and Infobae home, the first real look also finds nothing (empty blocks), and the second look 30 to 60 ms later finds the content. That second look is exactly what the 16 ms floor speeds up.

Leads for whoever takes this on:
(a) Use the 16 ms floor only for the first empty look after <body> appears, and 100 ms after two empty looks in a row. That keeps BBC and Infobae, which have one empty look, and slows down Amazon's repeated header looks. Not tested.
(b) Give the Amazon adapter's header-phase extractGeneric() (adapters/amazon.ts, the branch for a page with no results block) the same 50 ms budget, so a header look cannot take 100 to 290 ms.
(c) Measure on a quiet machine with Sift's looks and time before the first result, not only wall-clock medians.

YouTube (second part of the finding): not investigated within the time box. Nothing to report beyond the finding itself.

Housekeeping:
- My test Chrome on port 9474 is stopped. No server or helper of mine is running; the two firstpaint processes still up (Stack Overflow) belong to other agents.
- I used the round 12 Chrome on port 9445 read-only, from a tab named perf15. firstpaint puts back the sift:mode setting it changes.
- local-key.json was moved aside during timing runs and is back in place. The final build in dist includes it.
- Scratch tools are in /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/perf15/:
  - runs.ts: per-look log with debug marks.
  - ab2.ts: switches build flags per load in one tab and reports medians, looks and Sift time before the first result. It needs a debug build that reads localStorage sift:r12.
  - index.dbg.ts: the debug-mark variant of index.ts.
  - ab.sh: alternating firstpaint runs between two Chromes.
