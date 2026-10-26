# Round 5 findings: controls

Each was reproduced by a skeptic. F5xx are new in round 5; F3xx and F<100 are older findings a round 5 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F506 (medium): GitHub Status incident history: the 'Previous page' arrow is dropped, so older incidents cannot be reached

Found by: T4-generic. Where: https://www.githubstatus.com/history (reached from Sift's 'Incident History' link)

Evidence: The original has a visible pagination row: a.previous-page (aria-label 'Previous page', href '#back', aria-disabled=false, icon only), the text 'August 2026 to October 2026' and a disabled next arrow. Sift shows only the text 'August 2026 to October 2026', with no previous or next control. The months, incidents and '+ Show All N Incidents' buttons are kept.

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://www.githubstatus.com/history wait:7000 "eval:[!!document.querySelector('a.previous-page[aria-disabled=false]'), [...document.querySelector('sift-root').shadowRoot.querySelectorAll('a,button')].filter(e=>/previous|prev|back|older/i.test(e.textContent+' '+(e.getAttribute('aria-label')||''))).length]" gives [true,0].

Suspected cause: An icon-only link whose href is an in-page hash ('#back') is likely dropped as decoration or as a same-page anchor, although its aria-label names it.

Skeptic: Reproduced: [a.previous-page aria-disabled=false present, 0 Sift controls named previous/prev/back/older]. The original's .pagination holds <a href="#back" aria-label="Previous page"> with only an icon, then 'August 2026 to October 2026', then a disabled next link. With Sift off, clicking it loaded ?page=2 ('May 2026 to July 2026'). On page 2, Sift still shows neither the previous nor the next link, although both are enabled there. So older incidents cannot be reached from Sift. Likely cause: generic.ts line 848 skips an in-page anchor (inPage(): href starts with '#') that has no text, and an aria-label-only link has none.

Skeptic's fix lead: In src/content/extract/generic.ts around line 848, do not skip an in-page anchor with no text when it has an aria-label naming an action (Previous/Next page) or aria-disabled=false. Render it as a button, labeled with its aria-label, that proxy-clicks the original.

## F518 (high): A fixed bottom action bar (basket total, accept-terms checkbox, Go to payment / Pay) is dropped, so the order cannot be paid

Found by: T6-fixtures. Where: Fixtures /home/nico/projects/sift/research/fixtures/r5-stickybar.html and r5-wizard.html (position:fixed bar outside main). Code: extract/generic.ts ~2888-2903, the fixed/sticky keep test

Evidence: r5-stickybar.html: Sift's outline is 'Your basket | Sourdough… | Rye… | Delivery on Saturday… | [checkbox] gift | Sift'. There is no 'Total $20.50', no 'I accept the terms of sale' checkbox, no terms link and no 'Go to payment'. The Menu holds only Breadbox and Shop. Shot /home/nico/projects/sift-test-6/research/shots/r5t6-stickybar.png. r5-wizard.html: on step 3 the bar shows up only as an untitled modal sheet over the review summary and the rules, with focus on Close (shot /home/nico/projects/sift-test-6/research/shots/r5t6-wizard-step3.png). After the user checks 'I have read and accept the stand rules' (page log 'agree true', page #pay disabled=false), the sheet vanishes. Sift's buttons are then 'Skip to content ; Menu ; Back ; Sift'. 'Pay $40 deposit' is not in the Menu and does not come back after switching Sift off and on (shot /home/nico/projects/sift-test-6/research/shots/r5t6-wizard-agreed.png).

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/visit.ts http://127.0.0.1:8799/fx/r5-stickybar.html sb (no Total, no Go to payment in the outline). Wizard: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r5 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun wiz2.ts. The 'after Space' outline has no Pay button, while 'pay disabled false' on the page.

Suspected cause: The fixed/sticky keep test drops fixed elements under 40% of the viewport unless they hold an h1, a surface, a textarea, a sticky in-main input, a sort control or a Close button. A bottom checkout bar matches none of these. It can then only surface briefly through the recent-popup path after an action, and it is lost again on the next change.

Skeptic: Reproduced on both fixtures. On r5-stickybar.html Sift's outline has only the heading, the two items, the delivery line and the gift checkbox. 'Total $20.50', the 'I accept the terms of sale' checkbox, the terms link and 'Go to payment' are missing everywhere, and the Menu holds only Breadbox and Shop. On r5-wizard.html, after the stall name, Next, Next, Tab and Space, the page log is ['step 2','step 3','agree true'] and the page's #pay is enabled. Sift's root has no 'Pay $40' text, and the Menu holds only Market Hall, Stands and FAQ. Code: in the fixed/sticky keep test in generic.ts (~2888-2903), a fixed bar under 40% of the viewport with no h1, surface, textarea or close button returns early. The order cannot be paid in Sift. High.

Skeptic's fix lead: In generic.ts, in the fixed/sticky keep test (~line 2890), keep a fixed or sticky bar outside nav and header that holds a button, a checkbox or another form control (a checkout or pay bar). Render it in place or at the end of main, not only through the recent-popup path.

## F519 (high): Row overflow menus named 'More' or 'More actions for <file>' are dropped, so Rename, Download and Delete cannot be reached for those rows

Found by: T6-fixtures. Where: Fixture /home/nico/projects/sift/research/fixtures/r5-rowmenu.html (file list, a ⋮ button per row with aria-haspopup=menu). Code: extract/generic.ts:93-96 SKIP_EXACT ('more', 'menu', 'more (options|actions)') and ITEM_ACTION_NOISE ('more actions', 'options', 'action menu'), applied in usefulControl() line 650

Evidence: Default fixture (labels alternate 'More', 'More actions for <name>', 'Actions'): Sift keeps a button only on the 'Actions' rows. The other rows show '1.2 MB ⋮' as plain text. Variant with every label 'More actions for <name>' (scratchpad/r5/cases/rm-moreactions.html via case.ts): 6 rows and 0 menu buttons, each row ending in a '⋮' text glyph. Variant with every label 'Actions': 6 buttons. On the original, every ⋮ opens Rename/Download/Delete. The 'Actions' path works in Sift (Download logs 'download Team photo.jpg'). Shot /home/nico/projects/sift-test-6/research/shots/r5t6-rowmenu-loaded.png

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/visit.ts "http://127.0.0.1:8799/fx/r5-rowmenu.html?all=1" rm (only 2 'Actions' buttons for 6 files). Or cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r4-t6/x && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun case.ts ../../r5/cases/rm-moreactions.html

Suspected cause: 'More', 'More actions' and 'More options' are treated as pointer-only widget toggles and skipped, even when they are aria-haspopup=menu buttons that hold the only actions for a list row.

Skeptic: Reproduced on r5-rowmenu.html?all=1. Sift keeps a menu button only on the two rows labeled 'Actions' (Team photo.jpg, Logo.svg). The rows labeled 'More' (Budget, Invoice) and 'More actions for <name>' (Rye recipe.pdf, Notes.txt) have no button, and their ⋮ shows as text ('1.2 MB ⋮'). Rename, Download and Delete cannot be reached for 4 of the 6 files. The 'Actions' path works: Download logged 'download Team photo.jpg'. Code: SKIP_EXACT matches 'More', and ITEM_ACTION_NOISE matches the 'More actions…' prefix (generic.ts:93-96, usefulControl line 650, item actions line 2311).

Skeptic's fix lead: In generic.ts usefulControl (line 650) and the item-action filter (line 2311), exempt buttons with aria-haspopup=menu/true or aria-expanded from SKIP_EXACT and ITEM_ACTION_NOISE when they hold a list row's only actions. Name them after the row (for example 'Actions for <title>').

## F520 (high): Sortable table headers lose their sort buttons and aria-sort, so a table cannot be sorted in Sift

Found by: T6-fixtures. Where: Fixture /home/nico/projects/sift/research/fixtures/r5-table.html (th > button, aria-sort). Code: table() in extract/generic.ts ~4002-4006 (head is built with textIn(c) only)

Evidence: Sift's header is plain text: <th scope="col">Order</th><th scope="col">Customer</th>…<th scope="col">Total</th>. A real click on the 'Total' header in Sift leaves page log [] and the row order unchanged (#1006,#1003,#1002,…). On the original, the same click logs 'sort total asc', reorders the rows to #1002,#1006,#1004,… and sets aria-sort=ascending. Sift then follows the new order but still shows no control and no sort state. Shot /home/nico/projects/sift-test-6/research/shots/r5t6-table.png

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r5 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun table.ts (line '1 click Total header: true log []'). Original comparison: bun tsort.ts

Suspected cause: Header cells are reduced to their text, so a button inside a th, and the th's aria-sort, never reach the model.

Skeptic: Reproduced. In Sift, a real click on the 'Total' header leaves the page log [] and the order #1006,#1003,#1002,#1005,#1001,#1004. On the original, the same click logs 'sort total asc', reorders the rows to #1002,#1006,#1004,… and sets aria-sort=ascending. Sift then follows the new order, but its headers are plain <th scope=col>Total</th> with no button and no aria-sort. Code: table() builds head as strings via textIn(c) (generic.ts ~4004). The table cannot be sorted in Sift. Severity is medium to high.

Skeptic's fix lead: In generic.ts table() (~4004), when a th holds a button/[role=button] or has aria-sort, emit the header cell as an action part with its ref and sort state. Extend the table block in model.ts and the table render in app.tsx to show a header button with aria-sort.

## F521 (high): File rows with short names become a dead link ('Notes.txt 2 KB ⋮', href #) and the real file link is lost or doubled

Found by: T6-fixtures. Where: Fixture /home/nico/projects/sift/research/fixtures/r5-rowmenu.html?all=1 (rows 5-6: Notes.txt 2 KB, Logo.svg 12 KB)

Evidence: Outline: '[link] Invoice 1042.pdf | p: 88 KB | [link] Notes.txt 2 KB ⋮ | [link] Logo.svg 12 KB ⋮ | [link] Logo.svg | [button] Actions'. The 'Notes.txt 2 KB ⋮' anchor is <a href="#" class="title" data-ref="rt">. A real click on it does nothing (page log unchanged, URL unchanged). The real link to /f/Notes.txt is missing. Logo.svg appears twice: once as the dead row link and once as the real link. Rows with longer names (Budget 2026.xlsx, Rye recipe.pdf, …) render correctly as link plus size. The same happens on a fresh extraction (Sift off and on) and right after 'Load more files'. Shot /home/nico/projects/sift-test-6/research/shots/r5t6-rowmenu-loaded.png

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/visit.ts "http://127.0.0.1:8799/fx/r5-rowmenu.html?all=1" rm, then bun scripts/act.ts "click:Notes.txt 2 KB" wait:1000 url "eval:JSON.stringify(window.__log)" (no change)

Suspected cause: For a row whose text is short, the item builder makes the whole row (li) its title link instead of using the row's own <a>. Clicking the li does nothing, and the real link is folded away or repeated.

Skeptic: Reproduced twice: once with ?all=1, and once after 'Load more files' on the plain fixture. Sift renders <a href="#" data-ref="rg">Notes.txt 2 KB ⋮</a> and also 'Logo.svg 12 KB ⋮' as a dead row link, followed by a second, real 'Logo.svg' link. A real click on 'Notes.txt 2 KB ⋮' changes neither the URL nor the page log. The page's <a href="/f/Notes.txt"> exists, but nothing in Sift points to it, so Notes.txt cannot be opened. Likely cause: titleLink() (generic.ts:1751) needs the link to be at least 70% of its line, and a short name next to '2 KB' and the ⋮ button fails that. toItem then falls back to the li's text with no href.

Skeptic's fix lead: In generic.ts titleLink()/toItem() (~1751, ~2047), leave sibling buttons and glyph-only controls out of the line length. Or, when no named link is found and the row has exactly one non-action link, use it as the title link instead of making the li a href="#" title.

## F525 (medium): Date-range calendar: the Sunday column is cut off, booked days look available, and the chosen days are not marked

Found by: T6-fixtures. Where: Fixture /home/nico/projects/sift/research/fixtures/r5-daterange.html (role=dialog calendar with a role=grid of day buttons)

Evidence: Picking works by mouse and keyboard (log 'in Dec 3, 2026','out Dec 5, 2026', price '2 nights × $140 = $280 total', Reserve OK). But at 1280 px the sheet's table-wrap has scrollWidth 684 and clientWidth 576. 'November 8, 2026' starts at x=878, past the sheet's right edge at 874, so the Su column (1, 8, 15, 22, 29) is hidden behind a horizontal scroll inside the popup. Day links use the long aria-label and break mid-word ('Novembe r 2, 2026'). Days the page disables ('November 20, 2026, not available') are ordinary links with no aria-disabled. aria-selected and in-range state are not shown. At 200% zoom the table overflows to 720 px in a 640 px view. Shots /home/nico/projects/sift-test-6/research/shots/r5t6-daterange-open.png, r5t6-zoom200-daterange.png

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/act.ts goto:http://127.0.0.1:8799/fx/r5-daterange.html wait:1500 click:input wait:1000 shot:dr (no Su column; the sheet's .table-wrap scrollWidth > clientWidth)

Suspected cause: The grid is rendered as a generic data table of links named by aria-label, with no compact calendar layout and no disabled or selected state.

Skeptic: Reproduced at 1280 px. The sheet's .table-wrap has scrollWidth 684 and clientWidth 576. 'November 8, 2026' starts at x=878, past the sheet's right edge at 874, so the Su column is hidden behind a horizontal scroll inside the popup. Day links use the long aria-label and break mid-word ('Novembe r 2, 2026'). After picking Nov 3 (log 'in Nov 3, 2026'), that cell is still a plain <a href="#">, with no selected or in-range state. One part is overstated: booked days do say ', not available' in their text. But they are ordinary links with no disabled state, and clicking them does nothing. Medium.

Skeptic's fix lead: In generic.ts table() (inlineOf on grid cells), give a role=grid of day buttons a compact calendar layout: the visible day number as text, with the full aria-label kept, and disabled/aria-disabled and aria-selected carried into the model. Make the table fit the sheet in app.tsx/styles.ts (table-layout:fixed, no overflow).

## F526 (medium): Buttons inside table cells (Edit, Delete) are rendered as links

Found by: T6-fixtures. Where: r5-table.html row actions (<button aria-label="Delete order 1006">Delete</button>). Code: table() cells go through inlineOf()

Evidence: Sift's last cell is <a href="#" data-ref="ra">Edit order 1006</a> <a href="#" data-ref="rb">Delete order 1006</a>. The tabwalk lists them as '<a>'. A screen reader announces 'link, Delete order 1006' for a destructive button. The actions themselves replay correctly (edit 1003, confirm open 1003).

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/tabwalk.ts http://127.0.0.1:8799/fx/r5-table.html 14

Suspected cause: Inline cell content turns every control into an inline link part. There is no inline button type for table cells.

Skeptic: Reproduced. The last cell of each Sift row is <a href="#" data-ref="ra">Edit order 1006</a> <a href="#" data-ref="rb">Delete order 1006</a>, and tabwalk lists them as <a>. Space on the focused Edit 'link' does nothing (log []), while the page's button would act on Space. A destructive button is announced as a link. model.ts Inline has no button part, so inlineOf can only emit links. Clicks replay correctly. Medium (role/keyboard).

Skeptic's fix lead: Add an inline button part to model.ts Inline (for example { btn: string; ref: string }). Emit it from inlineOf in generic.ts for button/[role=button] cells, and render it as <button type=button> in app.tsx's inline renderer.

## F527 (medium): Fieldset legends are dropped: radio and checkbox groups have no group name

Found by: T6-fixtures. Where: r4-checkout.html step 2 'Payment method'; r5-chips.html 'Job type'; r5-wizard.html 'Which Saturdays?'

Evidence: Checkout step 2: Sift renders <fieldset><label class="check"><input type="radio" …>Card</label><label …>PayPal</label></fieldset> with no legend. 'Payment method' is only a loose paragraph before it. Chips: the three Job type checkboxes sit directly in <form class="form">, and 'Job type' is a separate small grey paragraph. Tabbing into a radio or checkbox announces only 'Card, radio button' or 'Part time, checkbox', with no group context.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r5 && SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun radio.ts (prints ["fieldset",null,null,…])

Suspected cause: The form extractor keeps the legend as text but does not set it as the group's legend or aria-label.

Skeptic: Reproduced. Checkout step 2 renders <fieldset> with the two radios and no legend. 'Payment method' is a separate 'p' before the form. On r5-chips.html the three Job type checkboxes sit directly in <form> with no group, after <p class="small">Job type</p>. generic.ts has no legend handling at all, and app.tsx FormView makes a legend-less fieldset only for runs of radios. Screen reader users in forms mode get no group name. Medium accessibility issue (WCAG 1.3.1).

Skeptic's fix lead: In generic.ts form extraction, record a fieldset's legend (or a radiogroup/group's aria-label) as a group label on its fields. In app.tsx FormView, wrap the group's fields (radios and checkboxes) in <fieldset><legend>label</legend>, and drop the loose paragraph.
