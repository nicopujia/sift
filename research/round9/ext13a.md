# Round 9 findings: ext13a

Each was reproduced by a skeptic. F9xx are new in round 9; older ids are findings a round 9 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F934 (high, regression): Short text whose only sibling has a noise class is dropped: a business's address and phone beside social icons, a recipe's yield beside a share bar

Found by: R1-extractor. Where: src/content/extract/generic.ts:3593 (visitEl, the 'label left from a dropped box' rule, newsC10/F832)

Evidence: fx my/stray-label.html has three pieces of text: 'Find us' over div.contact > [div.address '412 Valencia St, San Francisco', div.social-icons], div.contact > [div.phone 'Call (415) 555-0134', div.share-tools], and div.recipe-meta > [div.yield 'Serves 6, takes 90 minutes', div.share-bar]. cur.js drops all three, and the 'Find us' heading disappears with its content. pre8.js shows them as small lines. The real extension (9468) shows the same loss. With only this rule disabled in a patched bundle, all three come back. The rule fires for any element under 40 characters with no link or control, first of exactly 2 children, whose next sibling's class matches NOISE_TOKEN (share, social, related, promo, trending…). It never checks that the sibling is actually dropped, or that the element is a label rather than data.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js $PWD/my/stray-label.html 1 --as http://food.fixture.test/lucias   (cur.js = current src via entry.ts; pre8.js = tree before round 8 fixes)

Suspected cause: The sibling test uses only NOISE_TOKEN on the next box. It does not require the element's text to be a section label (a heading, or a short title-like line such as 'Trending'). It also skips the drop rule's own exceptions (MEDIA, socialSignIn, promoStory, tabPanel).

Skeptic: Reproduced. A harness bundle I rebuilt from the current src (identical md5 to cur.js) drops '412 Valencia St', 'Call (415) 555-0134' and 'Serves 6, takes 90 minutes', and the 'Find us' h2 goes with them. pre8.js shows all three as small lines. The real extension (9468, fixture served locally) shows the same loss. With only line 3593 disabled in a patched copy, all three return. The rule tests only NOISE_TOKEN on the next sibling (social-icons, share-tools, share-bar). It never asks whether the short element is a label rather than data. Address next to social icons is a common footer and contact pattern. Regression from newsC10.

Skeptic's fix lead: generic.ts:3593 (visitEl). Only drop when the element reads as a section label: a heading, or a short title-like line with no digits, like 'Trending'. Skip it when the sibling would survive the noise drop (MEDIA, socialSignIn, promoStory, tabPanel). Never drop text with digits, an address or a phone number.

## F935 (high, regression): Inside an article, any heading or box whose only link carries utm_campaign is dropped: a gift guide loses every product name and its link

Found by: R1-extractor. Where: src/content/extract/generic.ts:3595-3599 (visitEl, 'promo set as a lone tracked link inside the story', newsC10/F832)

Evidence: In fx my/utm-giftguide.html, each of 4 products is '<h2><a href="https://brand…?utm_source=giftguide&utm_campaign=holiday2026">Lodge 12-inch cast iron skillet</a></h2>' followed by a review paragraph. cur.js keeps the paragraphs but drops all 4 h2s, and prose flips from false to true. pre8.js shows the 4 linked h2s. In the real extension the page now gets a Short version. 'Show full text' then shows only the paragraphs, with no product names and no links to buy. The rule matches any non-p element under 200 characters whose single link covers its text, so headings, figures with a linked image, and button boxes all qualify.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js $PWD/my/utm-giftguide.html 1 --as http://blog.fixture.test/gifts

Suspected cause: utm_campaign alone is taken as proof of a promo. Many newsletters, affiliate guides and brand blogs tag every outbound link. Headings (heading(el)) are not excluded, and nothing checks that the link sells something (promoText or APPEAL_CTA).

Skeptic: Reproduced. In the harness, all 4 linked h2 product names are dropped and prose goes from false to true. pre8 keeps the 4 h2s with their links. In the real extension the page gets a Short version, and 'Show full text' shows only the 5 paragraphs, with no product headings and no buy links. Code at 3596-3599 matches any non-a, non-p element under 200 characters whose one link has utm_campaign, headings included.

Skeptic's fix lead: generic.ts:3596-3599. Exclude headings (h1-h6, [role=heading]) and figures. Require the link text to read as a call to action (APPEAL_CTA or promo wording, like 'Take the AIQ test'), not just a utm_campaign parameter.

## F936 (high, regression): Sweepstakes rule drops ordinary content: a blog post card filed under 'Giveaways', and the heading, description and rules link of a contest page

Found by: R1-extractor. Where: src/content/extract/generic.ts:1393 (sweepstakes), 3583 (walk drop), 6768 (titleH1 skips h1 inSweepstakes), gen11/F858

Evidence: fx my/giveaway-blog.html has 3 post cards in main. One is filed under <a href="/category/giveaways/">Giveaways</a>. cur.js lists only 2 posts, and 'Win a stand mixer: our autumn giveaway' is gone. main itself is under 500 characters, has a heading and the giveaways link, so it counts as a sweepstakes box: the H1 'Latest posts' is no longer the page title (title becomes the site name, the H1 is demoted to h2). fx my/sweeps-landing.html, a store's contest page: cur.js shows only the email form. The H1 'Win a year of groceries', the line with the dates, prize and 'NO PURCHASE NECESSARY', and the 'Official rules' link are gone. pre8.js shows all of it. The real extension matches the harness. Disabling the walk rule restores the post and the contest text; disabling inSweepstakes restores the H1.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js $PWD/my/giveaway-blog.html 1 --as http://blog.fixture.test/ ; bun run.ts cur.js,pre8.js $PWD/my/sweeps-landing.html 1 --as http://shop.fixture.test/win

Suspected cause: Any box of 20-500 characters with a heading and a link counts as a promo when one link path has a segment named giveaway(s)/sweepstake(s)/sorteo(s), or when its text says 'no purchase necessary'. Nothing asks whether the box is an extra on top of the page's own content (Booking's banner sits over the search form) rather than the content itself or a list entry.

Skeptic: Reproduced both. In giveaway-blog, the harness and the real extension list only 2 of 3 posts: the card filed under /category/giveaways/ is gone. 'Latest posts' is demoted from h1 to h2, and the title becomes the site name. In sweeps-landing, only the email form is left in the harness and the real extension. The h1 text, the dates, prize and 'NO PURCHASE NECESSARY' line, and the 'Official rules' link are gone. pre8 shows all of it. sweepstakes() (generic.ts:1393) fires on any 20-500 character box with a heading and any link whose path has a giveaway(s)/sweepstake(s)/sorteo(s) segment, taxonomy links included. The walk drop at 3583 and inSweepstakes for the title apply it without asking whether the box is the page's own content.

Skeptic's fix lead: generic.ts:1393 sweepstakes(). Ignore /category/ and /tag/ style links, and look only at the box's main call-to-action link. Return false when the box is a repeated list entry (siblings of the same shape), holds main or the page's only h1, or is most of main. Then 3583 and titleH1/inSweepstakes (6768) stop removing real content.

## F937 (high, regression): Every number-only button under any ancestor class containing slider/swiper/carousel/slick/glide is dropped, so a size picker in a swiper cannot be used

Found by: R1-extractor. Where: src/content/extract/generic.ts:871 (usefulControl carousel-dot rule, widened by newsC10)

Evidence: In fx my/sizes-swiper.html, 'Select size' sits over div.swiper.sizes-swiper > .swiper-slide > <button>8</button> … <button>11</button>, and each button sets 'Size: N'. pre8.js shows 'actions: 8 | 9 | 10 | 11'. cur.js and the real extension show only 'Select size', 'Size: none' and 'Add to cart', so no size can be picked. The regex went from /^(page|slide|item) \d+$/ to /^((page|slide|item) )?\d+$/. el.closest("[class*=slider]…") matches any ancestor whose class merely contains those letters (range-slider, date-slider, has-slider).

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r9 && bun run.ts cur.js,pre8.js $PWD/my/sizes-swiper.html 1 --as http://shoe.fixture.test/p/trail

Suspected cause: Bare numbers are carousel dots only inside a dots or pagination container (slick-dots, swiper-pagination, glide__bullets, [role=tablist]). The widened regex accepts them under any carousel-ish ancestor.

Skeptic: Reproduced. pre8 shows 'actions: 8 | 9 | 10 | 11'. The current harness and the real extension show only 'Select size', 'Size: none' and 'Add to cart', so no size can be picked. The newsC10 diff widened /^(page|slide|item) \d+$/ to /^((page|slide|item) )?\d+$/ under any ancestor whose class contains carousel/slick/swiper/slider/glide (generic.ts:871). That blocks buying on stores that put size or date pickers in a swiper. Regression.

Skeptic's fix lead: generic.ts:871 usefulControl. Keep the old 'Page N/Slide N' regex for any carousel ancestor. Accept a bare number only inside a dots or pagination container ([class*=dots], [class*=pagination], [class*=bullet], slick-dots, swiper-pagination, [role=tablist]), or when its aria-label says 'slide'/'page'.
