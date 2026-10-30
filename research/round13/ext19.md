# Round 13 findings: ext19

F13xx are new in round 13. Findings from R1 were not checked by a skeptic: reproduce them before changing code. The suspected cause and fix are leads, not orders.

## F1305 (high): A site-header search form with more than one field keeps only its text box: the location, dates and guests fields are dropped

Found by: R1-extractor. Where: src/content/extract/generic.ts:6655 (findSearch moves only the box and button) with :572 (isChrome drops the header holding the rest of the form)

Evidence: Fixture /home/nico/projects/sift/research/fixtures/r13rx-whatwhere.html: header form with Find and Near (value 'San Francisco, CA') and a Search button. Sift's only field is 'Find='. The original has 'Find=' and 'Near=San Francisco, CA'. Harness outline: 'search: Find', with no Near field anywhere (r10m is the same). Live USAJOBS results (https://www.usajobs.gov/search/results/?k=nurse&l=Boston%2C%20Massachusetts): Sift's inputs are 'Search=nurse' only. The original header has visible k and l fields ('Where do you want to work?'), so a new location cannot be typed (shot research/shots/r13rx-usajobs-location.png in sift-test-8). Live airbnb.com home: the original's header search has Where, When ('Add dates') and Who ('Add guests'). Sift has only 'Search destinations' and Search, and no date or guest control anywhere (shots r13rx-airbnb.png, r13rx-airbnb-orig.png). The code comment at 6655 says the rest of the form stays in the page content, but a form inside <header> is chrome and is dropped whole.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r13ext && bun run.ts r13.js $PWD/fx/yelpish.html 1 --as http://127.0.0.1:8799/fx/zz-yelpish.html ; or SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/act.ts goto:http://127.0.0.1:8799/fx/r13rx-whatwhere.html wait:3000 "eval:[...document.querySelector('sift-root').shadowRoot.querySelectorAll('input')].map(e=>e.placeholder+'='+e.value)"

Suspected cause: findSearch takes the search box out of its form. The form's other visible fields, selects and picker buttons are never walked when the form sits in a header or banner. Lead: when pick.form (or the smallest box holding the box and its button) has other visible fields or pickers, show them, either beside the search in the bar or as a form block at the top of the content.

Skeptic: NOT checked by a skeptic (the skeptic hit the usage limit). Reproduce it first; if you cannot, report not_fixed with what you saw and change nothing.

Skeptic's fix lead: 

## F1306 (high): Definition-list terms with several links lose all their links: on arXiv listings no paper can be opened

Found by: R1-extractor. Where: src/content/extract/generic.ts:5948 (dt read as textIn), :5939 (blocky dd: dt pushed as bold text), :3682 (resultDefs needs exactly one link per dt)

Evidence: Live https://arxiv.org/list/cs.AI/recent in the real extension: Sift has 0 of the original's 100 /abs/ and /pdf/ links. Each entry's dt ('<a href=/abs/2610.35868>arXiv:2610.35868</a> [<a href=/pdf/…>pdf</a>, <a>html</a>, <a>other</a>]') shows as plain text, either as a facts key ('[1] arXiv:2610.35868 [pdf, html, other]: …') or as a bold paragraph ('*[3] arXiv:2610.35847 [pdf, html, other]*'). The titles are not links on arXiv, so nothing opens a paper (shot research/shots/r13rx-arxiv.png). r10m gives the same outline. resultDefs rejects these dts because each has 4 links. defs() then keeps only textIn(dt), and the facts row key is a plain string.

Repro: SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/act.ts goto:https://arxiv.org/list/cs.AI/recent wait:6000 "eval:[...document.querySelector('sift-root').shadowRoot.querySelectorAll('a')].filter(a=>/\/abs\/|\/pdf\//.test(a.getAttribute('href'))).length"  → 0 (the original has 100).

Suspected cause: defs() reduces every <dt> to its text. Lead: when a dt holds links, emit it as a paragraph from inlineOf(dt) (as the blocky branch already does for its position), or let a facts key carry Inline[].

Skeptic: NOT checked by a skeptic (the skeptic hit the usage limit). Reproduce it first; if you cannot, report not_fixed with what you saw and change nothing.

Skeptic's fix lead: 

## F1307 (medium, regression): A sign-out link now takes one of the top bar's 4 slots, so a signed-in header can push the Cart into the Menu

Found by: R1-extractor. Where: src/content/extract/generic.ts:6894 (findTop stops at 4 in page order); sign-out words added to TOP_LABEL at :6840-6841

Evidence: Fixture /home/nico/projects/sift/research/fixtures/r13rx-signedin.html: header links 'Hello, Jane · Account', Orders, Sign out, Notifications, 'Cart (2)'. Current: 'top: …Account | Orders | Sign out | Notifications', 'nav(2): Shop | Cart (2)'. Before round 12 (r12.js): 'top: …Account | Orders | Notifications | Cart (2)', with Sign out in the nav. The real extension's bar confirms: '… | Orders | Sign out | Notifications', and no Cart in the bar.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r13ext && bun run.ts r13.js,../r12x/r12.js $PWD/fx/signedin.html 1 --as http://127.0.0.1:8799/fx/zz-signedin.html | grep 'top\|nav'

Suspected cause: ai18 added sign-out words to TOP_LABEL with the same rank as cart and account, and findTop keeps the first 4 matches in page order. Lead: add sign-out last, only when a slot is free, or never let it displace a cart.

Skeptic: NOT checked by a skeptic (the skeptic hit the usage limit). Reproduce it first; if you cannot, report not_fixed with what you saw and change nothing.

Skeptic's fix lead: 

## F1308 (medium, regression): F1210 residue: a whole-page form with no main, article or h1 and under 2000 characters still moves Add to cart and Subscribe into the search bar

Found by: R1-extractor. Where: src/content/extract/generic.ts:6623 (searchHome's whole-page test)

Evidence: Fixture /home/nico/projects/sift/research/fixtures/r13rx-aspnet-noh1.html is r12rx-aspnet with <main> as a div and the h1 as div.title. Harness: 'search: Search products btn=Search more=[Add to cart, Add to wish list, Subscribe]', 'form: fields=[number:Quantity] actions=[]', 'form: fields=[email:Email] actions=[]'. Real extension bar: 'Search products | Search | Add to cart | Add to wish list | Subscribe | Menu | My account'. r10m kept the buttons in their forms. searchHome treats the form as the search's own box unless it holds main, [role=main], article or h1, or has 2000 or more characters. The existing pageWide() (h1, or more than 60% of the body's text) says this form wraps the page.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r13ext && bun run.ts r13.js $PWD/fx/aspnet-noh1.html 1 --as http://127.0.0.1:8799/fx/zz-aspnet2.html

Suspected cause: searchHome uses its own, weaker whole-page test. Lead: also return to the walk when pageWide(form) is true.

Skeptic: NOT checked by a skeptic (the skeptic hit the usage limit). Reproduce it first; if you cannot, report not_fixed with what you saw and change nothing.

Skeptic's fix lead: 

## F1309 (medium): In a whole-page form whose search bar holds a second text field, the first button named Submit/OK/Go anywhere on the page becomes the search's button, and that form loses its button

Found by: R1-extractor. Where: src/content/extract/generic.ts:6680 (fallback scope starts at the form's parent, which is <body>)

Evidence: Fixture /home/nico/projects/sift/research/fixtures/r13rx-aspnet-where.html: ASP.NET whole-page form, header search bar with 'Search jobs', 'City or ZIP' and a 'Find jobs' submit, and a feedback textarea with its own 'Submit' further down. Current: 'search: Search jobs btn=Submit', 'form: fields=[textarea:Your feedback] actions=[]'. Real extension bar: 'Search jobs | Submit | Menu | My account'. The feedback form has no button, and Enter in a textarea does not submit, so it cannot be sent. The 'City or ZIP' field is gone too (see the header-search finding). searchHome returns null because the bar holds a second text field. btn stays null, and the fallback loop starts at pick.form.parentElement (body), so it takes the page's first button that SEARCH_BUTTON names (/submit|ok|go|enviar/) and marks it used. r10m and r12 also lose the Submit.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r13ext && bun run.ts r13.js $PWD/fx/aspnet-where.html 1 --as http://127.0.0.1:8799/fx/zz-aspnet-where.html | grep 'search\|form'

Suspected cause: For a page-wide form the 'nearby' fallback scope is the whole page. Lead: when pageWide(pick.form), start the fallback at the search box's own ancestors (below the form) and stop at the header or banner.

Skeptic: NOT checked by a skeptic (the skeptic hit the usage limit). Reproduce it first; if you cannot, report not_fixed with what you saw and change nothing.

Skeptic's fix lead: 

## F1310 (medium): Pages with many closed <details> take seconds per look: scrollBox reads layout of hidden FAQ answers before its cheap style test

Found by: R1-extractor. Where: src/content/extract/generic.ts:4282 (scrollBox: clientHeight/scrollHeight read first)

Evidence: Fixture /home/nico/projects/sift/research/fixtures/r13rx-details1000.html (1000 FAQ <details>, all closed). In the real extension a full look takes 3837 ms (dataset.ms). r13rx-details2000.html takes 8059 ms. The original page loads in about 0.2 s. Harness first look: 1000 → 1.8 s, 2000 → 5.5 s, 4000 → 30 s. That is quadratic; later looks are fast. CPU profile of details-2000: 6.0 s of 7.6 s self time in scrollBox. A copy with the overflowY style test moved before the clientHeight read takes 456 / 597 / 1850 ms with the same outline. r10m and r12 are as slow, so this is not new. It only bites with several hundred closed details (250 → about 0.1-0.2 s).

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r13ext && bun timeall.ts r13.js gen/details-1000.html gen/details-2000.html (first of 3 runs); bun prof.ts r13d.js gen/details-2000.html; extension: SIFT_PORT=9468 SIFT_TAB=R1-extractor bun scripts/act.ts goto:http://127.0.0.1:8799/fx/r13rx-details1000.html wait:8000 "eval:document.querySelector('sift-root').dataset.ms"

Suspected cause: Reading the layout of content inside a closed <details> (content-visibility: hidden) forces a layout each time. Lead: test getComputedStyle(el).overflowY first (and body/html), and read clientHeight/scrollHeight only for scrolling boxes.

Skeptic: NOT checked by a skeptic (the skeptic hit the usage limit). Reproduce it first; if you cannot, report not_fixed with what you saw and change nothing.

Skeptic's fix lead: 
