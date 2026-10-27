# Round 11 findings: news16

Each was reproduced by a skeptic. F11xx are new in round 11; older ids are findings a round 11 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F1125 (medium): NY Post article opens with an unrelated autoplaying 'Today's Video Headlines' video

Found by: T2-news. Where: https://nypost.com/2026/10/26/tech/microsoft-announces-buyouts-for-60k-employees-quarter-of-workforce-as-part-of-ai-transformation/

Evidence: The Sift outline shows these between the byline and the Short version: '[PORTAL] Interactive area from the original page: Connatix video player', 'Today's Video Headlines', 'Keep Watching', '[button] Close Player'. The player shows a clip about a Florida A&M shooting, which has nothing to do with the Microsoft story. It autoplays muted inside Sift's view (currentTime 22.5 s, then 25.5 s 3 s later). It pushes the Short version below the first screen. It is the site's own video-playlist widget, not the article's content. The spec says video stays only when it is content. Shot: /home/nico/projects/sift-test-2/research/shots/r11t2-nypost-art.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://nypost.com/2026/10/26/tech/microsoft-announces-buyouts-for-60k-employees-quarter-of-workforce-as-part-of-ai-transformation/ wait:15000 outline 'eval:[...document.querySelectorAll("video")].map(v=>[v.currentTime.toFixed(1),v.paused,v.muted])' wait:3000 'eval:[...document.querySelectorAll("video")].map(v=>[v.currentTime.toFixed(1),v.paused])'

Suspected cause: A Connatix (cnx) player is kept as a portal like an article video. Nothing tells a site-wide 'video headlines' playlist apart from the story's own video.

Skeptic: Reproduced on three loads. Every time, the Sift view has the Connatix 'Today's Video Headlines' player between the byline and the Short version, with 'Keep Watching' and 'Close Player'. In one of the three loads it autoplayed muted inside Sift's view (13.0 s, then 28.0 s). In the other two it stayed paused at 0.0. The clip I saw was about JD Vance at a rally, not Microsoft, so it is a rotating site-wide playlist and not the story's video. At 1280x813 it pushed the Short version below the first screen. The original has the same cnx-main-container inside ARTICLE after the byline, but by the spec this is noise, not content.

Skeptic's fix lead: In src/content/extract/generic.ts, in the video/portal keep path (the playerOf and lead-video logic around line 7945), skip players that are site playlists or outstream players: a Connatix cnx-* container, or a player whose own text is 'Today's Video Headlines' or 'Keep Watching', or which has its own 'Close Player' button.

## F1126 (medium): NY Post Short version drops the second article photo and shows its caption as body text

Found by: T2-news. Where: https://nypost.com/2026/10/26/tech/microsoft-announces-buyouts-for-60k-employees-quarter-of-workforce-as-part-of-ai-transformation/

Evidence: The original has two content photos, 'Microsoft office' and 'Microsoft data center' (both 734 px, loaded). The Short version shows only the first one. After the last Short paragraph it shows 'p: An aerial view of agricultural land acquired by Microsoft in Middenmeer … Anadolu via Getty Images' as a paragraph with no picture. 'Show full text' has both images (["Microsoft office","Microsoft data center"]).

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<url above> wait:50000 'eval:(()=>{const R=document.querySelector("sift-root").shadowRoot;return [[...R.querySelectorAll("main img")].map(i=>i.alt),[...R.querySelectorAll("main p")].map(p=>p.innerText).filter(t=>/aerial view/.test(t))]})()'  → [["Microsoft office"],["An aerial view…"]]

Suspected cause: When the Short version is built, the photo slot after the paragraphs is not placed again, but its caption text is kept as a paragraph.

Skeptic: Reproduced on two fresh loads with the browser cache off. The 'Microsoft data center' photo is missing, and its caption 'An aerial view of agricultural land… Anadolu via Getty Images' shows as a plain paragraph. Wheel-scrolling Sift's view until the caption is on screen (top 112) does not load it. One detail of the claim is wrong: on a fresh load, 'Show full text' is also missing the photo and also shows the caption as a paragraph, so the Short version is not the cause. Both images show in both modes only after the original's lazy image has loaded some other way, from an earlier scroll or a cached copy. The original img has loading=lazy, srcset only, an aspect-ratio style and no width attribute, inside a display:table figure that is 78 px wide. Its box is 0x0, so contentImage drops it.

Skeptic's fix lead: In src/content/extract/generic.ts, change lazyWidth/contentImage (around lines 1694-1720). When a lazy or srcset img has a 0x0 box, take its width from the px value in its sizes attribute or from the first ancestor wider than minW, past the shrink-wrapped figure, and take its height from the aspect-ratio style. When a figure's image is dropped, drop its figcaption too instead of emitting it as a paragraph.

## F1127 (medium): BBC Search dialog is named after the page H1, so a screen reader announces the wrong dialog

Found by: T2-news. Where: https://www.bbc.com/news and BBC articles (the Search button in Sift's header)

Evidence: After 'Search', Sift's sheet has aria-label 'Breaking news, video and the latest top stories from the U.S. and around the world' on the home page. On https://www.bbc.com/news/articles/cq398p1wd1evo it is labelled with the article title, 'Anthropic warns of 'catastrophic risk' to humankind ahead of blockbuster share listing'. The dialog holds the 'Site search' field and the nav links. The search itself works (/search?q=Starlink). Menu dialogs are named 'Menu' correctly. Shot: /home/nico/projects/sift-test-2/research/shots/r11t2-bbc-search.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.bbc.com/news wait:8000 click:Search wait:1500 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("[role=dialog]")].map(d=>d.getAttribute("aria-label"))'

Suspected cause: The BBC search drawer has no name of its own, and the sheet-naming fallback takes the nearest or first heading (the page H1) instead of the opener's label ('Search').

Skeptic: Reproduced on two pages. After Search on bbc.com/news, Sift's dialog has aria-label 'Breaking news, video and the latest top stories from the U.S. and around the world'. On the article cq398p1wd1evo it is the article H1, 'Anthropic warns of 'catastrophic risk'…'. The dialog holds Close, Site search, Search and the nav links. The original BBC drawer has no dialog role or name, so Sift falls back to page.title. A screen reader announces the article title when the user opens Search.

Skeptic's fix lead: In src/content/ui/app.tsx line 1143 (const name = d.title || firstLine(d.blocks) || page.title), use the label of the Sift opener the user pressed, or the dialog's search field label, before page.title. Or set title from the opener in generic.ts where the drawer dialog is built, the way line 7239 does for aria-haspopup panels.

## F1128 (medium): At 200% zoom the Daily Mail article and video pages lose their Login link

Found by: T2-news. Where: http://127.0.0.1:8799/dailymail-article and http://127.0.0.1:8799/dailymail-article-video at 640x450, scale 2

Evidence: At 200% zoom, Sift's header has only 'Enter your search' and 'Search', and no a/button anywhere in Sift matches /log ?in/ (0). At 1280 px the same page has '[link] Login' (78 px, href …/registration/login.html). The original at the same 640 px width shows a 'Login' link (71 px wide, top 3). The Daily Mail home keeps Login at 200%. Shots: /home/nico/projects/sift-test-2/research/shots/r11t2-z200-11.png, /home/nico/projects/sift-test-2/research/shots/r11t2-z200-12.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11t2/drive.ts vp:640x450@2 goto:http://127.0.0.1:8799/dailymail-article wait:9000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("a,button")].filter(e=>/log ?in/i.test(e.innerText)).length' press:Alt+Shift+S wait:2000 'eval:[...document.querySelectorAll("a")].filter(a=>/^Login$/.test(a.innerText.trim())).map(a=>a.getBoundingClientRect().width|0)' press:Alt+Shift+S vp:1280x900   → 0 in Sift, [71] in the original

Suspected cause: At a narrow width, the article header's Login sits in a row Sift treats as navigation clutter, or it is dropped when the header is merged, while the home header keeps it.

Skeptic: Reproduced on the dailymail-article and dailymail-article-video snapshots at 640x450@2. When the page loads at that size, Sift shows no Login link. At 1280 it shows 'Login' (78 px), and it keeps it if the page loads at 1280 and is then resized to 640. In the original at 640, the Login link is in a 964 px fixed-width desktop header at x=884, top 3, past the 640 px window, so the original needs a horizontal scroll to reach it. Sift's top-actions code skips any account link whose box starts at or beyond innerWidth, a rule meant for closed slide-in panels, so it drops a link that is only off-screen because the header overflows. I could not check the live site: dailymail.com returned Access Denied, and I did not try to get around it.

Skeptic's fix lead: In src/content/extract/generic.ts top actions (around line 6703: if (box.left >= innerWidth || box.right <= 0) continue), skip only when the element is in an off-canvas panel (a transformed or translated ancestor, or one with aria-hidden or a closed state). Do not skip when it sits in a header row that starts on screen and overflows the window, for example when its left is under document.documentElement.scrollWidth and its header row's left is at or after 0.

## F1129 (medium): At 200% zoom La Nación long-form article buries the title under two screens of portrait photo

Found by: T2-news. Where: https://www.lanacion.com.ar/el-mundo/las-claves-del-balotaje-en-brasil-los-votos-decisivos-los-desafios-para-el-lula-4-y-el-rechazo-de-nid26102026/ at 640x450, scale 2

Evidence: At 200%, Sift's first element is the lead photo, served as a 768x1100 portrait crop and drawn 604x865 CSS px. The H1 starts at 988 px, on the third 450 px screen. The original at the same size shows the title on the first screen, over the hero (H1 top 147). At 1280 px Sift's H1 is at 484, so only zoomed readers are hit. Shots: /home/nico/projects/sift-test-2/research/shots/r11t2-z200-9.png (Sift), /home/nico/projects/sift-test-2/research/shots/r11t2-ln-orig-z200.png (original)

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r11t2/drive.ts vp:640x450@2 goto:<url above> wait:12000 'eval:(()=>{const R=document.querySelector("sift-root").shadowRoot;const i=R.querySelector("img").getBoundingClientRect();return [i.width|0,i.height|0,R.querySelector("h1").getBoundingClientRect().top|0]})()' press:Alt+Shift+S wait:2000 'eval:document.querySelector("h1").getBoundingClientRect().top|0' press:Alt+Shift+S vp:1280x900

Suspected cause: The hero image is kept above the H1 with the <picture> source the narrow layout picks (a portrait crop), and with no height cap. The original overlays the title on that hero.

Skeptic: Reproduced at 640x450@2. Sift's first item is the lead photo, a 768x1100 portrait crop drawn at 604x865 CSS px from top 105. The H1 is at 988, on the third screen. The original at the same size shows the title over the hero on the first screen (H1 top 147). img.content in styles.ts has max-width:100% and height:auto, with no height cap.

Skeptic's fix lead: In src/content/ui/styles.ts line 75 (img.content), cap the height, for example max-height: 70vh with width:auto or object-fit: contain. Or, in generic.ts where the hero is placed above the H1, place a lead image taller than the viewport after the H1 and byline.
