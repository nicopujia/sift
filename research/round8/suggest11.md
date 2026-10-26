# Round 8 findings: suggest11

Each was reproduced by a skeptic. F8xx are new in round 8; older ids are findings a round 8 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F852 (high, regression): Every plain search field now gets the suggestion fast paths: a full extraction 300 ms after each pause, after every key for a slow typist, and every ~300 ms while the page changes

Found by: R2-interaction. Where: src/content/index.ts:2970-2975 (H.input: listed now includes proxy.SEARCH_FIELD, so typedRun schedule(0) and suggestAt) and src/content/index.ts:2287 (refreshList fast schedule)

Evidence: docs.python.org/3/library/stdtypes.html, Sift's 'Quick search' field: a plain text input in form action=search.html with no aria-controls. Typing 'frozenset' at 400 ms per key gave 8 full runs for 9 keys, key waits of 2.0 to 6.2 s, and long tasks of 1.7 to 6.2 s (load average 10 to 17). The original gave a slowest key of 31 ms and no long tasks. New fixture fx/r8int-searchpause.html, same build, same moment, 400 ms per key: the role=search field gave 10 runs for 10 keys and a slowest key of 448 to 979 ms. The page's plain 'Your note' field gave 0 runs and a slowest key of 42 ms. The pre-round-7 build gave 0 runs and a slowest key of 65 ms in the same search field. Typing words at 100 ms per key with a 500 ms pause gave one 0.8 to 2 s run per pause, and the first key after each pause waited 0.5 to 1.7 s. With ?n=25&tick=1 (a small page with a 100 ms clock), typing in the search field ran 19 full extractions in 5.4 s. The note field ran 2.

Repro: SIFT_PORT=9467 SIFT_TAB=R2-interaction bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8int/slowtype.ts search 400, then the same with 'note' in place of 'search' (prints runs during typing and key lags). Real site: bun .../r8int/slowdocs.ts, and bun .../r8int/slowdocs.ts orig.

Suspected cause: typing9 added SEARCH_FIELD to `listed` so the Wikipedia portal and Discourse lists show. Those lists are already picked up by refreshList's fieldPanel on the page's own mutation, so the 300 ms schedule(0) is not needed for them. Keep typedRun (and the lastDur<300 fast schedule) for fields that name a list, or skip it when lastDur is large.

Skeptic: Reproduced on the fixture and the real site. On fx/r8int-searchpause.html at 400 ms per key, the role=search field gave 10 full runs for 10 keys, key lags of about 200 ms and 10 long tasks of 266-333 ms. The 'Your note' field gave 0 runs and a 27 ms max. On docs.python.org stdtypes 'Quick search' I typed 'frozenset' at 400 ms per key twice. I got 9 runs both times, key lags up to 1.27 s and 1.01 s, and long tasks of about 0.7-1.4 s. The original: max 33 ms, no long tasks. The ctl build on the same page: 0 runs, max 118 ms (first key only). On the fixture search field ctl gave 0 runs and a 26 ms max. Regression confirmed. The cause is the SEARCH_FIELD clause added to `listed` in H.input (~2970), which schedules schedule(0) 300 ms after each key and sets suggestAt. Load was lower than the reporter's (4-8), so my lags are smaller, but the per-key full extraction is the same.

Skeptic's fix lead: src/content/index.ts H.input (~2970-2975): leave SEARCH_FIELD out of the typedRun schedule(0) and suggestAt triggers, or keep it only when lastDur is small. Search boxes whose lists Sift reads via fieldPanel are already refreshed by refreshList on the page's own mutation.

## F853 (medium): Escape in a plain search field does not close the suggestion list Sift shows under it (Wikipedia portal)

Found by: R2-interaction. Where: src/content/index.ts:966-980 (escapeList hides Sift's list only once the page hides its own)

Evidence: www.wikipedia.org, Sift's 'Search Wikipedia' field: type 'Pumper' and Sift shows 6 suggestions. Press Escape: 3 of 3 runs still show 6 suggestions 1.5 s later, focus stays in the field, and the page dropdown is still there. On the original, Escape clears the box and the dropdown is removed. The portal has no Escape handler and relies on the browser's own Escape clearing a type=search box. Sift prevents that default and sends a synthetic Escape, which has no default action. The page keeps its dropdown, so hidden() never dismisses Sift's list. This path is new: before round 7 the portal showed no suggestions in Sift (F750).

Repro: cd /home/nico/projects/sift-test-7; SIFT_PORT=9467 SIFT_TAB=R2-interaction bun scripts/act.ts goto:https://www.wikipedia.org/ wait:6000 'type:input[type=search]=>Pumper' wait:2500 press:Escape wait:1500 "eval:document.querySelector('sift-root').shadowRoot.querySelectorAll('.sheet.suggest a').length" prints 6. Original: bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8int/wikiesc.ts prints 'after Esc none'.

Suspected cause: For a list Sift read from a plain search field (fieldPanel, key 'fp:'), the page never gets a real Escape. escapeList should dismiss Sift's list itself (store.dismissed) when the page has not hidden it shortly after.

Skeptic: Reproduced 3 of 3 times on www.wikipedia.org. After typing 'Pumper', Sift's .sheet.suggest showed 6 suggestions. They are buttons, not links, so the reporter's '.sheet.suggest a' selector gives 0 here, but the list is there. After Escape, and still 4.5 s later, Sift kept 6 entries. Focus and value stayed in the field ('Pumper'), and the page's .suggestions-dropdown kept 6 links. A second Escape, and ArrowDown then Escape, changed nothing. On the original (2 runs), Escape cleared the box and removed the dropdown. Keyboard users cannot dismiss the list in Sift, so medium severity is fair.

Skeptic's fix lead: src/content/index.ts escapeList (~966-980): if the page's list is still visible after a short delay (the existing setTimeout), add the key to store.dismissed (and dismissedRefs) anyway for fieldPanel/fieldList lists ('fp:'/'fl:' keys). Optionally also clear a type=search field the way the browser default would, since Sift prevented that default.

## F854 (medium): Search results shown under the field after Enter (Discourse) vanish when the page changes while the user arrows through them, and focus is thrown back to the field

Found by: R2-interaction. Where: src/content/index.ts:1729-1743 (fieldList: `a` is swapped for suggestAnchor() when focus is in the sheet, then the post-action branch requires a === shadow.activeElement)

Evidence: users.rust-lang.org/latest. Search, type 'lifetime', Enter: Sift shows 6 results in its list under the field. ArrowDown puts focus on 'Lifetime issue - expected lifetime…'. Then a page change (I appended 3 divs to body; on a live forum a new-topic update does the same) triggers one routine run (runs 20 to 21). The list is gone and focus is back in the field ('input lifetime'). With focus in the list, `a` is the field, not shadow.activeElement, so fieldList returns undefined. The extractor does not find the Discourse menu on its own. Tab into the list goes the same way, because wrapTab now sends Tab from the field into a popup with tab stops.

Repro: cd /home/nico/projects/sift-test-7; SIFT_PORT=9467 SIFT_TAB=R2-interaction bun scripts/act.ts goto:https://users.rust-lang.org/latest wait:8000 click:Search wait:1500 'type:input[type=search]=>lifetime' wait:3000 press:Enter wait:5000 press:ArrowDown wait:500 "eval:(()=>{for(let i=0;i<3;i++)document.body.appendChild(document.createElement('div'));return 1})()" wait:9000 "eval:[!!document.querySelector('sift-root').shadowRoot.querySelector('.sheet'), document.querySelector('sift-root').shadowRoot.activeElement.localName]" prints [false,"input"]. Without the eval step the list stays.

Suspected cause: The 'still in it' test should also accept focus inside the field's own suggestion sheet: compare the original shadow.activeElement (before the suggestAnchor() swap) against '.sheet.suggest', not `a`.

Skeptic: Reproduced 3 of 3 times on users.rust-lang.org/latest. After Search, typing 'lifetime' and Enter, Sift shows 6 results under the field. ArrowDown focuses 'Lifetime issue - expected lifetime…'. After a page mutation (3 divs appended), one routine run fires (runs 20 to 21). Sift's sheet is then gone and focus is back in the input. The page's own .search-menu results are still visible with 6 links, so Sift differs from the original. With no mutation, the list and focus stayed for 9 s. The code agrees: in fieldList, `a` is swapped for suggestAnchor() when focus is in the sheet, so `a === shadow.activeElement` is false in the post-action branch and it returns undefined. The trigger was synthetic, but routine mutations (relative times, message-bus updates) do this on a live forum.

Skeptic's fix lead: src/content/index.ts fieldList (~1729-1743): keep the original shadow.activeElement and treat focus inside '.sheet.suggest' as being at the field. Use `(a === shadow.activeElement || shadow.activeElement?.closest('.sheet.suggest'))` in the panel condition instead of `a === shadow.activeElement`.
