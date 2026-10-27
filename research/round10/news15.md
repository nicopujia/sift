# Round 10 findings: news15

Each was reproduced by a skeptic. F10xx are new in round 10; older ids are findings a round 10 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F1034 (high): The Mirror: headline links, Sign in and 'Open image' do nothing in Sift, with no explanation; the site blocks clicks until a privacy choice that Sift hides

Found by: T2-news. Where: https://www.mirror.co.uk/ (home) and https://www.mirror.co.uk/news/world-news/president-lula-brazil-election-campaign-37812186 (article)

Evidence: On the home page, act.ts click on 'Storms Boelo and Austen…', 'Harry Kane beats…' and Enter on 'Bank bosses…' (each an <a> with the right href, e.g. …/flood-warnings-alerts-boelo-austen-37811134) left the URL at https://www.mirror.co.uk/ after 7-12 s. On the article, 'User Avatar - redirects to sign in and sign up' and 'Open image' also did nothing (no navigation, no dialog). Menu does work. With Sift off, the original shows a full-page 'We value your privacy' wall (More Options / Reject and Pay / I Accept) over the page. An in-page a.click() on the original anchor (Sift off, body not inert) did not navigate and never reached a click listener on the anchor. So the site swallows clicks until the choice is made. Sift hides that wall and gives no word about it. On the Guardian, Sift explains the same situation ('The site asks for a cookie choice before it plays this video'). A Sift reader on the Mirror has dead headlines. I did not accept the wall, so I could not see the original's behavior after a choice. Shots: /home/nico/projects/sift-test-2/research/shots/r10t2-mirror-orig-avatar.png (original with the wall), /home/nico/projects/sift-test-2/research/shots/r10t2-mirror-art.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.mirror.co.uk/ wait:8000 click:"Harry Kane beats" wait:10000 url  → prints https://www.mirror.co.uk/ (no navigation). Then press:Alt+Shift+S to see the original's privacy wall.

Suspected cause: The consent manager (Reach / Quantcast qc-cmp2) blocks clicks in the capture phase while consent is pending. Sift replays the click on the original element, where it is swallowed. Sift's consent explanation (F826) seems to run only for video Play, not for links or buttons that a pending consent blocks.

Skeptic: Reproduced twice on the Mirror home page in Sift. act.ts clicks on 'Harry Kane beats…' and 'Bank bosses…' left the URL at https://www.mirror.co.uk/ after 10 s. On the article, 'Open image' also did nothing: no navigation and no Sift layer. I switched to the original and saw the full-page InMobi/Quantcast 'We value your privacy' wall (screenshot: research/shots/skeptic-mirror-orig.png). I dispatched a click on the original anchor with Sift off and traced it. The InMobi CMP's document capture-phase listener (cmp.inmobi.com/tcfv2/61/cmp2ui-en.js) calls preventDefault and stopImmediatePropagation on the click, so the anchor never gets it. Sift's outline has no privacy, cookie or consent text. A new Sift reader on the Mirror gets dead links and buttons, with no hint that a choice is pending and no way to make it inside Sift. The only consent explanation (F826, consentFirst) runs on video Play.

Skeptic's fix lead: In src/content/index.ts H.act (around proxy.click(el) near line 3315), check after the replayed click whether it was default-prevented and whether consentWallUp() returns a wall. If so, show that wall the way the Play path does (askConsent(true) and consentKey, near lines 1901-1935), with a new i18n line such as 'The site asks for a cookie choice before it opens links'. In generic.ts, the consent-why block (around line 6807) should then also cover links and buttons. Do not navigate around the wall.

## F1037 (medium): La Nación Claves: the 'El giro político de los gobiernos sudamericanos' maps are lost; only the title, legend and the years show

Found by: T2-news. Where: https://www.lanacion.com.ar/el-mundo/las-claves-del-balotaje-en-brasil-los-votos-decisivos-los-desafios-para-el-lula-4-y-el-rechazo-de-nid26102026/ (section 'El freno a la ola azul')

Evidence: The original has a 896x867 graphic (div.ln-nd-mapa-gobiernos-latam-nuevo-title, 2 svgs). It shows two maps of South America for 2006 and 2026, with each of ten countries colored Izquierda or Derecha. Sift, in both the Short version and the full text, shows only the lines 'El giro político de los gobiernos sudamericanos', 'La orientación política de diez gobiernos…', 'Izquierda Derecha', '2006', '2026' and the Venezuela footnote. There is no portal or image, and the country names are gone. The reader cannot tell which governments were left or right, which is the point of the graphic. Shots: /home/nico/projects/sift-test-2/research/shots/r10t2-ln-giro-sift.png (Sift), /home/nico/projects/sift-test-2/research/shots/r10t2-ln-giro-orig.png (original)

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<claves url> wait:20000 'eval:(()=>{const R=document.querySelector("sift-root").shadowRoot;const t=R.querySelector(".sift").innerText;const i=t.indexOf("El giro político");return [t.slice(i,i+250),[...R.querySelectorAll("[aria-label]")].map(e=>e.getAttribute("aria-label")).filter(l=>/giro|gobiernos/i.test(l))]})()'  → loose legend lines and no portal.

Suspected cause: The F929 small-chart rule keeps seat charts whose text is labels plus numbers. This map's text is a title, a legend and country names with no numbers, so it falls through to text blocks. The SVG drawing is dropped, and the country labels are dropped as well.

Skeptic: Reproduced in both the Short version and 'Ver texto completo'. Sift shows only 'El giro político de los gobiernos sudamericanos', the subtitle, 'Izquierda Derecha', '2006', '2026' and the Venezuela footnote. It has no portal and no image (screenshot: research/shots/skeptic-ln-giro-sift.png). The original div.ln-nd-mapa-gobiernos-latam-nuevo-root (896x867, 2 SVGs) draws two South America maps for 2006 and 2026, each country colored left or right (screenshot: research/shots/skeptic-ln-giro-orig.png). The ten country names are SVG <text>, which Sift drops. The code explains it. dataWidget needs a select or button. dataChart needs at least 3 numeric parts outside the SVG, and chartParts skips SVG text, so only 2006 and 2026 count. The graphic falls through to text blocks, and SKIP drops the svg.

Skeptic's fix lead: In src/content/extract/generic.ts, widen dataChart (around line 1797) or add a sibling check for a captioned SVG graphic in an article. A box of at least 300x200 holding SVGs with many path/polygon shapes and SVG <text> labels, with only a title, legend and footnote outside, should be kept as a chart portal like F929. Its SVG text labels could also be read into the label so screen readers get the country names.

## F1038 (medium): Mirror article: unrelated 'READ MORE' promo links sit inside the Short version

Found by: T2-news. Where: https://www.mirror.co.uk/news/world-news/president-lula-brazil-election-campaign-37812186

Evidence: Between the second and third Short version paragraphs, Sift shows 'READ MORE: New HMRC £1,000 tax alert for anyone selling items in 'side hustle' message' and 'READ MORE: Jamie Oliver's wife says living with undiagnosed issue 'ruined 45 years' of her life'. Neither is related to the Lula story. In the original they are TextLink promos inside the body (580x43, 592x43). The spec says Sift removes promos. Shot: /home/nico/projects/sift-test-2/research/shots/r10t2-mirror-art.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/visit.ts https://www.mirror.co.uk/news/world-news/president-lula-brazil-election-campaign-37812186 x --wait 30000  → the outline has '[link] New HMRC £1,000 tax alert…' and '[link] Jamie Oliver's wife…' between the article paragraphs.

Suspected cause: An inline 'READ MORE:' label followed by a link to another story is kept as article content. A rule that drops in-body 'Read more / READ MORE / Also read' cross-links (as done for related-story boxes) does not catch this Mirror markup.

Skeptic: Reproduced on two loads. Between the article paragraphs, Sift shows 'READ MORE: New HMRC £1,000 tax alert…' and 'READ MORE: Jamie Oliver's wife says…' as linked paragraphs. Neither is related to the Lula story (screenshot: research/shots/skeptic-mirror-sift-readmore.png). In the original, each is a div.ReadMore_readmore-container holding span[data-testid=readmore] 'READ MORE:' and an <a data-tmdatatrack='read-more'> to another story. These are in-body cross-promos, which the spec says Sift removes. Medium is fair: two noise lines inside the Short version.

Skeptic's fix lead: In src/content/extract/generic.ts, drop an in-article block whose text is only a 'Read more / READ MORE / Also read / Leer más / Leia também:' label plus one link to another article. Match by text pattern and by class or test-id tokens (readmore, read-more). The check could go in the promo test or the noise token regex in src/content/dom.ts (around line 805), which already lists 'related' and 'promo' but not 'read-?more'.

## F1039 (medium): Mirror article: two in-article photos are lost and show only as long 'View 3 Images …' links

Found by: T2-news. Where: https://www.mirror.co.uk/news/world-news/president-lula-brazil-election-campaign-37812186

Evidence: The original has three photos, each a 604x490 button.SlideViewerButton holding an <img loading=lazy src=… alt=…>. Sift shows the first photo (eager) with its caption. The second and third become text links: 'View 3 Images Re-elected President of Brazil Luiz Inacio Lula da Silva delivers a victory speech… (Image: Anadolu via Getty Images)' and 'View 3 Images Federal Deputy Andre Janones, a key election ally, embraces President Lula…', with no picture. Shot: /home/nico/projects/sift-test-2/research/shots/r10t2-mirror-art.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<mirror article> wait:20000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("img")].length' gives 1 (plus none for the lazy ones). Compare with 'eval:document.querySelectorAll("button[class*=slide-viewer] img").length' = 3 in the original.

Suspected cause: A lazy image inside a <button> (a gallery opener) is turned into an action with the button's text, and the image is not kept. The lazy <img> is also never loaded, because the hidden original is not scrolled to it.

Skeptic: Reproduced on two loads. Sift's view has 1 <img>, the first photo. The second and third photos appear only as links: 'View 3 Images Re-elected President of Brazil…' and 'View 3 Images Federal Deputy Andre Janones…'. In the original, all three are button.SlideViewerButton (604x490) with an <img srcset>. The first is loading=eager, the other two loading=lazy and never loaded (naturalWidth 0, getBoundingClientRect width 0, height 402). photoButton (generic.ts around line 1947) needs img width of at least 160, so the lazy ones fail. They are then handled as a button with the button's text. Their content photos are lost.

Skeptic's fix lead: In src/content/extract/generic.ts photoButton, measure an unloaded lazy img by its button's or parent's width when its own rect width is 0, or reuse the lazy-size fallback from contentImage (around line 1628). Then figure()/contentImage keep the photo with its src from srcset or src, and the caption becomes the figcaption, not a link label.
