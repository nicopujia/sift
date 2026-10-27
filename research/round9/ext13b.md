# Round 9 findings: ext13b

Each was reproduced by a skeptic. F9xx are new in round 9; older ids are findings a round 9 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F938 (high, regression): A <details> with a date summary and a body that is only a time range still loses its body (F834 leftover)

Found by: R1-extractor. Where: src/content/extract/generic.ts:5635 (details(), dl(rest))

Evidence: In fx my/event-details-es.html, three <details> have summaries like 'Sábado, 7 de noviembre de 2026' over '<p>10:00 – 13:00 hs</p>'. cur.js and the real extension show only three small date lines, and the class hours are gone. fx my/event-details-lc.html (English, '10:00 am – 1:00 pm') loses them too. r6.js (before round 7) showed each date as a section with its hours. With 'AM'/'PM' in capitals the times survive, only because dateLine's time pattern is lowercase-only. When the page has a byline date (ctx.hasDate), the whole details block vanishes.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,r6.js $PWD/my/event-details-es.html 1 --as http://cocina.fixture.test/taller ; bun run.ts cur.js,r6.js $PWD/my/event-details-lc.html 1 --as http://kitchen.fixture.test/class

Suspected cause: The body passes when dl(rest) holds. dateLine accepts a bare time range, so any time-only body counts as a dateline. The Guardian case it was made for has a 'Last modified/updated' body. Requiring that prefix (or a full date) in rest would keep schedules.

Skeptic: Reproduced in the harness and the real extension. event-details-es and event-details-lc show only the three dates as small lines, and the time ranges are gone. r6.js shows each date as a section with its hours. pre8 already had the bug, so it is a round-7 leftover, not a round-8 regression. In details() (generic.ts:5635), dl(rest) accepts a bare time range as a dateline. Real content loss, but the pattern (a details element with a date summary over a body that is only a time) is uncommon, so medium rather than high.

Skeptic's fix lead: generic.ts:5635 details(). Accept rest only when it is a real dateline: a 'last modified/updated/actualizado' prefix, or a full date with a year or month name. A bare time range must not count, so time-only bodies stay as sections.

## F834 (still open, partly; original repro in /home/nico/projects/sift/research/round8/*.md)

Recheck by R1-extractor: Both repros are fixed. In the harness (cur.js, built from the current src), versiondetails.html gives 'section: Release 2.10' with its 3 changes and 'section: Python 3.12' with its paragraph. datedetails.html gives the three dated sections, and the open one keeps its 2 decisions and the 'Full minutes (PDF)' link. The real extension (port 9468) shows the same H2s and items. The Guardian's live dateline still folds into the byline (no stray section). What is left: a date summary over a body that is only a time range still loses the body. dl(rest) treats '10:00 – 13:00 hs' or '10:00 am – 1:00 pm' as a date line. fx my/event-details-es.html and my/event-details-lc.html now show only 'p(small): Sábado, 7 de noviembre de 2026' and the other dates, with no times, in both the harness and the real extension. r6.js shows each date as a section with its hours. Uppercase 'AM/PM' survives only because dateLine's time regex is lowercase-only. Filed as a finding below.

Skeptic: Agree with 'partly'. r8ext11-versiondetails gives 'section: Release 2.10' with its 3 changes and 'section: Python 3.12' with its paragraph. r8ext11-datedetails gives three dated sections, and the open one keeps its 2 decisions and the 'Full minutes (PDF)' link. A live Guardian article folds its dateline into the byline ('Novak Simin · Oct 26, 2026, 7:04 PM') with no stray section. What is left is a date summary over a time-only body losing that body (N4), which I reproduced in the harness and the real extension.

Skeptic's fix lead: See N4: in details() (generic.ts:5635), require rest to carry an update prefix or a full date before treating it as a dateline.

## F939 (high): A closed Slickstream search panel opens as a modal 'Search' sheet on load and makes the page inert (pinchofyum.com and other Slickstream sites)

Found by: R1-extractor. Where: src/content/extract/generic.ts:6342 (dialogIn: cands keep a [role=dialog][aria-modal=true] that is inert and aria-hidden=true)

Evidence: Real extension on https://pinchofyum.com/: Sift's shadow root holds div.sheet role=dialog aria-modal=true aria-label='Search' ('Close Search', 'Powered by Slickstream', a search field). button.skip, header.bar and main are inert until it is closed. In the page, slick-search-panel's shadow root has div#shell role=dialog aria-modal=true with inert and aria-hidden=true. It is pointer-events:none and transparent, and its contents are translated below the viewport (input at y=1205 in a 900 px window), so the panel is closed on the original. The harness shows 'DIALOG: Search' with both pre8.js and cur.js after a 6 s wait, so it is not a round 8 regression.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js https://pinchofyum.com/ 1 --wait 6000 | grep -n '===\|DIALOG'

Suspected cause: dialogIn collects shadow-root dialogs of custom elements whose names contain 'search', and filters only by visible(). A full-viewport fixed shell passes visible() even when it is inert, aria-hidden, transparent and pointer-events:none. An inert dialog (d.closest('[inert]')) can never be what the user opened.

Skeptic: Reproduced on live pinchofyum.com. The harness shows 'DIALOG: Search'. In the real extension, Sift's shadow root holds div.sheet role=dialog aria-modal=true aria-label='Search' (Close, Close Search, Powered by Slickstream, a search field), and button.skip, header.bar and main are inert. The screenshot shows a modal Search sheet over the page on load. In the original (Sift off), slick-search-panel's #shell has inert, aria-hidden=true and pointer-events:none, all its children have opacity 0, the input sits at y=1205, and the screenshot shows no panel. Not a regression, but the page is blocked by a modal on load.

Skeptic's fix lead: generic.ts dialogIn cands filter (~6342). Drop any candidate that is inert or aria-hidden=true, on itself or an ancestor (walk across shadow hosts with getRootNode().host). Also drop one with computed pointer-events:none whose visible children all have opacity 0 or sit outside the viewport.

## F941 (medium, regression): Story cards are now named after their section label ('Trending Right Now', 'Shop With Us'), and the real headline drops to plain meta text

Found by: R1-extractor. Where: src/content/extract/generic.ts:2608-2613 (kickerHeading own() filter, ext11's F836 fix)

Evidence: Live https://www.foodnetwork.com/: pre8.js gives '* Gatorade Was Recalled in 37 States Due to Undeclared Food Dyes ->/fn-dish/news/… | Trending Now'. cur.js gives '* Trending Right Now ->/fn-dish/news/gatorade… | … Gatorade Was Recalled…', and likewise 'More Cooking Inspiration', 'Shop With Us', "What We're Cooking", 'Fun Pumpkin-Shaped Foods' (which opens the Mac-O-Lantern recipe). The real extension shows the label as the link and the headline as a plain line. Deterministic fixture my/promo-sections.html (section[role=list] > header h2 label + div[role=listitem] > h3 > a headline) gives the same flip. With own() removed from hs and the link counts, the old names return.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js $PWD/my/promo-sections.html 1 --as http://food.fixture.test/

Suspected cause: own() excludes every heading inside an li/article/[role=listitem] that does not contain the first heading. That is exactly where a card's headline sits under a section kicker. The filter should apply only to entries of the same kind as el (a nested reply), not to a lone listitem wrapper under a section heading.

Skeptic: Reproduced. promo-sections.html: the current bundle names each card after its section label ('Trending Right Now', 'More Cooking Inspiration', 'What We're Cooking', 'Shop With Us') and moves the headline to meta. pre8 names it after the headline. Live foodnetwork.com in the harness: same flip, including 'Fun Pumpkin-Shaped Foods' linking to the Mac-O-Lantern recipe. The real extension shows 'Trending Right Now' as the link and 'Trending Now · Gatorade Was Recalled…' as a plain line. The cause is the own() filter in kickerHeading (generic.ts:2608-2613). It treats the card's single [role=listitem] wrapper as a nested entry, so the real headline and its link counts are excluded. Medium: links get wrong names, which screen reader users hear.

Skeptic's fix lead: generic.ts:2608-2613 kickerHeading own(). Exclude a heading only when its li/article/listitem ancestor is one of several same-shaped entries inside el (a reply list), not when it is the only listitem in el or wraps the card's main link.

## F942 (medium, regression): Wikipedia articles get a byline with the page's creation date, and often a fake author taken from the Authority control box

Found by: R1-extractor. Where: src/content/extract/generic.ts:6645 (byline: ldDate fallback, newsC10) and 6547 (bylineName: [class*=author i] matches div.authority-control)

Evidence: Real extension: 'Coeliac disease' shows 'United States · Jul 22, 2002' under its title, 'Buenos Aires' shows 'United States · Nov 4, 2001', 'Sourdough' shows 'Feb 28, 2003', and es.wikipedia 'Celiaquía' shows 'Proyectos Wikimedia · 14 abr 2004'. These dates are Wikipedia's JSON-LD datePublished, the day the article was first created. pre8.js shows no date. 'United States' comes from the navbox's 'National: United States' entry, because '[class*=author i]' matches 'authority-control'. Since the byline now has a date, ctx.hasByline/hasDate turn on, and on 'United States' the anthem audio's '1:19' line is dropped as a date line.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js https://en.wikipedia.org/wiki/Celiac_disease 1 --wait 2500 | grep -n '===\|small' | head

Suspected cause: ldDate accepts any Article's datePublished, including a wiki page's creation date. Wikipedia's JSON-LD also carries dateModified and a publisher of Wikimedia, which shows it is not a dated story. bylineName's class match has no word boundary.

Skeptic: Date part reproduced. The harness and the real extension show 'Jul 22, 2002' under 'Coeliac disease', 'Nov 4, 2001' under Buenos Aires, and 'Feb 28, 2003' under Sourdough. pre8 shows no date. On 'United States' the current bundle shows 'Sep 6, 2001' and drops the '1:19' anthem-audio line, which pre8 keeps. The fake author reproduced on es.wikipedia: 'Proyectos Wikimedia · 14 abr 2004', from div.mw-authority-control matching [class*=author i]. On en.wikipedia I did not see 'United States' as an author: in my runs the authority-control navbox was collapsed. The cause is the same class match, so it likely appears whenever that box is expanded. Medium: a misleading creation date on every Wikipedia article.

Skeptic's fix lead: generic.ts:6575 ldDate. Ignore JSON-LD whose publisher is Wikimedia or whose page has no visible date/time element, or use it only as a fallback when a byline name was found. generic.ts:6547 bylineName: match 'author' as a class word ((^|[\s_-])author([\s_-]|$)), not a substring, so 'authority-control' no longer matches.

## F943 (medium, regression): Hacker News item pages with few comments show the footer link row twice

Found by: R1-extractor. Where: src/content/extract/generic.ts:6959 (lookupLeftovers) and 7344 (late pushed to beside.after), gen11/F636

Evidence: Real extension on https://news.ycombinator.com/item?id=1 ends with 'Guidelines | FAQ | Lists | API | Security | Legal | Apply to YC | Contact' twice. pre8.js has it once. With lookupLeftovers disabled, it appears once. HN's search form sits in the footer row (tr top=285, under the 400 px limit on a short page). The rule climbs to that table row and marks it used, but the table still outputs the row, and walkPage then walks it again as 'after'.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js 'https://news.ycombinator.com/item?id=1' 1 --wait 1500 | grep -c Guidelines

Suspected cause: ctx.used does not stop table/text-run paths from emitting the element. lookupLeftovers also accepts a search form in a footer, because it only excludes header/nav/banner/search ancestors and not footer-like rows.

Skeptic: Reproduced in the harness (current: 2 'Guidelines' rows, pre8: 1) and in the real extension on two loads: 'Guidelines | FAQ | Lists | API | Security | Legal | Apply to YC | Contact' appears twice at the end of item?id=1. Code: lookupLeftovers (generic.ts:6959) climbs from HN's footer search form to its row, marks it used and pushes it to beside.after (7344). The table path still emits the row, so it is output twice. Low-to-medium impact (duplicated footer noise on short item pages), but a real regression, not polish.

Skeptic's fix lead: generic.ts:6959 lookupLeftovers. Return [] when the climbed box is a tr/td or inside a table (or a footer-like row), or make the table and text-run paths skip elements in ctx.used, so the row is emitted once.
