# Round 9 findings: lnac13

Each was reproduced by a skeptic. F9xx are new in round 9; older ids are findings a round 9 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F924 (high, regression): La Nación Claves: 'Reproducir' on the lead video does nothing in Sift, while a click on the original plays it

Found by: T2-news. Where: https://www.lanacion.com.ar/el-mundo/las-claves-del-balotaje-en-brasil-los-votos-decisivos-los-desafios-para-el-lula-4-y-el-rechazo-de-nid26102026/ (first video, 'El discurso de Lula Da Silva…', vertical poster)

Evidence: I tried twice, after 15 s and after 30 s. Clicking Sift's 'Reproducir' left 0 <video> elements in the page, and all three buttons still read 'Reproducir' 10-12 s later. With Sift switched off, a trusted click on the original poster (div.relative.cursor-pointer, 590x1049) created the player and played 6.4/86.5 s. works.md line 70 ('La Nación Claves 7.1/86.5 s then paused') no longer holds. Sift's portal for this video has role=img and aspect-ratio 0.563. On another La Nación article (Alfredito), the horizontal JW video plays and pauses through Sift. Shots: /home/nico/projects/sift-test-2/research/shots/r9t2-ln-claves-play.png, /home/nico/projects/sift-test-2/research/shots/r9t2-ln-claves-orig-play.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<url> wait:30000 click:Reproducir wait:12000 'eval:[document.querySelectorAll("video").length]' gives [0]. To compare with the original: switch Sift off with press:Alt+Shift+S, then click the element closest to the img whose alt matches /discurso de Lula/ (div.relative.cursor-pointer) with a real mouse click. A video then plays (86.5 s).

Suspected cause: The vertical poster is taken as an image portal (role=img). Sift's Play goes to the wrong element, or playFacade's proxy.click does not reach the site's handler on this poster. This may have changed with the merged playFacade code (F826).

Skeptic: Reproduced twice, after 30 s and after about 15 s. Clicking Sift's first 'Reproducir' (the vertical 'El discurso de Lula…' portal, role=img, aspect ratio 0.563) left 0 <video> elements, and all 3 buttons still read 'Reproducir' 12 s later. With Sift off, a trusted click on div.relative.cursor-pointer (590x1049) played the video: 6.81/86.46 s, not paused. The original has no button named Reproducir or Play. So playControl(portal) in src/content/index.ts:48 finds nothing, and media('play') falls through to v?.play() with no video, which does nothing. I did not check the regression part (whether round 8's 'Claves' line was this same video).

Skeptic's fix lead: src/content/index.ts media() case 'play' and playControl(): when no labeled Play control exists, run playFacade on the poster's clickable element (the largest element in the portal with cursor:pointer or a click handler, else the portal root) instead of the no-op v?.play().

## F929 (medium): La Nación Claves: the Diputados and Senado seat charts are lost; the Short version keeps only their legends

Found by: T2-news. Where: Same La Nación 'Las claves del balotaje' article, under 'El desafío del Congreso'

Evidence: The original has two svelte chamber charts (.eleccion_camara, 840x320). Diputados: PT + ALIADOS 124, BOLSONARISMO 131, CENTRO 245, OTROS 13, 513 bancas. Senado: 19, 31, 30, 1 of 81. Sift has no portal for them. The full text shows the numbers only as loose lines. The Short version keeps the H2s 'Diputados' and 'Senado' and the legend notes ('PT y aliados: PT, PCdoB, PV…') but drops every seat count. So the reader sees chart headings with a legend and no chart. Shots: /home/nico/projects/sift-test-2/research/shots/r9t2-ln-claves-diputados-sift.png, /home/nico/projects/sift-test-2/research/shots/r9t2-ln-claves-diputados-orig.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<claves url> wait:40000 'eval:(()=>{const t=document.querySelector("sift-root").shadowRoot.querySelector(".sift").innerText;const i=t.indexOf("El desafío del Congreso");return t.slice(i,i+900)})()' shows no 124/131/245. Compare with 'eval:[...document.querySelectorAll(".eleccion_camara")].map(c=>c.innerText.replace(/\s+/g," "))'.

Suspected cause: F828's fix keeps a data widget whole only when it has a large many-path svg plus its own controls. The chamber chart (one svg, no select or buttons) still falls through to text blocks, and the condense model drops the bare numbers.

Skeptic: Partly reproduced. It is intermittent. The charts get no portal: Sift's portals on the page are the 3 videos, the results map and Instagram, while the original has two .eleccion_camara svgs (840x320, 4 paths each). The full text shows the counts as loose lines ('PT + Aliados 124 / Bolsonarismo 131 / Centro 245 / Otros 13 / 513 bancas'). On my 2 loads, the Short version shown kept the counts (the cached 00:08:31 version, then the new 01:21:28 one). In the cache, 4 of the 7 saved Short versions (00:05:25, 00:05:43, 00:05:54, 00:31:29) have '## Diputados' and '## Senado' followed only by the legend ('PT y aliados: PT, PCdoB, PV…') and no seat counts. So what a reader sees depends on which version the visit gets (see F829).

Skeptic's fix lead: src/content/extract/generic.ts (the F828 data-widget rule): keep a small chart whose text is only labels and numbers (like .eleccion_camara) as one non-text block. A [[B]] placeholder or a small table means the condense model cannot drop the numbers, and the Short version keeps them verbatim.
