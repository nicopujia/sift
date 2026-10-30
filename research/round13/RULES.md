# Rules for round 13 fixers

Sift is a Chrome MV3 extension: "reader mode on steroids". README.md explains the architecture.

## What Sift must do (the owner's spec)

- Every page opens already sifted, with one clear switch to the original.
- Works on any site, including dynamic apps (YouTube, stores, dashboards, feeds, signed-in pages), and stays in sync as the page changes.
- Everything that matters stays usable (search, buttons, links, forms, video, add to cart, paying), with the same effect as on the original.
- Removes all noise.
- Summarizes and rewrites text into the shortest form that keeps the meaning.
- Images and video stay only when they are content.
- Presents information in the form fastest to absorb (YouTube home as a plain list of videos, each with a one-line summary).
- White, readable, minimal, fully accessible (screen readers, zoom, keyboard).
- Keeps the page's language. Must feel fast.
- Tool pages (maps, editors, players) are sifted too: noise goes, their working part stays usable.

## Your copy

- Edit only your own copy, /home/nico/projects/sift-r13-<group>. Never edit /home/nico/projects/sift or another copy.
- Other fixers work at the same time in other copies. I merge every copy into the main tree with a 3-way merge. So keep edits focused, do not reformat or move code you do not need to change, and do not rename shared helpers.
- Small additive edits outside your files (a new optional field in model.ts, a CSS rule) are fine. Say so in your report.
- Several groups work at once on the same base, in waves as round 11's testers finish. Several of them edit extract/generic.ts, index.ts and app.tsx. Prefer a small change inside the function that causes the problem over a new shared mechanism. If a finding needs a change that clearly belongs to another group's file and is large, do the smallest safe part and say what is left.
- research/round13/works.md lists what rounds 4 to 12 confirmed working. Check the lines for your area after your changes. research/round13/rejected.md (and the rejected.md files of rounds 4 to 11) lists reports the skeptics rejected: do not act on them.

## Testing

- Build: `bun run build`. Types: `bun run typecheck` (must be clean at the end).
- Your own test Chrome: `SIFT_PORT=<port> ./scripts/chrome.sh start`. After each build: `SIFT_PORT=<port> ./scripts/chrome.sh reload`. Stop it when you finish: `SIFT_PORT=<port> ./scripts/chrome.sh stop`.
- Drive it with `SIFT_PORT=<port> SIFT_TAB=<group> bun scripts/visit.ts <url> <name>`, and the same env for act.ts, a11y.ts, tabwalk.ts, profile.ts. Read the top of each script for its arguments.
- Saved snapshots (scripts stripped): http://127.0.0.1:8799/<name> (list: /home/nico/projects/sift/research/snapshots). Hand-made fixtures run with scripts: http://127.0.0.1:8799/fx/<name>.html. To add a fixture, write it to /home/nico/projects/sift/research/fixtures/r13<group>-<name>.html (that server is already running; do not restart it).
- Verify each fix on the real site when you can, else on a snapshot or a fixture. Check that the fix does not break the target sites: YouTube (home, search, watch), a news article (BBC), Amazon snapshots and fixtures, the Gmail fixture.
- The AI calls cost the owner money and are slow right now (the fast models are out of credit, so it falls back to a slow model). Keep AI-dependent checks few. Results are cached per site.

## Hard rules

- Never open amazon.* live. Amazon forbids automated agents. Use the snapshots and fixtures.
- No sign-ins, no purchases, no sending messages, no forms that post data. Searches and route queries are fine.
- Never get around a bot check, a captcha, or an "Access Denied" page. Fix only Sift's part of such a finding.
- Do not touch the OpenRouter account or settings. Do not commit to git.
- Never fabricate results. If you could not verify something, say so.

## Report

Return, per finding id (F<n>): fixed, partly fixed, or not fixed; one line on the change; one line on how you verified it. Then the list of files you changed, and anything another group must know.
