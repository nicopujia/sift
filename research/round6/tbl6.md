# Round 6 findings: tbl6

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F607 (medium): A table with a row-selection checkbox column is flattened into loose paragraphs: column headers and the caption ('Orders 1-5 of 12') are lost

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r6-bulktable.html (5 columns: select checkbox, Order link, Customer, Items, Status; <caption>)

Evidence: Sift's outline is 'Select all orders on this page | p: Order | p: Customer | p: Items | p: Status | Select order 2001 | #2001 | p: Ana Ruiz | p: 1 | p: To ship | …'. That is 25 stacked lines for 5 rows, with no <table>, no column headers for screen readers and no caption, so the total of 12 orders is not shown. By contrast, r5-table.html (buttons in cells, no checkbox column) keeps a real table. Shot /home/nico/projects/sift-test-6/research/shots/r6t6-bulktable.png.

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/visit.ts http://127.0.0.1:8799/fx/r6-bulktable.html bt (no 'Orders 1-5 of 12', headers as 'p:' lines)

Suspected cause: The checkbox inputs in the cells send the table down the form path instead of table() in extract/generic.ts. table() should accept checkbox cells as inline controls, as F526 did for buttons.

Skeptic: Reproduced. Sift renders r6-bulktable.html with tables=0, th=0 and no caption. 'Orders 1-5 of 12' is gone (hasTotal=false), and the headers come out as 'p: Order | p: Customer | p: Items | p: Status', followed by 4 to 5 stacked lines per row. r5-table.html (buttons in cells) still renders a real table, with 6 th and its caption. Cause in code: table() in generic.ts sends any table with an input or [role=checkbox] down the flat path, which walks only the cells and skips <caption>. Row-selection checkbox columns are common in admin and mail tables. Medium.

Skeptic's fix lead: In extract/generic.ts table(), do not count a cell whose only control is a checkbox (the row select, and the header's select-all) as 'fields'. Keep the data table and render those checkboxes as inline controls in their cells, as F526 did for buttons. Keep the caption on the flat path too.

## F608 (medium): Star-rating labels are dropped: review headings are read as star glyphs instead of '5 out of 5 stars'

Found by: T6-fixtures. Where: New fixture http://127.0.0.1:8799/fx/r6-readmore.html (<h2><span aria-label="4 out of 5 stars">★★★★☆</span> Good, but salty</h2>)

Evidence: Sift renders <h2 data-key=…>★★★★★ Best rye in town</h2> with no aria-label or text alternative. The page's 'N out of 5 stars' names are gone, so a screen reader reads glyph names ('black star … white star'), and a 4- and a 5-star review differ only by one glyph. Shot /home/nico/projects/sift-test-6/research/shots/r6t6-readmore.png.

Repro: SIFT_PORT=9466 SIFT_TAB=T6-fixtures bun scripts/act.ts goto:http://127.0.0.1:8799/fx/r6-readmore.html wait:3000 "eval:document.querySelector('sift-root').shadowRoot.querySelector('main h2').outerHTML"

Suspected cause: Inline text extraction (textIn) takes the span's textContent and ignores aria-label on decorative-glyph spans. It should use the aria-label (or role=img name) when the visible text is only symbols.

Skeptic: Reproduced. Sift's headings are <h2 data-key=…>★★★★★ Best rye in town</h2> and ★★★★☆ Good, but salty, with no text alternative. Their accessible names in Chrome's tree are '★★★★★ Best rye in town' and '★★★★☆ Good, but salty'. With Sift off, the same headings are named '5 out of 5 stars Best rye in town' and '4 out of 5 stars Good, but salty' (CDP getPartialAXTree). So Sift loses the rating text that the original gives screen readers. Medium accessibility regression on a common pattern.

Skeptic's fix lead: In extract/generic.ts textIn and inline extraction, when an element has an aria-label (or role=img with a name) and its own text is only symbols (/^[\p{S}\p{P}\s]+$/u), emit the aria-label as text. Or keep the glyphs aria-hidden next to a visually hidden copy of the label.
