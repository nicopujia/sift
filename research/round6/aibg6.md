# Round 6 findings: aibg6

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F609 (high, regression): keepQuotes swaps a reworded quote for another speaker's quote, reversing what the Short version says the person said

Found by: R3-ai-background. Where: src/background/text.ts:243-257 (best source quote by token overlap; words of 3+ letters such as 'the' and 'for' count), applied at src/background/index.ts:663, :622 and :514

Evidence: Offline: keepQuotes('The mayor said: “The plan is a disaster for the town,” …', source) returns 'The mayor said: “The plan is good for the town,”'. The source has the mayor's “This plan is a disaster for our town” and the opposition leader's “The plan is good for the town”. Overlap with the mayor's quote is 0.73; with the leader's quote it is 0.80, so the leader's wins. End to end in Chrome 9469 with the mock (qswap.html, marker QSWAP), the Short version shows 'The mayor said: “The plan is good for the town,” and she will appeal.' The same code runs on cached Short versions and on one-liners (title plus context).

Repro: bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6rev-ai/t/quotes.ts. In Chrome: start the mock (bun r6rev-ai/mock.ts, port 8869), then SIFT_PORT=9469 bun r6rev-ai/settings.ts mock, then SIFT_PORT=9469 SIFT_TAB=R3-ai-background bun r6rev-ai/mine/e2e-watch.ts qswap.html QSWAP 4,8 "mayor|plan"

Suspected cause: A quote that is not word for word is replaced by whichever source quote shares the most tokens, with no check that it is the same speaker's or close to the model's text. A short reworded quote then matches another quote on the same topic better than its own. A safer rule: replace only when the best match is clearly better than the runner-up and shares most of its distinctive words. Otherwise drop the quotation marks.

Skeptic: Confirmed, high. Offline, t/quotes.ts returns 'The mayor said: “The plan is good for the town,” and plans to appeal.' The mayor's own quote scores 8/11 = 0.73 and the opposition leader's scores 8/10 = 0.80, because 'the' and 'for' count as tokens. I ran it in Chrome 9469 against the mock (qswap.html, cache cleared), checking at 4 s and 8 s. The Short version said 'The mayor said: “The plan is good for the town,” and she will appeal.' The original page has the mayor saying 'This plan is a disaster for our town'. So the Short version says the opposite of what she said. keepQuotes also runs on cached Short versions (index.ts:622), on fresh ones (:663) and on lines (:495, :514).

Skeptic's fix lead: In src/background/text.ts keepQuotes, swap in a source quote only when it clearly beats the runner-up and matches the model's quote closely. Score with stopwords removed, or weight distinctive words, so 'the' and 'for' do not count. Otherwise remove the quotation marks, as the code already does when the score is below 0.5.

## F610 (high): A lines batch that ends in a final error (content filter, output limit, moderation 403) is sent again with no pause on every re-extraction: 24 paid calls in 30 s

Found by: R3-ai-background. Where: src/content/ai.ts:295-297 (requested.delete for every unanswered item on any error) with src/content/ai.ts:195 (onError sets no pause when r.final)

Evidence: The mock answers lines whose titles include [FILTER] with finish_reason content_filter. On filterlive.html (5 headlines, a clock that ticks every 2 s), the mock log showed 6 lines requests by 3 s, 9 by 10 s, 18 by 20 s and 24 by 30 s, each the same batch of 5 headlines. It keeps going while the page changes. Condense keeps a job with a final error (ai.ts:472), but lines forgets it.

Repro: Start the mock with the FILTER branch (r6rev-ai/mock.ts), then SIFT_PORT=9469 bun r6rev-ai/settings.ts mock and SIFT_PORT=9469 SIFT_TAB=R3-ai-background bun r6rev-ai/t/countlines.ts http://127.0.0.1:8869/fx/filterlive.html FILTER 3,10,20,30

Suspected cause: For a final error, the lines handler should keep the items in `requested`, or the worker should save KEEP_TITLE for them, so the same batch is not paid for again. Non-final errors also reset the backoff when any item succeeds (fails.lines = 0 at :292).

Skeptic: Confirmed, high. I ran t/countlines.ts on filterlive.html with the mock (the [FILTER] batch ends with content_filter). Lines requests rose to 6 at 3 s, 9 at 10 s, 18 at 20 s and 24 at 30 s. That is the same batch of 5 headlines about every 4 s, and each round hits all 3 models in the chain (gemini flash-lite, then gpt-6-luna twice). From the code: on any error the handler at src/content/ai.ts:295-297 deletes the unanswered items from `requested`. onError (:182-197) sets no pause when r.final is true. So every re-extraction of a changing page pays again, with no limit. The background caches nothing for a final lines error.

Skeptic's fix lead: In the lines error handler in src/content/ai.ts processAi, keep the items in `requested` when r.final is true, or pause lines for the page. Or have doLines in src/background/index.ts save KEEP_TITLE for the batch's misses when the chain ends in a final Incomplete.

## F613 (medium): A live article whose Short version was refused as 'not much shorter' is paid for again on every refresh: 5 calls, none shown

Found by: R3-ai-background. Where: src/content/ai.ts:307-311 (a job with a final error still counts as asked for, and changed prose calls refresh) and :404-422 (fire asks again for the new text)

Evidence: In Chrome on longlive.html?every=5000, the mock returns text that is not much shorter. There are 1, 2, 3, 4 and 5 condense calls at 5, 20, 40, 60 and 90 s, the Short version is never shown, and the call count stops only at MAX_REFRESH. A number changing in one paragraph does not make the model's answer shorter. With MAX_WORD_RATIO 0.75 now rejecting more answers, this happens on more articles.

Repro: Start the mock with the LONGLIVE branch, set the mock settings, then SIFT_PORT=9469 SIFT_TAB=R3-ai-background bun r6rev-ai/mine/e2e-watch.ts "longlive.html?every=5000" LONGLIVE 5,20,40,60,90 toll

Suspected cause: refresh() should not ask again when the last job ended with a final 'not much shorter' or filter error, unless the prose changed a lot (for example, sameArticle fails or many words were added).

Skeptic: Confirmed, medium. The waste is capped at 4 extra calls per article per visit. On longlive.html?every=5000 the mock echoes the text, so every answer is 'not much shorter'. Condense calls were 1, 2, 3, 4, 5 at 5, 20, 40, 60 and 90 s. No Short version ever showed, and the count stopped only at MAX_REFRESH (4). A final error keeps the job in keyJob (no release), and proseChanged on a ticking number calls refresh, which runs condense again. That gets around the 'final means do not ask again' rule that MAX_TRIES follows. Each changed text also misses the NO_SHORT cache, so the next visit pays again.

Skeptic's fix lead: In src/content/ai.ts processAi/refresh: skip refresh() when the job's state has an error from a final reply (keep a `final` flag on the Job), unless sameArticle fails or the prose grew a lot.

## F614 (medium, regression): One-liner language is decided per batch, not per page: batches of one page go out in different languages, and English titles in a mostly Spanish batch get Spanish lines

Found by: R3-ai-background. Where: src/background/index.ts:485-487 (pc.lang is read before the await, so batches sent together each run listLang on their own 25 titles)

Evidence: Two lines batches posted back to back on one port with lang "en" (as processAi sends a list of 26 or more entries) went to the mock with lang 'en' (5 English titles) and lang 'es' (5 Spanish titles). The comment promises 'Settled once per page … so a later list matches the first'. From the code: every entry of a batch gets that batch's language, so an English title in a mostly Spanish batch on an English page is asked for in Spanish. The cache key includes the language, so a feed whose batches mix differently on the next visit pays again.

Repro: With mock settings: SIFT_PORT=9469 bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6rev-ai/t/swlines2.ts, then read the two Q7 lines entries in r6rev-ai/mock.log

Suspected cause: Settle pc.lang through a shared promise (store the listLang promise in pc before awaiting it), or decide the language in ai.ts once over all the page's titles before splitting them into batches.

Skeptic: Confirmed, medium. t/swlines2.ts posts two batches back to back on one port, both with lang 'en'. The mock got lang 'en' for the 5 English titles and lang 'es' for the 5 Spanish titles. As a control, I sent the same two batches one after the other, waiting for the first to finish. Both went out as 'en', so pc.lang does settle when there is no race. processAi sends every batch in the same tick (ai.ts:286-300), and doLines reads pc.lang before its await (index.ts:485-487). So on a mixed-language list of 26 or more entries, each batch picks its own language. An English title in a mostly Spanish batch getting Spanish lines is how one language per page is meant to work. The bug is the inconsistency between batches, plus cache keys that change with the mix.

Skeptic's fix lead: In src/background/index.ts doLines, store the listLang promise on pc (pc.langP ??= listLang(...)) before awaiting it, so batches sent together share one decision. Or decide the language once in src/content/ai.ts over all the page's titles before splitting into batches.
