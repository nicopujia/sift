# Round 7 findings: ext8b

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F738 (high): NPR home still drops 16-17 of 50 top stories: hidden embed inputs make the grid 'rows with fields', and the walker deletes the promo-card cards

Found by: R1-extractor. Where: src/content/extract/generic.ts:2218 (withFields ignores visibility) and generic.ts:3334 (NOISE_TOKEN drop; dom.ts:780 'promocard'/'promo-card')

Evidence: Live https://www.npr.org/. Harness: 17 of 50 visible article headlines are missing from the outline, all in div.bucketwrap.promocard > article.c-promo-card. Examples: 'Israelis have changed. Will they change their leadership?' and 'The secret to lasting love might just be knowing how to fight'. Real extension: 16 of 50 promo-card story links are not in Sift. An instrumented detectItems returns null at line 2231 for the card-wraps: 20 of 50 cards hold input.embed-url readonly, and Sift's visible() is false for all 20. Minimal fixture promocard-audio.html: 4 cards, each with a display:none readonly input. Now: only the h1 shows. Without the input, all 4 items show. With the wrapper class renamed, still none show, because article.c-promo-card also matches NOISE_TOKEN.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js fx/promocard-audio.html 1 --as http://radio.fixture.test/ (then try fx/promocard-noinput.html)

Suspected cause: withFields uses k.querySelector('input:not([type=hidden]), select, textarea') without visible(), so a hidden share or embed field turns a story grid into form rows that get walked. The walker then removes any element whose class says promo-card or promocard, even an <article> whose heading links a story. That is the F625 backstop that was not done.

Skeptic: Reproduced. Fixture promocard-audio.html (cards with a display:none readonly input): now and pre both show only the h1. promocard-noinput.html shows all 4 items. promocard-noclass.html (wrapper renamed) still shows none. Live https://www.npr.org/ in the real extension, checked by link and title across 2 runs: 16 of 51 and 17 of 52 visible article.c-promo-card stories are missing from Sift. 20 cards hold a non-hidden-type input, and 9 of the missing cards hold one themselves. The code matches the cause: withFields at generic.ts:2218 counts input:not([type=hidden]) without visible(), and NOISE_TOKEN (dom.ts:779) matches 'promo-card'/'promocard', which the walker drops at generic.ts:3334. This is not a regression.

Skeptic's fix lead: In detectItems (generic.ts:2218), count a member as withFields only when its field is visible(), and ignore readonly fields. In the NOISE_TOKEN drop (generic.ts:3334), keep an element (an article, or a card) whose heading links to a same-site story path, as done for comments. Alternatively, remove the bare promo-card token from NOISE_TOKEN in dom.ts:779 and leave promo detection to promoCard().

## F739 (high): NPR section pages: every item is named and linked by its section label ('Law' -> /sections/law/) instead of its headline

Found by: R1-extractor. Where: src/content/extract/generic.ts:2395 (toItem takes the first heading in DOM order)

Evidence: Live https://www.npr.org/sections/news/, the same before and after round 6. Items read 'National ->/sections/national/', 'Law ->/sections/law/', 'Business ->/sections/business/' and so on. The headline ('Judge says DOJ illegally fired the daughter of former FBI director Comey') is only meta text. Real extension: the first 4 li.item links point to /sections/national/, /sections/law/, /sections/business/ and /sections/asia/, so opening an entry opens the section, not the story. DOM: article.item > div.slug-wrap > h3.slug > a(section), then h2.title > a(story), and the image and teaser link to the story. Fixture slug-items.html reproduces it: 4 items all titled and linked by their section.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7 && bun run.ts now.js fx/slug-items.html 1 --as http://radio.fixture.test/sections/news/

Suspected cause: toItem sets heading = el.querySelector('h1,...,h6') and so takes the small h3 slug before the h2 title. It should prefer the highest-ranked heading, or the heading whose link matches the card's other links (image, teaser), over a kicker heading that links elsewhere.

Skeptic: Reproduced live and in the fixture. slug-items.html: 4 items titled 'Law ->/sections/law/' and so on, with the headline only in the meta, the same in pre and now. Live https://www.npr.org/sections/news/ in the real extension: the first 10 entries' links are /sections/national/, /sections/law/, /sections/business/, /sections/asia/, ..., named by the section, with the headline as plain meta text. The page's article.item has h3.slug a -> section before h2.title a -> story. toItem (generic.ts:2395) takes el.querySelector('h1,...,h6'), the first heading in DOM order, so the story link is never the entry's target. Not a regression, but every entry on the page opens the wrong page.

Skeptic's fix lead: In toItem (generic.ts:2395), pick the highest-level heading (lowest hN) or the heading whose link matches the card's other links (image, teaser) instead of the first in DOM order. Treat a short heading linking to a /section/ or category path that differs from the card's majority href as a kicker (meta).

## F625 (still open, partly; original repro in /home/nico/projects/sift/research/round6/*.md)

Recheck by R1-extractor: The fixture is fixed. r6ext7-promocards.html now gives 11 items (3 before the fix). In the real extension (9468), 'click:plan number 3 for' opens /2026/10/24/story-3. Live https://www.npr.org/ still loses stories. In the harness, 17 of 50 visible article headlines are missing (34 of 50 before the fix). In the real extension, 16 of 50 promo-card story links are not in Sift (checked by href). Every missing story sits in div.bucketwrap.promocard > article.c-promo-card. detectItems returns null at generic.ts:2231 because 20 of 50 cards hold a hidden readonly input.embed-url (Sift's visible() is false for all 20), and withFields counts it (generic.ts:2218). The walker then drops each card on the NOISE_TOKEN match 'promocard'/'promo-card' (generic.ts:3334). The finding's suggested backstop for that drop was not done. A reduced copy is filed as a finding below.

Skeptic: Partly fixed, as reported. The fixture r6ext7-promocards.html now gives 11 items, against 3 in pre (harness). Live https://www.npr.org/ in the real extension still loses 16 of 51 and 17 of 52 visible c-promo-card stories (2 runs), all in div.bucketwrap.promocard > article.c-promo-card. The cause is the same as N3: hidden embed inputs counted by withFields (generic.ts:2218), and the NOISE_TOKEN promo-card drop (generic.ts:3334). The backstop was not done.

Skeptic's fix lead: As in N3: count only visible, non-readonly fields in withFields, and keep NOISE_TOKEN promo-card elements whose heading links to a same-site story.

## F649 (still open, partly; original repro in /home/nico/projects/sift/research/round6/*.md)

Recheck by T2-news: Le Monde home (/en/), 1 load. These credits are gone: SAMEER AL-DOUMY/AFP, HERVÉ LEQUEUX, MICHELE LAPINI, THIERRY LAPORTE, KEYSTONE/GAMMA-RAPHO, MASSIMO VALICCHIA. Still there: 'p: KENZA LE BAS' under 'Angèle's Instinct' in French Delights. In the original that text is span.ds-card__media__figcaption__text in a figcaption inside .ds-card__lifestyle-content, not .ds-card__media. The promo slot showed '[link] Partner Services' + 'Le Monde for hotels · … Get a free quote for : · Le Monde online for your hotel'. Its original container is div.ds-autopromo (class 'ds-home-aside__autopromo'). Outline: /home/nico/projects/sift-test-2/research/shots/r7t2-lemonde-home.txt, lines 31-32 and 61.

Skeptic: Confirmed as partly fixed, on 1 load of lemonde.fr/en/. The listed credits are gone. One credit remains under French Delights, 'p: GUILLAUME BLOT' (the slot rotates; T2 saw 'KENZA LE BAS'). Its path is span.ds-card__media__figcaption__text < figcaption < div.ds-card__lifestyle-content < div.ds-card__clickarea. The F649 rule at generic.ts:2563 needs `fc.parentElement?.querySelector("img, picture")`. Here the figcaption's parent, ds-card__lifestyle-content, holds no image, so the credit is kept. The promo slot still shows '[link] Partner Services' + 'p: Le Monde for hotels · In French and English. Only on PressReader. Get a free quote for : · Le Monde online for your hotel'. Its source is div.ds-autopromo.

Skeptic's fix lead: In generic.ts around line 2563, test for an image in the card (el) or the figcaption's closest card, not only in the figcaption's parent. Drop a container with an autopromo or self-promo token (ds-autopromo), or add 'get a free quote|partner services' to PROMO_STRONG or CTA_TITLE.
