# Round 7 findings: tools9

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F752 (medium): OpenStreetMap Layers panel is hidden in a collapsed 'Filters' disclosure that closes and drops focus after each choice

Found by: T3-tools. Where: https://www.openstreetmap.org/ (home map and /directions), the Layers control in the map portal

Evidence: A real click on the map's Layers control opens the original's 'Map Layers' panel (810 px: Standard, CyclOSM, Cycle Map, Transport Map, …). Sift adds only a collapsed '▶ Filters' summary above the map, with no radios visible. Expanding it shows 'Filters / Close / H2 Map Layers' and 8 layer radios. Picking 'Transport Map' by mouse switched the layer (layers=T). Then the disclosure collapsed at once and focus moved to main. By keyboard (Tab to 'Standard', ArrowDown) the layer switched to CyclOSM (layers=Y), but the details closed and focus went to main ('OpenStreetMap Car Bi…'), so the user cannot arrow on to the next layer. The original's panel stays open. Shots: /home/nico/projects/sift-test-3/research/shots/R7-T3-osm-layers-home.png, /home/nico/projects/sift-test-3/research/shots/R7-T3-osm-layers-filters.png

Repro: cd /home/nico/projects/sift-test-3; export SIFT_PORT=9463 SIFT_TAB=T3-tools; S=/tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7t3; bun scripts/act.ts "goto:https://www.openstreetmap.org/#map=16/37.7994/-122.3998" wait:9000; bun $S/osmlayers.ts  (prints 'Sift disclosures: details[open=false] summary="Filters"', no Sift radios, 'Original layers panel: 810px: Map Layers Standard CyclOSM…'). Then: bun scripts/act.ts "click:Filters" wait:1000 press:Tab press:Tab press:ArrowDown wait:2500 "eval:(()=>{const r=document.querySelector('sift-root').shadowRoot;return [...r.querySelectorAll('details')].map(d=>d.open)+' '+r.activeElement?.localName+' '+location.hash})()"  (details false, focus main, layers changed). Afterwards, reset the layer to Standard.

Suspected cause: The map-UI sidebar panel is treated as a filter panel (perhaps round 6's gena7 filter-panel change) and named 'Filters' instead of its heading 'Map Layers'. The details' open state is not kept across the re-render after a layer change, and focus is not put back on the chosen radio.

Skeptic: Reproduced on openstreetmap.org/#map=16/37.7994/-122.3998. A real click on the map's Layers control opens the original's 810 px 'Map Layers' panel. Sift shows only a collapsed '▶ Filters' details above the map, with no radios visible. Expanded, it holds 'Close', H2 'Map Layers' and 8 radios. By keyboard (Tab, Tab to the Standard radio, ArrowDown) the layer switched (layers=Y), then the details closed and Sift's focus went to main. By mouse ('Transport Map') the layer switched (layers=T), and again the details closed and focus went to main, while the original's panel stayed open (810 px). The 'Filters' title comes from filterPanel() in src/content/extract/generic.ts: the narrow sidebar of more than 6 radios beside a wider sibling is taken for a search-filter panel and folded with collapsed: true. I reset the layer to Standard afterwards (cookie _osm_location ...|M).

Skeptic's fix lead: In src/content/extract/generic.ts filterPanel(), do not fold a panel whose wider sibling is a map or another portal rather than a list of results, or one headed by its own heading (use the heading 'Map Layers' as its title). Keep a section's open state across re-renders when the panel is rebuilt, and put focus back on the chosen radio after the page changes.

## F753 (medium): GitHub issue Short version moves the opening post's byline and code example out of place

Found by: T3-tools. Where: https://github.com/preactjs/preact/issues/4416 (opening post, Short version)

Evidence: Sift's order: 'SHORT VERSION / Show full text', then 5 short paragraphs ('Preact needs syntax…' … 'Solid.js uses attr:foo=…'), then 'trusktr', 'opened on Jun 20, 2024', then pre 'return <some-element foo={[1, 2, 3]} />', then the custom-elements-everywhere link. In the original (and in Sift's full text), the byline comes first. The code block follows 'Does this set an attribute, or a property?' and comes before 'Answer: it depends…'. So in the Short version the byline sits in the middle of the post, and the code example appears after it with nothing explaining it. Block counts are still right (blockquotes 6/6, pre 3/3). Shot: /home/nico/projects/sift-test-3/research/shots/R7-T3-gh-4416.png

Repro: cd /home/nico/projects/sift-test-3; export SIFT_PORT=9463 SIFT_TAB=T3-tools; bun scripts/visit.ts https://github.com/preactjs/preact/issues/4416 x --wait 12000 --tall 2400  (see research/shots/x.png: short text, then 'trusktr opened on Jun 20, 2024', then the code block); compare "eval:document.querySelector('.markdown-body').innerText.slice(0,400)" (code right after 'Does this set an attribute, or a property?').

Suspected cause: The Short version replaces the post's prose but leaves the header row and the non-prose blocks (pre, link preview) where they were, after the shortened text. The question that introduced the code is dropped by the model.

Skeptic: Reproduced on github.com/preactjs/preact/issues/4416 (shot research/shots/skeptic-gh4416.png). The Short version reads 'SHORT VERSION / Show full text', 5 short paragraphs, then 'trusktr', 'opened on Jun 20, 2024', then the pre 'return <some-element foo={[1, 2, 3]} />', then the custom-elements-everywhere link. Sift's own full text starts with 'trusktr / opened on Jun 20, 2024', and the code follows 'Does this set an attribute, or a property?'. So in the Short version the post's byline sits after its text, as if starting a new post, and the code example sits under it with nothing introducing it. These blocks are kept-whole placeholders ([[B…]]) in src/content/short.ts. planShort() trusts where the model put them and re-places only dropped ones by source position. A leading byline therefore drifts to wherever the model wrote its placeholder.

Skeptic's fix lead: In src/content/short.ts planShort(), keep kept-whole blocks that come before the first prose unit (a post's header row or byline) pinned in front, rather than placing them where the model wrote them. When a placeholder comes out of source order, re-place it by its source position with the same anchor logic used for dropped units. This keeps the code block after the shortened sentence that introduced it, or the model can be asked to keep that sentence.

## F754 (medium): GitHub file view: the code starts 500 px lower than on the original, below a column of file-toolbar controls

Found by: T3-tools. Where: https://github.com/preactjs/preact/blob/main/hooks/src/index.js (any blob view)

Evidence: At 1280x900 the first code line is at y=850 in Sift (one line visible on the first screen) and at y=350 in the original. Before the code, Sift stacks: Repository navigation (9 tabs), H1 'index.js', Copy path, More file actions, author link, commit message link, 'success', hash · last week, History, Code, Blame, '573 lines (509 loc) · 15.9 KB', Raw, Copy raw file, Download raw file and Open symbols panel. Reading a file takes a scroll in Sift that the original does not need. All 573 lines are present. Shots: /home/nico/projects/sift-test-3/research/shots/R7-T3-gh-blob.png (Sift), /home/nico/projects/sift-test-3/research/shots/R7-T3-gh-blob-orig.png (original)

Repro: cd /home/nico/projects/sift-test-3; export SIFT_PORT=9463 SIFT_TAB=T3-tools; bun scripts/act.ts goto:https://github.com/preactjs/preact/blob/main/hooks/src/index.js wait:10000 "eval:Math.round(document.querySelector('sift-root').shadowRoot.querySelector('main pre').getBoundingClientRect().top)" press:Alt+Shift+S wait:2500 "eval:Math.round(document.querySelector('.react-code-lines').getBoundingClientRect().top)" press:Alt+Shift+S  (850 vs 350)

Suspected cause: The blob header and toolbar's buttons and links are each given their own row. On a file page they could be one compact row, or the secondary ones (Copy path, symbols, download, raw copy) could sit after the code.

Skeptic: Reproduced at 1280x900 on github.com/preactjs/preact/blob/main/hooks/src/index.js. Sift's first code line is at y=850, with one line visible on the first screen (shot research/shots/skeptic-gh-blob.png). The original's first line is at y=352, with about 27 lines visible (skeptic-gh-blob-orig.png). Before the code, Sift stacks Repository navigation (9 tabs), H1 index.js, then Copy path, More file actions, JoviDeCroock, Trim comments, a 'success' button, '6ba541a · last week', History, Code/Blame, the line count, Raw and Copy raw file / Download raw file / Open symbols panel, almost each on its own row. The file itself, the page's main content, is pushed off the first screen. This is more than a few pixels of polish.

Skeptic's fix lead: In src/content/extract/generic.ts, keep a compact horizontal header row of small controls (GitHub's blob header and code toolbar: commit line, History, Code/Blame, Raw/copy/download/symbols) as one actions row instead of one block per control. Or, on a page whose main content is a code view, move the secondary file tools (Copy path, symbols, raw copy, download, the CI status button) after the code.

## F755 (medium): weather.com Today's Outlook: each hour's condition (shown only as an icon) is dropped

Found by: T3-tools. Where: https://weather.com/en-CA/us/california/city/san-francisco/today (Today's Outlook hourly strip; likely every location's /today)

Evidence: The original's strip shows a visible 32 px icon per hour titled 'Sunny' (13:00-18:00) or 'Clear Night' (19:00-23:00), with no hidden text. Sift's strip reads 'Now 66° | 13:00 66° | 14:00 66° | …' with no condition, so a reader cannot tell when it turns cloudy or rainy. The current-conditions card and the daily rows keep theirs ('Sunny', 'Mostly Sunny'), because those have a hidden text twin. Outline: /home/nico/projects/sift-test-3/research/shots/R7-T3-weather-today3.txt

Repro: cd /home/nico/projects/sift-test-3; export SIFT_PORT=9463 SIFT_TAB=T3-tools; bun scripts/act.ts goto:https://weather.com/en-CA/us/california/city/san-francisco/today wait:15000 "eval:[...document.querySelectorAll('a')].filter(a=>/^\s*(1[3-9]|2[0-3]):00\s/.test(a.innerText)&&a.getBoundingClientRect().height>0).slice(0,4).map(a=>a.innerText.replace(/\s+/g,' ')+'['+[...a.querySelectorAll('svg title')].map(t=>t.textContent)+']').join(' | ')" "eval:[...document.querySelector('sift-root').shadowRoot.querySelectorAll('a')].filter(a=>/^(1[3-9]|2[0-3]):00 \d/.test(a.innerText)).slice(0,4).map(a=>a.innerText).join(' | ')"  (original '13:00 66°[Sunny]', Sift '13:00 66°')

Suspected cause: The round 6 fix reads a condition only through a hidden text twin of the icon (the stem match in generic.ts). An icon whose <title> is the only cue is still dropped. F663's fix lead also suggested keeping the svg <title> as text in that case.

Skeptic: Reproduced on weather.com/en-CA/us/california/city/san-francisco/today. In the original, each hourly link in Today's Outlook shows a visible 32 px svg icon whose only cue is <title>Sunny</title> (19:00 is 'Clear Night'). The link's aria-label is '14:00, 66°', and there is no hidden text twin. Sift's strip reads 'Now 66° · 14:00 66° · 15:00 66° · …' with no condition. The current-conditions card ('Sunny') and the daily rows ('Today Sunny', 'Tue 27 Partly Cloudy') keep theirs. So a sighted reader loses the per-hour weather the original shows. The site's own aria-label also omits it, so screen-reader users miss it on the original too, but the visual information is still dropped by Sift.

Skeptic's fix lead: In src/content/extract/generic.ts, where a link or list item is named from its aria-label or its text, append the name of a visible, non-aria-hidden svg (its <title>) or role=img/[aria-label] icon inside it when that name is not already in the label. This is the case the F663 lead suggested. Keep the hidden-twin rule for icons that have one.

## F756 (medium): weather.com at 200% zoom: site header items appear twice

Found by: T3-tools. Where: https://weather.com/en-CA/us/california/city/san-francisco/today at 640x450 CSS px (200% zoom)

Evidence: Sift's top bar holds Menu, San Francisco and Sign in. Main then starts with the same items again, before the H1: '[link] The Weather Company', '[button] San Francisco', '[link] Sign in'. At 200% that pushes the H1 and the forecast down by about a third of the screen. At 1280 px main starts directly with the H1. There is no horizontal overflow (scrollWidth 640). Shot: /home/nico/projects/sift-test-3/research/shots/R7-T3-zoomB-1.png

Repro: cd /home/nico/projects/sift-test-3; export SIFT_PORT=9463 SIFT_TAB=T3-tools; bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7t3/out640.ts https://weather.com/en-CA/us/california/city/san-francisco/today 15000 | head -8  (lines 5-7 repeat the header)

Suspected cause: At narrow widths weather.com renders a second (mobile) header block. Sift keeps it in main instead of recognizing it as the same site chrome its top bar already shows.

Skeptic: Reproduced twice at 640x450 CSS px with DPR 2 (200% zoom) on weather.com/en-CA/.../san-francisco/today. Sift's top bar holds Menu, San Francisco and Sign in. Main then starts with '[link] The Weather Company', '[button] San Francisco', '[link] Sign in' before H1 'San Francisco Weather'. H1 top is 235 of a 450 px viewport (shot research/shots/skeptic-n6-sift.png). The page has only one 'San Francisco' button (in header.relative…md:sticky), so Sift shows the same element both in its top bar and in main. scrollWidth is 640, so there is no overflow. The original at the same size shows that header once (behind its cookie dialog).

Skeptic's fix lead: In src/content/extract/generic.ts, the site-bar check (siteBar/CHROME_TOKEN handling in visit) should still recognize weather.com's header at narrow widths. Failing that, src/content/index.ts or app.tsx should drop from main any action whose ref already appears in Sift's top bar, along with the header's leftover logo and Sign in link.

## F762 (medium): argentina.gob.ar Trámites search: the open topic filter pushes the results below the first screen

Found by: T4-generic. Where: https://www.argentina.gob.ar/tramitar/tramites_y_servicios/dni (where 'dni' from the home field leads)

Evidence: At 1280x900 Sift shows the H1, the field and Buscar, then 'Filtrar por temas' open with 14 topic links. After that comes '620 resultados para "dni"' at y=877, and the first result is at y=915, below the first screen. The original shows the count at y=370 and the first result at y=427, beside its filter column. The plain /buscar/pasaporte page is fine (first result at y=199). Shots: /home/nico/projects/sift-test-4/research/shots/r7t4-arg-dni.png vs /home/nico/projects/sift-test-4/research/shots/r7t4-arg-dni-orig.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://www.argentina.gob.ar/tramitar/tramites_y_servicios/dni wait:7000 "eval:(()=>{const r=document.querySelector('sift-root').shadowRoot;const f=r.querySelector('li.item');return Math.round(f.getBoundingClientRect().top+r.host.scrollTop)})()" prints about 915.

Suspected cause: The F635 fix folds Craigslist's filter panel, but this <details> filter list stays open before the results.

Skeptic: Reproduced at 1280x813. Sift shows the H1, the field, Buscar, then 'Filtrar por temas' open with 14 topic links (research/shots/skeptic-arg-dni.png). The first result is at y=915, below the first screen. In the original, the same <details> is open but laid out as a side column, with '620 resultados para "dni"' at y=370. The results are what the page is for, and they need a scroll to reach. Same class of problem as F635 (Craigslist filters, accepted as medium).

Skeptic's fix lead: In src/content/extract/generic.ts, extend the F635 filter-panel folding to a <details> or panel of filter/topic links that comes before a results list in DOM order: render it closed (or after the results) when it precedes results. The 'Filtrar por temas' details should start collapsed in Sift.
