# Round 7 findings: newsA8

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F723 (high, regression): BBC home drops a real top story because its headline says 'WhatsApp channel'

Found by: T2-news. Where: https://www.bbc.com/news (1280 and 600 px)

Evidence: In the original top section, the card 'How 'Lula's Army' WhatsApp channel helped turn Brazil election around' is visible: dundee-card, 221x357 at y≈946, between 'Chris Brown…' and 'Anthropic's blockbuster…'. Sift shows 35 of 36 original story links, and the only one missing is this card (/news/articles/cwz0vg4v3ndeo), at both widths. Outlines: /home/nico/projects/sift-test-2/research/shots/r7t2-bbc-home.txt and /home/nico/projects/sift-test-2/research/shots/r7t2-bbc-home-600.txt. In-page test: changing the original h2 to '…WhatsApp group…' made the card appear in Sift within 4 s, and changing it back to '…WhatsApp channel…' removed it again. works.md line 6 ('every one of the original's story links is present') no longer holds.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.bbc.com/news wait:9000 'eval:!!document.querySelector("a[href*=cwz0vg4v3ndeo]")' 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("a")].some(a=>/Lula.s Army/.test(a.innerText))' gives true, then false. If that story has rotated off the home, run 'eval:document.querySelector("[data-testid=card-headline]").textContent="How a WhatsApp channel helped a campaign"' wait:4000 on any visible card: it vanishes from Sift. With 'WhatsApp group' it stays.

Suspected cause: PROMO_STRONG in src/content/extract/generic.ts line 49 contains 'whatsapp channel' (and other phrases a headline can contain), and it is applied to a story card's headline.

Skeptic: Confirmed, high, 2 of 2 loads at 1280 px. The original has a[href*=cwz0vg4v3ndeo], 'How 'Lula's Army' WhatsApp channel helped turn Brazil election around', 221x357 at top 945. Sift has no link with /Lula.s Army/. Changing the original headline to '…WhatsApp group…' made the card show in Sift within 5 s. Changing it back to '…WhatsApp channel…' removed it again. The whole card text is under 200 characters, so asCard's `len < 200 && promoText(all)` rejects it. promoCard would also reject it, because 'whatsapp channel' is not in TITLE_PROMO_WEAK.

Skeptic's fix lead: In src/content/extract/generic.ts, make 'whatsapp channel|canal de whatsapp' count only in a short call to action. Add it to TITLE_PROMO_WEAK, or move it from PROMO_STRONG to PROMO_WEAK. In asCard, test promoText on the non-headline text, or use promoCard(title, href), so a story headline that names the WhatsApp channel stays.

## F724 (high, regression): BBC article's lead video is dropped when its caption is empty

Found by: T2-news. Where: https://www.bbc.com/news/articles/ckm23y3mg1yyo (1280 and 600 px, Short version and full text)

Evidence: The original's first media is a 1:18 video: [data-component=video-block] inside the article, smp-toucan-player 721x406 at top 631, with an empty figcaption (shot /home/nico/projects/sift-test-2/research/shots/r7t2-bbc-lula-orig.png). Sift has 0 portals and no Play button. Its buttons are 'Skip to content|Menu|Search|Show full text|Sift', in 2 of 2 loads and at 600 px. Outline: /home/nico/projects/sift-test-2/research/shots/r7t2-bbc-lula.txt. Setting the original figcaption text to 'Watch: Lula celebrates his win' made a portal with that name appear. BBC Limoges, whose video has a caption, still shows both portals. works.md line 225 ('Every BBC article … opens with … its photos and lead video') no longer holds for this article.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.bbc.com/news/articles/ckm23y3mg1yyo wait:20000 'eval:document.querySelector("sift-root").shadowRoot.querySelectorAll(".portal").length' gives 0. Then 'eval:document.querySelector("[data-component=video-block] figcaption").textContent="Watch: test"' wait:5000 with the same count eval gives 1.

Suspected cause: The video block is kept only when it has a caption or title to name it. An uncaptioned BBC video-block (play button aria-label 'Play video', duration only) is dropped.

Skeptic: Confirmed, high, 2 of 2 loads. The original's [data-component=video-block] holds smp-toucan-player. Its nested shadow DOM has a <video> of 721x406 at top 631. The block's only button is 'Play video/1:18', and its figcaption is empty. Sift has 0 .portal in both the Short version and the full text. Its buttons are 'Skip to content|Menu|Search|Show full text|Sift'. After I set the figcaption text to 'Watch: test', a portal named 'Watch: test' appeared within 6 s. portalBlock and facadeBlock already fall back to t("video"), so the drop happens before them. A caption-less block seems not to be visited as media at all.

Skeptic's fix lead: In generic.ts, find where the caption-less BBC figure or video-block is skipped. Likely spots are figure() or the visit pruning of a box whose only media sits in nested shadow roots. Make it reach portalBlock or widgetBlock, using deepQuery with enough depth to find smp-toucan-player's video. Let the name fall back to t("video") instead of needing caption text.

## F729 (medium): Guardian articles repeat the byline and show the dateline as an H2 collapsible inside the Short version

Found by: T2-news. Where: https://www.theguardian.com/world/2026/oct/26/brazil-lula-vow-democracy-always-election-win (Short version and full text)

Evidence: Under Sift's own byline ('Tom Phillips · Oct 26, 2026, 3:51 PM'), the Short version repeats 'Tom Phillips in São Paulo and Tiago Rogero in Brasília' as links. Then comes a collapsible '<summary><h2>Mon 26 Oct 2026 15.51 GMT</h2></summary>', in the original details[data-gu-name=dateline]. Screen reader users get a date as a section heading, and tab order includes 'Tom Phillips', 'Tiago Rogero' and a summary stop before the article text. Shot: /home/nico/projects/sift-test-2/research/shots/r7t2-guardian-dateline.png. A round 4 skeptic noted the date H2 (round4/rejected.md) but it was never filed.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.theguardian.com/world/2026/oct/26/brazil-lula-vow-democracy-always-election-win wait:15000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("summary h2")].map(h=>h.innerText)'. This gives ['Mon 26 Oct 2026 15.51 GMT'].

Suspected cause: details() in generic.ts turns a details element whose summary is a date line into a section, and the in-body contributor line is not merged into the byline.

Skeptic: Confirmed, medium. Under Sift's byline 'Tom Phillips · Oct 26, 2026, 3:51 PM', the Short version repeats 'Tom Phillips in São Paulo and Tiago Rogero in Brasília', then 'Mon 26 Oct 2026 15.51 GMT'. Sift renders that date as summary > h2 (eval: ['Mon 26 Oct 2026 15.51 GMT']). In the original it is details[data-gu-name=dateline] > summary > span, with 'Last modified on …' inside. details() turns any <details> into a section whose title is its summary, so a date becomes an H2 heading. Sift's own byline also leaves out the second author, who appears only in the repeated line.

Skeptic's fix lead: In details() in src/content/extract/generic.ts, when the summary is a date line (dateLine(textIn(summary))) or the details is a dateline (BYLINE_TOKEN or data-gu-name=dateline), drop it when ctx.hasDate is true. Otherwise emit it as a small paragraph, not a section. Also skip the in-body contributor line (a byline-zone line naming the byline's author) the way the bylineZone check does.

## F730 (medium): BBC byline drops the second author

Found by: T2-news. Where: https://www.bbc.com/news/articles/ckm23y3mg1yyo

Evidence: The original byline-block reads 'Ione Wells, Brasília and Hafsa Khalil'. Sift's meta line is 'Ione Wells · 26 Oct 2026, 18:26' (2 of 2 loads, also at 600 px). Sift's text has no 'Khalil'.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.bbc.com/news/articles/ckm23y3mg1yyo wait:15000 'eval:document.querySelector("sift-root").shadowRoot.querySelector("h1").nextElementSibling.innerText' 'eval:document.querySelector("[data-component=byline-block]").innerText'

Suspected cause: 

Skeptic: Confirmed, medium, 2 of 2 loads. The original byline-block reads 'Ione Wells, Brasília and Hafsa Khalil'. Sift's meta line is 'Ione Wells · 26 Oct 2026, 20:00', and /Khalil/ is false on Sift's text. byline() takes only the first element matching its selector list ('[data-component=byline-block] span'), so every author after the first is lost.

Skeptic's fix lead: In byline() in src/content/extract/generic.ts, collect every author name that matches the selector with querySelectorAll, skipping place names such as 'Brasília'. Join them with Intl.ListFormat in the page language. Do the same in bylineName.

## F731 (medium): The Independent article loses its author

Found by: T2-news. Where: https://www.independent.co.uk/news/world/americas/jair-bolsonaro-flavio-lula-brazil-election-b3073236.html

Evidence: The original shows the author link 'James C. Reynolds' (128x16). Sift's meta line is only 'Oct 26, 2026, 1:48 PM', and /Reynolds/ tested on Sift's text is false. Outline: /home/nico/projects/sift-test-2/research/shots/r7t2-indy-article.png and the act outline.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.independent.co.uk/news/world/americas/jair-bolsonaro-flavio-lula-brazil-election-b3073236.html wait:15000 'eval:/Reynolds/.test(document.querySelector("sift-root").shadowRoot.querySelector(".sift").innerText)' 'eval:[...document.querySelectorAll("a")].filter(a=>/Reynolds/.test(a.innerText)).map(a=>a.getBoundingClientRect().width)'

Suspected cause: 

Skeptic: Confirmed, medium, 2 of 2 loads. The original has <a href="/author/james-c-reynolds" class="sc-1lhcz39-2 klRvHg">James C. Reynolds</a>, 128 px wide. It has no meta author tags. Sift's meta line is 'Oct 26, 2026, 1:48 PM', and /Reynolds/ is false on Sift's text. byline()'s selectors need a .byline class or rel=author, so the link is not found. The site's own byline is then removed as a byline zone, so the author is gone from the page.

Skeptic's fix lead: In byline() in src/content/extract/generic.ts, add a fallback: a visible a[href*="/author/"] or a[href*="/autor/"] near the article's title or header whose text matches PERSON. Only drop the site's byline (the ctx.hasByline skip) when Sift's own byline actually has an author.

## F734 (medium): Fox article text runs words together where the source has <strong>&nbsp;</strong>

Found by: T2-news. Where: https://www.foxnews.com/world/nearly-1000-arrested-across-france-police-find-potential-weapons-protestors (full text)

Evidence: Sift shows 'Nearly 1,000 peoplewere arrested…' and '…searched protesters andarrested people…'. The original's HTML is 'people<strong>&nbsp;</strong>were' and 'and<strong>&nbsp;</strong>arrested', and its textContent reads 'people were' and 'and arrested'. Shot: /home/nico/projects/sift-test-2/research/shots/r7t2-fox-peoplewere.png.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.foxnews.com/world/nearly-1000-arrested-across-france-police-find-potential-weapons-protestors wait:15000 'click:Show full text' wait:2000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("p")].map(p=>p.innerText).filter(t=>/peoplewere|andarrested/.test(t))'

Suspected cause: An inline element that holds only whitespace (a non-breaking space) is dropped, along with the space.

Skeptic: Confirmed, medium. In the full text, Sift shows 'Nearly 1,000 peoplewere arrested…' and '…searched protesters andarrested people…'. The original HTML is 'people<strong>&nbsp;</strong>were…'. In inlineOf (generic.ts around line 1118), a <b>/<strong> (and likewise <em>/<i>) is added only `if (tx)`, where tx = textIn(e) is trimmed. A strong that holds only a no-break space is dropped with its space, and the words join.

Skeptic's fix lead: In inlineOf in src/content/extract/generic.ts, when a b, strong, em, i or span holds only whitespace (textIn empty but textContent non-empty), push " " instead of skipping it. tidy() already merges repeated spaces.
