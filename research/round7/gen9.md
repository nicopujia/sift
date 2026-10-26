# Round 7 findings: gen9

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F757 (high, regression): Allbirds product page lost its whole buy box: no price, colors, sizes or Add to Cart

Found by: T4-generic. Where: https://www.allbirds.com/products/mens-tree-runners

Evidence: Sift shows the H1, 'Final Few', one photo, 'Open image', the description folds, the video and reviews. Its main text has no '$100', no 'Add to Cart' or 'Select a size', 0 size buttons and 0 color swatches. The original's buy box is an <aside> (486x552) inside <main class='template-product' role='none'>: title, $100, 4 color swatches, sizes 8-14, 'SELECT A SIZE' / 'Add to Cart - $100'. As a diagnostic I ran document.querySelector('main').removeAttribute('role') on the live page. Within 4 s, Sift's text had '$100' and 'Add to Cart / Select a size'. Round 6 works.md line 72 had the Navy Night swatch, size 10 and 'Add to Cart - $100' working. Shots: /home/nico/projects/sift-test-4/research/shots/r7t4-allbirds.png vs /home/nico/projects/sift-test-4/research/shots/r7t4-allbirds-orig.png, after removing the role: /home/nico/projects/sift-test-4/research/shots/r7t4-allbirds-norole.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://www.allbirds.com/products/mens-tree-runners wait:15000 "eval:(()=>{const t=document.querySelector('sift-root').shadowRoot.querySelector('main').innerText;return [/\$100/.test(t),/add to cart|select a size/i.test(t)]})()" "eval:document.querySelector('main').removeAttribute('role')" wait:4000 "eval:(()=>{const t=document.querySelector('sift-root').shadowRoot.querySelector('main').innerText;return [/\$100/.test(t),/add to cart|select a size/i.test(t)]})()" prints [false,false], then [true,true].

Suspected cause: Round 6 change to inMain() in src/content/extract/generic.ts (for weather.gov, F636): a <main role='none'> no longer counts as main. isChrome() then treats an <aside> inside it as outside main, so it is site chrome unless orderSummary(). Lead: skip a role=none main only when it wraps the site header or nav (as on weather.gov), or never treat an aside with a price, fields or an add-to-cart button as chrome.

Skeptic: Reproduced twice. On the Allbirds Tree Runner page, Sift's main text has no '$100' and no 'Add to Cart' or 'Select a size'. The whole Sift root has only 14 buttons (Menu, View Cart, Open image, the folds, video controls), with no sizes and no swatches. The original's <main role='none' class='template-product ...'> holds an <aside> with the title, $100, the color, sizes 8-14 and 'SELECT A SIZE'. After document.querySelector('main').removeAttribute('role'), Sift's text has [true,true] within 5 s. The 'role none/presentation' branch in inMain() is in research/round7/round6-fixes.diff (round 6, for weather.gov), so this is a regression. High: the store can no longer be bought from. Shot: research/shots/skeptic-allbirds.png.

Skeptic's fix lead: In src/content/extract/generic.ts, inMain() should skip a <main role=none|presentation> only when it wraps the site's header or nav (as on weather.gov). Or isChrome() should never treat an aside as chrome when it holds a price, size/variant controls or an add-to-cart button: extend the orderSummary() check to a product buy box.

## F759 (high): Discourse thread: a second post by the same author shows no author name

Found by: T4-generic. Where: https://users.rust-lang.org/t/is-ai-actually-getting-that-good/143208

Evidence: After one End press, the original has 8 posts loaded: burumdev, khimru, jumpnbrownweasel, notriddle, MOCKBA, Jookia, ZiCog, khimru. In Sift the last post (khimru's 581957) reads 'copy a link to this post to clipboard / 2d / ZiCog: …' with no author line, while every other post has one. Walking down with PageDown (16 steps), up to 3 posts in view at once had no author. Each one was an author's second post among the loaded posts (burumdev, ZiCog, khimru, MOCKBA). First posts and reply-to names show correctly. HN thread authors match the original for all 665 comments, so this is Discourse-specific. Shots: /home/nico/projects/sift-test-4/research/shots/r7t4-discourse-noauthor.png, /home/nico/projects/sift-test-4/research/shots/r7t4-discourse-end.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://users.rust-lang.org/t/is-ai-actually-getting-that-good/143208 wait:9000 press:End wait:4000 "eval:(()=>{const L=document.querySelector('sift-root').shadowRoot.querySelector('main').innerText.split('\n').map(s=>s.trim()).filter(Boolean);const a=L.map((l,i)=>[l,i]).filter(([l])=>/^\d+[dhm]$/.test(l));return {posts:a.length,noAuthor:a.filter(([l,i])=>/^(copy a link to this post to clipboard|like this post)$/.test(L[i-1])).length}})()" prints {posts:8,noAuthor:1}. A walk script that compares each step is at /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/t4r7/disc-walk.ts.

Suspected cause: Unverified. A dedupe across posts drops the repeated author link. One candidate is repeatCard() in src/content/extract/generic.ts: the same href with the same title counts as the same story, and ctx.cards (a Map) is shared through the {...ctx} spread used for each post.

Skeptic: Reproduced with my own walk (PageDown steps) on the Discourse thread. At several steps Sift showed (NONE) where the original had an author, always on an author's second post among the loaded posts. Examples: step 10 orig '...,ZiCog,burumdev' vs Sift '...,ZiCog,(NONE)'. Step 20 orig 'ZiCog,khimru,MOCKBA,ZiCog,ZiCog,shinaoka Anlis,khimru' vs Sift 'ZiCog,khimru,MOCKBA,(NONE),(NONE),shinaoka Anlis,(NONE)'. In a targeted check, post 581903 (burumdev, 'That's not reality though. It is a fantasy.') shows in Sift as 'copy a link to this post to clipboard / 2d / ZiCog: / go to the quoted post' with no author (research/shots/skeptic-disc-noauthor.png). A single End press loaded only 7 posts for me, all with authors, so the exact repro command is timing-dependent, but the defect itself is solid. In Sift, author names render as <a> in ul.links (link entries). High: in a discussion, who said what is content.

Skeptic's fix lead: In src/content/extract/generic.ts, the page-wide link dedupe key 'link:'+href+'|'+label in visit() (the case 'a' branch near line 3662, and the single-link text-block branch near line 3748; also linkOnly lists near 4503) drops the repeated author link. Scope that dedupe to one post (reset ctx.seen per post unit / postUnits), or skip it for a post's author/profile link. I did not verify which of these exact spots fires. repeatCard() is less likely, because the names are rendered as links, not items.

## F760 (medium): HN Search: several submissions of the same link collapse into one result

Found by: T4-generic. Where: https://hn.algolia.com/ (also seen once on docs.python.org/3/search.html?q=glob)

Evidence: For the query 'Debunking Faster Than Rust Malicious Benchmarks', the original lists 4 stories: addidotlol (5 points, 1 comment), ibobev (3 points), birdculture (3 points) and theanonymousone (2 points). Sift shows 1 item. On 'rust' sorted by Date, page 2: original 30 stories, Sift 28. Two of the three 'Debunking…' submissions are missing, including addidotlol's, the only one with a comment. This differs from works.md line 81 ('page 2 ... 30 items'). On Python docs search 'glob', 'fnmatch — Unix filename pattern matching' (library/fnmatch.html#index-3) is missing, because another result has the same title and another anchor. Shot: /home/nico/projects/sift-test-4/research/shots/r7t4-hns-dupes.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts "goto:https://hn.algolia.com/?q=Debunking%20Faster%20Than%20Rust%20Malicious%20Benchmarks" wait:7000 "eval:[document.querySelectorAll('.Story').length, document.querySelector('sift-root').shadowRoot.querySelectorAll('li.item').length]" prints [4,1].

Suspected cause: repeatCard() in src/content/extract/generic.ts drops an entry with the same href and the same title as an earlier one (and, for long titles, the same href without its #fragment). Reposts and same-page search hits are separate entries, with different points, author, comments link or anchor.

Skeptic: Reproduced twice: [4,1]. The original's 4 stories are the same link and title with different authors and points (addidotlol 5, ibobev 3, birdculture 3, theanonymousone 2). Sift shows only addidotlol's. On Python docs search 'glob', the original has 88 result links and Sift 83. 'fnmatch — Unix filename pattern matching' appears twice in the original (library/fnmatch.html and #index-3) and once in Sift. repeatCard()'s own comment says 'two listings with one title (a repost) are two', but its href->titles map catches them first. Medium: search results silently lose entries.

Skeptic's fix lead: In src/content/extract/generic.ts repeatCard(), do not treat same-href + same-title as a repeat when the two cards' other text differs (author, points, date, comments link, snippet) or their source elements are siblings in one results list. Keep the dedupe for carousel clones and second modules only.

## F761 (medium): Discourse post screenshot is replaced by a filename link

Found by: T4-generic. Where: https://users.rust-lang.org/t/is-ai-actually-getting-that-good/143208 (Anlis's post #2)

Evidence: The original post shows a 518x500 screenshot (a.lightbox > img, alt 'signal-2026-10-18-101319'). The post ends 'I'm agree with that screenshot', and a later post says 'Read the picture in post #2'. Sift's main has 0 images. The post shows only a link with the text 'signal-2026-10-18-101319'. The spec keeps images that are content. Shot: /home/nico/projects/sift-test-4/research/shots/r7t4-disc-reply1.png (the link above the 'This post has 1 reply' row)

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://users.rust-lang.org/t/is-ai-actually-getting-that-good/143208 wait:9000 "eval:[document.querySelectorAll('.cooked a.lightbox img').length, document.querySelector('sift-root').shadowRoot.querySelectorAll('main img').length]" prints [1,0].

Suspected cause: 

Skeptic: Reproduced: [1,0]. Post #2's a.lightbox wraps a 518x500 img (alt 'signal-2026-10-18-101319'), and the post says 'I'm agree with that screenshot'. Sift renders it as a plain link 'signal-2026-10-18-101319' in a ul (research/shots/skeptic-disc-img.png) and drops the picture. The image is content. In the code, visit()'s case 'a' takes the image path only when the link has no text (!textIn(el)). Discourse's lightbox has a .meta block with the filename and size, so it falls through to out.link(label).

Skeptic's fix lead: In src/content/extract/generic.ts visit() case 'a': when a link wraps a visible content-sized <img> (say >=150 px) and its own text is only the image's filename/meta (equal to the img alt or the link title, plus size info), push an img block (alt, href to the full image) instead of out.link.

## F763 (medium): GitHub Status: 'Subscribe to Updates' is missing from Sift

Found by: T4-generic. Where: https://www.githubstatus.com/

Evidence: The original's header has 'Subscribe to Updates' (a.show-updates-dropdown), which opens the email, SMS, Slack, webhook and feed options. Sift's root has no 'subscribe' text anywhere. The body has no such control, and the Menu lists Help, Community, Status, GitHub.com, Contact support, Privacy Policy, Terms, support site, Atom Feed and RSS Feed. Only the feeds remain. The rest of the page is complete: 12 components with uptime and incidents, Incident History, and 'Show All 19 Incidents' works.

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://www.githubstatus.com/ wait:7000 "eval:/subscribe/i.test(document.querySelector('sift-root').shadowRoot.textContent)" click:Menu wait:1000 outline prints false, and the Menu has no Subscribe.

Suspected cause: 

Skeptic: Reproduced. Sift's root has no 'subscribe' text, and the Menu lists Help, Community, Status, GitHub.com, Contact support, Privacy/Terms, support site, Atom Feed and RSS Feed, with no Subscribe. The original's header nav has a#show-updates-dropdown (role=button, aria-haspopup=dialog, href='#', 'Subscribe to Updates'). findNav() in generic.ts deliberately skips labels matching /^(subscribe|...)/ as paid-subscription appeals, and the control is a href='#' button, not a place. On a status page, subscribing to updates is a main feature, not a promo. Medium.

Skeptic's fix lead: In src/content/extract/generic.ts, keep a header control that opens a dialog (role=button / aria-haspopup=dialog) as an action in the bar or the Menu. In findNav(), narrow the subscribe filter to paid or newsletter appeals (e.g., not when the label says 'updates', 'alerts' or 'notifications').

## F636 (still open, partly; original repro in /home/nico/projects/sift/research/round6/*.md)

Recheck by T4-generic: Fixed: the NWS site nav (FORECAST ... ABOUT plus submenus) is now in the Menu, and the field is labelled 'get forecast', not 'inputstring'. Still open: at 900 px the view shows the H1, field, Go, 'View Location Examples', office link, News Headlines and hazard link first. 'Current conditions at' is at y=616 (was 795) and 'Today · High: 65 °F' at y=1281 (was 1461). The original shows current conditions at y=414 and the 7-day strip at y=665, both on its first screen. Shots: /home/nico/projects/sift-test-4/research/shots/r7t4-nws-top.png vs /home/nico/projects/sift-test-4/research/shots/r7t4-nws-orig.png

Skeptic: Status 'partly fixed' confirmed at 1280x813. Fixed: the site nav is no longer in main, and the field is labelled 'get forecast'. Still open: main starts with 'get forecast', Go, 'View Location Examples', the office link, 'News Headlines' and the hazard link. 'Current conditions at' is at y=616, the same as the claim, with the temperature just above the fold. The 7-day strip ('This Afternoon · High: 65 °F') is at y=1281, about 1.6 screens down. The original has current conditions at y=330 and the 7-day at y=538, both on its first screen. Shot: research/shots/skeptic-nws.png.

Skeptic's fix lead: In src/content/extract/generic.ts, treat weather.gov's header widgets (the location search form, 'Your local forecast office is', News Headlines) as site chrome. Move them to the bar or Menu, or after the forecast, so current conditions and the 7-day strip come first.
