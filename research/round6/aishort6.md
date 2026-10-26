# Round 6 findings: aishort6

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F611 (high, regression): While a refresh waits, and for good after the refresh limit, the Short version loses facts from other paragraphs: a sentence that merges a changed number with another fact is dropped whole

Found by: R3-ai-background. Where: src/content/short.ts:374-388 (staleAbout drops any sentence that best matches a changed paragraph or holds a number that is gone) and :526-533 (the sentence is removed; only the changed paragraph is put back)

Evidence: In Chrome on mergelive.html (the toll number changes every 18 s; the model writes 'The storm killed N people and left about 5,000 homeless in two shelters.'), the original keeps 'About 5,000 people lost their homes…'. The Short version leaves out '5,000 homeless' at 21 s and 40 s (waiting for a refresh), and at 100 s and 130 s, after 5 calls (limit reached), for good. Offline, t/merged.ts gives the same: 'mentions 5,000 homeless: false'. The prompt asks for an opening sentence that states the main point, which invites exactly this kind of merged sentence.

Repro: bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6rev-ai/t/merged.ts. In Chrome: SIFT_PORT=9469 SIFT_TAB=R3-ai-background bun r6rev-ai/mine/e2e-watch.ts mergelive.html MERGE 8,21,40,80,100,130 "killed|toll|5,000|homeless"

Suspected cause: A dropped sentence takes facts from unchanged paragraphs with it, and those paragraphs are not put back. Possible fixes: put back in full every paragraph the dropped sentence also matched, or drop only the clause that holds the gone number. After MAX_REFRESH, showing the full text for the article would also be safe.

Skeptic: Confirmed, high. Offline, t/merged.ts gives the toll paragraph in full plus the two other lines, and 'mentions 5,000 homeless: false'. In Chrome on mergelive.html with the mock, the Short version showed 'The storm killed 12 people and left about 5,000 homeless…' at 8 s. At 21 s and 40 s (waiting for a refresh) it showed only the full toll paragraph, with no 5,000 homeless. It came back at 80 s after a fresh answer. At 100 s and 130 s, with the call count stuck at 5 (limit reached), it was gone for good, while the original page still shows 'About 5,000 people lost their homes'. staleAbout drops the whole merged sentence, and only fresh paragraphs are put back (short.ts:571-576).

Skeptic's fix lead: In src/content/short.ts planShort: when staleAbout removes a sentence, also put back in full every unchanged source paragraph it matched (use the same token index), not only the fresh ones. Or remove only the clause with the number that is gone. In src/content/ai.ts refresh, once MAX_REFRESH is reached, think about showing the full text instead.

## F612 (medium): The reader's 'Show full text' choice is lost when the site re-renders the article as a new element: Sift switches back to the Short version under them

Found by: R3-ai-background. Where: src/content/ui/app.tsx:599 (the choice is stored per element key 'art:'+b.key) and :603 (art-late too); src/content/ai.ts:354 (share() puts the old Short version on the new key at once)

Evidence: In Chrome on rekey.html?at=9000: the Short version shows at 5 s. Clicking 'Show full text' gives the full text at 6 s and 8 s. The site replaces the article at 9 s. At 10 s and 12 s Sift shows the Short version again (article.short present, button 'Show full text'). The same happens to a reader who scrolled the full text first (art-late is per key). Before round 5 this happened only on an identical re-render (the twin path); share() makes it immediate for any small change.

Repro: With the mock running and settings set: SIFT_PORT=9469 SIFT_TAB=R3-ai-background bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6rev-ai/t/choice.ts

Suspected cause: View choices are keyed by the article element's ref, but share() and twin treat the new element as the same article. When share() or twin attaches a key, copy the old key's 'art:' and 'art-late:' locals to the new key.

Skeptic: Confirmed, medium. I ran rekey.html?at=9000 with the mock twice: once with t/choice.ts (a DOM click), once with my own script using a trusted Puppeteer mouse click on 'Show full text'. Both runs gave the same result. At 5 s the Short version shows. At 6 s and 8 s the full text shows with 'Show short version'. After the site replaces the article at 9 s, at 10, 12 and 15 s article.short is back with 'Show full text'. The choice is stored as local 'art:'+b.key (app.tsx:599) and art-late per key (:603). share() and the twin path in ai.ts attach the old Short version to the new key, but the reader's choice stays on the old key.

Skeptic's fix lead: In src/content/ai.ts share() and in the twin branch of condense(), when attaching a new key, copy store.local 'art:'+oldKey and 'art-late:'+oldKey to the new article key, if they are set. Or key the view choice by the job, not the element.

## F615 (medium): A bold warning line without end punctuation is dropped as an invented heading, and its paragraph is not put back

Found by: R3-ai-background. Where: src/content/short.ts:494-508 (a whole-line **…** that matches no source heading and does not end in . or ! is dropped)

Evidence: Offline planShort on a 5-paragraph article. The model output has the line '**Do not pay the processing fee twice**'. The plan keeps the other 3 lines and drops the warning. The source paragraph 'Do not pay the processing fee a second time…' does not come back, because only changed paragraphs are put back. The same happens to '**Warning: do not pay the processing fee twice, the bank charges it again**'. The prompt says 'no bold', but the code exists because models do it anyway.

Repro: cd /home/nico/projects/sift-test-9 && bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6rev-ai/t/bold.ts

Suspected cause: Only lines that look like headings (a few words, no verb-like length, or close to a source heading) should be dropped. A bold line of 5 or more words, or one ending in ':' or with no punctuation, should be kept as a paragraph, as lines ending in '.' already are.

Skeptic: Confirmed, medium. I checked this offline only; it is a deterministic code path. In t/bold.ts, planShort drops '**Do not pay the processing fee twice**' and '**Warning: do not pay the processing fee twice, the bank charges it again**'. The other lines stay, and source paragraph b ('Do not pay the processing fee a second time…') is not put back, because it is not fresh. short.ts:494-508 keeps a whole-line bold only when it holds a link or ends in . or !. Any other bold line with no matching source heading is dropped as a made-up heading. The prompt forbids bold, but this code exists because models use it anyway.

Skeptic's fix lead: In src/content/short.ts planShort, at the bold-heading branch: keep the bold text as a paragraph when it looks like a sentence (for example 5 or more words, or a comma or colon inside). Drop only short, heading-like bold lines with no source heading match.

## F616 (medium): A link id the model puts on other words opens the wrong target: words are never checked against the source link

Found by: R3-ai-background. Where: src/content/ui/app.tsx:610-612 (the model's words, with links[id]'s href and ref) and src/content/ui/markdown.tsx:21-24

Evidence: Offline: the source has '[open the route map](L0) … [cancel their parking permit](L1)'. The model writes 'You can [see every stop on the map](L1)'. planShort maps L1 to https://x.test/permit/cancel (source words 'cancel their parking permit'), and ArticleView renders a link labeled 'see every stop on the map' that opens the permit cancellation. The action has a different effect than its label says.

Repro: cd /home/nico/projects/sift-test-9 && bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6rev-ai/t/linkswap.ts

Suspected cause: When the model's link words share no word with the source link's words (Link.a), render the words as plain text and list the link under 'Links in the full text', or show the source's own words.

Skeptic: Confirmed, medium. I checked this offline; it depends on the model putting the wrong link id. t/linkswap.ts shows the source text '[open the route map](L0) … [cancel their parking permit](L1)'. The model text '[see every stop on the map](L1)' maps to href https://x.test/permit/cancel. The link function in ArticleView (app.tsx:610-612) renders the model's words with links[id].href and links[id].ref. No code compares the words with Link.a. A click is replayed on the original element, so the action differs from its label, against the 'same effect' rule.

Skeptic's fix lead: In src/content/ui/app.tsx ArticleView's link() (or in planShort, when building plan.links), check that the model's words share at least one content word with links[id].a. If not, render the words as plain text and add the link to plan.extra ('Links in the full text').
