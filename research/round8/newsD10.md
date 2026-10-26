# Round 8 findings: newsD10

Each was reproduced by a skeptic. F8xx are new in round 8; older ids are findings a round 8 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F826 (medium): Guardian article: Play on the video does nothing, and nothing says why

Found by: T2-news. Where: https://www.theguardian.com/world/2026/oct/26/brazil-lula-vow-democracy-always-election-win (both video portals)

Evidence: Sift shows the video poster and a 'Play' button. Clicking it adds no iframe or video to the original's youtube-overlay block (innerHTML 6141 before and after; overlay button still there). The original page sits behind a full-screen 'It's your choice' cookie consent wall (Sourcepoint iframe). Its YouTube overlay also does nothing when clicked from a script while that wall is up. Sift hides the wall, so a Sift user has no way to unlock the video. I did not click any consent button (it records a choice), so I have not verified that consent makes the video play on the original. Shots: /home/nico/projects/sift-test-2/research/shots/r8t2-guardian-video-play.png, /home/nico/projects/sift-test-2/research/shots/r8t2-guardian-video-orig2.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<url> wait:9000 'eval:(()=>{window.__c=document.querySelector("[data-testid^=youtube-overlay-y7G]").closest("figure");return window.__c.innerHTML.length})()' click:Play wait:7000 'eval:[window.__c.innerHTML.length,[...window.__c.querySelectorAll("iframe")].length]' gives the same length and 0 iframes.

Suspected cause: The consent wall is treated as noise, but here it gates a needed action. Sift could keep the site's reject/accept choice reachable when a gated control is used, or say that the site asks for a cookie choice first.

Skeptic: Reproduced on both videos. Sift's 'Play' does nothing: the figure's innerHTML stays 6141 (then 5982/5983 on the second video), there are 0 iframes or videos, the youtube-overlay is still there, and no YouTube chunk or API loads. Sift shows no message about it. The original sits behind the Sourcepoint 'It's your choice' wall (html.sp-message-open, TCF eventStatus 'cmpuishown', gdprApplies true), which also locks scrolling: body overflow hidden, scrollHeight 900, wheel leaves scrollY at 0. I found a second cause the claim missed. Both players are <gu-island name=YoutubeBlockComponent deferuntil=visible> at y=2247 and 4122. They only hydrate when they scroll into view in the original, and Sift never scrolls the original, so the overlay has no handler yet. So a Sift user can neither make the cookie choice (No, thank you / Yes, I accept) nor get the player to hydrate. Not verified: that playback works after a choice. Like the claimant, I did not record a consent choice.

Skeptic's fix lead: In generic.ts, the consent-wall branch (~line 6071, 'const wall = !!ctx.bare && consentWall(d, text)') should also keep the CMP as a dialog when it locks the page (html.sp-message-open, or body overflow hidden with a CMP iframe over the viewport), with the reject choice first. In proxy.ts or portal.ts, before replaying a click on a facade, scroll its original element into view (or into the top layer) and wait for hydration, so deferuntil=visible islands load. If the click still changes nothing, say so.

## F830 (medium, regression): La Nación: X posts with the goal video no longer load in Sift, so hashtags and dates show as links (F647 is back)

Found by: T2-news. Where: https://www.lanacion.com.ar/deportes/futbol/julian-alvarez-le-dio-el-triunfo-a-atletico-madrid-el-publico-lo-reconocio-y-el-se-disculpo-yo-nid24102026/ (Short version and full text)

Evidence: Sift has 0 portals in both the Short version and the full text. Both show '#ChampionsLeague', '#LaLigaxESPN', '#LaLiga', '#DisneyPlus', 4 'pic.twitter.com/…' links and 4 'October 24, 2026' links in the body. In the original, the 4 tweets are still plain blockquote.twitter-tweet elements (777x74 to 110) until the page is scrolled. After I turned Sift off and scrolled the original to the bottom, 4 iframes (550x576 to 897) loaded, and back in Sift there were 4 'X Post' portals. So Sift never triggers the site's lazy embed loader. works.md line 68 (F647 holds) no longer holds. Shot: /home/nico/projects/sift-test-2/research/shots/r8t2-ln-julian-fulltext.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:<url> wait:25000 'eval:document.querySelector("sift-root").shadowRoot.querySelectorAll(".portal").length' gives 0. 'eval:document.querySelectorAll("blockquote.twitter-tweet").length' gives 4, with no twitter iframes.

Suspected cause: La Nación loads X embeds only when they scroll into view. Sift keeps the original unscrolled behind its view, and the X Post portal logic only sees iframes.

Skeptic: Confirmed as a real defect, but not a regression, and F647's own fix still holds. Sift shows 0 portals. The 4 blockquote.twitter-tweet fallbacks (777x74 to 110) are in place, with '#ChampionsLeague', '#LaLigaxESPN', '#LaLiga', '#DisneyPlus', 4 pic.twitter.com links and 4 'October 24, 2026' links. No widgets.js is loaded. With Sift off, wheel-scrolling the original loaded platform.twitter.com/widgets.js and 4 iframes (550x672, 849, 576, 897). Three of those embeds hold a <video> (Atleti's apology clip, SportsCenter's Simeone clip, the ovation), so Sift users never get those videos. Not a regression: the round 6 skeptic also saw the widget never render without scrolling, and the round 7 recheck saw portals only 'once X's widget loaded'. That fix (fallbacks stay in place as one block, no 'Enlaces del texto completo' list) still holds.

Skeptic's fix lead: Sift should trigger the site's lazy loaders for embeds it shows. When an embed fallback (blockquote.twitter-tweet, .instagram-media, tiktok-embed) or a lazy placeholder is in Sift's view, or once at idle, bring the original element into the original's viewport (scrollIntoView on the inert original, then restore) so IntersectionObserver-based loaders run. The existing X Post portal logic then takes over. This belongs near index.ts keepPlayers or portal.ts.

## F831 (medium, regression): Fox search: a stray modal ('Fox News' plus a clock time) sometimes opens and takes focus

Found by: T2-news. Where: https://www.foxnews.com/search-results/search#q=Starlink

Evidence: In 2 of 6 tries, Sift opened an aria-modal sheet holding only Close, a 'Fox News' link and a time, and moved focus to its Close. Once it opened after Load More (named '10:13 PM'), and once on a direct load of the results URL (named 'Fox News Search Results'). With Sift off, the original had no visible dialog or overlay at that moment. works.md line 74 says focus stays on Load More after 10 to 19 results; the count still went 10 to 19, but focus moved to the stray Close. Shot: /home/nico/projects/sift-test-2/research/shots/r8t2-fox-loadmore.png

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.foxnews.com/ wait:10000 'type:input[type=search]=>Starlink' press:Enter wait:10000 'click:Load More' wait:6000 'eval:(()=>{const R=document.querySelector("sift-root").shadowRoot;const d=R.querySelector("[role=dialog]");return [d&&d.getAttribute("aria-label"),R.activeElement.innerText]})()'. Repeat a few times; it is intermittent.

Suspected cause: A fixed header strip that appears on scroll or refresh (logo plus clock) is taken for a page modal, like F645's Infobae masthead.

Skeptic: Reproduced 3 of 3 (more often than the claimant's 2 of 6). Fox home, type 'Starlink' + Enter goes to /search-results/search#q=Starlink with no dialog. 'Load More' then opens an aria-modal sheet named '10:30 PM' / '10:31 PM' (Close, 'Fox News' link, and the clock or '.com'), with a backdrop over the results, and focus moves to its Close. In the original, the clock is div.current-time inside div.branding (z-index 510) inside header.site-header (z-index 1000), scrolled off at top -4104. There is no dialog, role=dialog or aria-modal element in the original. This breaks works.md line 74 ('focus kept on Load More').

Skeptic's fix lead: In generic.ts, the fixed-layer branch (~line 3571, overlayLayer() feeding ctx.layers) and dialogIn() (~6028) should not treat a header part (inside header/[role=banner], logo + clock, under ~15% of the viewport, or outside the viewport) as a page modal. Require an overlay layer to cover a large share of the viewport, or to hold a form or real content.
