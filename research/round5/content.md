# Round 5 findings: content

Each was reproduced by a skeptic. F5xx are new in round 5; F3xx and F<100 are older findings a round 5 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F501 (high): Python docs search results are shortened into an AI Short version that drops the main results and names the wrong query

Found by: T4-generic. Where: https://docs.python.org/3/search.html?q=glob and ?q=thread (reached from Sift's search box on the pathlib page)

Evidence: For q=glob, the default view is 'SHORT VERSION / Show full text'. It has 39 links, while the original has 88 results. glob.glob and glob.iglob, the most relevant results, are missing. The model wrote 'Search results for Python names and features related to “global,”…'. For q=thread, the Short version has 223 links against 467 results and says 'Search results for “thread-safe” and “thread state”'. In both cases Sift has 0 li.item. 'Show full text' brings back all 88. A short result list (q=walk, 36 results) is not shortened. This is the F340 problem, now fixed on GOV.UK, showing up on another site. Shots: /home/nico/projects/sift-test-4/research/shots/r5t4-pydocs-search.png, /home/nico/projects/sift-test-4/research/shots/r5t4-pydocs-search-thread.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts 'goto:https://docs.python.org/3/search.html?q=glob' wait:45000 "eval:(()=>{const s=document.querySelector('sift-root').shadowRoot.querySelector('article.short');return [!!s, s&&s.querySelectorAll('a').length, s&&/glob\.glob/.test(s.innerText), document.querySelectorAll('#search-results li').length]})()" gives [true,39,false,88].

Suspected cause: The search-page exclusion added for F340 does not match Sphinx search pages (/search.html?q=, ul.search > li results). The results list is not detected as items, so it passes the condense gate as prose once it is long enough.

Skeptic: Reproduced on q=glob: [Short version shown, 39 links, glob.glob absent, 88 original results, 0 li.item]. The original's top results are 'glob (Python module)', 'glob.glob (Python function)' and 'pathlib.Path.glob (Python method)'. None of the three is in the Short version. It starts '7. Simple statements | glob — Unix style… | pathlib…' and adds model text: 'Search results for Python names and features related to “global,”…'. On q=thread the Short version is also the default: 201 links against 467 results, 0 li.item. The results list is condensed as prose instead of kept as a result list.

Skeptic's fix lead: In src/content/extract/generic.ts, make proseArticle() return false for search-result pages. Two ways: recognize a Sphinx results list (ul.search > li, #search-results) as items, or mark any article on a page with a filled search field in the URL (?q=) and a results list of more than 10 links as not prose. ai.ts then never condenses it.

## F502 (high): Craigslist listing page loses the photos and the reply button; a large map fills the first screen

Found by: T4-generic. Where: Any listing opened from https://sfbay.craigslist.org/search/sss?query=bike, e.g. https://www.craigslist.org/view/d/oakland-classic-burley-bee-single-seat/2Gf7rAhCWvVuE1cpw8KXCQ

Evidence: I checked 2 listings. The original shows a 600x450 photo gallery (div.gallery, 602 px wide) with thumbnails, and a 'reply' button (the only way to contact the seller). It also has favorite, hide, flag, share and print, plus prev/next listing links. Sift has 0 img and no reply button. Its only buttons are Skip to content, Menu and the switch. Its only portal is the map, which is 756x712 px and fills the first screen. The title, price, attributes and description are kept. Shots: /home/nico/projects/sift-test-4/research/shots/r5t4-cl-listing.png vs /home/nico/projects/sift-test-4/research/shots/r5t4-cl-listing-orig.png, and /home/nico/projects/sift-test-4/research/shots/r5t4-cl-listing2.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts 'goto:https://sfbay.craigslist.org/search/sss?query=bike' wait:9000 'click:li.item a' wait:8000 "eval:[document.querySelector('sift-root').shadowRoot.querySelectorAll('img').length, [...document.querySelector('sift-root').shadowRoot.querySelectorAll('button,a')].filter(b=>/reply/i.test(b.textContent)).length, [...document.querySelectorAll('img')].filter(i=>/images\.craigslist/.test(i.src)&&i.getBoundingClientRect().width>150).length, [...document.querySelectorAll('button')].filter(b=>b.checkVisibility()&&/reply/i.test(b.textContent)).length]" gives [0,0,≥1,1].

Suspected cause: The gallery (div.gallery / swipe carousel) is likely treated as decoration and the reply button as toolbar chrome (it sits in the post's action bar with favorite/hide/flag/share).

Skeptic: Reproduced on 2 listings: the one the search link opened (mini rocker BMX bike) and the claim's Burley Bee URL. Both gave [0 Sift img, 0 reply controls, 2 original images wider than 150 px, 1 visible original reply button]. Sift's outline for each is: H1, map portal (756x713), attributes, description, post id, best of. There are no photos, no reply button, and no favorite, hide, flag, share, print or prev/next. The original screenshot shows the photo, its thumbnails, the reply button at the top and the small map. In Sift the map fills the first screen.

Skeptic's fix lead: In src/content/extract/generic.ts, keep the listing's gallery images (div.gallery / .swipe slides from images.craigslist.org) as content images. Keep the post's 'reply' button as an action and do not drop it as toolbar chrome together with favorite, hide and flag. Consider keeping the map portal smaller, or placing it after the photos.

## F507 (medium): OpenStreetMap wiki: the first 1,300 px are wiki chrome (skip links, Help, a 29-language list) before the content

Found by: T4-generic. Where: https://wiki.openstreetmap.org/wiki/Key:highway

Evidence: After the H1, Sift shows the links 'Jump to navigation', 'Jump to search' and 'Help'. Then come the bullets 'Key:highway' and 'In other languages', then 29 language links one per line (Bahasa Indonesia … 粵語) and 'Other languages…'. The page's photo and description table only start at about y=1360 at 1280x900. The navboxes at the end are removed correctly. Shot: /home/nico/projects/sift-test-4/research/shots/r5t4-osmwiki.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/visit.ts https://wiki.openstreetmap.org/wiki/Key:highway x --wait 12000; the outline's first 40 lines are 'Jump to navigation', 'Jump to search', 'Help', 'In other languages' and the language links.

Suspected cause: MediaWiki's mw-jump-link skip links and the in-content Template:Languages bar (a table/div of language links) are not caught by the wiki-chrome rules that already work on Wikipedia.

Skeptic: Reproduced. After the H1, the outline is 'Jump to navigation', 'Jump to search', 'Help', 'Key:highway', 'In other languages', then 29 language links one per line and 'Other languages...'. Sift's first image (the page photo) starts at y=1361, and the 'Description' row at about y=1603, at 1280x900. The whole first screen is wiki chrome. The language bar is div.languages.LanguageBarRoot (classes 'noprint navigation-not-searchable'). The jump links are a.mw-jump-link.

Skeptic's fix lead: In src/content/extract/generic.ts, drop a.mw-jump-link skip links and the MediaWiki language bar (.LanguageBarRoot, or any .noprint.navigation-not-searchable block of language links) as chrome, the way Wikipedia's chrome is dropped. Or fold it into a closed 'In other languages' section at the end.

## F346 (still open, partly; original repro in /home/nico/projects/sift/research/round4/*.md)

Recheck by T4-generic: The repro now gives [true,true]: 'Incident History' and the au/eu/jp/us.githubstatus.com links are present, and 0 'Operational' buttons remain. The 'Incident History' link opens /history, which reads well. But the 90-day bars still lose every incident day. Actions has 90 bars in the original: 83 green, 4 red (#dc3545) and 3 yellow. Sift shows only '90 days ago · 99.29 % uptime · Today' and 'Normal'. Shot: /home/nico/projects/sift-test-4/research/shots/r5t4-ghstatus.png

Skeptic: The 'partly' status holds. The repro now gives [true,true] ('Incident History' and the regional githubstatus.com links are present), and there are 0 'Operational' buttons. But Actions still has 90 bars in the original (83 #28a745 green, 4 #dc3545 red, 3 yellow or olive), while Sift shows only 'Operational · 90 days ago · 99.29 % uptime · Today · Normal'. The incident days are lost.

Skeptic's fix lead: In src/content/extract/generic.ts, where the status-page uptime bars are reduced to the uptime line, also list the days that are not green: each bar's date and its tooltip (incident names), for example as a short 'Incidents: Oct 3 (major), …' list per component.

## F326 (still open, partly; original repro in /home/nico/projects/sift/research/round4/*.md)

Recheck by T3-tools: Fixed: the thread is now a run of articles in order (author, date, paragraphs, lists, blockquotes 6/6). The #1899 description 'Same logic with different libraries…' is present after SPA navigation from the issues list. #4416 has 3/3 <pre>. Still wrong: (1) #4416 keeps the noise links/buttons "@trusktr's profile", 'trusktr' (twice), 'Last edited by trusktr' and 'Issue body actions' above the body. (2) #1899 has 8/9 code blocks. The missing one sits inside a quote: '// Controlled, because Preact manages the input's value now <input value={someValue} onInput={myEventHandler} />;' is flattened into the quote paragraph. Shot: /home/nico/projects/sift-test-3/research/shots/R5-T3-gh-issue-top.png

Skeptic: Partly fixed, and both leftovers reproduce. #4416 (direct load): the thread is articles in order, with 3 of 3 <pre>. But "@trusktr's profile", 'trusktr', 'Last edited by trusktr' and 'Issue body actions' still sit above the body. #1899 (direct load): Sift has 8 <pre>, the page has 9. The missing one is inside a blockquote, and Sift renders the quote with the code flattened into it: '…use Controlled Components at all times." // Controlled, because Preact manages the input's value now <input value={someValue} onInput={myEventHandler} />;' (no pre inside). Both are lower severity than the original high.

Skeptic's fix lead: generic.ts: when walking a blockquote, emit the <pre> inside it as a code block, not as quote text. In the comment-thread branch, drop the author avatar link ('…'s profile'), the duplicate author link, and the 'Last edited by' / 'Issue body actions' buttons at the head of each comment.
