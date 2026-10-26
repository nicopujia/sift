# Round 7 findings: ext8a

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F735 (high, regression): filterPanel folds a product's buy box, or any narrow form column above a site footer, into a collapsed 'Filters' section

Found by: R1-extractor. Where: src/content/extract/generic.ts:2839 (filterPanel), used at generic.ts:3275

Evidence: Fixture product-footer.html: a product page whose 35%-wide div.info holds the h1, price, description, 4 color radios, 4 size radios, quantity and 'Add to cart', followed only by a footer with 14 links. Now: 'h1: Trail Runner 3', then 'section: Filters (collapsed)' holding the price, description, the whole form and 'Add to cart'. Before round 6, all of it showed. Real extension (9468): the outline is 'H1 Trail Runner 3 / H2 Filters', and act 'click:Add to cart' says 'not found'. Same result with a reviews list after the product instead of the footer (product-buybox.html). An email-preferences page (prefs2.html: a 480px div.card with 8 checkboxes and Save, then a 14-link footer) has its only content folded into 'Filters' too.

Repro: Fixtures are in /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7/fx/. Run: cd that r7 folder && bun run.ts now.js,pre.js fx/product-footer.html 1 --as http://shop.fixture.test/p/x. now.js is built from sift-test-8 src. pre.js is the tree before the round 6 fixes, rebuilt by reversing round6-fixes.diff.

Suspected cause: filterPanel accepts any div, section, aside or fieldset 120px to 40%vw wide and at least half the window tall, with 6 or more visible fields and 4 or more choices, when some later sibling of any of its 4 ancestors is 1.5x wider and holds 10 or more links. The site footer after <main> always passes. Nothing checks that the wide sibling is a results list beside the panel, or that the panel does not hold the page's h1 or a submit or buy button. On Craigslist, the case it was made for, the h1 is lifted out of the panel.

Skeptic: Reproduced. Harness on product-footer.html: now gives 'h1: Trail Runner 3' then 'section: Filters (collapsed)' holding the price, description, the whole form and Add to cart. pre.js shows all of it in the open. product-buybox.html gives the same result, and prefs2.html folds the whole preferences card (8 checkboxes and Save) into 'Filters'. Real extension on 9468 with the fixture served at http://shop.fixture.test/p/x: the outline is 'H1 Trail Runner 3 / H2 Filters', and act 'click:Add to cart' returns 'not found'. The code at generic.ts:2839 matches the suspected cause: any div/section/aside/fieldset 120px to 40%vw wide and at least half the window tall, with 6+ visible fields and 4+ choices, passes when some later sibling of one of 4 ancestors is 1.5x wider and holds 10+ links. A footer is enough. filterPanel does not exist in the pre tree, so this is a regression. Scope: I replicated the geometry test on 3 real product pages (Shopify Dawn demo x2, Patagonia) and none triggered it. The Dawn pages render the buy box open. Real-world frequency is unproven, but the fold hides the page's main action when the test matches.

Skeptic's fix lead: In filterPanel (generic.ts:2839), reject a panel that contains the page's h1 or a submit / buy button ('Add to cart', 'Save'). Require the wider sibling to be a results list (resultList(s), or a child of s that is one) instead of any box with 10+ links. A footer or [role=contentinfo] should never qualify.

## F736 (high, regression): The games-tile rule deletes real stories in a news site's Games section (The Guardian's 'What to play')

Found by: R1-extractor. Where: src/content/extract/generic.ts:2706

Evidence: Live https://www.theguardian.com/international, 'What to play' section. Before round 6 it had 4 items. Now 3 are gone: 'Lara Croft is 30! ...', 'Call of Duty: Modern Warfare 4 review ...' and 'Nintendo Switch Sports Resort review ...'. Each has meta 'Games' and a link /games/2026/oct/../... Only 'Pushing Buttons' stays. Real extension: all three are in document.body text but not in Sift's text. Minimal fixture games.html (4 cards, kicker 'Games', links /games/2026/oct/2N/story-N): now 1 item, before round 6 4 items.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js,pre.js fx/games.html 1 --as http://news.fixture.test/international

Suspected cause: The rule promo()s any card whose meta contains exactly 'Games' and whose main link path starts with /games/. That fits La Nación's puzzle tiles, but also every story in a newspaper's video-game section. It needs a game-like signal: a Play/Jugar call to action (already caught by PLAY_CTA), or a path that is not a dated story.

Skeptic: Reproduced in harness and live. Fixture games.html: now gives 1 item (Pushing Buttons), pre gives all 4. Live https://www.theguardian.com/international in the real extension: the 'What to play' section shows only the Pushing Buttons story. The visible links /games/2026/oct/25/lara-croft-is-30..., /games/2026/oct/23/call-of-duty-modern-warfare-4-review... and /games/2026/oct/22/nintendo-switch-sports-resort-review... appear neither as links nor as text in Sift's shadow root. The rule at generic.ts:2706 promo()s any card with meta exactly 'Games' and a path starting /games/. The pre tree has only the PLAY_CTA rule, so this is a regression and real stories are silently lost.

Skeptic's fix lead: At generic.ts:2706, also require a game signal: a PLAY_CTA action or meta, or a path that is not a dated story (exclude /games/YYYY/... and paths with a long slug). Better still, require that the card has no teaser or byline.

## F737 (high, regression): marketingModal hides a session-expiry alert dialog ('Sign in again ... to save your changes')

Found by: R1-extractor. Where: src/content/extract/generic.ts:5807-5816 (MARKETING, marketingModal), used at generic.ts:5716

Evidence: Fixture session.html: a role=alertdialog with aria-modal and an × Close button. It says 'You have been inactive for 28 minutes. Sign in again within 2 minutes to save your changes, or they will be lost.' and has a 'Sign in again' button. Before round 6: 'DIALOG: Your session is about to expire', with Close and 'Sign in again'. Now: no dialog. Real extension: no element in Sift's shadow root holds that text, and Sift shows the edit form as if nothing happened.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js,pre.js fx/session.html 1 --as http://blog.fixture.test/admin/edit/42

Suspected cause: The MARKETING alternative '\b(sign in|log in|sign up|register)\b.{0,80}\b(save|...)\b' matches any 'sign in ... save' sentence. Any page-opened dialog with a close button and no field is then skipped. Nothing excludes role=alertdialog or words about the user's own work ('save your changes', 'will be lost').

Skeptic: Reproduced. Harness on session.html: pre gives 'DIALOG: Your session is about to expire' with Close and 'Sign in again'. Now gives no dialog. Real extension: Sift shows only the Edit post form, and no text of the dialog is in its view. Same in the real extension with the existing fixture http://127.0.0.1:8799/fx/r7-sessionsave.html: the role=dialog 'Your session has expired / Sign in again to save your changes' is visible on the page (checkVisibility true) but missing from Sift. In the harness, pre shows it and now does not. The cause is MARKETING's 'sign in ... save' alternative plus the close-button test in marketingModal (generic.ts:5807-5816), used at 5716. marketingModal is new in round 6.

Skeptic's fix lead: In marketingModal (generic.ts:5811), return false for role=alertdialog, and when the text speaks of the user's own work or account state ('your changes', 'will be lost', 'session', 'expired', 'unsaved'). Tighten the MARKETING sign-in alternative to money words only (discount, deal, offer, reward, price, 'save N%' or 'save $'), not a bare 'save'.

## F740 (medium, regression): besideArticle unfolds a news article's side rail: 180 'TOP STORIES' entries now follow the story, open

Found by: R1-extractor. Where: src/content/extract/generic.ts:4239-4250 (besideArticle in itemsInto)

Evidence: Snapshot http://127.0.0.1:8799/dailymail-article-video.html. Before round 6: 'section: TOP STORIES (collapsed)'. Now: 'h2: TOP STORIES' and 180 items, open, right after the article and its comments. Real extension: h2 'TOP STORIES' and 180 li.item. With only besideArticle forced to false, the section folds again. This is the only snapshot or fixture that changed this way, but any news page whose rail sits beside the story column behaves the same.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js,pre.js http://127.0.0.1:8799/dailymail-article-video.html 1 | grep -n 'TOP STORIES'

Suspected cause: besideArticle treats every list in a column beside the article as facts about the page (meant for GitHub's About and Releases). A news site's 'Top stories' or 'Most read' rail is beside the story too. It needs a test that the rail's entries are about this page (few entries, no story links), or a cap on entries.

Skeptic: Reproduced. Harness on the dailymail-article-video snapshot: pre shows 'section: TOP STORIES (collapsed)', now shows 'h2: TOP STORIES' followed by open items. Real extension: h2 TOP STORIES followed directly by an ol.items with 180 li, open, after the article and the collapsed Comments. The code at generic.ts:4249 sets folded = afterArticle && !inArticle && !besideArticle(el), and besideArticle (4239) is true for any list in a column beside the story. besideArticle is not in the pre tree, so this is a regression. Severity is medium: it adds noise after the story but loses nothing.

Skeptic's fix lead: In besideArticle or at its use in itemsInto (generic.ts:4249), unfold only when the rail is short (for example 12 or fewer entries) and its entries do not link to other stories (dated same-site article paths). Otherwise fold it as before.

## F741 (medium, regression): bulkBar keeps a promo bottom bar whenever any checkbox in any li or tr is checked

Found by: R1-extractor. Where: src/content/extract/generic.ts:535 (bulkBar fallback), used at generic.ts:553, 3401, 5546

Evidence: Fixture bottombar.html: search results with a checked 'Hydro' brand filter in a li, plus a fixed full-width bottom bar: 'Members get free two-day delivery on every order, plus early access to sales. [Join for $5 a month] [Maybe later]'. Before round 6 the bar was dropped as a small fixed bar. Now it shows as a paragraph and two buttons at the end of the page, in the harness and in the real extension. popupLike also returns false for any such bottom bar, so a bottom sheet the user opens on such a page is no longer a popup.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js,pre.js fx/bottombar.html 1 --as 'http://shop.fixture.test/s?q=bottle'

Suspected cause: bulkBar accepts the bar when SELECTED_COUNT matches its text OR document.querySelector('tr input[type=checkbox]:checked, [role=row][aria-selected=true], li input[type=checkbox]:checked') finds anything anywhere. Filter lists and settings often have a checked box in a li. The fallback should require the checked rows to be in a list or table the bar acts on, or require the count text.

Skeptic: Reproduced. Harness on bottombar.html: now ends with 'p: Members get free two-day delivery ...' and 'actions: Join for $5 a month | Maybe later'. pre drops the bar. Real extension: the same paragraph and two buttons are at the end of Sift's text. Control: with the 'Hydro' facet unchecked, the bar is dropped again. So the li checkbox fallback in bulkBar (generic.ts:535) is the trigger. bulkBar is new in round 6. The popupLike sub-claim (generic.ts:5546) is read from code only and was not run. Medium: a promo bar comes back on any filtered results page, and nothing is lost.

Skeptic's fix lead: In bulkBar (generic.ts:535), drop the document-wide fallback, or limit it: require SELECTED_COUNT text, or require at least 2 checked rows in a table or list that holds the item rows the bar acts on (not a facet or filter list, and not inside an aside or filter panel). The same tightening then fixes popupLike at 5546.

## F742 (medium, regression): An all-caps call-to-action link in a story is moved into the folded 'More links' section

Found by: R1-extractor. Where: src/content/extract/generic.ts:3531-3537

Evidence: Fixture capslink.html: a city notice with a paragraph that holds only the link 'APPLY FOR THE STORM RELIEF GRANT ONLINE' (to /grants/storm-relief/apply), between its paragraphs. Before round 6 it stayed in place as a link. Now it is gone from the story and appears under 'section: More links (collapsed)' after it, so the page's main action is behind a fold.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js,pre.js fx/capslink.html 1 --as http://city.fixture.test/news/storm-relief

Suspected cause: The F648 rule treats any one-link paragraph in capitals (20 or more characters, 4 or more words) as a link to another story. It does not check that the target looks like a story (a same-site article path), or that the words are not a call to action (apply, register, download, read the full ...).

Skeptic: Reproduced. Harness on capslink.html: pre keeps 'p: [APPLY FOR THE STORM RELIEF GRANT ONLINE ->/grants/storm-relief/apply]' in place. Now drops it from the article and lists it under 'section: More links (collapsed)'. Real extension: the Short version and the full text (after 'Show full text') both lack the link. It appears only after expanding 'More links'. The rule at generic.ts:3531-3537 (F648) is new in round 6. Medium: the page's main action moves behind a fold.

Skeptic's fix lead: In the F648 branch (generic.ts:3531), skip relatedLink when the link text starts with a call-to-action verb (apply, register, sign up, download, donate, read the full, view, buy, book) or the href is not a story-like same-site article path (dated, or a long slug under a news section).
