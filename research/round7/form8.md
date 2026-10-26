# Round 7 findings: form8

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F703 (medium): Date-range calendar: keyboard focus order does not follow where the calendar is drawn

Found by: T6-fixtures. Where: http://127.0.0.1:8799/fx/r5-daterange.html, the calendar opened from Check-in

Evidence: After Enter on Check-in, the calendar is drawn right under the Check-in field (shot /home/nico/projects/sift-test-6/research/shots/r7t6-daterange-open.png). Tab then goes Check-out > Guests > Reserve > Previous month > Next month > November 1, 2026. The original's order is Check-in > Check-out > Previous month > Next month > November 1. A keyboard or screen-reader user passes Guests and Reserve before reaching the dates they just opened. Picking by keyboard works once there (Dec 3 to Dec 5 gives '2 nights × $140 = $280 total'). The pre-round-6 build also places the calendar after the form's controls.

Repro: cd /home/nico/projects/sift-test-6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun research/r7t6/datekb.ts   (prints the Sift Tab order and the original's DOM order)

Suspected cause: The page's non-modal role=dialog calendar is rendered as a popover after the form, outside the form's flow, rather than in place after the date fields.

Skeptic: Reproduced, and worse than the claim says. On r5-daterange.html, I pressed Enter on Sift's Check-in, then Tab. The order was Check-out > Guests > Reserve > Previous month > Next month > November 1, 2026. I checked each Tab stop with elementFromPoint inside the shadow root. Check-out (y=342), Guests (y=487) and Reserve (y=595) are all covered by the open calendar sheet: the hits were the calendar's Previous month button, the Mo header and day 2. So for three presses, keyboard focus sits on controls the user cannot see, and only then reaches the calendar. On the original, the calendar comes right after Check-out in the DOM, so the order is Check-in > Check-out > Previous month. Cause: DialogView in src/content/ui/app.tsx draws a field-anchored popup as a fixed '.sheet.suggest' placed under the field, but it sits after main in DOM order. Picking by keyboard still works once there (works.md). This is not a regression. Medium is fair for a keyboard and accessibility product (focus order, and focus hidden behind the sheet).

Skeptic's fix lead: In src/content/ui/app.tsx DialogView, or in index.ts key handling, when a dialog is anchored to a field (anchorOf(d) non-null) and holds focusable controls (a date grid): Tab from the anchor field should move focus to the sheet's first control, and Tab past the sheet's last control should return to the control after the anchor field. Alternatively, render the anchored sheet in the flow right after the anchor field.

## F704 (medium): Username availability message is shown but never announced, and Sift's Username field has no description

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r7-signup.html, the Username field (page: aria-describedby='user-hint user-msg', #user-msg aria-live=polite)

Evidence: After typing 'ana', the page says 'ana is taken. Try ana2026.' in its aria-live=polite region. Sift shows that text as a plain paragraph that is not in any live region, and no Sift live region received any text (__live []). Sift's Username input has aria-invalid=true but no aria-describedby. In Chrome's accessibility tree the textbox is 'Username', description (none), invalid true. A screen-reader user hears 'invalid' with no reason and is never told the name is taken. On the original the message is announced and also describes the field. By contrast, the Email and Confirm password errors are linked by aria-describedby in Sift.

Repro: cd /home/nico/projects/sift-test-6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun research/r7t6/signup-live.ts

Suspected cause: Page live regions under the inert original are not mirrored to Sift's announcer unless they are role=status or alert notices. Also, aria-describedby is carried over only for error paragraphs, not for hint or live-message paragraphs.

Skeptic: Reproduced twice, the second time waiting 6 s instead of 1.8 s to give Sift's delayed alert check time. The page's #user-msg (aria-live=polite) said 'ana is taken. Try ana2026.' Sift shows that text as a plain paragraph, not in a live region. Sift's own status region got nothing (__live []). Sift's Username input has aria-invalid=true and aria-describedby=null. In the AX tree it is 'Username | description: (none) | invalid: true', so even the hint '3 to 15 letters or numbers.' is lost. Causes in the code: fieldError() in generic.ts (~line 1715) keeps an aria-describedby target only if it is role=alert or its id or class matches err|invalid|warn ('user-msg'/'hint' do not). newAlert() in index.ts (~line 1501) announces a polite region only within 5 s of an action (actedAt). Typing does not set actedAt; only afterAct() does. So an async validation result while typing is never announced (WCAG 4.1.3 Status Messages). The original page is inert, so its own live region is not announced either. Medium is fair.

Skeptic's fix lead: In src/content/extract/generic.ts fieldError(): when the field is aria-invalid, also take aria-describedby targets that are aria-live or role=status. Better, also carry the field's full aria-describedby text into the Field (a desc), and render it in app.tsx as the input's aria-describedby. In src/content/index.ts newAlert(): treat a polite region that the field the user is typing in references through aria-describedby (or aria-errormessage) as an answer even without a recent actedAt. Or set actedAt on typing.
