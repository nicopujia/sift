# Round 8 findings: form10

Each was reproduced by a skeptic. F8xx are new in round 8; older ids are findings a round 8 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F801 (high): Sift's fields ignore the page's maxlength, so a longer value than the original allows reaches the page and is saved

Found by: T6-fixtures. Where: Any field with maxlength. Seen on http://127.0.0.1:8799/fx/r8-settings.html (Signature textarea, maxlength=80) and on r4-checkout.html ZIP with maxLength=5 set at runtime. src/content has no maxLength or maxlength handling at all (grep finds none).

Evidence: research/r8t6/maxlen-orig.ts types the same 92 characters on both sides. Original (Sift off): pageValue 80, counter '0 characters left', the page logs a saved signature of 80 characters. Sift: Sift's textarea has maxLength -1, the page's textarea gets 92 characters, counter '-12 characters left', the page logs 'saved sig' with 92 characters. r4-checkout with document.getElementById('zip').maxLength=5: typing 941031234 in Sift's ZIP field puts '941031234' (9 characters) into the page field. The original stops at 5. Not a regression: no maxlength handling existed before round 7 either.

Repro: cd /home/nico/projects/sift-test-6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun research/r8t6/maxlen-orig.ts   (prints original vs sift: pageValue 80 vs 92)

Suspected cause: Sift renders form fields without copying maxlength (or minlength or pattern) from the page's element. The proxy then sets the page field's value from code, which bypasses maxlength.

Skeptic: Reproduced on its own tab (skeptic, port 9466). research/r8t6/maxlen-orig.ts types 92 characters. Original: pageValue 80, counter '0 characters left', log [80]. Sift: pageValue 92, counter '-12 characters left', and the page's change handler logged a 92-character signature. On r4-checkout, with maxLength=5 set on #zip, typing 941031234 into Sift's ZIP field put '941031234' into the page field. Sift's field is <input data-ref=r8 ... name=zip> with no maxlength. grep finds no maxlength or minlength anywhere in src/. The value reaches the page past a limit the original enforces, so Sift does not have the same effect as the original. Severity is at least medium.

Skeptic's fix lead: Copy the limit from the page field. Add maxLength to the Field model: model.ts, plus generic.ts around line 1866 where autocomplete/accept/multiple are read (el.maxLength >= 0 ? el.maxLength : undefined). Set maxLength={f.maxLength} in TextField's `common` props in src/content/ui/app.tsx (~line 205). As a backstop, in proxy.ts setValue(), clamp the value to el.maxLength when it is >= 0 for input and textarea elements, as typing would.

## F802 (medium): Text the page changes as the user types (a 'N characters left' counter) shows the wrong value for about 2.5 s after each keystroke

Found by: T6-fixtures. Where: http://127.0.0.1:8799/fx/r8-settings.html, Signature field and its live counter. src/content/index.ts schedule(): 'if (minor && performance.now() - actedAt > 5000) d = Math.max(d, 2500);'

Evidence: research/r8t6/counterkey.ts types one key every 150 ms. After the 1st and 2nd keys Sift matched in 4 and 113 ms. From the 3rd key on, each update reached Sift only after 2501-2553 ms. research/r8t6/counterlag.ts types 'Baked with love' at 20 ms/key: in 6 of 6 runs, Sift's counter matched the page 2284-2538 ms after the last key. Until then it read, for example, '67 characters left' while the page said '65'. A screen reader user hears the stale value. By contrast, r7-signup's password checklist (class changes) matched within 2-522 ms of each key. Not a regression: the same line is in sift-r7-base (index.ts:1409).

Repro: cd /home/nico/projects/sift-test-6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun research/r8t6/counterkey.ts 150

Suspected cause: Typing in a Sift field does not set actedAt, so the page's text-only answer to typing counts as a 'minor' change (like a clock). Each one is delayed to at least 2500 ms.

Skeptic: Reproduced. counterkey.ts at 150 ms per key: 'R' matched in 7 ms and 'y' in 115 ms. Both were still inside the 3 s load window. 'e' through 'f' matched in 2508-2600 ms each. counterlag.ts as written missed the field in my tab (it does not scroll into view), so I reran it with my own version that checks focus, 3 runs. Focus was in Sift's textarea each time. Sift read '80 characters left' during all typing and for about 2 s after the last key, while the page said '65'. It matched 2029, 2040 and 2114 ms after the last key. The cause matches the code. The page's reply to an input event is a text-only childList mutation, so the mutation observer passes minor=true (index.ts ~2221-2257). Typing goes through H.input/proxy.setValue and never sets actedAt, so schedule() applies the 2500 ms floor (index.ts:1484). Any text-only answer to typing lags the same way, including inline validation text written with textContent. This is a sync defect, not polish.

Skeptic's fix lead: Record a typing time in the input handler that calls proxy.setValue (index.ts ~2966), e.g. typedAt = performance.now(). In schedule(), skip the minor 2500 ms floor when the last typing was within about 2 s: `if (minor && performance.now() - Math.max(actedAt, typedAt) > 5000)`. Keep the floor for clocks.

## F804 (medium): Fields with suggestions lose their combobox role and expanded state, and nothing is said when suggestions appear

Found by: T6-fixtures. Where: http://127.0.0.1:8799/fx/int-combo.html (Fruit), http://127.0.0.1:8799/fx/r5-chips.html (Add a skill), http://127.0.0.1:8799/fx/r6genb7-plain-autocomplete.html (Location)

Evidence: After typing 'ap' in int-combo, the original input is role=combobox, aria-expanded=true and aria-controls=lb. Sift's focused field is '<input data-ref="r4" value="ap" autocomplete="off" type="text">', with no role, aria-expanded, aria-controls or aria-activedescendant. The suggestion sheet is 'div.sheet suggest role=group'. Sift's live region says nothing (said: []). r5-chips after 'pa' and r6genb7 after 'ba' behave the same. A screen reader user gets no cue that a list opened. ArrowDown does move focus into the list ('Laminated dough' button), so picking still works once found.

Repro: cd /home/nico/projects/sift-test-6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun research/r8t6/go.ts goto:http://127.0.0.1:8799/fx/int-combo.html wait:2500 listen "type:Fruit=>ap" wait:900 "eval:document.querySelector('sift-root').shadowRoot.activeElement.outerHTML" said

Suspected cause: Sift's text field does not mirror the page field's combobox role and its aria-expanded state, and does not point aria-controls at its suggestion sheet. No count of suggestions is announced.

Skeptic: Reproduced twice on int-combo. After 'ap', the page input is role=combobox aria-expanded=true aria-controls=lb. Sift's focused field is <input data-ref=r4 value=ap autocomplete=off type=text>, with no role, aria-expanded, aria-controls or aria-activedescendant. The sheet is div.sheet.suggest role=group aria-label=Suggestions, and said: [] each time. r5-chips after 'pa' is the same: the page has role=combobox aria-expanded=true aria-autocomplete=list, while Sift has a plain input, a role=group sheet, and nothing said. The code agrees: TextField in app.tsx sets no combobox attributes, and DialogView renders the anchored sheet as role=group with no live text. One correction: r6genb7-plain-autocomplete has no combobox role on the original, so Sift does not differ there. That example only shows the missing announcement. On the original, a screen reader hears 'expanded' when the list opens. In Sift it hears nothing, so the user must guess to press ArrowDown. This is a real gap in what a screen reader hears.

Skeptic's fix lead: In TextField (src/content/ui/app.tsx), when the page field is a combobox, or when suggestAnchor() is this field, render role=combobox, aria-autocomplete from the page, aria-expanded={!!sheet shown}, and aria-controls pointing at an id on the .sheet.suggest div in DialogView. The extractor can pass the page field's role and aria-expanded in the Field model (generic.ts field builder). Optionally have say() announce the suggestion count when an anchored sheet first opens.
