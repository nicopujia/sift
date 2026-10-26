# Round 7 findings: int9

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F764 (high, regression): A small scroll box drawn as a windowed list is scrolled to its end on load, so Sift shows the oldest rows instead of the newest

Found by: R2-interaction. Where: src/content/index.ts:399-418 (readEnds), src/content/extract/generic.ts:3192-3210 (scrollBox marks the last block of any small scroll box with scrollEnd)

Evidence: New fixture fx/r7int-vlist.html: an order list of 1,000 rows in a 300 px box (overflow:auto) that draws only the rows in view, as react-window and ag-grid do. On the original, the box shows Order 1000 down to about Order 988. In Sift, 3 s after load and with no user action, the page box's scrollTop is 29700 (its end). The page log of drawn ranges is [0, 987]. Sift's outline shows 'Order 13' to 'Order 1', the oldest orders. The newest orders never show, and scrolling Sift does not bring them back, because nothing scrolls the page box up again. scrollBox() matches any box at most 60% of the window high that has overflow auto or scroll and 200 or more characters. readEnds() then sets box.scrollTop = box.scrollHeight as soon as the marked last block is in Sift's view, which includes the first paint.

Repro: SIFT_PORT=9467 SIFT_TAB=R2-interaction bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7int/vlist.ts. By hand: open http://127.0.0.1:8799/fx/r7int-vlist.html. Sift lists Order 13 to Order 1, while the original (Alt+Shift+S) shows Order 1000 and on.

Suspected cause: The edit6 F602 fix (scroll-to-agree terms) marks every small scroll box and scrolls it whenever its end shows in Sift's view, including on first paint. It does not check that the box is a terms box: one next to a disabled Agree box or button, holding all of its text in the DOM, and not drawing rows by scroll position.

Skeptic: Reproduced twice on fx/r7int-vlist.html at 1000x800, with no user action. In Sift, 3 s after load, the page box's scrollTop is 29700 of 30001, the page's drawn-range log is [0,987], and the outline lists only 'Order 13' to 'Order 1'. 'Order 1000' is not in Sift's text, and there is 1 [data-scroll-end] marker. With sift:mode set to 'original' before load, the box stays at scrollTop 0, the log is [0], and the rows read 'Order 1000', 'Order 999', and so on. Note: switching with Alt+Shift+S after 1.2 s is not a clean comparison, because Sift has already scrolled the box by then. The code matches the claim. scrollBox() in generic.ts:3192 matches any overflow auto/scroll box that is at most 60% of the window high and has 200 or more characters. visit() marks its last p/ul/ol with scrollEnd. paint() calls readEnds(), which sets box.scrollTop = box.scrollHeight once that block is in view, and that includes the first paint. Nothing in Sift scrolls the box back, so the newest rows cannot be reached. This is a real data-display regression from the F602 fix. Its reach is limited to boxes at most 60% of the window high, so I would call it medium-high.

Skeptic's fix lead: In src/content/extract/generic.ts scrollBox()/visit(), set scrollEnd only for a terms-gate box: a disabled checkbox or button nearby (the same form or the following siblings), and the box's text not windowed (for example, no absolutely positioned children, and the content's rendered height close to scrollHeight). In src/content/index.ts readEnds(), also require a recent reader scroll (userScrollAt) so it never fires on first paint.

## F765 (high, regression): Escape in Sift's field for a rich editor reaches the page before the typed text does: an editor that saves a draft on Escape saves it empty

Found by: R2-interaction. Where: src/content/index.ts:940-957 (escapeField), called from index.ts:840

Evidence: New fixture fx/r7int-escsave.html: 'New note' opens a role=dialog with a contenteditable note. Its Escape handler keeps the text as a draft and closes, as mail compose windows do. In Sift (2 of 2 runs), I typed 'buy rye flour' into the sheet's 'Note text' field and pressed Escape. The page then has window.__drafts = [""] and the dialog is closed, so the text is lost. On the original, the same keys give ["buy rye flour"]. Text typed into a contenteditable waits in pendingEdits until the field is left or an action runs. escapeField calls proxy.key(pf, 'Escape') without flushEdits(), so the page reads its editor before Sift has written the text into it. Before round 6, Escape went through H.closeDialog, which calls flushEdits() first.

Repro: SIFT_PORT=9467 SIFT_TAB=R2-interaction bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7int/escsave.ts (Sift), then the same command with the argument 'orig' (original). By hand: open http://127.0.0.1:8799/fx/r7int-escsave.html, press New note, type in Note text, press Escape. The Drafts list shows '(empty draft)'.

Suspected cause: escapeField (edit6, F605) sends Escape to the page field without first calling flushEdits() for a contenteditable page field.

Skeptic: Reproduced 2 of 2 in Sift on fx/r7int-escsave.html. After 'New note', focus is in Sift's textarea for the contenteditable 'Note text'. I typed 'buy rye flour' and pressed Escape. Result: window.__drafts = [""] and the page dialog closed, so the text was lost. On the original, the same keys give ["buy rye flour"]. The code matches the claim. The input handler keeps contenteditable text in pendingEdits (index.ts:2786). escapeField (index.ts:940) calls proxy.key(pf, 'Escape') with no flushEdits(), and proxy.key does not flush either. H.closeDialog (index.ts:2943) does flush first. This is data loss in mail-compose style editors that save a draft on Escape, so high is fair.

Skeptic's fix lead: In src/content/index.ts escapeField(), call flushEdits() before proxy.key(pf, 'Escape'), at least when (pf as HTMLElement).isContentEditable. setValue puts focus back where it was, so the key still goes to the right place.

## F767 (medium): 'Show more' on a page with no sections still sends focus and the view past the new entries (F633 holds wherever the control sits directly in main)

Found by: R2-interaction. Where: src/content/index.ts:461 (moreSpot returns null when the control's box is main)

Evidence: New fixture fx/r7int-showmore2.html (r6-readmore.html, but 'Show more reviews' adds 6 reviews), at 1000x600. In Sift, after 'Show more reviews', focus is on 'Expand all' at the place the control was (y 275). The first new review's heading is at y -734, above the window, and only the sixth is in view (y 70). On the original, focus goes to <body>, the view does not move, and the first new review is at y 308, where the button was. The reader only lands past the new reviews after pressing Tab. In Sift, the control's row is a direct child of #sift-main, so moreSpot gives up and refocus() falls back to the next control. fx/r7int-showmore.html (8 new comments) gives the same: focus on 'Add an answer', first new comment at y -259.

Repro: SIFT_PORT=9467 SIFT_TAB=R2-interaction bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r7int/more6.ts (Sift), then the same command with the argument 'orig' (original).

Suspected cause: The genb7 fix only finds the box of blocks when the control is nested below main. Allowing main as the box would let kids.slice(i).find(isNew) find the first new review at the control's index.

Skeptic: Reproduced twice on fx/r7int-showmore2.html at 1000x600. In Sift, after a click on 'Show more reviews' (the control was at y 275), focus is on 'Expand all' at y 275. The first new review's heading ('Too sour for kids') is at y -734, above the window. Only the last one ('My weekly loaf') is in view, at y 70. On the original, focus goes to body, the view does not move, and the first new review is at y 308, where the button was (control at 334). The code matches the claim. moreSpot() at index.ts:461 walks up to the control's row, then returns null because its parent is main(). paint() then falls back to refocus(), which puts the next control in view. This is the same failure as the accepted F633 (medium), still present when the control sits directly in main. So it is not fully fixed, though it is not a new regression.

Skeptic's fix lead: In src/content/index.ts moreSpot(), allow box === main(), so it returns null only when there is no box or the box is outside main. moreFocus() can then find the first new block at the control's index (kids.slice(i).find(isNew)) and focus it without scrolling.
