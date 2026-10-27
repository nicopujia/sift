// Acting through Sift means acting on the original page: every click, value,
// and submit is replayed on the original element with the same events a real
// user would cause, so the site's own code handles it.

import { withoutShield } from "./shield";
import { churned } from "./recent";

/** The focused element, looking inside shadow roots (Sift's own UI lives in one). */
export function deepActive(): HTMLElement | null {
  let a: Element | null = document.activeElement;
  while (a && (a as HTMLElement).shadowRoot?.activeElement) a = (a as HTMLElement).shadowRoot!.activeElement;
  return a as HTMLElement | null;
}

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function mouse(el: Element, type: string, init: MouseEventInit = {}) {
  const C = type.startsWith("pointer") ? PointerEvent : MouseEvent;
  const extra = type.startsWith("pointer") ? { pointerId: 1, pointerType: "mouse", isPrimary: true } : {};
  el.dispatchEvent(
    new C(type, { bubbles: type !== "mouseenter" && type !== "pointerenter", cancelable: true, composed: true, view: window, button: 0, ...center(el), ...extra, ...init }),
  );
}

/** A full, realistic click. Sites differ in which event they listen to. */
export function click(el: Element, opts: { focus?: boolean } = {}) {
  const run = () => {
    mouse(el, "pointerover");
    mouse(el, "pointerenter");
    mouse(el, "mouseover");
    mouse(el, "mouseenter");
    mouse(el, "pointerdown", { buttons: 1 });
    mouse(el, "mousedown", { buttons: 1 });
    if (opts.focus) (el as HTMLElement).focus?.({ preventScroll: true });
    mouse(el, "pointerup");
    mouse(el, "mouseup");
    // Controls and links get the browser's own click (its default action); any
    // other element a click at its center, as a pointer makes it (a slider's
    // track or a star rating reads where it was clicked).
    if (el instanceof HTMLElement && el.matches("a[href], area[href], button, input, select, textarea, label, summary")) el.click();
    else mouse(el, "click");
  };
  if (opts.focus) {
    const back = deepActive();
    withoutShield(run, el);
    back?.focus({ preventScroll: true });
  } else run();
}

/** Hover, for menus that open on mouseover. */
export function hover(el: Element) {
  mouse(el, "pointerover");
  mouse(el, "mouseover");
  mouse(el, "pointerenter");
  mouse(el, "mouseenter");
}

function nativeSetter(el: Element): ((v: string) => void) | null {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
  if (!proto) return null;
  const d = Object.getOwnPropertyDescriptor(proto, "value");
  return d?.set ? (v: string) => d.set!.call(el, v) : null;
}

/**
 * Each field's value as of its last change event, kept while Sift has typed
 * into it since. Chrome fires change when editing ends (leaving the field,
 * Enter) only if the value differs from that.
 */
const asOfChange = new WeakMap<Element, string>();

/** Set a text value as if typed. */
export function setValue(el: Element, value: string, back?: HTMLElement | null) {
  if ((el as HTMLElement).isContentEditable) return setEditable(el as HTMLElement, value, back);
  const set = nativeSetter(el);
  if (!set) return;
  if (!asOfChange.has(el)) asOfChange.set(el, (el as HTMLInputElement).value);
  const was = (el as HTMLInputElement).value;
  // Typing stops at the field's maxlength (a value set from code does not): no longer value reaches the page than typing gives (F801).
  const max = (el as HTMLInputElement).maxLength;
  if (max >= 0 && value.length > max && value.length > was.length && (el instanceof HTMLTextAreaElement || /^(text|search|url|tel|email|password)$/.test((el as HTMLInputElement).type)))
    value = value.slice(0, Math.max(max, was.length));
  set(value);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  // Live search that runs on keyup (queryly on Infobae) hears the key that typed it.
  if (value !== was) keyEvents(el, value.length > was.length ? value.slice(-1) : "Backspace", ["keyup"]);
}

/** Fire change if the value changed since the last change event, as ending an edit does; true if Sift had typed there. */
export function change(el: Element): boolean {
  const was = asOfChange.get(el);
  if (was === undefined) return false;
  asOfChange.delete(el);
  if (was !== (el as HTMLInputElement).value) el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** A plain search field: pages show suggestions or results under it as it is typed in, with no list it names. */
export const SEARCH_FIELD = "input[type=search], [role=searchbox], :is([role=search], form[action*=search i]) input:is(:not([type]), [type=text])";

/** Fire focus and focusin, as entering a field does (pages open date pickers and history lists then). */
export function focus(el: Element) {
  // A field with a suggestion list, or a plain search field (Wikipedia's portal draws its
  // suggestions only while its box is the active element): the page-world helper names it as
  // document.activeElement from now on (main/index.ts), as some pages check.
  if (el.matches("[role=combobox], [aria-autocomplete], [aria-controls], [aria-owns], [list]") || el.matches(SEARCH_FIELD))
    el.dispatchEvent(new CustomEvent("sift-enter", { bubbles: true, composed: true }));
  el.dispatchEvent(new FocusEvent("focus"));
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
}

/** Fire blur and focusout, as leaving a field does (sites validate on blur). */
export function blur(el: Element) {
  el.dispatchEvent(new CustomEvent("sift-leave", { bubbles: true, composed: true }));
  el.dispatchEvent(new FocusEvent("blur"));
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
}

/** Fire change, then blur, as leaving a changed field does. */
export function commit(el: Element) {
  change(el);
  blur(el);
}

export function setSelect(el: HTMLSelectElement, value: string | string[]) {
  if (Array.isArray(value)) for (const o of Array.from(el.options)) o.selected = value.includes(o.value);
  else nativeSetter(el)?.(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function setChecked(el: Element, checked: boolean) {
  const cur = el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked") === "true";
  if (cur !== checked) click(el);
}

export function setFiles(el: HTMLInputElement, files: FileList) {
  const dt = new DataTransfer();
  for (const f of Array.from(files)) dt.items.add(f);
  el.files = dt.files;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---------- rich editors ----------

const norm = (s: string) => s.replace(/ /g, " ").replace(/\n+$/, "");

type Pos = { node: Text; off: number };

/**
 * The editor's text as innerText gives it, with the DOM position of every
 * character (null for line breaks made by blocks and <br>). Follows innerText's
 * rules: <p> gives two line breaks, other blocks one, <br> one, collapsible
 * white space shrinks to one space and vanishes at line ends.
 */
function linearize(root: HTMLElement): { text: string; at: (Pos | null)[] } {
  let text = "";
  const at: (Pos | null)[] = [];
  let breaks = 0;
  let space: Pos | null = null;
  const ws = new Map<Element, string>();
  const push = (s: string, p: Pos | null) => {
    text += s;
    at.push(p);
  };
  const flush = () => {
    if (breaks && text.length) for (let i = 0; i < breaks; i++) push("\n", null);
    breaks = 0;
  };
  const char = (c: string, p: Pos) => {
    flush();
    if (space && text.length && !text.endsWith("\n")) push(" ", space);
    space = null;
    push(c, p);
  };
  const lineBreak = () => {
    flush();
    space = null;
    push("\n", null);
  };
  const block = (n: number) => {
    space = null;
    breaks = Math.max(breaks, n);
  };
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const t = n as Text;
      const parent = t.parentElement ?? root;
      let w = ws.get(parent);
      if (w === undefined) ws.set(parent, (w = getComputedStyle(parent).whiteSpace));
      const keepSpaces = /^(pre|pre-wrap|break-spaces)$/.test(w);
      const keepLines = keepSpaces || w === "pre-line";
      for (let i = 0; i < t.data.length; i++) {
        const c = t.data[i];
        if ((c === "\n" || c === "\r") && keepLines) lineBreak();
        else if (/[ \t\n\r\f]/.test(c) && !keepSpaces) {
          if (!space && !(text.endsWith(" ") && at[at.length - 1] && !breaks)) space = { node: t, off: i };
        } else char(c, { node: t, off: i });
      }
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (el.localName === "br") return lineBreak();
    if (/^(script|style|template|noscript)$/.test(el.localName)) return;
    const d = getComputedStyle(el).display;
    if (d === "none") return;
    const req = el.localName === "p" ? 2 : !d.startsWith("inline") && d !== "contents" ? 1 : 0;
    if (req) block(req);
    for (const c of Array.from(el.childNodes)) walk(c);
    if (req) block(req);
  };
  for (const c of Array.from(root.childNodes)) walk(c);
  return { text, at };
}

/**
 * The DOM boundary before character `i`, when a neighbouring character is
 * text: right after the previous character when there is one, so typed text
 * takes the formatting before it, as it does when typing.
 */
function boundary(lin: { text: string; at: (Pos | null)[] }, i: number, root: HTMLElement): [Node, number] | null {
  const prev = i > 0 ? lin.at[i - 1] : null;
  if (prev) return [prev.node, prev.off + 1];
  const here = lin.at[i];
  if (here) return [here.node, here.off];
  if (i === 0 && !lin.text.length) return [root, 0];
  if (i >= lin.text.length) return [root, root.childNodes.length];
  return null;
}

/** The longest run of equal code points in A[alo:ahi] and B[blo:bhi], as [i, j, length]. */
function longest(A: string[], alo: number, ahi: number, B: string[], blo: number, bhi: number): [number, number, number] {
  let best: [number, number, number] = [alo, blo, 0];
  let prev = new Int32Array(bhi - blo + 1);
  let row = new Int32Array(bhi - blo + 1);
  for (let i = alo; i < ahi; i++) {
    for (let j = blo; j < bhi; j++) {
      const v = A[i] === B[j] ? prev[j - blo] + 1 : 0;
      row[j - blo + 1] = v;
      if (v > best[2]) best = [i - v + 1, j - v + 1, v];
    }
    [prev, row] = [row, prev];
  }
  return best;
}

/**
 * The changes that turn `a` into `b`, as [start, end, insert] with offsets in
 * `a`, in order. Unchanged runs between separate changes are kept, so the text
 * and formatting between two edits stay. Works on code points, so an emoji is
 * never split.
 */
function changes(a: string, b: string): [number, number, string][] {
  const A = Array.from(a);
  const B = Array.from(b);
  const off = [0];
  for (const c of A) off.push(off[off.length - 1] + c.length);
  const out: [number, number, string][] = [];
  const split = (alo: number, ahi: number, blo: number, bhi: number) => {
    while (alo < ahi && blo < bhi && A[alo] === B[blo]) alo++, blo++;
    while (alo < ahi && blo < bhi && A[ahi - 1] === B[bhi - 1]) ahi--, bhi--;
    if (alo === ahi && blo === bhi) return;
    const [i, j, k] = (ahi - alo) * (bhi - blo) <= 4e6 ? longest(A, alo, ahi, B, blo, bhi) : [0, 0, 0];
    if (k < 2) {
      out.push([off[alo], off[ahi], B.slice(blo, bhi).join("")]);
      return;
    }
    split(alo, i, blo, j);
    split(i + k, ahi, j + k, bhi);
  };
  split(0, A.length, 0, B.length);
  return out;
}

/**
 * Type `text` at the caret the way the editor separates lines: in <p>
 * editors a blank line is a new paragraph and a single line break a <br>; in
 * <div> editors every line is a new block.
 */
function typeText(text: string, sep: string): boolean {
  let ok = true;
  const run = (cmd: string, v?: string) => (ok = document.execCommand(cmd, false, v) && ok);
  text.split(sep).forEach((part, i) => {
    if (i) run("insertParagraph");
    const lines = sep === "\n\n" ? part.split("\n") : [part];
    lines.forEach((line, j) => {
      if (j) run("insertLineBreak");
      if (line) run("insertText", line);
    });
  });
  return ok;
}

/**
 * Bring a rich editor's text to `text` through the browser's editing pipeline.
 * Only the changed part is replaced, so formatting, links, a signature, or
 * quoted text elsewhere in the editor stay as they are. Focus goes back to
 * `back` (by default, where it was).
 */
export function setEditable(el: HTMLElement, text: string, back: HTMLElement | null = deepActive()) {
  const next = norm(text);
  if (norm(el.innerText) === next) return;
  withoutShield(() => {
    // An empty editor with no height has no line to put a caret on, and editing
    // commands fail there; give it one line while Sift types.
    const flat = el.getBoundingClientRect().height < 1;
    const minH = el.style.getPropertyValue("min-height");
    const minP = el.style.getPropertyPriority("min-height");
    if (flat) el.style.setProperty("min-height", "1lh", "important");
    el.focus({ preventScroll: true });
    const sel = getSelection();
    const sep = el.querySelector("p") && !el.querySelector("div") ? "\n\n" : "\n";
    let done = false;
    const lin = linearize(el);
    // Only edit in place when Sift's reading of the editor matches the browser's.
    if (sel && norm(lin.text) === norm(el.innerText) && lin.text.length < 100000) {
      // Last change first, so the positions of earlier ones stay valid.
      try {
        for (const [a, b, insert] of changes(norm(lin.text), next).reverse()) {
          const start = boundary(lin, a, el);
          const end = boundary(lin, b, el);
          if (!start || !end) break;
          const range = document.createRange();
          range.setStart(start[0], start[1]);
          range.setEnd(end[0], end[1]);
          sel.removeAllRanges();
          sel.addRange(range);
          if (!range.collapsed) document.execCommand("delete");
          typeText(insert, sep);
        }
      } catch {
        /* a node moved under us: the check below falls back */
      }
      done = norm(el.innerText) === next;
    }
    if (!done) {
      // Fall back to replacing everything when the targeted edit did not land.
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      const cleared = document.execCommand("delete") || !el.innerText.trim();
      if (!cleared || !typeText(next, sep)) {
        // Editing commands do not work here: set the text directly.
        el.innerText = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
    if (flat) {
      if (minH) el.style.setProperty("min-height", minH, minP);
      else el.style.removeProperty("min-height");
      if (!el.getAttribute("style")) el.removeAttribute("style");
    }
    el.blur();
  }, el);
  back?.focus({ preventScroll: true });
}

// ---------- keys and submitting ----------

const CODES: Record<string, number> = {
  Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34, Tab: 9, " ": 32, Backspace: 8,
};

/** Dispatch key events in order; false when the page cancelled one (the rest are not sent). */
function keyEvents(el: Element, k: string, types: string[], opts: KeyboardEventInit = {}): boolean {
  // The page-world helper (main.js) creates events that carry keyCode, and
  // cancels this request when the page cancelled one of them.
  if (document.documentElement.hasAttribute("data-sift-main")) {
    const detail = JSON.stringify({ key: k, code: k === " " ? "Space" : k, keyCode: CODES[k] ?? (/^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : 0), types });
    return el.dispatchEvent(new CustomEvent("sift-key", { detail, bubbles: true, composed: true, cancelable: true }));
  }
  const init = { key: k, code: k === " " ? "Space" : k, bubbles: true, cancelable: true, composed: true, ...opts } as KeyboardEventInit;
  for (const type of types) if (!el.dispatchEvent(new KeyboardEvent(type, init))) return false;
  return true;
}

/**
 * Press a key on a page element: keydown, keypress (Enter and Space), then
 * `action` as the key's default action unless the page cancelled it, then
 * keyup. Returns whether the default action ran.
 */
export function key(el: Element, k: string, action?: (() => void) | KeyboardEventInit): boolean {
  const opts = typeof action === "object" ? action : {};
  const ok = keyEvents(el, k, ["keydown", ...(k === "Enter" || k === " " ? ["keypress"] : [])], opts);
  if (ok && typeof action === "function") action();
  keyEvents(el, k, ["keyup"], opts);
  return ok;
}

type Submitter = HTMLButtonElement | HTMLInputElement;

// When a navigation last started, to tell whether Enter in a field did anything.
let navAt = 0;
// And when the page last started to leave for another document (a held submit then stays dropped).
let leftAt = -1;
(window as any).navigation?.addEventListener?.("navigate", (e: any) => {
  navAt = performance.now();
  if (e.destination?.sameDocument === false) leftAt = navAt;
});
addEventListener("beforeunload", () => (navAt = leftAt = performance.now()));

/**
 * A button that opens or shows a search box rather than searching ("Ir al
 * buscador", a magnifier that expands the field): a toggle, or a verb that
 * opens with the search box as its object. Never a button named for searching
 * or its results ("Search", "Show results").
 */
export function opensSearch(el: Element): boolean {
  if (el.hasAttribute("aria-expanded") || el.hasAttribute("aria-haspopup")) return true;
  // Its name: what a screen reader says ("Show results" for a button showing "Search").
  const label = (el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLElement).innerText || "").trim();
  return /\b(open|show|toggle|expand|abrir|mostrar|ir al|ouvrir|afficher|öffnen|anzeigen|apri|mostra)\b.{0,24}(search|buscador|búsqueda|busca|pesquisa|recherche|suche|ricerca|cerca)/i.test(label);
}

function isSubmitter(el: Element | null): el is Submitter {
  return (el instanceof HTMLButtonElement && el.type === "submit") || (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image"));
}

/**
 * Input types that can trigger implicit submission (Chrome's text fields). Enter
 * in one submits a form with no submit button only when it is the form's only
 * such field. Enter in other fields (a date, a checkbox) only clicks the
 * form's first enabled submit button (the spec lists date and time too;
 * Chrome does not).
 */
const BLOCKING = new Set(["text", "search", "url", "tel", "email", "password", "number"]);
const triggers = (el: Element | null) => el instanceof HTMLInputElement && BLOCKING.has(el.type);

/** The form's controls in tree order, image buttons included (form.elements leaves them out). */
function listed(f: HTMLFormElement): Element[] {
  const all = new Set<Element>(Array.from(f.elements));
  for (const i of Array.from(f.querySelectorAll("input[type=image]"))) if ((i as HTMLInputElement).form === f) all.add(i);
  if (f.id) for (const i of Array.from(document.querySelectorAll(`input[type=image][form="${CSS.escape(f.id)}"]`))) all.add(i);
  return Array.from(all).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * Implicit submission as Chrome does it (HTMLFormElement::SubmitImplicitly):
 * click the first submit button (an image button too) if it is enabled. From a
 * field that cannot trigger it, any enabled submit button counts and the form
 * is never submitted without one. Returns a validation message when the
 * browser would refuse to submit.
 */
function submitImplicitly(f: HTMLFormElement, fromTrigger: boolean): string {
  let count = 0;
  for (const c of listed(f)) {
    if (isSubmitter(c)) {
      if (!c.matches(":disabled")) {
        // Validity is read before the click: a site may clear the form after a good submit.
        const problem = invalidMessage(f, c);
        click(c);
        return problem;
      }
      // The default button is disabled: no submission.
      if (fromTrigger) return "";
    } else if (triggers(c)) count++;
  }
  if (!fromTrigger || count !== 1) return "";
  const problem = invalidMessage(f);
  try {
    f.requestSubmit();
  } catch {
    f.submit();
  }
  return problem;
}

/**
 * What Chrome does on Enter in a field before implicit submission: a search
 * field's search event (queued), then change if the value changed, since
 * "form submission finishes editing".
 */
function finishEditing(field: Element) {
  if (field instanceof HTMLInputElement && field.type === "search") setTimeout(() => field.dispatchEvent(new Event("search", { bubbles: true })), 0);
  change(field);
}

/** An endpoint (origin and path) of a page request. */
const endpoint = (url: string) => url.split(/[?#]/)[0];
/** When the page last sent a request to each endpoint: a beacon or a poll it sends all the time. */
const sentAt = new Map<string, number>();
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceResourceTiming[]) {
      if (!/fetch|xmlhttprequest/.test(e.initiatorType)) continue;
      const k = endpoint(e.name);
      sentAt.delete(k);
      sentAt.set(k, e.startTime);
      if (sentAt.size > 200) sentAt.delete(sentAt.keys().next().value!);
    }
  }).observe({ type: "resource", buffered: true });
} catch {
  /* no resource timing */
}

/**
 * Watch how the page reacts to a key about to be pressed in `field`: a
 * navigation (an app router may push its URL late), a request it makes, or a
 * change to its content (results drawn in the page, even by the key handler
 * itself). The field's own suggestion list redrawing does not count, nor does
 * what the page does all the time anyway (a beacon, a poll, a clock, a
 * carousel). `then` runs `fallback` a second later if the page did none of
 * these; `stop` ends the watch.
 */
function watchReaction(field: Element) {
  const t0 = performance.now();
  let acted = false;
  const polled = new Map(sentAt);
  /** Nodes the page kept changing before the key: their changes now are not its answer. */
  const steady = new Set<Node>();
  const own = [field, ...["aria-controls", "aria-owns"].flatMap((a) => (field.getAttribute(a) ?? "").split(/\s+/).map((id) => (id ? document.getElementById(id) : null)))].filter(Boolean) as Element[];
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      const n = r.target instanceof Element ? r.target : r.target.parentElement;
      if (!n || n.closest("sift-root, [data-sift-portal], [role=listbox], [role=option]") || own.some((o) => o.contains(n))) continue;
      if (r.type === "attributes" && /^(data-sift|inert$|tabindex$|role$|popover$|aria-activedescendant$|aria-expanded$)/.test(r.attributeName ?? "")) continue;
      if (steady.has(r.target) || churned(r.target, t0)) {
        steady.add(r.target);
        continue;
      }
      acted = true;
      mo.disconnect();
      return;
    }
  });
  mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((list) => {
      const polling = (url: string) => {
        const at = polled.get(endpoint(url));
        return at !== undefined && t0 - at < 5000;
      };
      if (list.getEntries().some((e) => e.startTime >= t0 && /fetch|xmlhttprequest/.test((e as PerformanceResourceTiming).initiatorType) && !polling(e.name))) acted = true;
    });
    po.observe({ type: "resource" });
  } catch {
    /* no resource timing */
  }
  const stop = () => {
    mo.disconnect();
    po?.disconnect();
  };
  return {
    stop,
    then(fallback: () => void) {
      setTimeout(() => {
        stop();
        if (!acted && navAt < t0) fallback();
      }, 1000);
    },
  };
}

/**
 * Why submitting `form` (from `submitter`) would be refused by the browser's
 * own validation, as a message to show in Sift; "" when it would go through.
 * Reads validity without firing invalid events.
 */
export function invalidMessage(form: HTMLFormElement | null, submitter?: Element | null): string {
  if (!form || form.noValidate || (isSubmitter(submitter ?? null) && (submitter as Submitter).formNoValidate)) return "";
  const bad = Array.from(form.elements).find((e) => (e as HTMLInputElement).willValidate && !(e as HTMLInputElement).validity.valid) as HTMLInputElement | undefined;
  if (!bad) return "";
  return `${bad.labels?.[0]?.innerText.trim() || bad.getAttribute("aria-label") || bad.name || ""}: ${bad.validationMessage}`.replace(/^: /, "");
}

/** The message for a click on a form's submit button, which the browser may refuse. */
export function submitProblem(el: Element): string {
  return isSubmitter(el) && !el.disabled ? invalidMessage(el.form, el) : "";
}

/**
 * Press Enter in a field, as the browser would: the page's key handlers run
 * first and may cancel; then implicit submission. With a form, that clicks the
 * form's default button (its first submit button in tree order; nothing if it
 * is disabled), or, with no submit button, submits the form only when it has
 * at most one field that blocks implicit submission. A field with no form gets
 * the Enter key, as typing there would. Sift's own button (`via` "button")
 * clicks the page's submit button (`button`) instead, unless that button only
 * opens the search box. When Enter did nothing (the page neither handled it
 * nor started a navigation), the page's real submit button is clicked. Returns
 * a validation message when the browser would refuse to submit.
 */
export function submit(field: Element | null, button: Element | null, form: HTMLFormElement | null, via: "enter" | "button" = "button"): string {
  clearTimeout(heldSubmit);
  const f = form ?? (field as HTMLInputElement | null)?.form ?? null;
  if (f && holdsSubmit(f)) {
    // A form that only posts back to this page ("#"), submitted while the page still loads: its script
    // that searches binds late (Corriere's burger search, F1235), and the browser's own submission would
    // just reload the page and lose the query. Hold it and try again once the page has loaded.
    const t0 = performance.now();
    const at = location.href.split("#")[0];
    const hold = (e: Event) => {
      if (e.target !== f || e.defaultPrevented) return;
      e.preventDefault();
      clearTimeout(heldSubmit);
      heldSubmit = setTimeout(function retry() {
        // Not once the page has gone on to another address (the site took it over, or the user went elsewhere).
        if (leftAt >= t0 || location.href.split("#")[0] !== at || !f.isConnected) return;
        if (document.readyState !== "complete") heldSubmit = setTimeout(retry, 500);
        else submit(field?.isConnected ? field : null, button, form, via);
      }, 1000);
    };
    addEventListener("submit", hold);
    try {
      return submitNow(field, button, f, via);
    } finally {
      removeEventListener("submit", hold);
    }
  }
  return submitNow(field, button, form, via);
}

/** The retry of a submission held while the page loads. */
let heldSubmit: ReturnType<typeof setTimeout> | undefined;

/**
 * Whether a submission of `f` that the page does not take over is held for
 * now: its action is only a fragment or a script ("#"), and the page is
 * loading or loaded less than 8 seconds ago.
 */
function holdsSubmit(f: HTMLFormElement): boolean {
  if (!/^\s*(#|javascript:)/i.test(f.getAttribute("action") ?? "")) return false;
  if (document.readyState !== "complete") return true;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return !!nav && performance.now() < nav.loadEventEnd + 8000;
}

function submitNow(field: Element | null, button: Element | null, form: HTMLFormElement | null, via: "enter" | "button"): string {
  const f = form ?? (field as HTMLInputElement | null)?.form ?? null;
  if (!f) {
    const real = !!button && !opensSearch(button);
    if (field && (via === "enter" || !real)) {
      const watch = watchReaction(field);
      const unhandled = key(field, "Enter", () => finishEditing(field));
      // Enter did nothing the page shows: its real search button does it.
      if (unhandled && real) watch.then(() => button!.isConnected && click(button!));
      else watch.stop();
    } else if (button) click(button);
    else if (field) key(field, "Enter", () => finishEditing(field));
    return "";
  }
  let problem = "";
  const implicit = () => {
    if (!field) {
      // Sift's own submit with no field to press Enter in: the default button, else the form.
      const def = listed(f).find(isSubmitter);
      if (def) problem = submitImplicitly(f, false);
      else {
        problem = invalidMessage(f);
        try {
          f.requestSubmit();
        } catch {
          f.submit();
        }
      }
      return;
    }
    finishEditing(field);
    // A change handler may have taken the form away.
    if (f.isConnected) problem = submitImplicitly(f, triggers(field));
  };
  if (field) key(field, "Enter", implicit);
  else implicit();
  return problem;
}
