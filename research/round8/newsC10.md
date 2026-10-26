# Round 8 findings: newsC10

Each was reproduced by a skeptic. F8xx are new in round 8; older ids are findings a round 8 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F823 (high): Times of India home: Sift offers no way to search or sign in

Found by: T2-news. Where: https://timesofindia.indiatimes.com/ (new cluttered site; CNN gave 'Unknown Error' and El País a DataDome device check, so I used TOI)

Evidence: The original header shows 'Sign In' (span.login.user-notloggedin) and a search icon (span.vho4K). Clicking the icon opens #searchField 'Latest news, videos, photos'. Sift's header has only 'Menu'. The Menu dialog has Close, 13 sections, about 70 city links, photos, Web Stories, Abound and ePaper, with no search and no sign-in. No Sift control matches /search|sign/i. Sift showed the search field only after I opened it in the original with a script. Shots: /home/nico/projects/sift-test-2/research/shots/r8t2-toi-home.png (Sift), /home/nico/projects/sift-test-2/research/shots/r8t2-toi-home-orig.png (original), /home/nico/projects/sift-test-2/research/shots/r8t2-toi-menu.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://timesofindia.indiatimes.com/ wait:10000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("a,button,input")].map(e=>e.innerText||e.placeholder||e.getAttribute("aria-label")||"").filter(t=>/search|sign/i.test(t))' gives []. Then click:Menu wait:1500 shows no search or sign-in. In the original, 'eval:!!document.querySelector("span.login")' is true, and 'eval:document.querySelector("span.vho4K").click()' makes #searchField visible.

Suspected cause: Both controls are clickable spans with no role, link or label (span.vho4K is icon-only). The generic extractor drops them, although it does keep the div.hamburg menu.

Skeptic: Reproduced on https://timesofindia.indiatimes.com/ (it redirects to /us). Sift's header has only 'Menu'. The Menu dialog has 89 controls, and none matches /search|sign|log ?in/. In the original, both controls are visible: span.login 'Sign In' at (1031,277), cursor pointer, and the icon-only span.vho4K at (1066,393), cursor pointer, data-newga 'NavBar-Search-Click'. With Sift off, a trusted click on the icon opened #searchField 'Latest news, videos, photos' at 570x40. Neither span has a role, href, onclick, tabindex or data-sift-click, so they are dropped. Losing site search breaks the spec ('search … stays usable'). Shots: /home/nico/projects/sift-test-2/research/shots/sk-toi.png, /home/nico/projects/sift-test-2/research/shots/sk-toi-orig.png, /home/nico/projects/sift-test-2/research/shots/sk-toi-orig-search.png

Skeptic's fix lead: In src/content/extract/generic.ts, keep a pointer-cursor span or div in the header or nav as a control. Name it by its own text ('Sign In'). For an icon-only one, use a search hint in its class or data attributes (data-newga 'NavBar-Search', 'search') or the hidden search form beside it (form[name=frmsea], #searchField). The search should become Sift's search field, or a 'Search' button that replays the click so the form opens.

## F827 (medium): La Nación long article: share and count clutter above the text, and an unlabeled '99' button

Found by: T2-news. Where: https://www.lanacion.com.ar/el-mundo/las-claves-del-balotaje-en-brasil-los-votos-decisivos-los-desafios-para-el-lula-4-y-el-rechazo-de-nid26102026/

Evidence: Between the standfirst and the Short version, Sift shows: the link 'Guido Bovone' (already in the meta line 'Guido Bovone · 26 oct 2026, 16:35'), the line '26 de octubre de 2026 14:40 12' minutos de lectura', and the buttons Escuchar, Guardar, Resumen, '99' and 'Compartir WhatsApp'. Tab order: Iniciar sesión, Guido Bovone, Escuchar, Guardar, Resumen, 99, Compartir WhatsApp, then the toggle. A screen reader hears '99, button'. The Neuquén article on the same site still has a clean header, so this depends on the long-form layout. Shot: /home/nico/projects/sift-test-2/research/shots/r8t2-ln-claves-top.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/tabwalk.ts <url> 14

Suspected cause: In this layout the image comes before the H1, and the article's toolbar and byline block are not recognised as the header zone. So the share button and the comment count are kept as actions.

Skeptic: Reproduced. tabwalk.ts on the article gives: Ir al contenido, Buscar en LA NACION, Buscar, Menú, Iniciar sesión, Guido Bovone, Escuchar, Guardar, Resumen, 107, Compartir WhatsApp, then the body links. The outline also has 'p: 26 de octubre de 2026 14:40 12' minutos de lectura', and 'Guido Bovone' repeats the meta line. The original comment button has title='Ir a los comentarios de la nota', but Sift's '107' button has no aria-label or title, so its purpose is lost. The share button stays, although the README says share buttons are removed. Escuchar, Guardar and Resumen are real site actions (Infobae's equivalents are in works.md), so they are fine. The bare-number button is the same class as F648 (number-only buttons, medium).

Skeptic's fix lead: In generic.ts labelOf/usefulControl, use the element's title (or aria-describedby text) as the accessible name when the visible text is only a number ('Ir a los comentarios de la nota, 107'). Also apply the existing share-button drop (dom.ts NOISE share token) to 'Compartir WhatsApp' buttons and to this toolbar. Treat the byline and toolbar block after a hero-image H1 as the header zone, as on the Neuquén layout.

## F828 (medium): La Nación long article: the results map is dropped and leaves loose fragments in the Short version

Found by: T2-news. Where: Same La Nación 'Las claves del balotaje' article, 'El mapa de la victoria' section

Evidence: The original widget (div.ln-root, 896x664) holds a 496x600 SVG map of Brazil (54 paths), totals and a state select. Sift has no map. The Short version shows: buttons 'Lula: diferencia con 1ra vuelta' and 'Bolsonaro: diferencia con 1ra vuelta', then 'Porcentaje de votos', 'Cliqueá en el mapa para más información', 'Mostrando resultados de Brasil', a select 'Seleccionar departamento', 'Lula da Silva', 'Partido de los Trabajadores' and 'votos en blanco:' with no number after it. The full text lists bare legend numbers ('50', '58', '67', '75'). Shot: /home/nico/projects/sift-test-2/research/shots/r8t2-ln-claves-map.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<url> wait:20000 'eval:(()=>{const b=[...document.querySelector("sift-root").shadowRoot.querySelectorAll("button")].find(b=>/Lula: diferencia/.test(b.innerText));b.scrollIntoView({block:"start"});return 1})()' shot:ln-map

Suspected cause: The interactive widget is flattened into text blocks instead of being kept whole as a portal. The Short version then keeps its labels and drops its numbers.

Skeptic: Reproduced for the full text. The original div.ln-root (896x664) holds svg.ln-interactive-map__svg (496x600, 54 paths), a select and two buttons. Sift has no map and no portal for it (its 4 portals are the 3 videos and an Instagram embed). The widget is flattened into loose blocks: the two 'diferencia con 1ra vuelta' buttons, 'Porcentaje de votos', bare '50', '58', '67', '75', 'Cliqueá en el mapa para más información', 'Mostrando resultados de Brasil', a select showing '99999', and label/value pairs as separate paragraphs ('votos nulos:' / '2,1%'). I could not show the Short version myself, because this article's current key now holds a cached no-short marker (see N7/N12). The claimant's shot /home/nico/projects/sift-test-2/research/shots/r8t2-ln-claves-map.png shows the Short version keeping the labels without the numbers ('votos en blanco:' alone). That fits what I saw.

Skeptic's fix lead: In generic.ts, treat an interactive data widget (a container with a large svg of many paths plus its own select or buttons, such as LN's svelte div.ln-root) as one portal, like a map or player, not as text blocks. In short.ts, keepWhole() should keep such a widget whole, so the model never splits labels from values.

## F832 (medium): Times of India article: the lead photo is dropped, and the page is full of clutter

Found by: T2-news. Where: https://timesofindia.indiatimes.com/world/middle-east/rings-of-revenge-how-iranian-women-are-pledging-gold-to-avenge-ayatollah-khamenei/articleshow/135216142.cms

Evidence: The original's lead photo (327x185, alt = the title) is missing: Sift has 0 img, but keeps its caption 'The Nehzat-e Madari movement…' as a plain paragraph. Before the H1 Sift shows 'H2 TOI' with Today's ePaper, Live, News, World News and Middle East News links, a list item repeating the title, and 'Trending'. The byline is only a link 'Vivek Dubey', with no date. Then come Save, '5 Comments' and Print, an ad link 'You use AI every day. Now get your AI Quotient. Take the AIQ test.', the text 'Continue Reading' (the full text is present), the author bio with 'Read More', 'End of Article', 'Follow Us On Social Media', and Videos and Photostories carousels with '1 2 3' buttons. All 10 body paragraphs are present. Shots: /home/nico/projects/sift-test-2/research/shots/r8t2-toi-article.png, /home/nico/projects/sift-test-2/research/shots/r8t2-toi-article-orig.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<url> wait:20000 outline 'eval:document.querySelector("sift-root").shadowRoot.querySelectorAll("img").length' gives 0. In the original, a 327x185 img with the title as alt sits beside the first paragraph.

Suspected cause: 

Skeptic: Reproduced. Sift has 0 img. The original's lead photo (327x185, alt = the title, in section.leadmedia) is missing, while its caption 'The Nehzat-e Madari movement…' (the img's title attribute) shows as a stray first paragraph. Clutter in the outline: 'H2 TOI' with Today's ePaper, Live, News, World News, Middle East News; a list item repeating the title; 'Trending'; Save; '6 Comments'; Print; the ad link 'You use AI every day. Now get your AI Quotient. Take the AIQ test.'; 'Continue Reading'; the author bio with 'Read More'; 'End of Article'; 'Follow Us On Social Media'; and Videos and Photostories carousels with '1', '2', '3' buttons. A content photo is lost and there is noise around the story, so medium. I did not find which rule drops the photo; it passes contentImage's size limits. Outline: /home/nico/projects/sift-test-2/research/shots/sk-toi-art.txt

Skeptic's fix lead: In generic.ts, find why the img in section.leadmedia is dropped. It may be taken as a duplicate of the H1 because its alt equals the title, or its title-attribute caption may be emitted instead. Keep it as the lead figure, with the title attribute as the caption. Add TOI's 'End of Article', 'Continue Reading', 'Follow Us On Social Media', AIQ promo and numbered carousel pagers to the noise rules.
