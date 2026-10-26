# Round 6 findings: gena7

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F631 (high): BART Trip Planner page loses the whole planner (cross-origin iframe dropped)

Found by: T4-generic. Where: https://www.bart.gov/planner

Evidence: The original shows the Trip Planner (start/destination fields, Depart Now, SEARCH, map) in iframe.bart-trip-planner (src https://planner.bart.gov/, 1280x800, visible, inside main#block-bart-content from the first second). Sift shows only H1 'Bay Area Rapid Transit' and the service advisory, with 0 portals, and the rest of the page is empty. So the page's only tool, trip planning, cannot be used from Sift. axe finds 0 violations. Shots: /home/nico/projects/sift-test-4/research/shots/r6t4-bart.png vs /home/nico/projects/sift-test-4/research/shots/r6t4-bart-orig.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://www.bart.gov/planner wait:15000 "eval:[JSON.stringify(document.querySelector('iframe.bart-trip-planner').getBoundingClientRect()), document.querySelector('sift-root').shadowRoot.querySelectorAll('.portal').length]" outline gives a 1280x800 rect, 0 portals, and an outline that ends after the advisory paragraph.

Suspected cause: Unverified. portalBlock() in src/content/extract/generic.ts should make a portal from a large cross-origin iframe, so the iframe is probably skipped before it gets there. It is untitled, full-width, and has the class 'bart-trip-planner no-breadcrumb'.

Skeptic: Reproduced. After 15 s, iframe.bart-trip-planner (src https://planner.bart.gov) is 1280x800 and visible, but Sift has 0 portals. Sift's outline ends after the Service Advisory paragraph (shot research/shots/skeptic-bart.png). The original with Sift off shows the full planner: start and destination fields, Depart Now, SEARCH and the map (research/shots/skeptic-bart-orig.png). Cause found: in visitEl() (src/content/extract/generic.ts), the NOISE_TOKEN check skips only MEDIA tags (img, picture, video, audio), so it also runs on the iframe. NOISE_TOKEN in src/content/dom.ts matches '-breadcrumb' inside the class 'no-breadcrumb'. I tested NOISE_TOKEN.test('bart-trip-planner no-breadcrumb') and it returned true. So the iframe is dropped before portalBlock() runs. High severity: the page's only tool cannot be used.

Skeptic's fix lead: In src/content/extract/generic.ts visitEl(), exempt embedded surfaces (iframe, canvas, embed, object) from the NOISE_TOKEN skip, or only apply that skip to them when they are small. Also make NOISE_TOKEN in src/content/dom.ts ignore negated classes such as 'no-breadcrumb' or 'no-share', for example with a (?<!no-) lookbehind.

## F635 (medium): Craigslist search: results start about 2.7 screens down, after the whole filter panel

Found by: T4-generic. Where: https://sfbay.craigslist.org/search/sss?query=bike

Evidence: In Sift, the first result ('2021 Liv Embolden E+ $1,600') is at y=2412 at 1280x900. Before it come every filter: categories with counts, 4 checkboxes, show more/check all/uncheck all, all/owner/dealer, miles/zip, price, make and model, odometer, model year, 10 filter groups, reset/apply, and 4 safety links, then the toolbar. The original shows 6 result cards on its first screen, beside a narrow filter sidebar. Shots: /home/nico/projects/sift-test-4/research/shots/r6t4-cl-search.png vs /home/nico/projects/sift-test-4/research/shots/r6t4-cl-search-orig.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts 'goto:https://sfbay.craigslist.org/search/sss?query=bike' wait:12000 "eval:(()=>{const r=document.querySelector('sift-root').shadowRoot;const f=r.querySelector('li.item');return Math.round(f.getBoundingClientRect().top+r.host.scrollTop)})()" gives about 2412.

Suspected cause: The filter sidebar comes before the results in DOM order and is rendered open in full. It could be folded into a closed 'Filters' section, or placed after the results.

Skeptic: Reproduced. At 1280x813, Sift's first result ('Actbest Striker Ebike') is at y=1936, about 2.4 screens down. Before it come every category as a link plus a checkbox, 4 checkboxes, show more/check all/uncheck all, all/owner/dealer, miles/zip, price, make and model, 9 filter-group buttons, reset/apply, 4 safety links and the toolbar (research/shots/skeptic-cl.png). The original shows 6 result cards on its first screen, beside a narrow filter sidebar. My y value is lower than the claim's 2412 because my viewport was shorter, but the problem is the same. Medium: the results are what the page is for, and the filter panel buries them.

Skeptic's fix lead: In src/content/extract/generic.ts, when a panel of filter controls (checkbox groups, min/max fields, reset/apply) comes before a list of results in DOM order, fold it into a closed 'Filters' section, or place it after the results list and toolbar.

## F636 (medium): weather.gov: the first screen is site chrome; the forecast starts 1.6 screens down

Found by: T4-generic. Where: https://forecast.weather.gov/MapClick.php?lat=37.7749&lon=-122.4194

Evidence: After the H1, Sift shows the 3 agency links, then the site nav as 9 buttons (HOME, FORECAST … ABOUT), then the location field with the visible label 'inputstring' (its name attribute), 'View Location Examples', the office link, and 'News Headlines'. 'Current conditions' starts at y=795 and the 7-day forecast ('Tonight · Low: 53 °F') at y=1461, at 1280x900. The original shows current conditions and the 7-day strip on its first screen. Opening FORECAST shows a dialog whose title is its items run together ('Local Graphical Aviation Marine Rivers and Lakes Hurricanes Severe Weather Fire'), with a Close button that wraps as 'Clo/se'. Shots: /home/nico/projects/sift-test-4/research/shots/r6t4-nws.png vs /home/nico/projects/sift-test-4/research/shots/r6t4-nws-orig.png, /home/nico/projects/sift-test-4/research/shots/r6t4-nws-forecastmenu.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/visit.ts 'https://forecast.weather.gov/MapClick.php?lat=37.7749&lon=-122.4194' x --wait 9000. In the outline, lines 4-17 are agency links, nav buttons, the inputstring field and news before 'Hazardous Weather Conditions'. Then eval the top of the p containing 'Tonight · Low' plus host.scrollTop: 1461.

Suspected cause: The NWS nav bar (div.navbar with dropdown buttons) and the header widgets are not recognised as site chrome, so they are not moved to Menu. The field label falls back to the name attribute.

Skeptic: Reproduced. After the H1, Sift shows the 3 agency links, then the site nav as 9 button-styled links (HOME … ABOUT), then the location field labelled 'inputstring' (its name attribute), 'View Location Examples', the office link and News Headlines. 'Current conditions at' is at y=795 and 'Tonight · Low: 53 °F' at y=1461, with a viewport 813 px tall (research/shots/skeptic-nws.png). The original shows current conditions and the 7-day strip on its first screen. Opening FORECAST gives a dialog titled 'Local Graphical Aviation Marine Rivers and Lakes Hurricanes Severe Weather Fire', and its Close button wraps as 'Clo/se'. The page behind the dialog also turned into a long list of the dropdown links (research/shots/skeptic-nws-fmenu.png). The dialog title and the wrap are polish, but the site nav and header widgets kept in the body are real noise and push the forecast down, so this is medium.

Skeptic's fix lead: In src/content/extract/generic.ts, recognize the NWS div.navbar (a row of dropdown toggles for site sections) as site chrome in isChrome() and move it to Menu. Name the dropdown dialog from its trigger ('Forecast'), not from its items' text (dialogIn/openedPanel). Never use a field's name attribute as its visible label (toField's label fallback).

## F638 (medium): Booking 'Sign in, save money' promo modal is shown as a Sift dialog and takes the first input

Found by: T4-generic. Where: https://www.booking.com/ (first visit in the session)

Evidence: After clicking Sift's destination field and typing 'Bariloche', Sift showed a modal dialog 'Window offering discounts of 10% or more when you sign in to Booking.com … Sign in, save money … Sign in or register'. The typed text was lost: the field still read 'Mendoza'. This is the original's aria-modal Genius promo. Spec: popups are noise. After 'Dismiss sign-in info.', typing worked. I saw it once; after dismissal the site did not show it again in this profile, so a fresh profile may be needed to reproduce. Shot: /home/nico/projects/sift-test-4/research/shots/r6t4-booking-typing.png

Repro: In a fresh Chrome profile: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://www.booking.com/ wait:12000 'click:input[type=search]' press:Control+a press:Backspace 'type:input[type=search]=>Bariloche' wait:4000 "eval:[document.querySelector('sift-root').shadowRoot.querySelector('[role=dialog]')?.innerText.slice(0,80), document.querySelector('sift-root').shadowRoot.querySelector('input[type=search]').value]" gave ['Window offering discounts of 10%…','Mendoza'].

Suspected cause: The dialog rules keep any visible aria-modal dialog. A sign-in or discount promo with a 'Dismiss' button and no form could be dismissed (proxy its Dismiss button) or dropped.

Skeptic: Reproduced after I cleared booking.com cookies and storage in the test profile (CDP Network.deleteCookies and Storage.clearDataForOrigin, booking.com only). On load, Sift shows a modal dialog: 'Window offering discounts of 10% or more when you sign in to Booking.com · Dismiss sign-in info. · blue Genius logo · Sign in, save money · Sign in or register'. Clicking Sift's search field and typing 'Bariloche' left the field empty, and the dialog stayed on top (research/shots/skeptic-booking-fresh2.png). The original also shows this Genius promo (research/shots/skeptic-booking-fresh-orig.png), but the spec says popups and promos are removed. Sift keeps it as a blocking dialog and loses the first input. On a later load it did not show again. Cause in the code: dialogIn() in src/content/extract/generic.ts drops self-opened dialogs only when NOISE_TEXT (cookies or newsletter) matches. Its close-name regex /^(close|…|dismiss|…)$/ does not match 'Dismiss sign-in info.', so the dialog has no close and may be marked blocking.

Skeptic's fix lead: In src/content/extract/generic.ts dialogIn(), skip (or auto-dismiss by proxying its Dismiss button) a dialog the page opened on its own, with no field, whose content is a sign-in or discount promo (a 'Sign in or register' link plus a dismiss control, 'save 10%'). Keep it when the user's last action opened it (openedWith). Also let the close-name regex match names that start with Dismiss or Close ('Dismiss sign-in info.').
