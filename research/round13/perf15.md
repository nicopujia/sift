# Round 13 findings: perf15

## F1315 (medium, speed, regression): Amazon search shows its first result about 0.1 to 0.3 s later than the round 12 build

Measured on 2026-10-30 with scripts/firstpaint.ts, 5 runs each side, alternating between two test Chromes: port 9444 runs the current main build (4c81c6a, round 12 plus the perf14 and ai19 fixes) and port 9445 runs the round 12 build (ae0fe8f, built in /home/nico/projects/sift-ab12). Data: /home/nico/projects/sift/research/round13/ab-r12-r13.txt. Script: /home/nico/projects/.sift-tools/ab13.sh.

Amazon search snapshot (`http://127.0.0.1:8799/amazon-search '[data-component-type=s-search-result]' 5 --sift li.item --block amazon`), Sift minus original:
- current: +161, +189, +302 ms (Sift 423, 424, 673 ms)
- round 12: +96, +152, +116 ms (Sift 324, 402, 389 ms)
Sift's Loading line shows at the same time on both builds, so the delay is between the Loading line and the first result.

The only changes since round 12 are perf14 (research/round13/perf14.md; its report is in /home/nico/projects/.sift-tools/r13-fixes.txt) and ai19. See `git -C /home/nico/projects/sift diff ae0fe8f 4c81c6a -- src/content`. perf14 removed the early run's lastRunAt, set a 50 ms first-look budget, a 16 ms gap while the page parses, and early exits in detectItems and readingStrip. One of these likely makes the first look on Amazon search end before the first result and wait for a later slice.

perf14 gains to keep (quiet machine, 2026-10-30): BBC home +50 ms (round 12 +357), Infobae home +75 ms (+274), core-buttons3000 +125 ms (+473), BBC article +53 ms. Full numbers: research/round13/speed-r13.txt.

Also look at YouTube home and search: with Sift on, YouTube's own first video renders about 0.2 to 0.3 s later than with Sift off ("original under Sift" in firstpaint's per-run lines equals Sift's time), so Sift's list is late because the page under it is late. YouTube search is the same on both builds (current +269, +917, +359; round 12 +586, +1060, +404), so this is not a perf14 regression. If there is a cheap fix (Sift's content-script work during YouTube's parsing that delays YouTube's own scripts), make it; otherwise report what you found.

Policy: find the cause with a profile (scripts/profile.ts) or by toggling each perf14 change, not only by timing, because the machine is busy (other agents run tests; timing differences under about 100 ms are noise unless repeated). Fix the Amazon search regression without losing the perf14 gains above. Measure with A/B runs that alternate builds or alternate your change on and off, at least 3 times. The round 12 Chrome on port 9445 is running for your A/B use; do not stop it, and do not edit /home/nico/projects/sift-ab12.
