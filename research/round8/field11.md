# Round 8 findings: field11

Each was reproduced by a skeptic. F8xx are new in round 8; older ids are findings a round 8 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F850 (high, regression): Typing in a removed field writes its text into another field with the same name: changing one cart quantity to 0 also empties the next item

Found by: R2-interaction. Where: src/content/index.ts:1733 (fieldList calls liveField(ref) with sync on) and src/content/index.ts:2638-2651 (liveField adopts a field with the same name and type, then proxy.focus and proxy.setValue)

Evidence: New fixture fx/r8int-cartzero.html?v=labels. It has two text quantity fields, both named qty, labelled 'Quantity of Rye loaf' and 'Quantity of Seeded rye'. Typing 0 removes that row, as an autosaving basket does. In Sift, I cleared the first quantity and typed 0. The page log is row1=, row1=0, focus@row2, input@row2, row2=0, and both items are gone (Total $0.00). The original logs only row1=0 and keeps Seeded rye ($8.00). The pre-round-7 build (scratchpad/ctl on port 9467+10) also keeps Seeded rye and focuses its field. No key was pressed after the 0. On the next run, fieldList() still sees Sift's old field focused. liveField finds exactly one visible input named qty. The removed input has no form any more, so any form matches. liveField adopts that input, sends it focus, and copies Sift's value into it.

Repro: Start the test Chrome. Run SIFT_PORT=9467 SIFT_TAB=R2-interaction bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8int/cartzero.ts sift '?v=labels'. It prints rows [] and log row1=, row1=0, row2=0. Run it with 'orig' as the first argument and it prints rows [row2:1]. By hand: open http://127.0.0.1:8799/fx/r8int-cartzero.html?v=labels, click the first Quantity in Sift, press End, Backspace, type 0, wait 2 s.

Suspected cause: The F751 change resolves the field in fieldList with liveField(a.dataset.ref). The default sync=true runs on every extraction and every refreshList, not only on the user's own keystroke. The skeptic's lead was liveField(ref, false). Even then, a swap should be adopted only when the old field was replaced in place (same form, same parent position, or the page focused the new one), never just because one same-named field is left.

Skeptic: Reproduced 2 of 2 times on fx/r8int-cartzero.html?v=labels. Sift's log was row1=, row1=0, row2=0, rows [] and Total $0.00. The original kept row2 ($8.00). I traced it with capture listeners on the page: focus@row2* then input@row2*=0, both synthetic, which is liveField's proxy.focus plus setValue. The labels differ in this variant, so twinOf's label match cannot fire and this is not the carry path. The pre-round-7 build (ctl on port 9477) kept row2 with no event on it, so this is a regression. The code agrees: fieldList now calls liveField(a.dataset.ref) with sync on, where ctl called elOf. The detached input has no form, so `form === undefined` lets any same-named field match.

Skeptic's fix lead: src/content/index.ts fieldList (~1733): look up the field with elOf, or at least liveField(ref, false). In liveField, when the old field has no form left (form === undefined), never adopt on name and type alone. Require positive evidence of an in-place swap, such as the page focusing the new field (the sift-focus path), and only proxy.focus or setValue from the user's own focus or input handlers.

## F851 (high): After an edit removes the focused field, Sift's focus repair types the same text into another field with the same label (cart quantities, number or text)

Found by: R2-interaction. Where: src/content/index.ts:277-292 (twinOf falls back to any control with the same label) and src/content/index.ts:296-304 (carry writes the typed value and dispatches input)

Evidence: fx/r8int-cartzero.html has two fields labelled 'Quantity', typed text or (?v=number) number, as in most carts. Typing 0 in the first removes its row. Sift: rows [], log row1=, row1=0, row2=0, Total $0.00. The trace shows input@row2 without focus@row2, so this is the carry path, not liveField. ?v=names (different names) gives the same. The pre-round-7 build gives the same for the default, ?v=names and ?v=number variants, so this is older than round 7. The original removes only Rye loaf (rows [row2:1], $8.00). When paint() finds the focused field gone, refocus() asks twinOf(). The ref is gone, so twinOf() matches any control with the same label: the next item's Quantity. carry() then puts the old field's value there and fires input, because lastTyped > store.actAt. That sends the 0 to the page.

Repro: SIFT_PORT=9467 SIFT_TAB=R2-interaction bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8int/cartzero.ts sift '?v=number' prints rows []. Add 'orig' as the first argument for the original, which prints rows [row2:1].

Suspected cause: carry() is meant for the same field after a re-render. It should only write when the twin stands for the same page element (same data-ref, or one adopted under the rules for a replaced field). A label-only twin may take focus but must never take the typed text.

Skeptic: Reproduced on ?v=names, ?v=number and the default variant: rows [] and row2=0 each time. In ?v=names and ?v=number the trace shows input@row2*=0 with no focus@row2, and the names differ, so liveField cannot match. At t+100 ms Sift had r5=0 focused. At t+400 ms Sift's r7 (the other 'Quantity') was focused with value 0, and the page's row2 had received it. That is refocusNow, then twinOf's label fallback, then carry() writing spot.value and dispatching input. The ctl build gave the same result for names, number and default, so this is older than round 7. The original removes only Rye loaf (rows [row2:1], $8.00) in all variants.

Skeptic's fix lead: src/content/index.ts carry() (~296): write the value and dispatch input only when twin.dataset.ref === spot.ref (or the ref was legitimately adopted). A label-only twin from twinOf may take focus and the caret, never the typed text.
