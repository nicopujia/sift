# Round 6 findings: tools7b

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F662 (medium, regression): Long English Wikipedia articles get no Short version ('Shortening…' shows, then the full text stays)

Found by: T3-tools. Where: https://en.wikipedia.org/wiki/Bread, /wiki/Sourdough, /wiki/Bagel, /wiki/Rye_bread

Evidence: Bread: 'Shortening…' at 2.1 s, gone at 3.1 s, then no Short version and no 'not available' notice in the next 177 s (log /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6t3/bread-poll.log). Bread also had none in two earlier loads (35 s, then 2.5 min). Sourdough: 'Shortening…' at 0 s, gone at 16.5 s, no Short version. Bagel: 'Shortening…' gone after 0.3 s. Rye bread: nothing in 60 s. The control cases work: es.wikipedia.org/wiki/Pan shows 'VERSIÓN CORTA' and 'Ver texto completo' at 37 s, and the short English article /wiki/Pumpernickel shows 'SHORT VERSION'. Sift's own cache (IndexedDB 'sift'/'kv', read from options.html) holds a 20,410-character Sourdough Short version written 34 min earlier ('Sourdough uses a live flour-and-water starter…'). Yet reloading /wiki/Sourdough shows no Short version and no 'Shortening…'. works.md lines 51 and 124 say Bread had a Short version that kept See also and External links. MDN Array/map also showed no Short version in 85 s, so I could not recheck works.md line 48's '6 example code blocks'.

Repro: cd /home/nico/projects/sift-test-3; SIFT_PORT=9463 SIFT_TAB=T3-tools bun scripts/act.ts goto:https://en.wikipedia.org/wiki/Sourdough wait:500; SIFT_PORT=9463 SIFT_TAB=T3-tools bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r5t3/poll.ts 60 "(()=>{const t=document.querySelector('sift-root').shadowRoot.querySelector('.sift').innerText;return (t.match(/(SHORT VERSION|Show full text|Shortening…|Shortening is not available[^\n]*)/gi)||[]).join(',')})()"  (shows 'Shortening…' at most briefly, never 'SHORT VERSION'). Control: the same on https://es.wikipedia.org/wiki/Pan shows VERSIÓN CORTA.

Suspected cause: Unknown. The cached Short version exists, so the drop happens after the model answers. Possibly the 'not much shorter' check (MAX_RATIO/MAX_WORD_RATIO) running on a cache hit against a different request text, or a content-side gate. It may also come from the slow fallback model.

Skeptic: Reproduced on /wiki/Sourdough (twice) and /wiki/Bread. I tapped the AI port in the service worker. The page sends condense with 29,572 chars (Sourdough) and gets back a cached 'full' of 20,410 chars, then 'done', with no error. The page shows 'Shortening…' for about 0.3-1 s, then the full text, with no Short version and no notice. Bread behaves the same (26,402 chars in, 17,268 out). From the dumped texts: the model kept 3,119 of 4,391 prose words (0.71) and dropped all 17 [[B…]] placeholders. So the background tooLong check passes (word ratio under 0.75) and the result is cached as good. The content side's planShort then puts the 17 blocks back, and its MAX_SHOWN = 0.75 test, which counts those blocks' words, almost certainly returns null. app.tsx shortPlan then shows the full text silently, and the cache replays the same rejected answer for 30 days. I did not run planShort itself, so the exact gate is inferred, not measured. A sameArticle mismatch is unlikely on a static Wikipedia page. The root is the model writing 71% when asked for about 35%, but Sift's two gates disagree and lock the failure in. I cannot say whether it is a regression, because the earlier works.md result may have come from a different model.

Skeptic's fix lead: Make the two gates agree. In background/index.ts doCondense, reject and do not cache an output whose prose words exceed the asked 'never more than' share (about 0.5), or retry once with a stricter prompt. Do not accept anything up to MAX_WORD_RATIO 0.75. Or, in content (app.tsx shortPlan / ai.ts), when planShort returns null on a done result, mark the job as an error so the 'not available' notice shows, and ask again with cache bypass once instead of replaying the cached text.

## F663 (medium): weather.com: foggy days lose their weather condition in the daily forecast

Found by: T3-tools. Where: https://weather.com/en-CA/us/california/city/san-francisco/today (Daily Forecast) and /tenday

Evidence: Sift's rows read 'Tonight 19% 50° 73°', 'Sun 25 19% 54° 69°' and 'Tue 27 19% 50° 66°', with no condition. Other days keep theirs: 'Mon 26 Mostly Sunny 15% 49° 66°', 'Wed 28 Mostly Cloudy 7%…'. In the original, those three rows have the icon <svg><title>Foggy</title></svg> and the text 'Fog Late' / 'AM Fog/PM Clouds'. A reader cannot tell which days are foggy without expanding each row. The rows without a condition are also laid out differently (one link) from the others (a link plus a paragraph). Shot: /home/nico/projects/sift-test-3/research/shots/R6-T3-weather-10day.png

Repro: cd /home/nico/projects/sift-test-3; SIFT_PORT=9463 SIFT_TAB=T3-tools bun scripts/act.ts goto:https://weather.com/en-CA/us/california/city/san-francisco/tenday wait:12000 "eval:[...document.querySelector('sift-root').shadowRoot.querySelectorAll('[aria-expanded]')].map(e=>e.innerText.replace(/\n/g,' ')).join(' | ')" "eval:[...document.querySelectorAll('button[data-slot=accordion-trigger]')].map(b=>b.querySelector('span')?.textContent+' '+[...b.querySelectorAll('svg title')].map(t=>t.textContent)[0]).join(' | ')"  (compare the rows whose icon title is 'Foggy'; this depends on the day's weather)

Suspected cause: 

Skeptic: Reproduced on /tenday and /today. On /today, Sift's Daily Forecast reads '[link] Tonight 19% 50° 73°', '[link] Sun 25 19% 54° 69°', '[link] Tue 27 19% 49° 66°' with no condition. The other days are split into link and paragraph ('[link] Mon 26' / 'p: Mostly Sunny 14% 49° 67°', 'Wed 28' / 'Mostly Cloudy…'). The ten-day page shows the same for 'Sun 25 19% 54° 69°' against 'Mon 26 Mostly Sunny 14%…'. In the original at 1280 px, the condition span ('Fog Late', 'AM Fog/PM Clouds', 'AM Fog/PM Sun', 'Mostly Sunny') is display:none for every row. The visible cue is the icon, <svg><title>Foggy</title>. So Sift takes the hidden condition for non-fog rows and drops both the text and the icon meaning for fog rows. A reader cannot tell which days are foggy. Side note, not part of this claim: Sift's /tenday view showed only 3 days (Tonight, Sun 25, Mon 26) out of 15.

Skeptic's fix lead: In extract/generic.ts, in the link/card row reader that splits a row into title plus text (the path that gives 'Mon 26' + 'Mostly Sunny …'), make every row of the same list take the same path. When a row's only condition is an icon, keep the svg <title> (or the row's hidden condition span) as text, so foggy rows read 'Sun 25 AM Fog/PM Clouds 19% 54° 69°'.

## F664 (medium): weather.com hourly: the first rows break into a column of unlabeled numbers

Found by: T3-tools. Where: https://weather.com/en-CA/us/california/city/san-francisco/hourbyhour (top of the hourly list)

Evidence: After 'Saturday, October 24', Sift shows each cell as its own paragraph. First the headers 'Humidity', 'Wind', 'Precipitation', then '18:30', '60°', '2%', '77%', '11 mph', '0 in', then '18:45', '60°', '2%', '77%'… (15 lines). No value is tied to its label, and the 'Clear' condition is dropped. The original lays each of these as one row ('18:30 | 60° | Clear | 2% | 77% | 11 mph | 0 in'). From 19:00 on, Sift shows one-line rows ('19:00 60° Clear 2% 78% 11 mph 0 in'). This is the first thing on the page, and it is hard to read. Shot: /home/nico/projects/sift-test-3/research/shots/R6-T3-weather-hourly.png

Repro: cd /home/nico/projects/sift-test-3; SIFT_PORT=9463 SIFT_TAB=T3-tools bun scripts/act.ts goto:https://weather.com/en-CA/us/california/city/san-francisco/hourbyhour wait:12000 outline  (lines after 'p: Saturday, …' are one value each). The number of 15-minute rows varies with the time of day.

Suspected cause: 

Skeptic: Reproduced on 2 loads of /hourbyhour (at 19:11 PDT). After 'p: Saturday, October 24', Sift shows 'Humidity', 'Wind', 'Precipitation', then '19:15', '59°', '2%', '75%', '8 mph', '0 in', '19:30', … each as its own paragraph. The 'Clear' condition is dropped. From 20:00 on, the rows are one-line buttons ('20:00 59° Clear 2% 76% 6 mph 0 in'). The original (screenshot with Sift off) lays each 15-minute row out as one row under column headers. In the original markup, each 15-minute cell is its own <p> inside nested divs, so the 'strip of small readings is one line' rule (generic.ts around 3508/3876) misses these rows. This is the first content on the page and is hard to read.

Skeptic's fix lead: In extract/generic.ts, extend the readings-strip rule (around line 3508 and the helper near 3876) to a row of sibling cells that each hold one short <p> (time, temperature, percent, speed, amount), joining them into one line. Join the column headers ('Humidity', 'Wind', 'Precipitation') to the values or drop them.

## F665 (medium): GitHub repo page: the About sidebar is empty (website, topics, releases and languages are lost)

Found by: T3-tools. Where: https://github.com/preactjs/preact

Evidence: Sift's outline ends with 'H2 About' with nothing under it. Checks in Sift's text: preactjs.com false, Releases false, 'MIT license' false, topic 'virtual-dom' false, Contributors false, Languages false. The original's About shows the website link preactjs.com, the topics (components, dom, jsx, preact, react, vdom, virtual-dom), Readme / MIT license / Code of conduct, 39.0k stars, 388 watching and 4.4k forks, then Releases (11.0.2 Latest, +255 releases), Contributors and Languages. The round 5 outline (/home/nico/projects/sift-test-3/research/shots/R5-T3-gh-repo.txt) ends the same way, so this is old, not a merge regression. Outline: /home/nico/projects/sift-test-3/research/shots/R6-T3-gh-repo.txt

Repro: cd /home/nico/projects/sift-test-3; SIFT_PORT=9463 SIFT_TAB=T3-tools bun scripts/visit.ts https://github.com/preactjs/preact x --wait 15000  (last lines: 'H2 About' then '[button] Sift'); then bun scripts/act.ts "eval:/preactjs\.com/.test(document.querySelector('sift-root').shadowRoot.querySelector('.sift').innerText)"  (false)

Suspected cause: 

Skeptic: Reproduced on 2 fresh loads of github.com/preactjs/preact. Sift's text ends with 'Links in the full text … Become a backer', then an empty 'About' heading, then 'Sift'. The checks for preactjs.com, Releases, 'MIT license', 'virtual-dom', Contributors and Languages are all false. Original with Sift off: the About cell reads 'About ⚛️ Fast 3kB React alternative… preactjs.com Topics components dom jsx preact react vdom virtual-dom Resources Readme MIT license Code of conduct … 39.0k stars 388 watching 4.4k forks'. Sift does show the description in the header line and 'Fork 4.4k', 'Star 39k', and the README ends with 'License MIT'. Lost for good: the project's website link, the topics, the latest release (11.0.2 Latest) and the languages. A heading with nothing under it is also left behind. Medium severity, not high.

Skeptic's fix lead: In extract/generic.ts, keep the repository sidebar (.Layout-sidebar / BorderGrid cells under the 'About' h2, and Releases/Languages) as page content instead of dropping it as an aside. At minimum keep its links and short lines. Never emit a heading whose section came out empty.

## F666 (medium): OpenStreetMap search results: AI one-liners replace result names (addresses), and two different results get the same name

Found by: T3-tools. Where: https://www.openstreetmap.org/search?query=Main%20Street%20Springfield

Evidence: Sift's result links read like 'Main Street is a secondary road in Indian Orchard, Springfield, Massachusetts, ZIP code 01151'. The original names are 'Main Street, Indian Orchard, Springfield, Hampden County, Massachusetts, 01151, United States'. The new text is no shorter (both about 92 characters), repeats the road type that the meta line already gives ('Secondary Road'), and drops details that tell results apart. Results 6 and 9 both became 'Main Street is a primary road in North End, Springfield, Massachusetts, ZIP code 01115'. Their originals are '…Downtown Springfield Railroad District, North End, Metro Center, McKnight…' and '…North End, Metro Center…'. The original name survives only in the link's title attribute, which screen readers and keyboard users do not get. On a reload, newly listed results were not rewritten, so the list mixes the two styles. A 'Union Square' search was not rewritten within 100 s. The spec keeps names as they are, and a place result's name is its address. Shot: /home/nico/projects/sift-test-3/research/shots/R6-T3-osm-springfield.png

Repro: cd /home/nico/projects/sift-test-3; SIFT_PORT=9463 SIFT_TAB=T3-tools bun scripts/act.ts goto:"https://www.openstreetmap.org/search?query=Main%20Street%20Springfield" wait:15000 "eval:[...document.querySelector('sift-root').shadowRoot.querySelectorAll('li.item a.title')].map(a=>a.innerText+' [orig: '+a.title+']').join('\n')"  (the one-liners are cached from my runs, so they show at once)

Suspected cause: The OSM result list is marked rewrite with no keepTitle, so place names go to the 'lines' AI task like headlines.

Skeptic: Reproduced on 2 loads. Sift's result links read 'Main Street is a secondary road in Indian Orchard, Springfield, Massachusetts, ZIP code 01151', each with a 'Secondary Road'/'Primary Road' line under it that repeats the road type. The original names, kept only in the title attribute, are addresses like 'Main Street, Downtown Springfield Railroad District, Metro Center, McKnight, Springfield, Hampden County, Massachusetts, 01144, United States'. The rewrite is not shorter. It drops the district names that tell close results apart, and two results (rows 2 and 7) stay unrewritten, so the list mixes styles. In my runs the duplicate pair T3 saw did not appear, but rows differ only by neighborhood and ZIP. Cause: Out.rewriteIfLong in generic.ts marks any list whose titles average over 13 words as rewrite 'oneliner' in news mode. Comma-separated addresses pass that test, so place names are treated as headlines.

Skeptic's fix lead: In extract/generic.ts Out.rewriteIfLong, do not rewrite titles that are names or addresses. Skip a list when most titles are comma-separated name parts (for example 3+ commas and no sentence verb or end punctuation), or when its links go to map objects (/node/, /way/, /relation/). Or set keepTitle on such items.
