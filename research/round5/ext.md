# Round 5 findings: ext

Each was reproduced by a skeptic. F5xx are new in round 5; F3xx and F<100 are older findings a round 5 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F560 (high, regression): Rows of 8+ buttons (date picker, showtimes, sizes) become plain text: the buttons can no longer be pressed

Found by: R1-extractor. Where: src/content/extract/generic.ts:3471 (readingStrip checks only cells' descendants for buttons), 3474-3478 (only a cell that is itself a[href] stays a link), called before detectItems at 3167

Evidence: Fixture dates.html (10 date <button>s 'Fri 24'…'Sun 2', 10 time <button>s '10:30 AM'…, 10 div>a day links in one row). Harness now: 'p: Fri 24 · Sat 25 · …', 'p: 10:30 AM · 11:45 AM · …', 'p: Fri 24 · … ' for the links too. Pre-fix bundle: actions ['Fri 24[on]','Sat 25[off]',…], actions ['10:30 AM',…], ul of 10 links. Real extension (9468): same three plain paragraphs; act 'click:Sat 25' → 'not found'. The round-4 fixture core-buttons3000 also renders as 'p: e0 · e1 · e2 …' instead of 3000 buttons. Cells with opacity < 0.6 (faded/sold-out buttons) are also dropped entirely.

Repro: Serve /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r5/fx on 8813 (python3 -m http.server 8813), then SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/act.ts goto:http://127.0.0.1:8813/dates.html wait:3000 outline 'click:Sat 25'. Or http://127.0.0.1:8799/fx/core-buttons3000.html.

Suspected cause: tools' readingStrip (weather.com hours) accepts any 8+ same-row children with short letter+digit text. `c.querySelector("…button…")` never matches a cell that is itself a button/[role=button]/[role=tab]/[onclick], and a div cell holding a link is read as text. It should refuse when any cell matches or holds a control or link (or keep them as clickable inlines), and not drop faded cells that are controls.

Skeptic: Confirmed regression, high. Real extension (9468) on dates.html shows 'p: Fri 24 · Sat 25 · …', 'p: 10:30 AM · …' and the day links also as one plain paragraph. act 'click:Sat 25' gives 'not found', and #picked stays 'No time picked yet.' Harness with the current bundle gives the same. The pre-fix bundle (g-base) gives actions ['Fri 24[on]','Sat 25[off]',…], actions ['10:30 AM',…] and a ul of 10 links. core-buttons3000 in the real extension renders as 'p: e0 · e1 · e2 …' with no buttons. Code at generic.ts:3471: c.querySelector(...) never tests the cell itself, so a cell that is a button passes. A div cell holding an <a> is read as text, because only c.matches('a[href]') keeps a link. readingStrip comes from the tools group and is absent from g-base and from every other group's bundle. I did not test the opacity<0.6 drop separately.

Skeptic's fix lead: In readingStrip (src/content/extract/generic.ts ~3463-3480): return null when any cell matches or contains a control: c.matches('button, [role=button], [role=tab], [role=option], [onclick], input, select') || c.querySelector('button, [role=button], [role=tab], [onclick]'). For a cell that holds exactly one a[href], emit that inner link ({a, href, ref}) instead of text. Apply the faded-cell drop only to non-control cells.

## F561 (high, regression): Picture-only links side by side collapse to 'first +N': the other links vanish, and the check is quadratic

Found by: R1-extractor. Where: src/content/extract/generic.ts:856-866 (inlineNodes avatar stack), 967-970 (avatarStack scans all siblings for every picture link)

Evidence: Live https://github.com/vitejs/vite README badges: pre-fix 'p: [npm package] [node compatibility] [build status] [discord chat]', now 'p: [npm package ->/package/vite] +3'. Fixture flags.html: language links English/Español/Français/Deutsch/中文 (flag images with alt) → now 'Read this page in: [English] +4'; App Store + Google Play badges → '[Download on the App Store] +1'. Real extension: only 'English' and 'Download on the App Store' links remain. Fixture wall1000/3000.html (1000/3000 <a href><img alt='Member N' 40px></a>): harness now 2010 ms / 18475 ms vs pre-fix 90 / 164 ms and output 268 bytes vs 71,941; real extension first content 5013 ms (1000) and 44345 ms (3000), with one link 'Member 0' left.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/rv && BOTH=1 bun run3.ts http://127.0.0.1:8813/wall3000.html ../r5/time3.js (8813 serving scratchpad/r5/fx). Live: LONGNAME=1 WAIT=4000 bun batch.ts ../r5/out3 now,g-base https://github.com/vitejs/vite then grep 'npm package' ../r5/out3/*.

Suspected cause: generic's avatarStack treats any 2+ sibling a[href] with an img and no text as a stack of avatars, with no check that they are avatars (small, round, profile links) or that they share a target type. Cache the stack per parent per pass and restrict it to real avatar stacks (e.g. profile-like hrefs, overlapping/small square images), else read each link by its alt.

Skeptic: Confirmed regression, high. Live github.com/vitejs/vite in the real extension: the README badge paragraph reads 'npm package +3'. Only the 'npm package' link remains, and 'node compatibility', 'build status' and 'discord chat' are gone. The original has 4 sibling <a><img alt></a> in a <p>. The pre-fix bundle on the same live page gives '[npm package] [node compatibility] [build status] [discord chat ->/]'. On flags.html the real extension keeps only 'English' and 'Download on the App Store', and act 'click:Español' gives 'not found'. Performance in the harness (current vs g-base): wall1000 1653 ms vs 66 ms, wall3000 11974 ms vs 176 ms, JSON 268 vs 221649 bytes. In the real extension, wall1000 first content took 4965 ms, with only 'Member 0' left. avatarStack (generic.ts:967) rescans all of the parent's children for every picture link, which makes it quadratic, and it has no test that the pictures are avatars. It is new in the generic group.

Skeptic's fix lead: In generic.ts avatarStack and its caller in inlineNodes (~856-866): cache the result per parent per pass, as linkWordCache does. Treat siblings as an avatar stack only when the images are small and square (for example ≤48px with width ≈ height), or overlap or are rounded, and the hrefs look like profiles. Otherwise fall through so each link is read by its alt.

## F562 (high, regression): controlSentence turns links beside a menu button into dead text, and shows share buttons and promos

Found by: R1-extractor. Where: src/content/extract/generic.ts:3277 (a child that is itself a[href] is walked as text), 3246-3286

Evidence: Fixture sentence.html ('Showing 20 results · [Sort: Newest ▾] · <a href=/saved>Saved searches</a>'): pre-fix '… [Saved searches ->/saved]'; now 'p: Showing 20 results · [Sort: Newest (btn)] · Saved searches' with no link; real extension act 'click:Saved searches' → 'not found'. Daily Mail article snapshot (http://127.0.0.1:8799/dailymail-article.html): pre-fix 'ul: [33 comments ->/#comments]'; now 'p: [Share (btn)] Add us as a preferred source33 comments' twice (header and footer social bars). The '33 comments' link is dead text glued to the promo, and the Share button and the 'preferred source' promo that usefulControl rejects are shown. Real extension text: 'Share Add us as a preferred source33 comments' at lines 14 and 63.

Repro: SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/visit.ts http://127.0.0.1:8799/dailymail-article.html dm --text | grep preferred; or the sentence.html fixture in scratchpad/r5/fx.

Suspected cause: generic's controlSentence: `e.querySelector("a[href]")` checks only descendants, so a direct-child <a> is recursed into and pushed as plain words. Its controls also skip usefulControl/isPromo. It should return null when a child is or holds a link (or emit the link), and run usefulControl on each control.

Skeptic: Confirmed regression, high. Real extension on sentence.html: the outline shows only '[link] Sort: Newest' with no 'Saved searches' link, and act 'click:Saved searches' gives 'not found'. Harness: now 'p: Showing 20 results · [Sort: Newest (btn)] · Saved searches'; g-base '· [Saved searches ->/saved]'. Daily Mail article snapshot in the real extension: text lines 14 and 63 read 'Share Add us as a preferred source33 comments'. Harness now 'p: [Share (btn)] Add us as a preferred source33 comments' twice, g-base 'ul: [33 comments ->/#comments]'. Code at generic.ts:3277: e.querySelector('a[href]') skips a child that is itself a link, so the link is recursed into and pushed as plain words. The controls are never run through usefulControl, and the result is never run through isPromo. controlSentence is new from the generic group.

Skeptic's fix lead: In controlSentence (src/content/extract/generic.ts ~3277), change the check to `if (e.matches('a[href]') || e.querySelector('a[href]') || go(e) === false) return false;`. Filter ctls with usefulControl(c, labelOf(c), ctx), so share buttons are dropped. Return null when isPromo(content, ctx.inArticle) holds.

## F563 (high, regression): A card that holds a list of headlines becomes one item: its title links to the first story and stories past the 8th are lost

Found by: R1-extractor. Where: src/content/extract/generic.ts:1924-1931 (multi-headline rule now needs >30% of members), toItem 2151 (kept links) and 2262 (meta capped at 8)

Evidence: Fixture mostread.html: a grid of 5 div.card stories plus one div.card.card--list 'Most read' holding 10 linked headlines. Pre-fix: 5 items, 'h2: Most read', then 10 items. Now: a 6th item 'Most read ->/read/0' (the box's name opens story 0) with 8 headlines squeezed into its meta line; 'Most read story number 8' and '9' are gone. Real extension shows '[link] Most read' with only stories 1-7 under it.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/rv && bun batch.ts ../r5/out11 now,g-base http://127.0.0.1:8813/mostread.html (8813 serving scratchpad/r5/fx).

Suspected cause: generic relaxed `heads > members*1.5` with `multi > members*0.3` for search results with sub-pages. One member with many headlines among few others now passes and is made one card. Exclude members whose headline links are in their own list (ol/ul with ≥3 linked rows), or walk such a member instead of toItem.

Skeptic: Confirmed regression, high (content and links lost). Harness on mostread.html: g-base gives 5 story items, then 'h2: Most read' and 10 linked items. Now there is a 6th item 'Most read ->/read/0' whose meta holds headlines 0-7 only. Real extension: '[link] Most read' with only stories 1-7 linked under it. act 'click:Most read story number 8' gives 'not found'. Code at generic.ts:1931 needs multi > members*0.3 as well as heads > members*1.5. Here heads=15 > 9, but multi=1 < 1.8, so the box holding the list becomes a card through toItem. I found no live case. A 'Most read' box inside a story grid is a common news layout.

Skeptic's fix lead: In detectItems (src/content/extract/generic.ts ~1924-1931): treat a member whose headline links sit in its own ol/ul of 3 or more linked rows as a group. Return null, or exclude that member from the set so visit walks it. Alternatively, keep the old heads > members*1.5 rule when any single member holds 3 or more headlines.

## F564 (medium, regression): Two adjacent padded links with no margin are glued into one ('NewsSportBusiness')

Found by: R1-extractor. Where: src/content/dom.ts:322 (link pair returns drawnBetween || !touching, never consulting padding/flex)

Evidence: Fixture pills.html: flex menu of <a> with padding 8px 14px, tag pills with padding and background, chip row with padding. textIn now 'NewsSportBusinessCulture', 'Topics: PoliticsEconomyLeeds', 'HousingTransportSchools'; pre-fix 'News Sport Business Culture' etc. Real extension: screenshot shows 'NewsSportBusinessCulture' and 'PoliticsEconomyLeeds' as one continuous underlined link run. The Infobae article snapshot (unstyled) also changed from '[Adolf Hitler] [Alemania]' to '[Adolf Hitler][Alemania]'. A whitespace-diff scan of 22 live sites (BBC, Guardian, HN, GitHub, La Nación, Infobae home and article, MDN, SO, Wikipedia, NPR, Daily Mail, weather.com, Next.js, React, Reddit, dev.to, IMDb, Allrecipes, eBay, Craigslist, Verge, CNN, NYT, AP) found no live case, so reach is unproven.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/rv && BOTH=1 bun run3.ts http://127.0.0.1:8813/pills.html cmpspace.js

Suspected cause: generic's '<a>un</a><a>believable</a>' rule joins any two touching links. Padding inside a link's box keeps the boxes touching. Also treat setApart(prev,'r') || setApart(e,'l') or a flex/grid parent as apart before joining.

Skeptic: Confirmed regression, medium. Real extension on pills.html: the text reads 'NewsSportBusinessCulture', 'Topics: PoliticsEconomyLeeds' and 'HousingTransportSchools'. The screenshot shows each row as one continuous underlined link run, so the links cannot be told apart. g-base in the harness spaces them: '[News] [Sport] [Business] [Culture]'. The Infobae article snapshot in the real extension reads 'Últimas noticias AméricaAdolf HitlerAlemaniaNido del Águila…'. g-base kept the spaces there, and that pair is the exact case the code comment says this rule should keep apart. That snapshot lacks the live site's CSS, and the reporter found no live case, so reach is unproven. The flex-plus-padding fixture is a common pattern, though. Code at dom.ts:322 returns drawnBetween || !touching for any two different-href links, and never consults apart() (flex parent, padding).

Skeptic's fix lead: In needsSpace (src/content/dom.ts ~322), for two adjacent links with different hrefs, return `drawnBetween(prev, e) || !touching(prev, e) || apart()`. apart() already covers inFlex() and setApart padding. Keep the 'un'+'believable' join only when nothing in CSS sets them apart.

## F565 (high): A box whose only content is a link inside a web component's shadow root crashes extraction: Sift stays on 'Loading…'

Found by: R1-extractor. Where: src/content/extract/generic.ts:3200-3201 (el.querySelector("a")! is null when the link is in a shadow root, then usefulControl(null) throws)

Evidence: Fixture shadowlink.html (<div class=cta><docs-link> whose open shadow root holds <a href=/start>Get started</a>). Harness: 'ERROR TypeError: Cannot read properties of null (reading 'getAttribute')' with both the current and pre-fix bundles. Real extension: console '[sift] extraction failed TypeError…' repeated; the screenshot shows only 'Loading…' with no content, indefinitely. Not found live on shoelace.style or material-web.dev.

Repro: SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/visit.ts http://127.0.0.1:8813/shadowlink.html sl (8813 serving scratchpad/r5/fx)

Suspected cause: inlineNodes reads through shadow roots, so a single-link content can come from a shadow tree that el.querySelector cannot see. Use the link element by its ref (elOf(c.ref)) or guard null.

Skeptic: Confirmed, high (not a regression: g-base crashes the same way). Real extension on shadowlink.html: the console repeats '[sift] extraction failed TypeError: Cannot read properties of null (reading 'getAttribute')', and the screenshot shows only 'Loading…' after 8 s, with no content. The harness stack trace is formControl <- usefulControl <- visit <- walk <- walkPage. The cause is el.querySelector('a')! at generic.ts:3200, which returns null when the only link is inside an open shadow root that inlineOf reads through. I found no live case.

Skeptic's fix lead: In visit's single-link branch (src/content/extract/generic.ts ~3198-3201), take the link element from the inline's ref (elOf(c.ref)) or use deep querying, and guard null: `const a = elOf(c.ref) ?? el.querySelector('a'); if (a && usefulControl(a, c.a, ctx)) …`. When a is null, push the link anyway rather than throwing.

## F566 (medium): Long links to '#' that run a script (FAQ questions) become plain text: their answers cannot be opened

Found by: R1-extractor. Where: src/content/extract/generic.ts:868 (guard !clickableAnchor(e) is dead: clickableAnchor returns false for any element with an href, line 703) and 3116 (no guard at all)

Evidence: Fixture hashlink.html: two FAQ questions as <a href='#' onclick=…> of 70+ chars that toggle their answers. Real extension outline: 'p: How do I change the delivery address…' as plain text; act 'click:How do I change' → 'not found', answers never shown. Same with the pre-fix code.

Repro: SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/act.ts goto:http://127.0.0.1:8813/hashlink.html wait:2500 outline 'click:How do I change'

Suspected cause: The '#' link check means 'a key point a script scrolls to', but cannot tell it from a link with a click handler because clickableAnchor bails on href. Check onclick/data-action/role=button/aria-expanded/aria-controls directly for href='#' links.

Skeptic: Confirmed, medium (not a regression: g-base output is identical). Real extension on hashlink.html: both FAQ questions are plain 'p:' text, and act 'click:How do I change' gives 'not found'. A second outline after the click still shows no answers, so they cannot be opened. In the original, the <a href='#' onclick> toggles the hidden answer. Code: clickableAnchor (generic.ts:703) returns false whenever href is present, so the guard at 868 never fires. The block path at 3116 has no guard at all.

Skeptic's fix lead: In src/content/extract/generic.ts, add a helper for href='#' links that checks e.hasAttribute('onclick') || data-action || role=button || aria-expanded || aria-controls. Use it in place of clickableAnchor at ~868, and add the same guard at ~3116, so such links stay clickable links or actions instead of becoming text.
