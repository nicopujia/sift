// Sift's look: white, high contrast, large readable type, generous spacing,
// thick focus rings, 44px touch targets. Sizes are in em so browser zoom and
// the user's default font size both scale everything.

export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.sift {
  --text: #111;
  --muted: #474747;
  --line: #d4d4d4;
  --soft: #f3f3f3;
  --link: #0645ad;
  --visited: #5a2a8a;
  --focus: #ffbf47;
  --bg: #fff;
  --danger: #a4001e;
  font-family: "Sift Sans", "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: var(--sift-fs, 18px);
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
  min-height: 100%;
  -webkit-text-size-adjust: 100%;
  text-rendering: optimizeLegibility;
  overflow-wrap: anywhere;
}
.sift :focus { outline: none; }
#sift-main:focus, #sift-main:focus-visible { outline: none; box-shadow: none; }
.sift :focus-visible { outline: 3px solid #111; outline-offset: 2px; box-shadow: 0 0 0 6px var(--focus); border-radius: .25em; }
.sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skip { position: absolute; inset-inline-start: .5em; top: -3em; background: #111; color: #fff; padding: .5em .8em; border-radius: .4em; z-index: 10; border: 0; font: inherit; cursor: pointer; }
.skip:focus { top: .5em; }

/* Top bar */
.bar { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); }
/* A bar that takes much of a short screen (200% zoom, a phone) scrolls away with the page. */
.bar[data-flat] { position: static; }
/* Its notice (a form's problem, a page's toast) shows under the controls, and stays at the top of
   the window once they scrolled away: the bar sticks with its controls' rows (--bar-rows) above the window.
   Not while focus is in those rows: the browser then scrolls the focused control into view. */
.bar[data-flat]:has(.bar-notice):not(:has(.bar-in:focus-within)) { position: sticky; top: calc(-1 * var(--bar-rows, 0px)); }
.bar[data-flat] .bar-notice { padding-top: .55em; }
/* Focus and jumps stop below the sticky bar (--bar-h, 0 when it scrolls away) and above the switch. */
main * { scroll-margin: calc(var(--bar-h, 0px) + .5em) 0 4.5em; }
/* In a long sheet, below its sticky head with Close. */
.layer .sheet > :not(.sheet-head), .layer .sheet > :not(.sheet-head) * { scroll-margin: 4em 0 1em; }
.bar-in { max-width: 52em; margin: 0 auto; padding: .5em 1em; display: flex; flex-wrap: wrap; gap: .5em .75em; align-items: center; }
.site { font-weight: 700; font-size: .95em; color: var(--text); text-decoration: none; white-space: nowrap; max-width: 14em; overflow: hidden; text-overflow: ellipsis; }
.search { flex: 1 1 14em; display: flex; gap: .4em; min-width: 0; margin: 0; }
.search input { flex: 1; min-width: 0; font: inherit; font-size: 1em; padding: .4em .7em; border: 2px solid #111; border-radius: .5em; background: #fff; color: var(--text); min-height: 2.4em; }
.top { display: flex; gap: .4em; flex-wrap: wrap; }
.bar-notice { max-width: 52em; margin: 0 auto; padding: 0 1em .55em; }
.bar-notice .notice { margin: 0; border: 2px solid #8a6d00; }

/* Content */
main { max-width: 44em; margin: 0 auto; padding: 1.25em 1em 6em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 .4em; font-weight: 700; }
h1 { font-size: 1.6em; margin-top: .3em; }
h2 { font-size: 1.3em; }
h3 { font-size: 1.12em; }
h4, h5, h6 { font-size: 1em; }
p { margin: .55em 0; }
p.small { font-size: .92em; color: var(--muted); }
a { color: var(--link); text-decoration: underline; text-underline-offset: .15em; text-decoration-thickness: .06em; }
a:visited { color: var(--visited); }
a:hover { text-decoration-thickness: .14em; }
ul, ol { padding-inline-start: 1.4em; margin: .55em 0; }
li { margin: .25em 0; }
/* The current step of a checkout, the current page in a list: bold, as on the page. */
li[aria-current] { font-weight: 700; }
blockquote { margin: .8em 0; padding: .2em 0; padding-inline-start: 1em; border-inline-start: 4px solid var(--line); color: var(--muted); }
pre { background: var(--soft); padding: .8em 1em; border-radius: .4em; overflow: auto; font-size: .85em; line-height: 1.45; white-space: pre-wrap; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; background: var(--soft); padding: .05em .3em; border-radius: .25em; }
img.content { display: block; max-width: 100%; height: auto; border-radius: .4em; margin: .8em 0 .3em; }
figure { margin: 1em 0; }
figcaption { font-size: .88em; color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.5em 0; }
.muted { color: var(--muted); }
.links { list-style: none; padding: 0; }
.links li { margin: .35em 0; }

/* Lists of items */
.items { list-style: none; padding: 0; margin: .5em 0 1em; }
.item { display: flex; gap: .9em; padding: .75em 0; border-bottom: 1px solid var(--line); margin: 0; align-items: flex-start; }
.item:first-child { border-top: 1px solid var(--line); }
.item .thumb { flex: 0 0 auto; width: 5.5em; height: 5.5em; object-fit: contain; border-radius: .35em; background: var(--soft); }
.item .body { flex: 1; min-width: 0; }
.item .title { font-weight: 600; font-size: 1.02em; }
.item .lead { font-weight: 700; margin-inline-end: .35em; }
.item .item-badge { margin-inline-end: .45em; vertical-align: .1em; }
/* Unread mail: a bar, a word, and bold text; read items in the same list are plain. */
.item.unread { box-shadow: inset 5px 0 0 #111; padding-inline-start: .85em; }
[dir=rtl] .item.unread { box-shadow: inset -5px 0 0 #111; }
.item.unread .title, .item.unread .lead { font-weight: 800; }
.items:has(.unread) .item:not(.unread) .title, .items:has(.unread) .item:not(.unread) .lead { font-weight: 400; }
.unread-tag { margin-inline-end: .45em; vertical-align: .1em; color: #111; border-color: #111; }
.item .meta { margin: .2em 0 0; font-size: .86em; color: var(--muted); }
.item .snippet { margin: .25em 0 0; font-size: .92em; }
.item .row { margin-top: .45em; }
/* Comments in a thread: author and time over the whole text; replies indented under what they answer. */
.item.post .title { font-weight: 400; font-size: .9em; color: var(--muted); }
.item .post-body > :first-child { margin-top: .3em; }
.items.replies { margin: .6em 0 0; padding-inline-start: .9em; border-inline-start: 2px solid var(--line); }
.items.replies .item:first-child { border-top: 0; }
.items.replies .item:last-child { border-bottom: 0; padding-bottom: 0; }
.items.replies .items.replies .items.replies .items.replies .items.replies .items.replies { padding-inline-start: 0; border-inline-start: 0; }
.more { margin: 1em 0; }

/* Buttons and fields */
.row { display: flex; flex-wrap: wrap; gap: .5em; align-items: center; }
.btn { font: inherit; font-size: .95em; line-height: 1.2; padding: .5em .95em; min-height: 2.6em; border: 2px solid #111; border-radius: .5em; background: #fff; color: #111; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: .35em; }
.btn:hover { background: var(--soft); }
/* A button whose label is a sentence (a fact you can act on) reads as text. */
.btn.long { display: flex; width: 100%; text-align: start; justify-content: flex-start; border: 1.5px solid var(--line); font-weight: 400; }
.btn.long.primary { font-weight: 700; }
.btn.primary { background: #111; color: #fff; }
.btn.primary:hover { background: #333; }
.btn.danger { border-color: var(--danger); color: var(--danger); }
.btn.quiet { border-color: var(--line); }
.btn[aria-pressed=true], .btn[aria-current] { background: #111; color: #fff; }
a.btn[aria-current] { text-decoration: none; border-color: #111; }
.btn:disabled, .btn[aria-disabled=true] { opacity: .45; cursor: not-allowed; }
.btn .badge { background: #111; color: #fff; border-radius: 1em; padding: 0 .45em; font-size: .85em; }
.btn.primary .badge { background: #fff; color: #111; }
.actions { margin: .8em 0; }
.form { margin: 1em 0; padding: 0; display: grid; gap: .8em; }
.field { display: grid; gap: .25em; }
.field > span { font-weight: 600; font-size: .95em; }
.field input, .field select, .field textarea { font: inherit; font-size: 1em; padding: .5em .65em; border: 2px solid #555; border-radius: .45em; background: #fff; color: var(--text); width: 100%; max-width: 34em; min-height: 2.6em; }
.field textarea { min-height: 7em; resize: vertical; }
.field [aria-invalid=true] { border-color: var(--danger); border-width: 3px; }
.check { display: flex; gap: .55em; align-items: center; font-size: 1em; cursor: pointer; }
.check input { width: 1.3em; height: 1.3em; margin: 0; accent-color: #111; }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: .4em; }
legend { font-weight: 600; padding: 0; margin-bottom: .2em; }

/* Facts and tables */
.facts { display: grid; grid-template-columns: minmax(6em, max-content) 1fr; gap: .35em 1em; margin: .8em 0; }
.facts dt { font-weight: 600; color: var(--muted); }
.facts dd { margin: 0; }
.table-wrap { overflow-x: auto; margin: .8em 0; }
/* Quirks-mode pages reset table text (color, weight, size) to the page's; Sift's tables follow Sift. */
table { border-collapse: collapse; color: inherit; font-family: inherit; font-weight: inherit; font-style: inherit; line-height: inherit; white-space: inherit; font-size: .92em; min-width: 50%; }
th, td { text-align: start; padding: .45em .7em; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 700; border-bottom: 2px solid #111; }
/* Cells keep whole words and numbers ("Chrome", "120"); a wide table scrolls in its wrapper instead. */
th, td { overflow-wrap: break-word; }
/* Buttons in cells (Edit, Delete, a calendar's day) and a header that sorts its column. */
.cell-btn { font: inherit; line-height: 1.2; overflow-wrap: normal; min-width: 2.2em; min-height: 2.2em; padding: .2em .5em; margin: .1em 0; border: 1.5px solid #555; border-radius: .35em; background: #fff; color: #111; cursor: pointer; }
.cell-btn:hover { background: var(--soft); }
.cell-btn[aria-pressed=true] { background: #111; color: #fff; border-color: #111; }
.cell-btn[aria-disabled=true] { opacity: .45; cursor: not-allowed; text-decoration: line-through; }
.th-btn { font: inherit; font-weight: 700; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: .15em; text-decoration-thickness: .06em; }
th[aria-sort=ascending] .th-btn::after { content: " ▲" / ""; }
th[aria-sort=descending] .th-btn::after { content: " ▼" / ""; }

/* Sections */
details.section { border-top: 1px solid var(--line); margin: 1.2em 0; padding-top: .3em; }
details.section > summary { cursor: pointer; font-weight: 700; font-size: 1.05em; padding: .5em 0; list-style-position: inside; }
details.section > summary > :is(h2, h3, h4, h5, h6) { display: inline; font-size: inherit; margin: 0; }

/* Articles */
.short-head { display: flex; flex-wrap: wrap; gap: .5em .8em; align-items: center; margin: .6em 0 .9em; }
.tag { display: inline-block; font-size: .78em; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); border: 1.5px solid var(--line); border-radius: .35em; padding: .1em .45em; }
.short h2 { font-size: 1.15em; }
.short h3 { font-size: 1.05em; }
.pending { color: var(--muted); }
.notice { background: var(--soft); border-radius: .5em; padding: .6em .9em; margin: .8em 0; display: flex; gap: .8em; align-items: center; flex-wrap: wrap; }
.notice.warn { background: #fff4d6; }
.notice.error { background: #fde8ea; }
.notice.success { background: #e6f4ea; }

/* Media */
.portal-wrap { margin: .4em 0 1em; }
.portal { width: 100%; background: #000; border-radius: .5em; }
.portal.other { background: var(--soft); }
.media { margin-top: .5em; }
.time { font-variant-numeric: tabular-nums; color: var(--muted); font-size: .9em; }
.seek { flex: 1 1 10em; min-width: 8em; margin: 0; height: 2.4em; accent-color: #111; cursor: pointer; }

/* Dialogs and menus */
/* The backdrop scrolls a long sheet: a rounded scrolling sheet let Chrome paint the page behind over its bottom edge. */
.layer { position: fixed; inset: 0; background: rgba(0, 0, 0, .4); display: flex; align-items: flex-start; justify-content: center; padding: 0 1em 1em; z-index: 20; overflow: auto; overscroll-behavior: contain; }
.layer > .sheet { margin-top: 6vh; }
.sheet { background: #fff; width: 100%; max-width: 36em; border-radius: .8em; padding: .6em 1.25em 1.2em; box-shadow: 0 10px 40px rgba(0, 0, 0, .35); }
/* Focus lands on the sheet itself only after a click on its text: no ring. */
.sheet:focus-visible { outline: none; box-shadow: 0 10px 40px rgba(0, 0, 0, .35); border-radius: .8em; }
.sheet-head { display: flex; justify-content: space-between; align-items: center; gap: 1em; position: sticky; top: 0; background: #fff; padding: .6em 0 .3em; }
.sheet-head h2 { margin: 0; font-size: 1.2em; }
.sheet .links a { display: block; padding: .3em 0; }
/* Suggestions the page shows while the user types: under the field, not modal. */
.sheet.suggest { position: fixed; z-index: 20; overflow: auto; max-width: min(36em, calc(100vw - 1em)); padding: .5em .9em; border: 2px solid #111; box-shadow: 0 6px 24px rgba(0, 0, 0, .25); }
.sheet.suggest .row { flex-direction: column; align-items: stretch; }

/* The one toggle, always in the same corner */
.toggle { position: fixed; right: 16px; bottom: 16px; z-index: 30; font: 700 15px/1 "Sift Sans", system-ui, sans-serif; display: inline-flex; align-items: center; gap: 9px; padding: 9px 12px 9px 14px; border-radius: 999px; border: 2px solid #fff; background: #111; color: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .35); cursor: pointer; }
.toggle .track { width: 34px; height: 20px; border-radius: 10px; background: #666; position: relative; flex: 0 0 auto; }
.toggle .knob { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; }
.toggle[aria-checked=true] .track { background: #2e9d50; }
.toggle[aria-checked=true] .knob { left: 17px; }
.toggle:focus-visible { outline: 3px solid #111; box-shadow: 0 0 0 6px var(--focus); }
.off .toggle { opacity: .9; }

.loading { padding: 3em 1em; text-align: center; color: var(--muted); }
@media (max-width: 540px) {
  .site { max-width: 9em; }
  main { padding-top: .8em; }
}
/* On a phone-width screen the switch is only its track (its name stays): it covers less of the rows it floats over. */
@media (max-width: 480px) {
  .toggle { padding: 9px 11px; }
  .toggle > span:first-child { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .toggle .knob { transition: left .12s; }
}
`;
