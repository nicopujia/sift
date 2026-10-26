# Site sweep (2026-10-24)

Tester tab: `SIFT_TAB=2`. Screenshots and outlines are in `research/shots/<name>.png|.txt`.
"First content" is the time printed by `visit.ts`. Note: the outline tool prints only the links of a `p` that holds links, so text claims below were checked against Sift's `innerText` or the screenshot.

## 1. Hacker News

Front page (`hn-home`, first content 423 ms, no errors)
- Rows are not a list. Each story is three blocks: a lone rank paragraph `p: 1.`, the title line, then the points line. 30 stray "1." … "30." paragraphs.
- Header text glued: screenshot shows `Hacker Newsnew | past | comments …` (no space between "Hacker News" and "new").
- Promo leaked at the end: `[link] Consider applying for YC's Winter 2027 batch! Applications are open till November 2.`
- `hide` link kept on every row (useless when signed out). Pipes `|` kept as text separators.
- Font size of some titles is smaller than others in the screenshot (items 10, 11, 14), no reason visible.

Comment page (`hn-item`, 320 ms)
- Thread nesting is lost. All comments are flat. Original indents are `0,0,1,0,0,1,0,1,0,1,1,0,1,2,0` (`.ind[indent]`); in Sift "punnerud" (a reply to Kinrany) looks like a top-level comment (`hn-item.png` vs `hn-item-orig.png`).
- Paragraphs inside a comment are merged: Kinrany's 5-line list becomes `Is there a project that does all of these together? - embeddable like sqlite - clustered like dqlite - …` on one line; piterrro's quoted paragraph `> I'll let you…` is glued to the previous one.
- The `parent | prev | next` links are dropped but their separators stay: `Kinrany 1 hour ago | | [–]`, `bendangelo 1 hour ago | | | [–]`.
- H1 is the document title with site suffix: `H1 Twelve years of distributed SQLite | Hacker News`.
- Comment textarea has no visible label; the "help" link sits between the textarea and the button.
- Interaction: clicking `16 comments` in Sift opened the item page (same as original). Clicking `[–]` collapsed the comment (`.comtr.coll` true, Sift shows `[1 more]`); `[1 more]` expanded it again. Both work.

## 2. Google search (blocked) and fallback

- Google: redirected to the `/sorry` captcha page. Sift's H1 is the raw URL (`H1 https://www.google.com/search?q=gluten+free+bread&sei=…`). The screenshot shows "About this page" then the link, without the sentence "Our systems have detected unusual traffic…" that the original shows. Not investigated further.
- DuckDuckGo HTML: bot challenge ("Select all squares containing a duck"). Sift drops the 9 challenge images and labels the checkboxes with their names (`image-check_d6768abce2d9…`), so a human could not complete the challenge inside Sift (`ddg-search.png`). Images that are the content of a form control are lost.
- Bing (`bing-search`, 1439 ms) served degraded results to this IP (results about "Erika Montgomery"; the original shows the same, so not a Sift bug; `&quot;` is also in the original).
  - The vertical tabs (All, Images, Videos, Maps, News, Shopping, Tools) are gone. Original has them under the search box.
  - A lone `[button] Menu` (hamburger) with nothing useful behind it is shown at the top.
  - One result has its parts swapped: `p: https://www.signalhire.com › companies …` then `p: signalhire.com · Reveal contacts of …` (URL where the snippet should be).
  - Interaction: typing " rolls" in Sift's search box and pressing Enter ran the search on Bing (URL `q=gluten+free+bread+rolls`). Works.

## 3. GitHub

Repo page (`gh-repo`, 2744 ms)
- Repo tabs are not clickable. The whole repo header becomes a fake card: `[link] Repository navigation` + `p: preactjs · preact · Code · Issues17 (17) · Pull requests23 (23) · Discussions`. The card link goes to `/preactjs/preact/security` (the longest link). `click:Issues` → "not found". There is no way to reach Issues/PRs/Actions from Sift.
- The Sift Menu does not help: it holds 60 marketing mega-menu links (`GitHub CopilotWrite better code with AI`, `IssuesPlan and track work`, …) and is cut at 60; the repo tabs are not in it.
- The About sidebar is gone entirely: description, website, topics, stars/watchers/forks, Releases, Contributors, Languages (`innerText` has no "About", "Releases", "Languages"). It lives in `div.prc-PageLayout-Pane` beside the file list.
- Signed-out noise kept as big blocks: `Sponsor`, `Notifications / You must be signed in to change notification settings`, `Fork4.5k (4.5k)`, `Star38.9k (38.9k)` (twice, also in the top bar), top-bar button labeled with a tooltip `You must be signed in to fork a repository`.
- The file table is flattened: header cells become `p: Name / p: Last commit message / p: Last commit date`, then each row is 3 separate lines; commit messages are split into link pieces `Ryan makes a great point (` `#5255` `)`.
- Glued words: `264 Branches361 Tags`, `Open commit detailssuccess`, `Issues17 (17)`.
- H1 is the document title `GitHub - preactjs/preact: ⚛️ Fast 3kB React alternative…`.
- README badge links kept as a link run (`npm`, `coveralls`, `gzip size`, `Drydock review`).

Issues list (`gh-issues`, 2103 ms)
- Pagination is missing. Closed list has `Previous 1 2 3 4 5 6 7 … 40 Next` in the original (`nav[aria-label=Pagination]`); Sift has no "Next".
- Labels and authors appear only as big buttons: `[button] Filter by label feature request`, `[button] Filter by author jakearchibald` under every issue (2-3 per item).
- Meta lines are cryptic or broken: `Unread · preactjs/preact#4994 · opened · on Jan 9, 2026 · 1 · 3` (bare numbers, "Unread" while signed out); on the Closed tab `· by was closed ·` (author name dropped from the sentence).
- Useless controls kept: `Comfortable display density`, `Compact display density`, a lone `Search` button separate from the field, `More Issue list controls`.
- Two "Issues" headings (`H1 Issues`, `H2 Issues`).
- Interaction: clicking `Closed 1,936` in Sift switched to `?q=is:issue state:closed` and Sift updated. Works.

## 4. Reddit (blocked)

- www.reddit.com: "You've been blocked by network security." old.reddit.com: "whoa there, pardner!". Both are IP blocks. Sift renders the block text correctly. Not tested further.

## 5. Google Maps (tool page)

- The map is not shown at all (`gmaps.png`, `gmaps-place.png`). The original has a 1792x1280 canvas inside `div[role=application][aria-label="Map · Use arrow keys to pan the map…"]`. Zero portals in Sift.
- Cause (checked): `mainRoot()` returns the 408 px wide side panel (`div.m6QErb[role=main]`), and the map canvas is outside it, so it is never walked.
- Interaction: typing "Golden Gate Bridge" in Sift's search box and pressing Enter did nothing (URL unchanged, value did reach the original input). Pressing Enter in the original input ran the search. Sift's search replay does not work here.
- After searching on the original, the place panel in Sift:
  - Facts are rendered as buttons: `[button] Address: Golden Gate Brg, …`, `[button] Phone: +1 415-921-5858`, `[button] Plus code: …`, and the description `[button] Famed 4,200 ft art deco suspension bridge…`.
  - Rating (4.8 stars) is missing. The hero photo becomes `[button] Photo of Golden Gate Bridge`.
  - Icon-font glyphs leak as tofu boxes: an empty paragraph with ``, `Famed … traffic. `, ` Add a photo`.
  - Tabs are verbose buttons: `Overview of Golden Gate Bridge`, `About Golden Gate Bridge`.
- Note: before searching, Maps itself (not Sift) dropped the place from the URL and showed Iran for this IP.

## 6. OpenStreetMap (tool page)

- First attempt: HTTP 429 from OSM. Retried later and it loaded (`osm`, 796 ms).
- The map is not shown. `#map` is a 1280x845 Leaflet container made of `img.leaflet-tile` (48 tiles, no canvas). Sift only portals `canvas`, `iframe`, `video`, `embed`, `object`.
- The map controls are there but useless without the map: `Zoom InZoom Out` (glued into one line), `Show My Location`, `Layers`, `Legend`, scale `500 m` / `2000 ft` as paragraphs. A stray `p: Zoom In` appears at the end after searching.
- Interaction: `click:Zoom In` changed the URL from `map=14/…` to `map=15/…` (works, but the user sees nothing). Search "Golden Gate Bridge" through Sift worked and listed results; the first four results lost their type labels (only the last two show `p: Motorway`, `p: Unclassified Road`).
- Same result on opentopomap.org (`opentopomap.png`): no map, controls rendered as `+-` link, `Suchen…`, `Layers`.

## 7. BBC

Home (`bbc-home`, 1592 ms)
- Mostly good: story list with title, summary, time.
- Meta glued: `1 hr agoEurope`, `8 hrs agoEurope`, `15 hrs agoEuropean Football`.
- H1 is the long `<title>`: `BBC News - Breaking news, video and the latest top stories from the U.S. and around the world`.
- "MOST WATCHED" ranks come after the title as separate paragraphs (`[link] Which emergency foods…` then `p: 1`).
- No search control in the top bar (BBC has one in its header).
- Interaction: clicking the "Ruins of Limoges…" headline in Sift opened the article. Works.

Article (`bbc-article`, 472-901 ms)
- The author is missing. Sift's byline is only `23 Oct 2026, 23:09`; the original byline is "James Waterhouse, Paris Correspondent". Sift hides the site byline because it shows its own, but its own has no author.
- The Short version covers only a middle chunk. The first 8 paragraphs are shown in full, then `SHORT VERSION / Show full text` with 10 bullets, then ~20 more paragraphs in full. The article block is a sub-container of the real article.
- The lead video does not play in Sift. Sift shows `[button] Play video`. Clicking it removed the button but no player or portal appeared (`video` count 0, portal count 0; the player is `smp-toucan-player` with a shadow root). `bbc-article-video.png`.

## 8. Allrecipes (blocked) and fallback

- Allrecipes: Cloudflare "Just a moment..." (Sift shows `H1 Just a moment... / Nothing to show yet.`).
- Fallback: BBC Good Food "Gluten-free bread" (`goodfood`, 1367 ms). This is the worst content loss in the sweep:
  - The first ingredient is missing. Original: `400g gluten-free white bread flour`, `1 tsp salt`, … Sift starts at `1 tsp salt`. Cause (checked): the first `li` has classes `ingredients-list__item list-item`, the others add `list-item--separator-top`, so `signature()` puts it in a different group and `detectItems()` returns only the 5 majority items. The odd one is silently dropped.
  - Servings, difficulty and times are missing (`Makes 1 loaf (10-12 slices) Easy Prep: 5 mins Cook: 1 hr Plus rising time`). Cause (checked): they sit in `div.post-header__body[role=banner]` inside `main`, and `isChrome()` drops any `role=banner`.
  - Ingredients are cards with the quantity split from the name and placed after it: `[link] eggs` / `p: 2`, `[link] olive oil` / `p: 2 tbsp`. A plain list "2 eggs" is faster to read.
  - Method steps lose words. Glossary links are pulled out of the sentence into the meta line: `Mix the flour, salt and yeast in a large . In a separate bowl, together the buttermilk…` with `bowl · whisk` below. Original: "in a large bowl. In a separate bowl, whisk together…".
  - Step 2 is cut off at ~320 characters with no way to expand: `…leave somewhere wa…`. The missing end is "warm for 1 hr, or until risen by a third or so."
  - Each step's heading is a pointless link (`[link] Step 1`).
  - Headings out of order: `H2 Ingredients`, `H2 Nutrition` (tab labels) come before the list; the nutrition values are not shown.
  - Promos leaked: `Keep the screen awake with cook mode on the Good Food app.`, `Good Good Trust Campaign`, `Get 3 months of Good Food All Access for just £6…`.
  - "Related guides" is a fake card with unclickable entries and mangled ratings: `Gluten-free banana bread · A star rating of 4.8 out of 5.45 ratings · …`.
  - Interaction: clicking `US` in Sift switched the original to US units and Sift updated (`1 packet instant yeast`, `1¼ cups`). Works (first ingredient still missing).

## 9. Weather

- timeanddate.com: Cloudflare "Just a moment…". weather.com used instead (`weathercom`, 1328 ms).
- Current conditions are one mashed link plus a garbled duplicate: `[link] Now 55° 54° 53° Clear Feels Like 53° High 68° Low 51° Chance of Rain 2% 0 in` and `p: Now55°54°53° · 53° · HHigh · 68° · LLow · 51°`.
- Stray `p: ·` under the city name.
- Hourly forecast is 40 one-per-line links (`Now, 53°`, `1 am, 53°`, …) with no conditions or rain chance; sunrise/sunset split into `p: 7:26 am` / `p: Sunrise`. A table would be far faster.
- Icon names as button labels: `[button] Chevron Left`, `[button] Chevron Right`.
- Daily forecast duplicated and glued: `[link] Tonight 2% 51° 68°` then `p: TonightClear · 2% · 51°68°`; some days have no condition at all (`Sat 24 3% 49° 70°`).
- Details are glued: `p: 85%Very High`, `p: 48° · 3080`, `p: 30.02in`.
- The radar map is missing (`H2 Radar` then only `[link] Now` and `[button] Map Attribution`).
- No way to change the city: the header's location control and the Today/Hourly/10 Day tabs are only in the Menu, with doubled labels (`TodayForecasts`, `RadarRadar`, `NewsNews`, `User AvatarSign in`).
- "Sponsored Content" section leaked (`H2 Sponsored Content`, `Editor's Pick`).

## 10. MDN `<details>` (`mdn`, 1058 ms)

- The "Technical summary" table is missing (heading with nothing under it). Cause (checked): the table is inside `figure.table-container`, and `figure()` only looks for images and media, so the table is dropped.
- The Browser compatibility table is missing. It is `mdn-compat-table-lazy` (lazy, loads on scroll). Likely never loads because the original page is not scrolled under Sift.
- The "Try it" interactive example is missing (`interactive-example`, 351 px, open shadow root). Heading with nothing under it.
- Code-block toolbar text leaks as paragraphs: `p: js`, `p: Copy`, `p: html`, `p: Play`, `p: css` around every example.
- Feedback widget leaked: `Help improve MDN / Was this page helpful to you? / Yes / No / Learn how to contribute`.
- The live example results are shown as portals (`[PORTAL] … runner`). Good.

## 11. GitHub login (`gh-login`, 876 ms)

- Both fields present with visible labels associated (`labels.length` 1 each), `autocomplete` kept (`username`, `current-password`), "Sign in" button present.
- Missing: `New to GitHub? Create an account` and `Sign in with a passkey` (both in the original).
- Interaction: typing into the Sift username field set `#login_field` on the original (cleared after; nothing submitted).

## 12. La Nación

Home (`lanacion-home`, 3978 ms)
- Language kept (Spanish UI labels: `Buscá en LA NACION`, `Menú`). Good.
- Page H1 is the lead story headline, not the site: `H1 El caso $LIBRA. La trama cripto…`. The same story then appears again as the first list item.
- AI one-liner rewrites drop the news from headlines that were already short. Examples (original → Sift): `A horas del balotaje. Otro áspero debate: Bolsonaro llamó "presidente nueve dedos" a Lula…` → `Debate entre Bolsonaro y Lula antes del balotaje`; `De no creer. Milei en Madrid: aplaudan, no dejen de aplaudir` → `Milei en Madrid y los aplausos`. The lead story's deck ("La Justicia descartó una estafa…") is gone.
- Meta glued: `PolíticaPor Federico González del Solar`.
- An empty item row (blank separator) between "Cinco experiencias…" and "Bullrich…" in the screenshot.
- An autoplaying "SELECCIÓN DEL EDITOR" clip is shown large with five player buttons (`Pausar`, `Atrás 10 s`, …).
- Interaction: clicking a headline in Sift opened the article. Works.

Article (`lanacion-article`, 7105 ms first content: slowest in the sweep)
- No Short version at all on a 9-minute article (11,110 characters of text), and no "shortening" indicator, even after several minutes. BBC got one. Likely cause (not verified): the page keeps mutating, so the article word count keeps changing and the 600 ms stability timer in `processAi` never fires, or `page.partial` stays true.
- Missing spaces next to bold text: `esperaba,Patricia Bullrich`, `Mileiy`, `desmarquespor`, `queiba`. Cause (checked): the source is `esperaba,<strong> Patricia Bullrich</strong>`, and `inlineOf()` uses `textIn()` (trimmed) for `strong`/`b`/`em`/`a`, losing the space.
- Date shown twice with different times: Sift byline `Matías Moreno · 23 oct 2026, 22:01`, then the site's `23 de octubre de 2026 / 19:01 / 9 minutos de lectura`.
- Fragments and promos leaked: `Agregar LA NACION en` (Google preferred-source promo minus its image), `Conforme a` (Trust Project badge minus its image), `Sumate a la conversación / Para comentar las notas, necesitás suscribirte / INICIAR SESIÓNSUSCRIBIRTE`.

## 13. Stack Overflow (`so`, 285 ms)

- The question is missing: no title "How do JavaScript closures work?" and no question body. Sift starts at `H2 85 Answers`.
- The page H1 is a heading from inside an answer: `H1 The Straw Man`.
- Cause (checked): `titleH1()` keeps the last visible h1 before or inside the article; the answer's own `h1` "The Straw Man" (inside `#answers`) wins over the question's h1, so `articleScope()` is `#answers` and the question is cut. On page 2 (no h1 in answers) the question does show.
- Code blocks start with the copy button text: `Copyfunction foo() {`.
- `Sorted by:` appears twice. Vote controls are big primary buttons (`Up vote`, `Down vote`) with the score as a lone `p: 8349`; `p: +100` and `Timeline` are fragments.
- "Links" section: link text is pulled out of the sentence into the title: `[link] private attributes and private methods` / `p: Douglas Crockford's simulated for an object, using closures.`
- Interaction: `Go to page 2` in Sift loaded page 2 and Sift updated. Works.

## 14. Wikipedia portal (`wikiportal`, 854 ms)

- The page is almost empty: H1 and search only. The 10 top language links (`English 7,254,000+ articles`, `日本語`, …) and the full language list are hidden in Sift's Menu because they are `<nav>` elements. They are the main content of this page.
- The Menu stops at 60 links; Wikipedia has 300+ languages.
- The search language selector and the sister-project links are missing.
- Interaction: searching "Celiac disease" through Sift opened en.wikipedia.org/wiki/Coeliac_disease. Works. (The article's infobox shows fragments like `Symptoms / non-specific / diarrhoea / malabsorption` on separate lines.)

## 15. Craigslist (`craigslist`, 938 ms)

- All search filters are missing: search titles only, has image, posted today, bundle duplicates, miles from zip, price min/max, make/model, delivery, etc. Only the top search box exists (1 input in Sift). Cause (checked): the filters are inside `form.cl-search-query`, the same form as the search box, and `findSearch()` does `ctx.used.add(form)`, so the whole form is skipped.
- Carousel dots leak into meta: `p: •••••• · <1hr agocity of san francisco · $119`.
- Glued meta: `<1hr agoVallejo`, `1h agoSan Jose`.
- Two large buttons under every listing (`add to favorites list`, `hide posting`) double each item's height.
- Thumbnails kept (good for listings), price present.

## Interactions tried (11)

Worked: HN comment link and collapse, Bing search, GitHub Closed filter, OSM zoom and search, BBC headline click, Good Food units, Stack Overflow pagination, Wikipedia search, GitHub login typing.
Failed: Google Maps search (Enter in Sift did not submit), BBC "Play video" (no player appeared).

## Patterns

Ranked by harm to users. Causes refer to `src/content/extract/generic.ts`.

1. Main content silently dropped by wrong scoping or over-broad noise rules. The user cannot tell anything is missing.
   - Stack Overflow question gone: `titleH1()` picks the last h1, which can be inside the content (an answer), so `articleScope()` cuts the real title and everything beside it.
   - Recipe times and servings gone: `isChrome()` treats every `role=banner` as chrome, even inside `main`/article.
   - First ingredient gone: `detectItems()` keeps only the majority `signature()` group; siblings with one extra class (`--separator-top`, `--first`, featured) are discarded.
   - MDN tables gone: `figure()` ignores a `<table>` inside `<figure>`.
   - Craigslist filters gone: `findSearch()` marks the whole search form used.
   - GitHub About sidebar gone (side pane beside the main column); Wikipedia portal languages hidden (in `<nav>`).
2. Tool surfaces not shown (maps, players, editors). Google Maps: `mainRoot()` picks a narrow `[role=main]` side panel that excludes the map. OSM/Leaflet: `portalBlock()` only knows `canvas/iframe/video/embed/object`, not tile maps; `role=application`, `.leaflet-container`, `.maplibregl-map` are not treated as working surfaces. Players created after a click (BBC `smp-toucan-player`) and shadow-DOM widgets (MDN "Try it", weather radar) never become portals.
3. Navigation and paging lost. Every `<nav>` is dropped (`isChrome`), so pagination (GitHub issues), repo tabs, search verticals (Bing), and language lists disappear. The Menu (`findNav`) is capped at 60 links and is filled first by header mega-menus, so the needed links often never appear.
4. The card heuristic mangles text and links. `asCard()`/`toItem()`:
   - take the longest link as the item, so a nav bar becomes a fake card linking to the wrong page (GitHub header → /security; "Related guides").
   - move inline links out of sentences into meta ("in a large . … together", "Douglas Crockford's simulated for an object").
   - cut text at ~320 characters with no expand (recipe step).
   - duplicate content as title plus garbled meta (weather cards).
5. Glued words and lost spaces. `inlineOf()` trims `a`/`strong`/`em` text via `textIn()` ("esperaba,Patricia"); labels and meta join sibling text without a separator ("Hacker Newsnew", "264 Branches361 Tags", "1 hr agoEurope", "RadarRadar", "Copyfunction").
6. Signed-out and decorative controls kept as big buttons (Filter by label/author, Up/Down vote, add to favorites/hide posting, display density, Chevron Left), plus fragments ("1.", "| |", "·", "••••", "Copy/Play", icon-font tofu), and promos the patterns miss (YC, Good Food All Access, "Agregar LA NACION en", "Was this page helpful?", Sponsored Content).
7. Structure not fast to absorb: HN rows and comment threads flattened, GitHub file table split into lines, hourly forecast as 40 links, H1 taken from `<title>` with site suffix or from a lead story.
8. AI output unreliable: no Short version on a long La Nación article (likely the stability timer never settles on a mutating page); BBC's covers only a middle chunk because the article block is a sub-container; headline one-liners drop the actual news.
