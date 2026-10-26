# Round 6 findings: edit6

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F602 (high): A 'scroll to the end of the terms to agree' gate cannot be passed in Sift, so the account cannot be opened

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r6-termsgate.html (terms in a 160 px overflow:auto box; the agree checkbox stays disabled until the box's scroll event sees the end; a sticky gate with 'Open account')

Evidence: Sift flattens the terms into 8 paragraphs, which reads well, but nothing in Sift scrolls the page's box. 10 wheel steps of 300 over the terms in Sift, plus End: page log [], #terms scrollTop 0, and Sift's 'I have read and agree…' checkbox still disabled. Clicking its label does nothing, and 'Open account' stays aria-disabled (log []). On the original, the same wheel steps over the box log 'scrolled to end', then 'agree true' and 'open account'. Switching back to Sift then shows the box enabled and checked. Shot /home/nico/projects/sift-test-6/research/shots/r6t6-termsgate-stuck.png.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun terms.ts (prints 'log [] page box scrollTop 0 checkbox disabled in sift true'). Original comparison: bun termsorig.ts.

Suspected cause: Scrollable regions are flattened into plain text, and Sift's own scrolling is never mirrored onto the original scroll container. A gate that listens for the box's scroll event never fires. One possible fix: when the reader scrolls past the end of a flattened scroll region, or a disabled control's label mentions scrolling, scroll the original container to its end.

Skeptic: Reproduced twice. Sift flattens the 8 terms into paragraphs, with no scrollable region (no [role=region] or tabindex box in Sift). 10 wheel steps over the terms, then End: page log [], #terms scrollTop 0, and Sift's checkbox stays disabled. A click on its label does nothing (page agree=false). 'Open account' is aria-disabled, and a click logs nothing. With Sift off, the same wheel steps log 'scrolled to end', and the box click and Open account give 'agree true' and 'open account'. Back in Sift, the box is enabled and checked. The account cannot be opened without switching to the original. index.ts only mirrors scrolling of the document (se.scrollTop), never of inner overflow containers.

Skeptic's fix lead: In extract/generic.ts, when a region with overflow:auto/scroll is flattened, keep its ref on the block (a new optional model field). In index.ts, when the region's last paragraph scrolls into Sift's view (IntersectionObserver), or when the user presses a disabled control near it, set the original container's scrollTop to scrollHeight and dispatch scroll, then re-extract.

## F604 (medium): When the page focuses a field and selects its text (inline Edit), Sift puts the caret at the start, so typing prepends instead of replacing and a different value is saved

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r6-inlineedit.html (Edit turns a row into Name/Address fields; the page calls focus() and select() on Name)

Evidence: In Sift, 'Edit Work' moves focus to Sift's Name field ('Work'). Typing 'Office' gives 'OfficeWork' in both Sift and the page, and Enter logs 'save OfficeWork | 500 Howard St, San Francisco'. On the original, the same keys log 'save Office | …' because the text was selected. The same happens on 'Edit Mum' (typing x gives 'xMum'). No selection highlight is shown, so a screen reader user is not told the text would be replaced.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun inl.ts (line '2 Enter: log [… save OfficeWork …]'); original: bun inlorig.ts (log 'save Office').

Suspected cause: When Sift mirrors the page's focus move into a field, it does not mirror selectionStart/selectionEnd (or a select() call) onto Sift's copy.

Skeptic: Reproduced. After 'Edit Work', focus is on Sift's Name field, with the selection at 0-0 of 4, while the page's .en selection is 0-4. Typing 'Office' gives 'OfficeWork' in Sift and on the page, and Enter logs 'save OfficeWork | 500 Howard St, San Francisco'. 'Edit Mum' plus x gives 'xMum'. With Sift off, the same keys log 'save Office | 500 Howard St, San Francisco'. Sift copies selection only in fieldClick (the user's own press), not when it follows a focus move the page made itself (followPageFocus in index.ts).

Skeptic's fix lead: In index.ts followPageFocus(), after ctl.focus(), when ctl and to.el are text inputs with the same value, copy the page field's selectionStart and selectionEnd with ctl.setSelectionRange() (as the fieldClick mirror() does).

## F605 (medium): Escape typed in a Sift field never reaches the page, so Escape-to-cancel in inline editors does nothing

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r6-inlineedit.html (the list's keydown handler cancels the edit on Escape)

Evidence: In Sift, after 'Edit Mum' (focus in the Name field), typing x and then Escape: a capture-phase keydown listener on the page's document records nothing at all ([]). Page log ['edit Mum'], the edit stays open and focus stays in the field. On the original, Escape logs 'esc cancel' and focus returns to 'Edit Mum'. The Cancel button still works in Sift.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r6 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun esc.ts (events [] and no 'esc cancel'); original: bun inlorig.ts ('esc cancel').

Suspected cause: proxy.ts forwards text as value changes plus input events and handles Enter itself (implicit submission). It does not replay other keys such as Escape as keydown/keyup on the original field.

Skeptic: Reproduced twice. After 'Edit Mum', x, then Escape in Sift's field, a document capture keydown/keyup listener records only Sift's synthetic 'keyup m' from setValue, and nothing for Escape. Log ['edit Mum']. The editor stays open, Save is still shown, and focus stays in the field (a second Escape also does nothing). With Sift off, Escape logs 'esc cancel' and focus returns to Edit. In index.ts onSiftKey, Escape only closes Sift's menu or dialog, or goes to the page in the suggestion-list case (escapeList). A plain field never forwards it. The Cancel button works, so this is a keyboard-parity gap. Medium is fair.

Skeptic's fix lead: In index.ts onSiftKey, when Escape is pressed in a Sift field that stands for a page field, and no menu or dialog sheet takes it, send proxy.key(elOf(tg.dataset.ref), 'Escape') to the page field, then call afterAct() so the page's cancel and focus move show.

## F606 (medium): In a list with per-row buttons, the buttons are separated from their rows: another field gets placed between a row and its buttons, and during an inline edit, 'Edit Home' is placed with the Work row's Save and Cancel

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r6-inlineedit.html (ul of addresses, each li = text + Edit / Make default; a separate 'Deliver on' date paragraph after the list)

Evidence: At load, the outline order is 'Mum 22 Elm Ave, Oakland | Deliver on [date] | Edit Mum | Make default'. Mum's buttons come after the unrelated date field (shot /home/nico/projects/sift-test-6/research/shots/r6t6-inline-0.png). While Work is being edited: 'Home 1 Market St… Default | Name [Work] | Address […] | Edit Home | Save | Cancel'. The Work fields sit right under Home's text, and 'Edit Home' is grouped with Work's Save and Cancel (shot /home/nico/projects/sift-test-6/research/shots/r6t6-inline-edit.png). The buttons act on the right rows, but the layout tells sighted and screen reader users the wrong row.

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/act.ts goto:http://127.0.0.1:8799/fx/r6-inlineedit.html wait:2500 outline "click:Edit Work" wait:1200 outline

Suspected cause: The list is not kept as items. Its controls are gathered into one form whose rows of buttons are emitted after the next text block, and the trailing date paragraph is merged into the same form run.

Skeptic: Reproduced. At load, Sift's HTML is <p>Mum 22 Elm Ave, Oakland</p><form><label>Deliver on <input type=date></label><div><button>Edit Mum</button><button>Make default</button></div></form>, so Mum's buttons come after the unrelated date field. While Work is edited, it is <p>Home 1 Market St… Default</p><form>Name [Work] | Address [...] | <div>Edit Home | Save | Cancel</div></form>. Work's fields sit under Home's text, and Edit Home shares a row with Work's Save and Cancel. Mum's 'Make default' also loses its aria-label 'Make Mum the default'. The buttons act on the right rows, but the grouping shows the wrong row. Cause: Out.field and Out.action in generic.ts merge loose controls from neighboring li and p into one form, with fields first and actions after. Medium.

Skeptic's fix lead: In extract/generic.ts, flush pending controls (Out.flushControls) at each li boundary of a list whose items are text plus buttons, or emit such a ul as items with their own actions. A following paragraph's field must never join the previous row's form. Keep the aria-label as the button's name when it adds the row name.
