# Round 12 findings: harness14

## F1221 (high, test tooling): scripts/firstpaint.ts can report "equal" when Sift is slower

Found by the round 12 T6 skeptic (see research/round12/perf13.md, F1220, the verdict). firstpaint.ts waits for DOMContentLoaded before it polls, and its page.evaluate polls stall while Sift's long task runs, so with Sift on it records when Sift's task ends, not when anything first painted, and the "original" column in the same Sift-on load is held back too. Rounds 7 to 11 recorded many target pages as "equal" this way; those numbers are unreliable when Sift's first task is long.

The skeptic's frame-accurate probe is /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/fp/probe.ts (checks every animation frame from the page's start via an injected script, records long tasks and first-contentful-paint).

Policy: rebuild scripts/firstpaint.ts so it measures honestly:
- It injects its probe before the page's scripts (Page.addScriptToEvaluateOnNewDocument), records the first animation frame where the selector matches (original) and the first frame where Sift's view shows content, plus long tasks and FCP, and reads the results after load, so a busy main thread cannot hide time.
- It compares Sift on against the original with Sift off, in alternating runs on the same tab (switching with a trusted Alt+Shift+S, or a per-run way that does not change the user's site setting permanently), and prints medians for both, plus Sift's 'Loading' time.
- Keep the old command line working (url, selector, runs). Document the method in the script header and in README's testing section.
- Then measure, 5 runs each side, and report: YouTube home, search and watch (live), the amazon-search snapshot and the amazon-product and amazon-cart fixtures, the Gmail fixture, BBC home and one article (live), Infobae home (live), the Daily Mail home snapshot, and core-buttons3000. These numbers go into STATUS.md, so be exact.
