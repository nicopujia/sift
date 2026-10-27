# Round 11 findings: ext17

Each was reproduced by a skeptic. F11xx are new in round 11; older ids are findings a round 11 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F1131 (high, regression): marqueeCopies drops real content: a visible block whose text and links equal an earlier sibling's, including a hidden responsive twin, so the content vanishes; pricing cells and repeated stanzas also go

Found by: R1-extractor. Where: src/content/extract/generic.ts:3885-3903 (marqueeCopies; kids() and tlen() include hidden children)

Evidence: (1) Responsive twin: a 'mobile-only' div (display:none at desktop width) followed by an identical 'desktop-only' div. Round 11 shows neither, so the sale paragraph and its 'Shop city bikes' link are gone. r10m shows it. The real extension's main text is only 'Spring sale / Opening hours / Monday to Saturday…'. (2) Live pricing comparisons, compared on separate page loads with marqueeCopies stubbed out. notion.com/pricing: the Offline row's 'Recents and Favorites auto-download for offline use.' shows 2 times instead of 3 (once per paid plan), so one plan looks as if it lacks it. vercel.com/pricing: the Enterprise cell '150 overrides / month included · then $250 for unlimited overrides' is dropped because it equals Pro's. (3) A poem whose refrain is its own <p> three times shows the refrain once. (4) Project fixture fx/r9int-nextart.html: the article falls from 1593 to 137 words, 15 of 16 paragraphs dropped (r9int13-nextart-wide: 4751 words to a stub). The snapshots (YouTube, Daily Mail, Infobae, Amazon) and the Amazon fixtures are unchanged by it.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11 && bun run.ts r11.js,r10m.js $PWD/fx/twins.html 1 --as http://127.0.0.1:8799/fx/zz-twins.html ; bun run.ts r11.js,r11nomq.js https://www.notion.com/pricing 1 --wait 4000 | grep -c 'Recents and Favorites' ; bun run.ts r11.js,r10m.js $PWD/fx/poem.html 1 --as http://127.0.0.1:8799/fx/zz-poem.html

Suspected cause: It treats any later sibling with the same tag, text (40 characters or more) and link hrefs as a marquee copy, whether the earlier one is hidden or not and whether or not they sit next to each other. A marquee copy should at least need a visible earlier twin, and probably a run of copies of the whole strip (several siblings repeating in order) or a scrolling or animated container.

Skeptic: Confirmed, high. On the twins fixture (a display:none mobile div, then the same desktop div), the current bundle drops the sale paragraph and its 'Shop city bikes' link. Main is only 'Spring sale / Opening hours / Monday to Saturday'. The baseline and the stubbed bundle keep it. The real extension (fixture served locally) shows the same loss: 'Spring sale\nOpening hours\n\nMonday to Saturday, 9:00 to 18:00.' Poem fixture: the refrain shows once instead of three times (214 words to 158). Live notion.com/pricing: the original's Offline row has three visible cells 'Recents and Favorites auto-download for offline use.' (checked in the DOM). The current bundle shows it 1 time in my run (the claim said 2). The stub shows 3, so paid plans look as if they lack it. Project fixtures r9int-nextart and r9int13-nextart-wide drop to 137 and 159 words (stub: 1593 and 4751). Those use synthetic repeated filler, so I give them little weight. The cause is as stated: kids() includes hidden children, and any later same-tag sibling with the same text (40+ characters) and hrefs counts as a copy.

Skeptic's fix lead: src/content/extract/generic.ts marqueeCopies: count a sibling as a copy only if its earlier twin is visible. Require a repeated run (the whole strip repeating in order, at least 2 siblings per copy) inside a ticker-like container (overflow hidden with a CSS animation or transform, or a marquee/ticker class), never single cells or paragraphs.

## F1132 (medium, regression): Field labels now include every picture's alt, doubling names: color swatches read 'Red Red', extras read 'Photo of a gift box Gift wrap ($3)'

Found by: R1-extractor. Where: src/content/dom.ts:680-684 (labelWords, used by accName at 641, 647, 651)

Evidence: A form with radios <label><input type=radio><img width=24 alt="Red"> Red</label> and checkboxes <label><input type=checkbox><img width=80 alt="Photo of a gift box"> Gift wrap ($3)</label>. Round 11 field labels: 'Red Red', 'Blue Blue', 'Photo of a gift box Gift wrap ($3)', 'Photo of a greeting card Greeting card ($2)'. r10m: 'Red', 'Blue', 'Gift wrap ($3)', 'Greeting card ($2)'. The real extension shows the same doubled label text.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11 && bun run.ts r11.js,r10m.js $PWD/fx/labels.html 1 --as http://127.0.0.1:8799/fx/zz-labels.html

Suspected cause: labelWords switches to contentName(l, true) whenever the label holds any img[alt] or [role=img][aria-label], so every alt is added. F1010 needs only icon-sized pictures whose alt the visible words do not already say. generic.ts iconWord has that size and 'already said' test, but labelWords does not.

Skeptic: Confirmed, medium (low end). On the labels fixture, the current bundle's field labels are 'Red Red', 'Blue Blue', 'Photo of a gift box Gift wrap ($3)' and 'Photo of a greeting card Greeting card ($2)'. The baseline gives 'Red', 'Blue', 'Gift wrap ($3)' and 'Greeting card ($2)'. The real extension's labels read the same doubled text. Cause: dom.ts labelWords() switches to contentName(l, true) whenever the label holds any img[alt], so every alt is added, including big photos and alts the visible words already say. Product option swatches with an image plus text are common in stores, so every option is read twice.

Skeptic's fix lead: src/content/dom.ts labelWords: add a picture's name only when the picture is icon-sized (32 px or less) and the label's visible text does not already include its alt. That is the same test as generic.ts iconWord, so share one helper.

## F1133 (medium, regression): Decorative icon alts now show in text: star ratings read 'starstarstarstar', and 'Read the full review arrow'

Found by: R1-extractor. Where: src/content/extract/generic.ts:1152-1159 (iconWord) used at 1308; the svg role=img path at 1252 has the same gap

Evidence: Article paragraphs 'Our rating: <img alt=star 16x16>×4 (4 out of 5)' and '<a>Read the full review</a> <img alt=arrow 12x12>'. Round 11 gives 'Our rating: starstarstarstar (4 out of 5)' (glued, no spaces) and '... Read the full review arrow'. r10m gives 'Our rating: (4 out of 5)' and no 'arrow'. The real extension shows the same words. The text also goes to the Short version input.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11 && bun run.ts r11.js,r10m.js $PWD/fx/icons.html 1 --as http://127.0.0.1:8799/fx/zz-icons.html

Suspected cause: iconWord accepts any alt of 40 characters or less on an image 32 px or smaller unless it is a logo word. dom.ts already has ICON_WORD (dom.ts:521: arrow, chevron, star, check, external, …) for this purpose, but the new rule does not use it, and repeated icons get no separator.

Skeptic: Confirmed, medium. On the icons fixture, the current bundle gives 'Our rating: starstarstarstar (4 out of 5)' and '... Read the full review arrow'. The baseline gives 'Our rating: (4 out of 5)' and no 'arrow'. The real extension's main text shows the same words. iconWord() (generic.ts:1152) accepts any alt of 40 characters or less on an image of 32 px or less unless LOGO_NAME matches. It does not use dom.ts ICON_WORD (which lists star and arrow). Repeated icons are glued with no space. This garbage is visible in article text and is also sent to the Short version.

Skeptic's fix lead: src/content/extract/generic.ts iconWord (and the svg role=img branch near line 1252): reject alts that match dom.ts ICON_WORD (export it). Collapse a run of the same icon alt into one count ('4 stars') or drop it, and make sure sep() puts a space between adjacent icon words.

## F1135 (medium): Page title h1 that links to the page itself is skipped when the URL has a query string, and a later section h1 sharing one word becomes the H1

Found by: R1-extractor. Where: src/content/extract/generic.ts:7693 (story-card skip compares full hrefs including ?query) and 7704 (score loop returns before the bySeg rule at 7716)

Evidence: Real extension on https://wiki.debian.org/Backports?utm_source=mastodon: main H1 'Using backports', a section h1 half way down. The page's title 'Backports' (h1#locationline > a[href=/Backports]) is an H2. The first visit to any Debian wiki page lands on ?pow_referer= (proof-of-work redirect), with the same result. Without a query, the H1 is right. The harness agrees; r10m gave 'External links'.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11 && bun run.ts r11.js 'https://wiki.debian.org/Backports?utm_source=x' 1 --wait 3000 | grep 'h1:'

Suspected cause: `a.href.split('#')[0] !== location.href.split('#')[0]` treats /Backports and /Backports?utm_source=x as different pages, so the real title h1 counts as a story card. With a one-word <title> part, any h1 containing that word scores 1.0 and wins before bySeg is tried. Compare origin and pathname only, or try bySeg before accepting a one-word match.

Skeptic: Confirmed, medium, not a regression. Real extension on https://wiki.debian.org/Backports?utm_source=mastodon: main starts with H1 'Using backports' (a section h1 moved to the top), then Debian, Login and the rest, and 'Backports' is an H2. On plain https://wiki.debian.org/Backports the H1 is 'Backports'. The headless harness lands on ?pow_referer= on a first visit, and the current bundle gives title 'Using backports' there. The baseline gave 'External links', which is wrong too. The code is as stated: titleH1 skips an h1 whose link's href without #hash differs from location.href without #hash, query included. 'Using backports' then scores 1.0 against the one-word title and wins before the bySeg rule. This also hits any site whose title h1 links to its own permalink when the URL has utm or other query parameters.

Skeptic's fix lead: src/content/extract/generic.ts titleH1: compare the link's origin and pathname with location's (ignore search and hash) in the story-card skip. Optionally check bySeg before accepting a score loop winner that is not the first plain h1.

## F1136 (medium, regression): F1047's date check walks the whole page on every article with a meta date and rebuilds a parent's full text per dated text node: 3-5x slower extraction on long reference lists

Found by: R1-extractor. Where: src/content/extract/generic.ts:7546 (now calls pageShowsDate on every meta date) and 7490 (p.parentElement.textContent for each text node with a year)

Evidence: Scratch article with meta article:published_time 2021-03-15 (not shown on the page), 30 paragraphs and a 3000-entry <ol> of references, each with a year in the li's own text. Round 11 took 1692/1224/1211 ms. The same bundle with the line 7546 check disabled took 453/252/221 ms, and r10m 518/308/194 ms. This repeats on every re-extraction pass.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11 && bun run.ts r11.js,r11nodate.js,r10m.js $PWD/fx/refs3000.html 3 --quiet --as http://127.0.0.1:8799/fx/zz-refs3000.html

Suspected cause: For each text node with a year, `p.parentElement.textContent?.length < 200` builds the parent's whole text. For li or p children of one big list or article body, that is quadratic. Check the parent's size with tlen() (memoized) or childElementCount first, and stop the walk at the article when one is known.

Skeptic: Confirmed but narrow. I would rate it low-to-medium. Reporter's refs3000 fixture: current 1813/1382/1394 ms, current with the line 7546 check off 367/198/271 ms, baseline 311/158/239 ms. My own 1500-comment page with a meta date and years in each li's own text: current 573/328/295 ms, check off 220/125/95 ms. A realistic long article (400 paragraphs, 500 references, meta date not shown) showed no clear cost from the check (marqueeCopies off: 298/119/116 ms; both off: 190/88/139 ms; within noise). The quadratic box test (p.parentElement.textContent) already existed in the JSON-LD path. The regression is that byline() now runs pageShowsDate on every meta date, so pages with more than about 1500 year-bearing entries directly under one parent pay a second or more on every extraction pass.

Skeptic's fix lead: src/content/extract/generic.ts pageShowsDate: before building p.parentElement.textContent, check a cheap bound (childElementCount or childNodes.length small, or a memoized tlen). Optionally stop the walk at the article element when one is known.

## F1046 (still open, partly; original repro in /home/nico/projects/sift/research/round10/*.md)

Recheck by R1-extractor: On plain URLs it works. Real extension on wiki.debian.org/SourcesList, /Backports and /DebianTesting (after the wiki's proof-of-work cookie is set) gives the right H1, puts the search box in Sift's bar and moves Login/Info/Attachments after the H1. Two cases still fail. (1) With any query string, the page h1 is skipped. The first visit is redirected to ?pow_referer=, and links can carry ?utm_source=. Real extension on https://wiki.debian.org/Backports?utm_source=mastodon: main h1 'Using backports' (a section half way down), and 'Backports' is an H2. The harness agrees (r10m: 'External links'). See the titleH1 finding. (2) MoinMoin's second search button 'Text' is now a lone button at the end of main (see the search finding). The 'Debian' logo link still comes before the H1. The ext15 fixture r10ext15-moinmoin still gives title 'External links' from 127.0.0.1, because the new host rule needs the real wiki.debian.org hostname, so this fix cannot be checked on that fixture.

Skeptic: Partly fixed, as reported. Plain URLs in the real extension: the H1 is 'SourcesList' on /SourcesList and 'Backports' on /Backports. Search is in the bar, and Login, Info, Attachments and More Actions come after the H1. The 'Debian' link still comes before the H1. Still failing: (1) Any query-string URL, including the ?pow_referer= every first visit lands on. /Backports?utm_source=mastodon gives H1 'Using backports' with 'Backports' as an H2 (see N5). (2) The 'Text' full-text search button sits alone at the end of main (see N4). The fixture r10ext15-moinmoin.html from 127.0.0.1 still gives title 'External links', as the reporter said.

Skeptic's fix lead: See N5 (titleH1: compare origin and pathname only) and N4 (findSearch: consume or keep the form's other submit buttons with the box).
