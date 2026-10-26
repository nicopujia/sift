# Round 6 findings: news7

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F645 (medium): Infobae: closing the search panel opens a stray modal of the site's top nav bar

Found by: T2-news. Where: https://www.infobae.com/america/ (Sift, 1280 px)

Evidence: After 'Buscar en todo el sitio' and then 'Cerrar' (with or without typing a query), Sift opens an aria-modal dialog labelled '24 Oct, 2026'. It holds Cerrar, Mundo, Últimas Noticias, Tecno, Entretenimiento, REGISTRARME and INICIAR SESION, and focus moves into it (Tab lands on 'Mundo'). Reproduced 2 of 2. Seen through Sift's switch, the original has nothing open, only its normal sticky masthead bar (div#mastheadnavbar, position:fixed). Escape closes the stray dialog. Shots: /home/nico/projects/sift-test-2/research/shots/r6t2-ib-after-cerrar.png (Sift), /home/nico/projects/sift-test-2/research/shots/r6t2-ib-after-cerrar-orig.png (original).

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.infobae.com/america/ wait:8000 'click:Buscar en todo el sitio' wait:3000 'click:Cerrar' wait:3000 'eval:(()=>{const d=document.querySelector("sift-root").shadowRoot.querySelector("[role=dialog],dialog[open]");return d&&d.getAttribute("aria-label")})()' gives '24 Oct, 2026'. On a fresh load, with no search opened, there is no dialog.

Suspected cause: Once the queryly overlay closes, the fixed #mastheadnavbar is taken for a panel the page opened in answer to the user's action, and it is shown as a modal sheet.

Skeptic: Reproduced 2 of 2 on infobae.com/america at 1280 px. A fresh load has no dialog. After 'Buscar en todo el sitio' and then 'Cerrar', Sift shows an aria-modal=true dialog labelled '24 Oct, 2026'. It holds Cerrar, Mundo, Últimas Noticias, Tecno, Entretenimiento, REGISTRARME and INICIAR SESION, and focus is on Cerrar. Shot: research/shots/skeptic-ib-after-cerrar.png. Through Sift's switch, the original has nothing open. #mastheadnavbar is the normal header: position:fixed, display:flex, top 96 px (under the ad slot), 144 px tall (shot research/shots/skeptic-ib-after-cerrar-orig.png). So Sift turns the site's fixed masthead into a modal the user never opened, and moves focus into it.

Skeptic's fix lead: generic.ts popupLike() counts a full-width bar as page layout only when r.top <= 2. Infobae's masthead sits at top 96 under an ad slot, so once the search overlay's close touches it, it passes as a fresh popup. Count a full-width, short, fixed/sticky box anywhere in the top ~30% of the viewport as a bar. Or reject a candidate whose links the previous page view already showed (shownBefore).

## F646 (medium): BBC at 600 px: a content map is dropped because its lazy image has no width/height attributes

Found by: T2-news. Where: https://www.bbc.com/news/articles/c9zrdknlmpdlo at 600x900 (also its Short version)

Evidence: At 1280 px Sift shows 8 article images, including '[img] Map of the coast of Busan, South Korea, where a shark was spotted in a canal near Bukhang (North Port)…'. At 600 px it shows 7, and the map is missing (/home/nico/projects/sift-test-2/research/shots/r6t2-bbc-shark-600.txt). In the original at 600 px that img has loading=lazy, src and srcset (ichef.bbci.co.uk/news/480/…), no width or height attribute, naturalWidth 0 and a 0 px rect. The F544 fix keeps lazy photos that carry size attributes (Jade, Faucher), but not this one.

Repro: Set the viewport to 600x900 (scratchpad t2/narrow.ts: bun narrow.ts https://www.bbc.com/news/articles/c9zrdknlmpdlo 600 name 60000) and count shadowRoot article img elements: 7, with no 'Map of the coast' alt. At 1280 px the count is 8.

Suspected cause: contentImage() still needs a rendered size or width/height attributes for a lazy image. An unloaded lazy <img> with src/srcset and a meaningful alt inside the article body should be kept, for example at column width.

Skeptic: Reproduced 2 of 2 at 600x900. Both the Short version and the full text show 7 images, without 'Map of the coast of Busan…'. At 1280 px both show 8, with the map. The cause is not the one claimed. contentImage() already has a lazy fallback (generic.ts 1310-1316) that would keep a 568x0 lazy img with a 16:9 height. The map's figure holds two imgs. The first is BBC's grey-placeholder.png (aria-label 'image unavailable', 568x319.5, inside the figure's box). The second is the real lazy img (568x0, so it fails the 'framed' overlap test). figureImage() (~generic.ts 4671) narrows the list to framed imgs, which leaves only the placeholder. It skips the placeholder, then returns `best ?? imgs[0]`, which is the placeholder again. contentImage rejects that by LOGO_TOKEN ('placeholder' in its src), so the map is lost. A content map dropped at narrow widths also affects zoomed users. Medium holds.

Skeptic's fix lead: In figureImage() (generic.ts ~4671-4695), filter out placeholder imgs (LOGO_TOKEN src, alt/aria-label 'unavailable|placeholder') before the 'framed' narrowing. Or ignore 'framed' when every framed img is a placeholder. Never return a placeholder as the `imgs[0]` fallback. Then contentImage's existing lazy 16:9 fallback keeps the real map.

## F647 (medium): La Nación Short version drops the embedded X posts (with the goal video) and lists their hashtags and dates as links

Found by: T2-news. Where: https://www.lanacion.com.ar/deportes/futbol/julian-alvarez-le-dio-el-triunfo-a-atletico-madrid-el-publico-lo-reconocio-y-el-se-disculpo-yo-nid24102026/

Evidence: The full text shows 4 X posts as portals ('Área interactiva de la página original: X Post'), and the first holds the goal video (shot /home/nico/projects/sift-test-2/research/shots/r6t2-ln-video-xpost.png). The Short version has none of them. Instead, under 'Enlaces del texto completo', it lists '#ChampionsLeague', '#LaLigaxESPN', '#LaLiga', '#DisneyPlus', four 'pic.twitter.com/…' links and four 'October 24, 2026' links (/home/nico/projects/sift-test-2/research/shots/r6t2-ln-video.txt lines 32-44). The Short version shows no video, while the original article leads with these embeds.

Repro: Open the URL in Sift, wait for 'Ver texto completo', and read the outline: no PORTAL, and the 'Enlaces del texto completo' list holds the hashtags and dates. Click 'Ver texto completo': 4 X Post portals appear.

Suspected cause: The embed placeholders the model drops are not put back the way photos are, and the links inside the embeds' fallback blockquotes are counted as article links that 'left with their sentence'.

Skeptic: Partly confirmed: the link list is real, the video part did not reproduce. On a fresh Short version from the current worker (and again on a reload), 'Enlaces del texto completo' lists 12 junk links: #ChampionsLeague, #LaLigaxESPN, #LaLiga, #DisneyPlus, 4 pic.twitter.com/… links and 4 'October 24, 2026' links. The Short version has no X posts. Not reproduced: 'drops the goal video'. In my two loads X's widget never rendered: the original had 4 blockquote.twitter-tweet (74-110 px) and no iframes. So the full text shows them as 4 quote blocks, not portals, and the model's summary covers their content (the apology, Simeone's praise). Also, the claimant's own shot shows that video as 'Este video no está disponible en tu ubicación'. The defect is the noise list appended to the Short version on any article with tweet fallbacks. Severity is closer to low-medium.

Skeptic's fix lead: Treat social-embed fallbacks (blockquote.twitter-tweet, .instagram-media, tiktok-embed) as one embed block that short.ts keepWhole() keeps whole. They are then put back, not condensed, and their links are never listed. Also, in planShort's extra-links loop, skip hashtag links ('#…'), pic.twitter.com links and twitter.com/x.com status permalinks.

## F648 (medium): Fox News article (new site): unlabeled reaction buttons and in-body promos are left in

Found by: T2-news. Where: https://www.foxnews.com/world/nearly-1000-arrested-across-france-police-find-potential-weapons-protestors

Evidence: Under the standfirst, Sift shows 8 buttons named only by numbers: '64', '17', '14', '5', '3', '2', '1', '+ 3' (/home/nico/projects/sift-test-2/research/shots/r6t2-fox-france.txt lines 10-17; shot r6t2-fox-france.png). They are the hedgehog-reactions emoji pills. The original buttons hold an emoji img with alt '👍' and a count, so a screen reader hears only '64, button'. Pressing one would post a reaction. In-body promos also stay: '[link] AMERICANS WARNED ABOUT PARIS TRAVEL AFTER VIOLENCE, LOOTING AND TEAR GAS-FILLED STREETS' (line 26), '[link] FRANCE'S TEEN RIOTS TAKE EXPLOSIVE NEW TURN…' (line 33), '[link] CLICK HERE TO DOWNLOAD THE FOX NEWS APP' (line 54), and a bare '[link] Video' (line 40).

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/visit.ts <url> fox --wait 20000 and read the outline lines listed. Do not click the reaction buttons.

Suspected cause: The reaction pills sit in a shadow root (hedgehog-reactions). Their label comes from the count span only, and they are not recognised as social or engagement noise. The all-caps 'related story' and app-download links inside the body are not matched by the promo filters.

Skeptic: Reproduced 2 of 2 on the Fox France article. Under the first H2, Sift shows `<button class="btn">84</button>`, then 25, 22, 6, 3, 2, 2 and '+ 4', with no aria-label. In the original, hedgehog-reactions' shadow-root buttons each hold an img (alt 👍 🔥 🍿 👎 🫶 ⚖️ 😢 😤 💡) plus a count. So Sift lost the only thing naming them, and they are engagement controls that post a reaction. I did not click them. In-body promos also stay: '[link] AMERICANS WARNED ABOUT PARIS TRAVEL…', '[link] FRANCE’S TEEN RIOTS TAKE EXPLOSIVE NEW TURN…', '[link] CLICK HERE TO DOWNLOAD THE FOX NEWS APP' and a bare '[link] Video'. They appear in the Short version too, put back as link-heavy blocks. Also seen, not claimed: a '[PORTAL] MVPD Picker' (the TV-provider widget).

Skeptic's fix lead: In generic.ts, drop reaction rows (hedgehog-reactions, or a row of buttons whose content is only an emoji img plus a number) as engagement noise, like share buttons. At minimum, name each button from its img alt. Widen PROMO_STRONG's 'download (our|the) app' to allow a brand name ('download the fox news app'). Treat Fox's standalone all-caps related-story link paragraphs inside the body as promos.

## F649 (medium): Le Monde home (new site): an app-download promo and orphan photo credits are left in

Found by: T2-news. Where: https://www.lemonde.fr/ (redirects to /en/), 1280 px

Evidence: /home/nico/projects/sift-test-2/research/shots/r6t2-lemonde-home.txt: 'H2 Application' / 'p: Le Monde's app' / 'p: Follow your favorite topics and never miss a headline.' / '[link] Download' (lines 35-38). Photo credits whose photos were removed stay as meta lines under the headlines: 'SAMEER AL-DOUMY/AFP' (7), 'HERVÉ LEQUEUX/HANS LUCAS FOR LE MONDE · Feature' (14), 'MICHELE LAPINI/REUTERS' (19), 'THIERRY LAPORTE FOR LE MONDE' (26), 'KEYSTONE/GAMMA-RAPHO · In Depth' (34) and 'MASSIMO VALICCHIA/NURPHOTO/AFP' (64). Le Monde articles answered with a 'Client Challenge' captcha, so I stopped there and did not test them.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/visit.ts https://www.lemonde.fr/ lm --wait 20000 and read the outline lines listed.

Suspected cause: The app block has a heading and a CTA link, so it passes as a section. Credit text inside a dropped figure or picture is kept as card meta.

Skeptic: Confirmed, at medium-low severity. Orphan credits reproduced 2 of 2 on lemonde.fr/en: 'SAMEER AL-DOUMY/AFP', 'HERVÉ LEQUEUX/HANS LUCAS FOR LE MONDE · Feature', 'MICHELE LAPINI/REUTERS', 'THIERRY LAPORTE FOR LE MONDE', 'KEYSTONE/GAMMA-RAPHO · In Depth · By Clément Martel', plus one more each run ('DAMIEN PERRONNET/SOTHEBY'S' / 'KENZA LE BAS'). In the original they are span.ds-card__media__figcaption__text inside the card photo's figcaption (103x9 px). Sift drops the photo and keeps its credit as a meta line. The promo slot rotates. I did not see 'Application / Le Monde's app / Download'. In 1 of 2 loads the same slot held another promo: '[link] Partner Services' + 'Le Monde for hotels · In French and English. Only on PressReader. Get a free quote…'. The other load had neither.

Skeptic's fix lead: In generic.ts card/meta extraction, drop text from a figcaption inside a card's media (.ds-card__media, or any figure/picture whose image was not kept) instead of turning it into card meta. Treat a home-page block made of a short heading or label plus one CTA link ('Download', 'Partner Services', 'Get a free quote') as a promo in promoText/promoCard.

## F650 (medium): La Nación sign-in page drops the 'Buscar con DNI' account-recovery link and the terms notice

Found by: T2-news. Where: https://www.lanacion.com.ar/ -> INICIAR SESIÓN -> login.lanacion.com.ar/u/login/identifier

Evidence: The original page reads: Email, INICIAR SESIÓN, 'Registrate SIN CARGO', 'Ó INGRESÁ CON TU EMAIL', Google/Facebook/Apple, '¿SOS SUSCRIPTOR Y OLVIDASTE TU EMAIL?' with the visible link 'Buscar con DNI' (a.dni-link, 21 px tall), and 'Al continuar, confirmo que he leído y acepto…' with the links 'Términos y Condiciones' and 'Políticas de Privacidad'. Sift's view ends after 'Iniciar sesión con Apple'. 'Buscar con DNI' and the terms text are missing (the eval found no 'DNI' and no 'confirmo' in Sift's text). A subscriber who forgot their email has no way to recover the account from Sift. Shot /home/nico/projects/sift-test-2/research/shots/r6t2-ln-login.png

Repro: Open https://www.lanacion.com.ar/ in Sift, click INICIAR SESIÓN, wait 8 s, then eval /DNI/.test(document.querySelector('sift-root').shadowRoot.querySelector('.sift').innerText): it gives false. In the original, document.querySelector('a.dni-link') is visible. Do not submit.

Suspected cause: The lower block (section.container-dni plus the legal paragraph) is treated as a footer or legal noise and dropped as a whole, recovery link included.

Skeptic: Reproduced 2 of 2: La Nación home, then INICIAR SESIÓN, then login.lanacion.com.ar/u/login/identifier. Sift's text has no 'DNI', no 'OLVIDASTE' and no 'confirmo/Términos', and it ends after 'Iniciar sesión con Apple'. The original shows '¿SOS SUSCRIPTOR Y OLVIDASTE TU EMAIL?' and 'Buscar con DNI'. That link is a.dni-link: visible, top 746, 21 px tall, href ingresar.lanacion.com.ar/login/buscar-con-dni. Below it is div.terms, 'Al continuar, confirmo que he leído y aceptado los Términos y Condiciones y las Políticas de Privacidad…', which is not inside a footer. So the account-recovery path is missing from Sift's view. Also seen, minor: the 'ó ingresá con tu email' divider now appears after the email form, not before it. I did not submit anything.

Skeptic's fix lead: generic.ts's legal/footer filtering (LEGAL ~line 525 and the footer-like block drop) removes this lower block of the sign-in card. Do not drop a block that sits inside or right after the page's sign-in form and is not in footer/contentinfo. Always keep an action link there (account recovery). Keep a terms notice tied to a form as small text.

## F76 (still open, partly; original repro in /home/nico/projects/sift/research/round5/*.md)

Recheck by T2-news: Fixed on La Nación home: the radio promo ('El mundo necesita más música' / 'Escuchá + música') and the empty 'H3 Ln Juegos' are gone, and 'H3 Que Sale?' now holds 4 stories. Also fixed: the Daily Mail home has no 'Shorts' orphan, and the Daily Mail article shows '+6 View gallery' once. Still on La Nación home (/home/nico/projects/sift-test-2/research/shots/r6t2-ln-home.txt): 'H2 Selección del Editor' is directly followed by another H2 (lines 25-26), and the quiz promo '[link] Edición especial: ¿De qué año son estas fotos de Charly García?' + 'p: Juegos' remains (lines 106-107).

Skeptic: Status 'partly' holds (one load, La Nación home, 1280 px). Line 26 'H2 Selección del Editor' is directly followed by 'H2 A Fondo ¿Dónde está Nanci?…' (an empty section heading). The quiz promo remains: '[link] Edición especial: un juego pregunta de qué año son estas fotos de Charly García' + 'p: Juegos' (lines 105-106). Outline: research/shots/skeptic-ln-home.txt. I did not recheck the Daily Mail items reported as fixed.

Skeptic's fix lead: In generic.ts dropEmptyHeadings(), also drop a heading followed directly by a heading of the same or higher rank. Treat La Nación's games module (a 'Juegos' label under an 'Edición especial' quiz link) as a promo in promoText/promoCard.
