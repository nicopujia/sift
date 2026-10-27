// Small DOM helpers shared by the extractors.

export const clean = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    // Icon fonts draw glyphs from the Private Use Area; as text they are noise.
    .replace(/[\ue000-\uf8ff]|\udb80[\udc00-\udfff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Classes that hide text for screen readers only ("Unread", "(17)"). */
const SR_ONLY = /(^|[\s_-])(sr-?only|visually-?hidden|screen-?reader-?(text|only)|a11y-hidden|hidden-visually|assistive-text|offscreen)($|[\s_-])/i;
// "4.5 out of 5", "4,5 de 5", stars; not "Showing items 1 to 3 of 6".
const RATING = /\d([.,]\d+)? (out of \d|(of|de|sur|von|su) (5|10)\b)|\bstars?\b|estrellas|[ée]toiles|sterne/i;
const SR_SEL = ".sr-only, .visually-hidden, .visuallyhidden, .screen-reader-text, .screen-reader-only, .a11y-hidden, .u-hidden-visually, .assistive-text";

const FIELD_TAGS = new Set(["input", "select", "textarea"]);

export function visible(el: Element): boolean {
  const c = visCache.get(el);
  if (c !== undefined) return c;
  let v = el.isConnected;
  if (v && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
    // display:contents has no box but its children may be visible.
    if (!el.checkVisibility({ visibilityProperty: true })) v = getComputedStyle(el).display === "contents" || inClosedDetails(el);
    // Scroll-reveal effects keep in-flow sections at opacity 0 until the page is
    // scrolled, and the original is never scrolled under Sift. Only transparent
    // out-of-flow things (closed menus, faded carousel slides) count as hidden.
    else {
      const o = transparentOverlay(el);
      // A custom checkbox, radio or file button draws itself over its own transparent native field.
      v = o ? o === el && realField(el) : !squeezed(el);
    }
  }
  if (v && srOnly(el)) {
    // Screen-reader-only text repeats what is shown ("(17)", "Unread"), except a
    // rating that the page draws only as star icons. Fields and labels styled
    // that way are still the form, and words inside a link name where it goes
    // ("Continue reading <sr>Sourdough basics</sr>") unless the link shows them.
    const link = el.parentElement?.closest("a[href], label");
    v = (FIELD_TAGS.has(el.localName) && realField(el)) || el.localName === "label" || RATING.test(el.textContent ?? "") || (!!link && !repeats(el, link)) || onlyPrice(el);
  }
  if (v && clippedOut(el)) v = false;
  visCache.set(el, v);
  return v;
}

/**
 * Rolled out of a one-line window: a counter that animates its value
 * (weather.com's "48° 47° 46°", only the last shown) stacks the values in a
 * moved column inside a short box that clips the others. Carousels move
 * sideways and keep their slides.
 */
function clippedOut(el: Element): boolean {
  // The values roll in a column of several (the one shown and the ones before it), moved by
  // the script that animates them: an inline transform (cheap tests first; computed styles are slow).
  const p = el.parentElement;
  // (childElementCount counts every child each time: on a feed of thousands it is slow.)
  if (!p || p.firstElementChild === p.lastElementChild || !/transform|translate/.test(p.getAttribute("style") ?? "")) return false;
  // Only a short number rolls.
  const n = tlen(el);
  if (!n || n > 24 || !/\d/.test(el.textContent ?? "")) return false;
  for (let c = p.parentElement, i = 0; c && i < 2; c = c.parentElement, i++) {
    const s = styleOf(c);
    if (s.overflowY !== "hidden" && s.overflowY !== "clip") continue;
    const cr = c.getBoundingClientRect();
    if (cr.height > 200) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.right > cr.left && r.left < cr.right && (r.bottom <= cr.top + 1 || r.top >= cr.bottom - 1);
  }
  return false;
}

/** Hidden from sight by a screen-reader-only class ("sr-only", "visually-hidden", "screen-reader-text"). */
export function srOnly(el: Element): boolean {
  const cls = typeof el.className === "string" ? el.className : "";
  return !!cls && (cls.includes("nly") || cls.includes("idden") || cls.includes("ffscreen") || cls.includes("ssistive") || cls.includes("reader")) && SR_ONLY.test(cls);
}

/**
 * A field people use, not a honeypot, a focus trap kept out of the tab order,
 * or a "checkbox hack" that opens a menu (role=button, aria-haspopup).
 */
function realField(el: Element): boolean {
  return FIELD_TAGS.has(el.localName) && el.getAttribute("tabindex") !== "-1" && (el as HTMLInputElement).type !== "hidden" && !el.hasAttribute("role") && !el.hasAttribute("aria-haspopup");
}

const PRICE_TEXT = /^\s*(([$€£¥₹]|US\$|R\$)\s?\d[\d.,]*|\d[\d.,]*\s?([€$]|USD|EUR))\s*$/;

/** A price given only as screen-reader text, with no copy drawn beside it: the only price there is. */
function onlyPrice(el: Element): boolean {
  const own = el.textContent ?? "";
  if (!PRICE_TEXT.test(own)) return false;
  const all = el.parentElement?.textContent ?? "";
  return !/\d/.test(all.replace(own, ""));
}

/** Screen-reader text whose words the rest of the link already shows ("Issues 17 <sr>(17)</sr>"). */
function repeats(el: Element, link: Element): boolean {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const own = norm(el.textContent);
  return !own || norm(link.textContent).replace(own, "").includes(own);
}

/**
 * Content of a closed <details> (an FAQ answer) is real content one click
 * away; it counts as visible unless its own styles hide it.
 */
function inClosedDetails(el: Element): boolean {
  const p = el.parentElement;
  if (!p || (el.localName === "summary" && p.localName === "details") || !el.closest("details:not([open])") || !visible(p)) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && !el.hasAttribute("hidden");
}

/** The transparent out-of-flow element that hides `el` (itself or an ancestor), if any. */
function transparentOverlay(el: Element): Element | null {
  for (let a: Element | null = el, i = 0; a && i < 40; a = a.parentElement ?? ((a.getRootNode() as ShadowRoot).host ?? null), i++) {
    const s = getComputedStyle(a);
    if (s.opacity === "0") return s.position === "absolute" || s.position === "fixed" ? a : null;
  }
  return null;
}

/**
 * A transparent box with no room for its words: a label that slides open on
 * hover (weather.com's "Save Location" beside each place's Favorite button).
 */
function squeezed(el: Element): boolean {
  const s = getComputedStyle(el);
  if (s.opacity !== "0" || (s.overflowX !== "hidden" && s.overflowX !== "clip")) return false;
  return (el as HTMLElement).clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) < 2;
}

/**
 * A visual copy kept from screen readers (aria-hidden "$19.99") whose spoken
 * twin is screen-reader-only text that Sift drops: the copy is what people see.
 */
export function visualTwin(el: Element): boolean {
  const p = el.parentElement;
  if (!p) return false;
  for (let c = p.firstElementChild; c; c = c.nextElementSibling) if (c !== el && srOnly(c) && !visible(c)) return true;
  return false;
}

/** Only pictures drawn with glyphs ("★★★★☆"), no words or numbers. */
const GLYPHS = /^[\s\p{So}]+$/u;

/**
 * The words a row of glyphs stands for: a rating drawn as stars ("★★★★☆")
 * whose name says it ("4 out of 5 stars"), read in its place as a screen
 * reader does. An emoji named by a word ("fire") stays as drawn.
 */
export function glyphName(e: Element, text: string): string {
  if (text.length > 24 || !GLYPHS.test(text) || !/\S/.test(text) || CONTROL_TAGS.has(e.localName) || e.localName === "a") return "";
  const role = e.getAttribute("role");
  if (role && CONTROL_ROLES.has(role)) return "";
  const name = clean(e.getAttribute("aria-label"));
  if (!name || name.length > 80 || !/\p{L}/u.test(name)) return "";
  return /\d/.test(name) || /[★☆✩-✰⭐⯨-⯫]/u.test(text) ? name : "";
}

/** Glyphs kept from screen readers whose words are beside them as screen-reader text that Sift reads (a rating). */
function glyphTwin(e: Element, text: string): boolean {
  if (text.length > 24 || !GLYPHS.test(text)) return false;
  const p = e.parentElement;
  if (!p) return false;
  for (let c = p.firstElementChild; c; c = c.nextElementSibling) if (c !== e && srOnly(c) && visible(c) && RATING.test(c.textContent ?? "")) return true;
  return false;
}

export function rectOf(el: Element): DOMRect {
  return el.getBoundingClientRect();
}

export function isTiny(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width < 2 || r.height < 2;
}

// Per-extraction caches. The DOM does not change during one synchronous pass.
let textCache = new WeakMap<Element, string>();
let lenCache = new WeakMap<Element, number>();
let visCache = new WeakMap<Element, boolean>();
let ctlCache = new WeakMap<Element, boolean>();

const CONTROL_TAGS = new Set(["input", "select", "textarea", "button", "video", "audio", "iframe", "canvas", "embed", "object"]);
const CONTROL_ROLES = new Set(["button", "checkbox", "switch", "textbox", "combobox", "searchbox", "radio", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton"]);

/** A shadow root, open or closed (content scripts may read closed ones). */
export function shadowRootOf(el: Element): ShadowRoot | null {
  const open = (el as HTMLElement).shadowRoot;
  if (open) return open;
  if (!el.localName.includes("-")) return null;
  try {
    return (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement) as ShadowRoot | null) ?? null;
  } catch {
    return null;
  }
}

/** Whether the subtree holds a form control or embedded media (memoized, bottom-up, through shadow roots). */
export function hasControl(el: Element): boolean {
  let v = ctlCache.get(el);
  if (v !== undefined) return v;
  v = ctlIn(el);
  // Web components (Material, Shoelace, Ionic) keep their real <button> in a shadow root.
  if (!v && el.localName.includes("-")) {
    const sr = shadowRootOf(el);
    if (sr) v = ctlIn(sr);
  }
  ctlCache.set(el, v);
  return v;
}

function ctlIn(p: Element | ShadowRoot): boolean {
  for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
    const t = c.localName;
    if (CONTROL_TAGS.has(t) && !(t === "input" && (c as HTMLInputElement).type === "hidden")) return true;
    if (CONTROL_ROLES.has(c.getAttribute("role") ?? "")) return true;
    const ce = c.getAttribute("contenteditable");
    if (ce === "" || ce === "true") return true;
    if (hasControl(c)) return true;
  }
  return false;
}

let pass = 0;
/** The extraction pass, for callers that keep their own per-pass caches. */
export function passNo(): number {
  return pass;
}

export function resetCaches() {
  pass++;
  hostCache = new Map();
  mathCache = -1;
  rawCache = new WeakMap();
  blockCache = new WeakMap();
  ctlCache = new WeakMap();
  textCache = new WeakMap();
  lenCache = new WeakMap();
  visCache = new WeakMap();
  styleCache = new WeakMap();
  apartCache = new WeakMap();
  twinCache = new WeakMap();
}

let styleCache = new WeakMap<Element, CSSStyleDeclaration>();
function styleOf(el: Element): CSSStyleDeclaration {
  let s = styleCache.get(el);
  if (!s) {
    s = getComputedStyle(el);
    styleCache.set(el, s);
  }
  return s;
}

// Tags whose children flow inline. Everything else starts a new line.
const INLINE_TEXT = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "font", "i", "kbd", "mark", "q", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr", "del", "ins", "label", "output",
  "nobr", "tt", "big", "strike", "button", "img", "picture",
]);
const NO_TEXT = new Set(["script", "style", "noscript", "template", "svg", "math", "select", "datalist", "textarea", "iframe", "video", "audio", "canvas", "object", "embed", "img", "input"]);
const ICON_CLASS = /material-(icons|symbols)|google-symbols|(^|[\s_-])(icon|icons|glyph|glyphicon)([\s_-]|$)/i;
let rawCache = new WeakMap<Element, string>();
let blockCache = new WeakMap<Element, boolean>();

function isBlock(el: Element): boolean {
  const tag = el.localName;
  if (INLINE_TEXT.has(tag)) return false;
  // A letter in its own inline-block box (an animated title split per letter) flows in the line.
  if (!tag.includes("-") && (tag !== "div" || tlen(el) > 3)) return true;
  let b = blockCache.get(el);
  if (b === undefined) {
    b = !getComputedStyle(el).display.startsWith("inline");
    blockCache.set(el, b);
  }
  return b;
}

/** CSS sets the element apart from its neighbours: not plain inline, or a margin or padding on that side. */
function setApart(e: Element, side: "l" | "r"): boolean {
  // Remembered for the pass: each element meets its neighbours in several texts (its own, its parent's).
  const bit = side === "l" ? 1 : 4;
  const known = apartCache.get(e) ?? 0;
  if (known & bit) return !!(known & (bit << 1));
  const s = styleOf(e);
  let v: boolean;
  if (s.display !== "inline" && s.display !== "contents") v = true;
  else {
    const m = side === "l" ? s.marginLeft : s.marginRight;
    const p = side === "l" ? s.paddingLeft : s.paddingRight;
    v = parseFloat(m) > 0 || parseFloat(p) > 1;
    // Words CSS draws between them (".meta span + span::before { content: ' · ' }") part them too.
    if (!v) {
      const c = getComputedStyle(e, side === "l" ? "::before" : "::after").content;
      v = !!c && c !== "none" && c !== "normal" && c !== '""' && c !== "''";
    }
  }
  apartCache.set(e, known | bit | (v ? bit << 1 : 0));
  return v;
}
let apartCache = new WeakMap<Element, number>();

const MATH_SEL = ".MathJax, .MathJax_CHTML, .MathJax_SVG, .katex, mjx-container";
let mathCache = -1;
/** Whether the page has typeset math at all (checked once per pass). */
function mathOnPage(): boolean {
  if (mathCache < 0) mathCache = document.querySelector(MATH_SEL) ? 1 : 0;
  return mathCache === 1;
}
const CJK_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** An all-caps label ("EXCLUSIVE", "LIVE") followed by a capitalized word. */
function kicker(prev: Element, next: string): boolean {
  if (!/^\p{Lu}\p{Ll}/u.test(next)) return false;
  const t = clean(rawText(prev));
  return t.length >= 3 && t.length <= 30 && /^[\p{Lu}\d\s:!-]+$/u.test(t) && /\p{Lu}{3}/u.test(t);
}

/**
 * Whether two pieces need a space where an inline element meets other text
 * with no whitespace: "Issues"+"17" reads "Issues 17", but "CO"+<sub>2</sub>
 * stays "CO2", and "$19."+"99" stays a price unless CSS sets them apart.
 */
function needsSpace(a: string, b: string, e: Element, prev: Element | null, inFlex: () => boolean): boolean {
  const tag = e.localName;
  if (tag === "sub" || tag === "sup") return false;
  // A search hit marked inside a word ("threading.<mark>Thread</mark>", Sphinx's span.highlighted) is part of it.
  if (tag === "mark" || e.classList.contains("highlighted")) return false;
  // A gap before closing punctuation is an icon's padding ("22 [↗]. Retrieved"), not a space.
  if (/^[.,;:!?)\]}»”’…]/.test(b)) return false;
  // Typeset math draws each letter in its own box ("G F p a s t a"); its spaces are in the text.
  if (mathOnPage() && e.closest(MATH_SEL)) return false;
  const wa = /[\p{L}\p{N}]$/u.test(a);
  const wb = /^[\p{L}\p{N}]/u.test(b);
  // The container's layout is read only when CSS is what decides.
  const apart = () => inFlex() || setApart(e, "l") || (!!prev && setApart(prev, "r"));
  if (/\d[.,:]$/.test(a) && /^\d/.test(b)) return apart();
  // Chinese and Japanese write words without spaces; only CSS sets pieces apart.
  if (wa && wb && (CJK_END.test(a) || CJK_START.test(b))) return apart();
  if (wa && wb) {
    // An all-caps label before a headline ("EXCLUSIVE"+"Insiders") is its own word.
    if (prev && kicker(prev, b)) return true;
    // Two links to different places are two things ("Adolf Hitler"+"Alemania" in a row of tags).
    // Two links that touch with nothing drawn between them ("<a>un</a><a>believable</a>") are one word,
    // unless CSS sets them apart (a flex menu, a pill's padding): their boxes touch, their words do not.
    if (prev?.localName === "a" && tag === "a" && prev.getAttribute("href") !== e.getAttribute("href")) return drawnBetween(prev, e) || !touching(prev, e) || apart();
    // Otherwise CSS decides: "Java"+"Script" in <em> and <b> is one word, a chip's padding parts two,
    // but letters each in their own box that touch ("W"+"e" of an animated title) are one word.
    if (!apart()) return false;
    return !(prev && (b.length <= 2 || tlen(prev) <= 2) && touching(prev, e));
  }
  // "Hello,"+"world" and "Done."+"Next" are two words; "www."+"bbc" and "config."+"json" are one,
  // and so is code ("pathlib."+"PurePath" in an API signature).
  if (wb && (/[!?;:,]$/.test(a) || (/\.$/.test(a) && /^\p{Lu}/u.test(b) && !codeFont(e)))) return true;
  // "40°"+"39°" or "$19.99"+"$24.99" in a flex row are separate values.
  return apart();
}

/** CSS draws something between two elements (a "·" or "," as ::after or ::before content). */
function drawnBetween(a: Element, b: Element): boolean {
  const drawn = (e: Element, p: string) => {
    const c = getComputedStyle(e, p).content;
    return !!c && c !== "none" && c !== "normal" && c !== '""';
  };
  return drawn(a, "::after") || drawn(b, "::before");
}

/** Set in a monospace font, or in a code element: code, where "a."+"B" is one name. */
function codeFont(e: Element): boolean {
  return !!e.closest("code, kbd, samp, tt, pre") || /mono|courier|consol|menlo/i.test(styleOf(e).fontFamily);
}

/** Two boxes side by side with no gap between them (letters of one word, each in its own box). */
function touching(a: Element, b: Element): boolean {
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  if (!ra.width || !rb.width || Math.abs(ra.top - rb.top) > ra.height) return false;
  const gap = rb.left - ra.right;
  return gap > -2 && gap < Math.max(1.5, parseFloat(styleOf(b).fontSize) * 0.12);
}

/**
 * Whether inline element `e` needs a space before it, after text ending in `a`
 * when its own text starts with `b` (`prev`: the element just before it, if
 * that is what wrote `a`; `parent`: their container, for flex rows).
 */
export function spaceBefore(a: string, b: string, e: Element, prev: Element | null, parent: Element | null): boolean {
  if (!a || !b || /\s$/.test(a) || /^\s/.test(b)) return false;
  return needsSpace(a, b, e, prev, () => !!parent && /flex|grid/.test(styleOf(parent).display));
}

/** Whether text starting with `s` right after inline element `prev` is its own word ("<span>EXCLUSIVE</span>Insiders"). */
export function spaceAfter(prev: Element, a: string, s: string): boolean {
  return !!a && !/\s$/.test(a) && s[0] !== " " && /[\p{L}\p{N}]$/u.test(a) && /^[\p{L}\p{N}]/u.test(s) && (setApart(prev, "r") || kicker(prev, s));
}

/**
 * Visible text of an element as a reader sees it: hidden parts skipped, blocks
 * on their own lines, and a space between words that only CSS kept apart.
 * Unlike innerText, adjacent inline elements never glue words together.
 * Built from parts so long containers stay linear.
 */
function rawText(el: Element): string {
  const c = rawCache.get(el);
  if (c !== undefined) return c;
  const parts: string[] = [];
  // The last two characters written, for the joining rules.
  let tail = "";
  let prev: Element | null = null;
  let flex = -1;
  if (visible(el)) {
    // A <slot> shows the nodes assigned to it, not its fallback.
    const list = el.localName === "slot" ? (el as HTMLSlotElement).assignedNodes({ flatten: true }) : null;
    const useList = !!list && list.length > 0;
    let i = 0;
    for (let n: Node | null = useList ? list![0] : el.firstChild; n; n = useList ? list![++i] ?? null : n.nextSibling) {
      if (n.nodeType === 3) {
        const s = (n.nodeValue ?? "").replace(/[ \t\n\r\f]+/g, " ");
        if (!s) continue;
        // "<span>EXCLUSIVE</span>Insiders": a kicker CSS set apart, or an all-caps label, is its own word.
        if (prev && tail && spaceAfter(prev, tail, s)) parts.push(" ");
        parts.push(s);
        tail = s.length >= 2 ? s.slice(-2) : (tail + s).slice(-2);
        prev = null;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const tag = e.localName;
      if (tag === "br") {
        parts.push("\n");
        tail = "\n";
        prev = null;
        continue;
      }
      const pic = tag === "svg" ? pictureWords(e) : "";
      if ((NO_TEXT.has(tag) && !pic) || e.hasAttribute("hidden")) continue;
      let t = pic || rawText(e);
      if (!t) continue;
      // A rating drawn as stars is read by its name ("4 out of 5 stars"), and stars kept
      // from screen readers beside words that say the rating are not read as well.
      if (e.hasAttribute("aria-label")) t = glyphName(e, t) || t;
      else if (e.getAttribute("aria-hidden") === "true" && glyphTwin(e, t)) continue;
      // Ligature icon fonts spell their icon name ("chevron_left", "more_vert"); counts ("3") are not icons.
      const cls = typeof e.className === "string" ? e.className : "";
      // A BEM modifier ("badge-category --style-icon": a badge drawn with an icon) names a style, not an icon font.
      if (!pic && cls && ICON_CLASS.test(cls.replace(/(^|\s)\S*--\S*/g, " ")) && /^\s*[a-z][a-z0-9_]*\s*$/.test(t)) continue;
      if (isBlock(e)) {
        // Drop the trailing spaces before the line break.
        while (parts.length) {
          const p = parts[parts.length - 1];
          let j = p.length;
          while (j && p.charCodeAt(j - 1) === 32) j--;
          if (j) {
            if (j < p.length) parts[parts.length - 1] = p.slice(0, j);
            break;
          }
          parts.pop();
        }
        parts.push("\n", t.trim(), "\n");
        tail = "\n";
        prev = null;
        continue;
      }
      if (tail && !/\s$/.test(tail) && !/^\s/.test(t)) {
        const inFlex = () => {
          if (flex < 0) flex = /flex|grid/.test(styleOf(el).display) ? 1 : 0;
          return flex === 1;
        };
        if (needsSpace(tail, t, e, prev, inFlex)) parts.push(" ");
      }
      parts.push(t);
      tail = t.length >= 2 ? t.slice(-2) : (tail + t).slice(-2);
      prev = e;
    }
  }
  const out = parts.length === 1 ? parts[0] : parts.join("");
  rawCache.set(el, out);
  return out;
}

/**
 * An icon that is information, not decoration: the page also says what it
 * shows in words it hides at this width (weather.com's day forecast: a sun
 * icon titled "Sunny", "Mostly Clear Day" beside a hidden "Mostly Sunny").
 * Those words are read where the icon is.
 */
function pictureWords(svg: Element): string {
  if (svg.getAttribute("aria-hidden") === "true") return "";
  const title = svg.firstElementChild?.localName === "title" ? svg.firstElementChild : svg.querySelector(":scope > title");
  const name = clean(title?.textContent).toLowerCase();
  if (!name || name.length > 40) return "";
  const words = name.split(/\s+/).filter((w) => w.length >= 4);
  if (!words.length) return iconWord(svg, title!, name);
  let row: Element | null = svg.parentElement;
  for (let i = 0; i < 2 && row?.parentElement && row.parentElement !== document.body; i++) row = row.parentElement;
  if (!row) return "";
  // The row's short words, read once per pass for all its icons (a strip of hours has dozens).
  let leaves = twinCache.get(row);
  if (!leaves) {
    leaves = [];
    for (const s of Array.from(row.querySelectorAll("span, div, p"))) {
      if (s.firstElementChild) continue;
      const said = clean(s.textContent);
      if (said && said.length <= 40) leaves.push({ el: s, low: ` ${said.toLowerCase()} `, said });
    }
    twinCache.set(row, leaves);
  }
  for (const l of leaves) if (words.some((w) => l.low.includes(` ${w} `)) && !l.el.checkVisibility()) return l.said;
  // The same word in another form: a "Foggy" icon beside the hidden "AM Fog/PM Clouds".
  const stem = (lw: string) => lw.length >= 3 && words.some((w) => (w.startsWith(lw) || lw.startsWith(w)) && Math.min(w.length, lw.length) >= Math.max(w.length, lw.length) * 0.6);
  for (const l of leaves) if ((l.low.match(/\p{L}+/gu) ?? []).some(stem) && !l.el.checkVisibility()) return l.said;
  return iconWord(svg, title!, name);
}

/** Icon names that are a control's or a count's picture, not what a cell shows. */
const ICON_WORD = /\b(icons?|logo|arrow|chevron|caret|close|search|menu|share|star|heart|like|comments?|play|pause|info|external|download|clock|calendar|location|pin|eye|view|user|bookmark|cart|bell|check|plus|minus)\b/;

/**
 * A picture's name is read with the words beside it only when it adds meaning ("Not included", "Yes"
 * drawn as a cross or a tick, F1010): never a decorative icon's name ("star", "arrow", "chevron down")
 * or words the text says already (a "Red" swatch beside "Red") (F1132, F1133). A mark that alone says
 * a state ("check", "plus") still counts.
 */
export function pictureAdds(name: string, said: string): boolean {
  const n = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!n || (!/\d/.test(n) && n.split(" ").length <= 3 && ICON_WORD.test(n) && !/^(check|check ?mark|tick|cross|plus|minus)$/.test(n))) return false;
  return !` ${said.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `.includes(` ${n} `);
}

/**
 * With no hidden twin, an icon that alone says a short cell's state is read by
 * its title (weather.com's hourly strip: "15:00", a sun titled "Sunny", "66°").
 */
function iconWord(svg: Element, title: Element, name: string): string {
  if (name.split(/\s+/).length > 3 || !/^[\p{L} ]+$/u.test(name) || ICON_WORD.test(name)) return "";
  const r = svg.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return "";
  let cell: Element | null = svg.parentElement;
  for (let i = 0; cell && cell !== document.body && i < 3; i++, cell = cell.parentElement) {
    const said = clean((cell as HTMLElement).innerText ?? "");
    if (!said) continue;
    if (said.length > 40 || !/\d/.test(said) || said.toLowerCase().includes(name.split(/\s+/)[0])) return "";
    return clean(title.textContent);
  }
  return "";
}
let twinCache = new WeakMap<Element, { el: Element; low: string; said: string }[]>();

/** The first non-empty line of an element's visible text. */
export function firstLine(el: Element): string {
  const raw = rawText(el);
  for (let i = 0; i < raw.length; ) {
    let j = raw.indexOf("\n", i);
    if (j < 0) j = raw.length;
    const line = clean(raw.slice(i, j));
    if (line) return line;
    i = j + 1;
  }
  return "";
}

/** The element's visible text split into its lines (blocks and line breaks). */
export function textLines(el: Element): string[] {
  return rawText(el).split("\n").map(clean).filter(Boolean);
}

/** The first `n` characters of an element's text, without reading all of it. */
export function textPrefix(el: Element, n: number): string {
  let s = "";
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = tw.nextNode(); t && s.length < n * 2; t = tw.nextNode()) {
    const p = t.parentElement?.localName;
    if (p === "script" || p === "style" || p === "noscript") continue;
    s += t.nodeValue + " ";
  }
  return clean(s).slice(0, n);
}

/** Visible text of an element, on one line (respects display and visibility). */
export function textIn(el: Element): string {
  let t = textCache.get(el);
  if (t === undefined) {
    t = clean(rawText(el));
    textCache.set(el, t);
  }
  return t;
}

/** Visible text with its leading and trailing spaces kept, for inline runs. */
export function textInRaw(el: Element): string {
  return rawText(el).replace(/\s+/g, " ");
}

/** Cheap text length (raw textContent, no layout). Good enough for size checks. */
export function tlen(el: Element): number {
  let n = lenCache.get(el);
  if (n !== undefined) return n;
  n = 0;
  // Bottom-up with memoization: each node is measured once per pass.
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) n += (c.nodeValue ?? "").replace(/\s+/g, " ").length;
    else if (c.nodeType === 1) {
      const t = (c as Element).localName;
      if (t !== "script" && t !== "style" && t !== "noscript" && t !== "template") n += tlen(c as Element);
    }
  }
  lenCache.set(el, n);
  return n;
}

/** An anchor's resolved URL, without building URL objects. */
export function hrefOf(a: Element): string | undefined {
  const h = (a as HTMLAnchorElement).href;
  if (!h || typeof h !== "string" || h.startsWith("javascript:")) return undefined;
  const raw = a.getAttribute("href");
  if (!raw || raw === "#") return undefined;
  return h;
}

function idrefText(el: Element, attr: string): string {
  const ids = el.getAttribute(attr);
  if (!ids) return "";
  return clean(
    ids
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id))
      .filter(Boolean)
      // A referenced node's own aria-label is its name, as in the accessible-name rules: a date segment
      // labelled by itself and the field reads "month, Reservation date", not "mm Reservation date" (F1110).
      .map((n) => n!.getAttribute("aria-label")?.trim() || (n as HTMLElement).innerText || n!.textContent)
      .join(" "),
  );
}

/** A practical approximation of the accessible name. */
export function accName(el: Element): string {
  const lb = idrefText(el, "aria-labelledby");
  if (lb) return lb;
  const al = clean(el.getAttribute("aria-label"));
  if (al) return al;
  if (el instanceof HTMLInputElement) {
    if (["button", "submit", "reset"].includes(el.type)) return clean(el.value) || clean(el.title) || (el.type === "submit" ? "Submit" : "");
    if (el.type === "image") return clean(el.alt) || clean(el.title);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    // A label hidden some other way still names its field; an icon-only label
    // (OpenStreetMap's car, bike and foot modes) names it by its tooltip or picture.
    // The same words twice (a wrapping label and a label for the same id) are said once.
    const labels = el.labels ? Array.from(new Set(Array.from(el.labels).map((l) => labelWords(l) || clean(l.textContent) || pictureName(l)))).join(" ") : "";
    if (clean(labels)) return clean(labels);
    // A page that repeats the same ids (OpenStreetMap's two copies of its route modes) ties each
    // label to the first copy only: the label for this id beside the field still names it.
    const beside = !el.labels?.length && el.id ? el.parentElement?.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    if (beside) {
      const n = labelWords(beside) || clean(beside.textContent) || pictureName(beside);
      if (n) return n;
    }
    const wrap = el.closest("label");
    if (wrap) return labelWords(wrap) || pictureName(wrap);
    return clean(el.title) || clean((el as HTMLInputElement).placeholder) || adjacentText(el);
  }
  if (el instanceof HTMLImageElement) return clean(el.alt) || clean(el.title);
  const t = textIn(el);
  // A control whose picture names part of it ("Driving" drawn as a car beside "16 min").
  if (t.length < 40) {
    const pic = el.querySelector("[role=img][aria-label]");
    if (pic && !t.includes(clean(pic.getAttribute("aria-label")))) {
      const n = contentName(el);
      if (n) return n;
    }
  }
  if (t) return t;
  const img = el.querySelector("img[alt]") as HTMLImageElement | null;
  if (img && clean(img.alt)) return clean(img.alt);
  const svgTitle = el.querySelector("svg title");
  if (svgTitle && clean(svgTitle.textContent)) return clean(svgTitle.textContent);
  const tip = clean(el.getAttribute("title")) || clean(el.getAttribute("data-tooltip"));
  if (tip) return tip;
  // Icon buttons often name themselves only for screen readers.
  const sr = el.querySelector(SR_SEL);
  return sr ? clean(sr.textContent).slice(0, 120) : "";
}

/**
 * A label's words, with the icons among them that name themselves ("Not included" drawn as a cross
 * beside "Delivery zones"), as a screen reader hears it (F1010).
 */
function labelWords(l: Element): string {
  const t = textIn(l);
  if (!t || !l.querySelector("[role=img][aria-label], img[alt]:not([alt=''])")) return t;
  // Only pictures that add meaning: not a product photo (an img bigger than an icon) or a swatch named by the words beside it (F1132).
  // A brand's logo stays: a short wordmark (wider than tall, a short name), or one of any size that tells
  // options apart ("Afterpay" and "Klarna" over the same "Pay in 4", F1212).
  let twin: boolean | undefined;
  const adds = (pic: Element, name: string) => {
    if (pic instanceof HTMLImageElement) {
      const w = pic.width || pic.getBoundingClientRect().width, h = pic.height || pic.getBoundingClientRect().height;
      const logo = h <= 48 && w >= h * 1.5 && name.split(/\s+/).length <= 3;
      if (!w || !h || ((w > 32 || h > 32) && !logo && !(twin ??= sameWordsAsPeer(l, t)))) return false;
    }
    return pictureAdds(name, t);
  };
  return contentName(l, true, adds) || t;
}

/** Another option of the same group (a radio or checkbox beside it) whose label says the same words. */
function sameWordsAsPeer(l: Element, t: string): boolean {
  const c = (l as HTMLLabelElement).control;
  if (!(c instanceof HTMLInputElement) || !/^(radio|checkbox)$/.test(c.type)) return false;
  const group = c.closest("fieldset, [role=radiogroup], [role=group]") ?? c.form ?? document.body;
  const peers = Array.from(group.querySelectorAll(`input[type=${c.type}]`)).slice(0, 60) as HTMLInputElement[];
  return peers.some((p) => p !== c && (c.type !== "radio" || p.name === c.name) && Array.from(p.labels ?? []).some((pl) => textIn(pl) === t));
}

/** What an element without words says through its tooltip or picture (a label holding only an icon). */
function pictureName(el: Element): string {
  const pic = el.querySelector("[role=img][aria-label], img[alt]:not([alt='']), [aria-label], svg title, [title]");
  return (
    clean(el.getAttribute("title")) ||
    clean(pic?.getAttribute("aria-label")) ||
    clean(pic?.getAttribute("alt")) ||
    (pic?.localName === "title" ? clean(pic.textContent) : "") ||
    clean(pic?.getAttribute("title"))
  );
}

/**
 * A name from content as the accessibility tree builds it: the words, and the
 * pictures that name themselves (role=img with a label, an img's alt), without
 * the parts hidden from screen readers.
 */
function contentName(el: Element, apart = false, keep?: (pic: Element, name: string) => boolean): string {
  const parts: string[] = [];
  const go = (n: Element) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        parts.push(c.nodeValue ?? "");
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (e.getAttribute("aria-hidden") === "true" || !visible(e)) continue;
      if (e.getAttribute("role") === "img" || e.localName === "img") {
        const name = clean(e.getAttribute("aria-label")) || clean((e as HTMLImageElement).alt);
        if (name) {
          if (!keep || keep(e, name)) parts.push(" ", name, " ");
        } else if (e.localName !== "img") go(e);
        continue;
      }
      if (NO_TEXT.has(e.localName)) continue;
      // With `apart`, words CSS sets apart (a card's name and price in their own boxes) are two words.
      const block = isBlock(e) || (apart && setApart(e, "l"));
      if (block) parts.push(" ");
      go(e);
      if (block) parts.push(" ");
    }
  };
  go(el);
  return clean(parts.join(""));
}

/**
 * Plain text written next to an unlabeled field: "Search: [ ]" names the box
 * before it, "[x] Write tests" names the checkbox after it.
 */
function adjacentText(el: Element): string {
  return adjacent(el).text;
}

/** The nodes after an unlabeled checkbox or radio that name it, if they do (the walker shows them once, as its label). */
export function labelNodes(el: Element): Node[] {
  const a = adjacent(el);
  return a.text ? a.nodes : [];
}

function adjacent(el: Element): { text: string; nodes: Node[] } {
  const after = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  let s = "";
  const nodes: Node[] = [];
  for (let n = after ? el.nextSibling : el.previousSibling; n && s.length < 80; n = after ? n.nextSibling : n.previousSibling) {
    if (n.nodeType === 3) {
      const v = n.nodeValue ?? "";
      s = after ? s + v : v + s;
      nodes.push(n);
      if (/\S/.test(v)) break;
      continue;
    }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (!/^(span|b|strong|em|i|small|font)$/.test(e.localName) || e.querySelector("input,select,textarea,button")) break;
    const v = textIn(e);
    s = after ? s + " " + v : v + " " + s;
    nodes.push(n);
    if (v) break;
  }
  s = clean(s).replace(/\s*:$/, "");
  if (!s && after) {
    // A checkbox at the end of its row ("bicycles 5487 [x]") is named by the row.
    const row = el.closest("li, tr, [role=row], [role=listitem]");
    const t = row && row.querySelectorAll("input, select, textarea").length === 1 ? textIn(row) : "";
    if (t && t.length <= 60) return { text: t, nodes: [] };
  }
  return s.length <= 60 ? { text: s, nodes } : { text: "", nodes: [] };
}

export function absUrl(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const h = href.trim();
  if (!h || h.startsWith("javascript:") || h === "#") return undefined;
  try {
    // As the browser resolves the link: against the page's <base href>, if it has one.
    return new URL(h, document.baseURI).href;
  } catch {
    return undefined;
  }
}

export function imgSrc(img: HTMLImageElement): string {
  // An element that only says its address (AMP's amp-img before it makes its <img>) is read by its attribute.
  const cand = img.currentSrc || img.src || (img.localName !== "img" && absUrl(img.getAttribute("src"))) || "";
  if (cand && !cand.startsWith("data:")) return cand;
  for (const a of ["data-src", "data-lazy-src", "data-original", "data-url", "data-srcset", "srcset"]) {
    const v = img.getAttribute(a);
    if (v) {
      const first = v.split(",")[0].trim().split(/\s+/)[0];
      const u = absUrl(first);
      if (u) return u;
    }
  }
  return cand || "";
}

export const AD_HOSTS =
  /doubleclick|googlesyndication|googleadservices|adservice|amazon-adsystem|adnxs|criteo|taboola|outbrain|pubmatic|rubiconproject|openx|teads|mgid|revcontent|sharethrough|smartadserver|adform|yieldmo|33across|moatads|zergnet|nativo|triplelift|media\.net|carbonads|buysellads/i;

// Class/id tokens that mark ads and other page furniture.
// A bare "adv" is short for "advanced" ("adv", "adv-search", "advOptions") as often as it marks an ad
// (Italian sites' "card--adv", "adv-Top"): only its ad compounds ("box-adv", "adv-slot", "adv-300x250") count here,
// and isAd() weighs the bare word (F903).
export const AD_TOKEN =
  /(^|[\s_-])(ads?|(box|banner)[_-]adv|adv[_-]?(box|slot|unit|banner|wrap(per)?|container|\d+(x\d+)?)|advert|advertisement|advertising|adslot|adunit|ad-slot|ad-container|adbox|ad-wrapper|dfp|gpt-ad|sponsor|sponsored|promoted|taboola|outbrain|teads|mgid|banner-ad|publicidad|anuncio)($|[\s_-])/i;

// "promo-price", "share-price" and "promo-code" are content, not furniture.
// A negated class ("no-breadcrumb", "no-share") says the box has none: it is not noise.
// Nor is a box that says it holds some ("with-related" on G1's headline card with its related links, F1001).
export const NOISE_TOKEN =
  /(^|[\s_-])(?<!(?:^|[\s_-])(?:no|with|has)[_-])(cookie|consent|gdpr|newsletter|subscribe-?box|paywall-?prompt|share(?![\s_-]*(price|holder))|sharing|social|sharebar|breadcrumbs?|skip-?link|editsection|edit-?section|back-?to-?top|related|recommend(ed|ations)?|trending|most-?popular|outbrain|(?<!price[\s_-]*)promo(?![\s_-]*(price|code))|popup|modal-?backdrop|toast|chat-?widget|intercom|drift|centralnotice|banner-?overlay|fundrais(ing|er)-?banner|promo(tion)?-?cards?|auto-?promos?|powered-?by)($|[\s_-])/i;

export const SOCIAL_HOSTS =
  /(^|\.)(facebook\.com|fb\.com|twitter\.com|x\.com|t\.co|instagram\.com|linkedin\.com|pinterest\.[a-z.]+|reddit\.com\/submit|wa\.me|whatsapp\.com|api\.whatsapp\.com|telegram\.me|t\.me|tiktok\.com|threads\.net|bsky\.app|flipboard\.com|tumblr\.com)$/i;

/** Share controls: "Share", "Share on Facebook", "Tweet", "Copy link". Not "Post Your Answer" or "Email us". */
export const SHARE_LABEL =
  /^((share|compartir|partager|teilen|condividi|compartilhar)( (this|it|on|en|via|por|article|story|page|link|post|nota|whatsapp|facebook|twitter|x|linkedin|telegram|email|e-mail|correo)\b.{0,30})?|tweet|pin it|copy link|copiar (el )?enlace|whatsapp|facebook|twitter|x|linkedin|telegram|reddit|pinterest)$/i;
/** Labels that share only in a share bar or with a share link; elsewhere they post a comment, write to someone, or print a ticket. */
export const SHARE_MAYBE = /^(post|email|e-mail|correo|print|imprimir)$/i;

// Parsing URLs is slow and pages repeat the same few hosts: remember each answer for the pass.
let hostCache = new Map<string, string>();

export function hostOf(url: string | undefined): string {
  if (!url) return "";
  let h = hostCache.get(url);
  if (h !== undefined) return h;
  try {
    h = new URL(url).hostname;
  } catch {
    h = "";
  }
  hostCache.set(url, h);
  return h;
}

const tokenCache = new WeakMap<Element, string>();

/** Id, class, and test ids as words: "desktopNavBar_x1" also reads as "desktop-nav-bar_x1". */
export function tokens(el: Element): string {
  let cls = typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
  // Utility classes that style other elements or states ("md:flex", "[&_[data-comment-header]_p]:text-sm")
  // name no part of the page: their words ("comment", "ad") would misread it.
  if (/[[:&]/.test(cls)) cls = cls.split(/\s+/).filter((c) => !/[[:&]/.test(c)).join(" ");
  // MediaWiki's Parsoid ids ("mwAdA", "mwAds") are serial numbers, not words.
  const id = /^mw[A-Za-z0-9_]{1,6}$/.test(el.id) ? "" : el.id;
  const raw = `${id} ${cls} ${el.getAttribute("data-testid") ?? ""} ${el.getAttribute("data-component") ?? ""}`;
  const cached = tokenCache.get(el);
  if (cached !== undefined && cached.startsWith(raw)) return cached;
  const kebab = raw.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const out = kebab === raw.toLowerCase() ? raw : raw + " " + kebab;
  tokenCache.set(el, out);
  return out;
}

export function isAd(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "INS" && el.classList.contains("adsbygoogle")) return true;
  if (tag === "IFRAME") {
    const src = (el as HTMLIFrameElement).src || "";
    if (AD_HOSTS.test(src) || /ads|banner/i.test(el.id)) return true;
  }
  if (el.hasAttribute("data-ad") || el.hasAttribute("data-ad-slot") || el.hasAttribute("data-google-query-id") || el.hasAttribute("data-ad-unit")) return true;
  const al = el.getAttribute("aria-label");
  if (al && /^(advertisement|advertising|ad|ads|publicidad|anuncio|sponsored( content)?|patrocinado)$/i.test(al.trim())) return true;
  // A player's state while its ad plays ("jw-flag-ads", "vjs-ad-playing") does not make the player an ad.
  // Nor does a box's note that it holds one: G1's section main is "has-smart-container-ad" (F1001).
  const tk = tokens(el).replace(/(^|\s)(jw-flag-ads[\w-]*|vjs-ad-[\w-]+|(?:has|with)-[\w-]+)(?=\s|$)/gi, " ");
  return AD_TOKEN.test(tk) || (/(^|[\s_-])adv($|[\s_-])/i.test(tk) && advAd(el));
}

/**
 * A box marked only "adv": an ad slot holds no field or button and few words of its own (its "Pubblicità" label,
 * the ad in a frame); an "Advanced" section or note ("adv", "adv-search", "advOptions") is content (F903).
 */
function advAd(el: Element): boolean {
  if (el.matches("form, fieldset, details, summary, label, input, select, textarea, button, [role=button], [role=group], [role=spinbutton]")) return false;
  if (el.querySelector("input:not([type=hidden]), select, textarea, summary, button, [role=button], [role=switch], [role=checkbox], [role=spinbutton]")) return false;
  let n = 0;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    if (t.parentElement?.closest("script, style, noscript, template")) continue;
    n += (t.nodeValue ?? "").trim().length;
    if (n >= 60) return false;
  }
  return true;
}

/** Short label-like elements such as "Advertisement" or "Publicidad". */
export const AD_LABEL = /^(advertisement|advertising|ad|ads|publicidad|anuncio|sponsored|patrocinado|promoted|promocionado|story continues below advertisement|continúa después de la publicidad|content lab|contenido patrocinado|contenido de marca|publinota|brandvoice|paid (post|content)|partner content|contains affiliated? (content|links))$/i;

export function lang(): string {
  return (
    document.documentElement.lang ||
    document.querySelector('meta[http-equiv="content-language" i]')?.getAttribute("content") ||
    textLang()
  ).trim();
}

/**
 * Each language's most common words, so close languages differ by the words only one of them uses: Dutch "het een
 * niet" and English "the of", Catalan "els amb és" and Spanish "los con es", Galician "unha non" and Portuguese "uma
 * não". A word common to two languages is listed under both, so it counts for neither against the other.
 */
const LANG_WORDS: Record<string, string> = {
  en: "the of and to a in is it that for on was with he as at by this are be from his have or not but they she her an had were which their we been has will said would there one can who all its more if about after new you up out what when than into also",
  nl: "de het een van en in is dat op te die voor met zijn niet aan er maar om ook als bij nog wordt door naar werd heeft hij ze zij uit over dan kan worden deze tot wel meer was geen al had wat dit nu na onder hun haar zo ik je we of jaar",
  de: "der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an er hat aus bei sie nach wird einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man dass sein wurde werden ich wir kann was",
  fr: "de la le et les des en un du une que est pour qui dans a par plus pas au sur ne se ce il sont avec ou son aux mais nous elle comme sa ses ont cette été leur y à je vous on tout fait être après sans entre",
  es: "de la que el en y a los se del las un por con no una su para es al lo como más o pero sus le ha me si sin sobre este ya entre cuando todo esta ser son dos también fue había era muy años hasta desde está mi porque qué han hay vez puede todos así nos ni tiene uno donde e otro después según durante",
  ca: "de la el i a que en les els del per un una es amb no al va dels com més ha o hi seu però també és són ho li se han aquest aquesta sobre entre ja fins molt quan tot seva ser perquè anys on sense dos fer després això era si pel ni ens des fa",
  gl: "de a o e que en do da os as un unha non se no na dos das con para por é ao como máis pero ou súa seu foi polo pola xa tamén moi cando ser este esta entre sobre ten hai desde ata anos dun dunha nun nunha tras onde nos nas aos ás isto iso co coa lle porque sen despois aínda era son",
  ast: "de la el y en que los les con un una del al por como más pero o so sobre ye nun pa nel na nos dende tamién esti esta tolos toles dellos delles agora cuandu yá pela pol cola colos anque foi hai fai ente ensin hasta según",
  oc: "de la e lo que en a los las per un una es del dels amb son dins se pas o mai sus coma aquel aquela entre lor tanben pus fins èra foguèt an pel als al ont mas sa sas son sos fòrça plan totes aquò ara",
  pt: "de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas esse eles estão você num nem suas às numa pelos elas são anos sobre após ainda este esta",
  it: "di e il la che è per un in del non una a i le si con da al sono della ha dei gli più lo nel alla come ma anche delle ci se o nella questo ad cui degli sul dal tra hanno essere stato suo sua loro dopo ancora quando perché questa ne molto solo senza sulla dalla alle fino nei nelle sia già era poi anni",
  ro: "de și în a la cu care pe nu din să se o un mai este pentru au că ce fost sunt al lui ca sau după prin cel cea fi va dar ei acest această își între le am ar fiind are despre până doar foarte iar unei unui unor sale său lor",
  sv: "och i att det som en på är av för med till den har de inte om ett han men var jag sig från vi så kan man när år säger hade sin under efter eller nu hon vid då ska skulle mot också hans bara finns där alla mycket sedan blir blev två mellan dem upp ut vara än dess sina denna detta",
  da: "og i at det er en til på som de med af for har den ikke et der var om han vi men fra kan jeg sig så hun også efter skal ved sin når nu vil mod over år eller blev havde man alle have da kun være hvor mange dem op ud mere meget noget hans end sine her siger bliver deres nogle dette denne under får hvis andre før kommer",
  no: "og i det er en til på som å av for med at de har den ikke et han var om vi men fra kan jeg seg så hun også etter skal ved sin når nå vil mot over år eller ble hadde man alle ha da bare være hvor mange dem opp ut mer mye noe hans enn sine her sier blir deres noen dette denne under får hvis mellom blitt slik inn andre før kommer",
  pl: "w i na z się nie do to że jest o a jak od po przez dla ale co za jego tym czy tak jej oraz który która które są był była było by ma może już tylko jako także roku lat ich jednak bardzo pod przy ze we też gdy tego tej ten ta sobie go nad przed między kiedy został została",
  cs: "a v se na je že s z o to do k i pro jako by ve ale po jsou od za které který která jeho také byl byla bylo jsem už tak jak při nebo podle jen již tím její mezi než této tento pouze roce let být má může či však aby kde když kdy ze",
  sk: "a v sa na je že s z o to do k aj pre ako by vo ale po sú od za ktoré ktorý ktorá jeho tiež bol bola bolo som už tak pri alebo podľa len tým jej medzi než tejto tento iba roku rokov byť má môže či však aby kde keď kedy zo",
  tr: "bir ve bu da de için ile olarak çok daha en gibi ne o sonra kadar ama her olan ise var değil mi mı ki yeni ya ancak büyük göre şekilde sadece tarafından olduğu oldu yıl yılında ilk iki kendi arasında önce bile hem şey şu nasıl neden",
  id: "yang dan di ke dari ini itu dengan untuk tidak dalam akan pada juga ada oleh atau adalah bisa karena saat sudah telah lebih tersebut mereka kami kita saya ia dia para satu dua bahwa sebagai hanya namun jika masih bagi hingga belum sangat setelah secara menjadi banyak harus seperti tahun baru orang",
  ms: "yang dan di ke dari ini itu dengan untuk tidak dalam akan pada juga ada oleh atau adalah boleh kerana ketika sudah telah lebih tersebut mereka kami kita saya ia dia para satu dua bahawa sebagai hanya namun jika masih bagi hingga belum sangat selepas secara menjadi banyak perlu seperti tahun baru orang daripada iaitu",
};
const LANGS = Object.keys(LANG_WORDS);
let langOfWord: Map<string, number> | undefined;
let textLangFor = "";
let textLangWas = "";

/**
 * A page that does not say its language (G1's search page has no lang) is read for it (F931): its title, then its
 * paragraphs, headings and links, leaving out text marked as another language (a list of the site's languages).
 * When the guess is not sure, nothing, so Sift's view does not mark the text wrongly (F1032).
 */
function textLang(): string {
  if (textLangFor === location.href) return textLangWas;
  let text = document.title;
  for (const sel of ["p", "h1, h2, h3", "a"]) {
    for (const e of Array.from(document.querySelectorAll(sel))) {
      if (text.length > 4000) break;
      const marked = e.closest("[lang]");
      if ((marked && marked !== document.documentElement && marked !== document.body) || e.hasAttribute("hreflang")) continue;
      text += " " + (e.textContent ?? "");
    }
  }
  const pick = langOfText(text);
  // Too little text yet to tell: asked again on the next pass.
  if (pick || text.length > 2000) {
    textLangFor = location.href;
    textLangWas = pick;
  }
  return pick;
}

/**
 * The language of a text, or "" when it is not sure. A script one language owns names it (Hangul, kana, Hebrew,
 * Greek, Thai), as do the letters that tell Russian from Ukrainian, Arabic from Persian, and simplified Chinese from
 * traditional. Latin text needs several sentences: the winner's common words must be a real share of the words, some
 * of them its own alone, and it must beat every other language two to one on the words that tell the two apart.
 */
export function langOfText(text: string): string {
  const s = text.slice(0, 6000);
  const count = (re: RegExp) => s.match(re)?.length ?? 0;
  const letters = s.replace(/\P{L}+/gu, "").length;
  if (letters - s.replace(/\P{Script=Latin}+/gu, "").length > letters / 2) {
    if (letters < 150) return "";
    const share = (re: RegExp) => count(re) / letters;
    if (share(/\p{Script=Hangul}/gu) > 0.4) return "ko";
    const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
    const han = count(/\p{Script=Han}/gu);
    if (kana + han > letters / 2) {
      if (kana > (kana + han) / 10) return "ja";
      const simp = count(/[这们个来说时会为国学对发经过还没开关见长门问间车马书与实现进动从业东区将应当]/gu);
      const trad = count(/[這們個來說時會為國學對發經過還沒開關見長門問間車馬書與實現進動從業東區將應當]/gu);
      return simp >= 10 && trad * 5 < simp ? "zh" : trad >= 10 && simp * 5 < trad ? "zh-Hant" : "";
    }
    for (const [re, code] of [[/\p{Script=Hebrew}/gu, "he"], [/\p{Script=Greek}/gu, "el"], [/\p{Script=Thai}/gu, "th"]] as const) if (share(re) > 0.5) return code;
    if (share(/\p{Script=Cyrillic}/gu) > 0.5) {
      // Russian's ы э ё, Ukrainian's і ї є ґ; letters of Belarusian, Serbian, Macedonian or Kazakh rule both out.
      const ru = count(/[ыэё]/giu);
      const uk = count(/[іїєґ]/giu);
      const other = count(/[ўјђћџљњѓќѕәғқңөұүһ]/giu);
      return ru >= 10 && (uk + other) * 20 < ru ? "ru" : uk >= 10 && (ru + other) * 20 < uk ? "uk" : "";
    }
    if (share(/\p{Script=Arabic}/gu) > 0.5) {
      // Arabic's ة ي ك, Persian's ی ک; letters of Urdu, Kurdish or Pashto rule Persian out.
      const ar = count(/[\u0629\u064A\u0643]/gu);
      const fa = count(/[\u06CC\u06A9]/gu);
      const other = count(/[\u0679\u0688\u0691\u06BA\u06D2\u06BE\u06D5\u06C6\u06CE\u0695\u06B5\u067C\u0689\u0693\u0696\u069A\u06AB\u06BC\u06CD\u06D0]/gu);
      return ar >= 20 && fa * 10 < ar ? "ar" : fa >= 20 && ar * 10 < fa && other * 20 < fa ? "fa" : "";
    }
    return "";
  }
  if (!langOfWord) {
    langOfWord = new Map();
    for (const [i, k] of LANGS.entries()) for (const w of LANG_WORDS[k].split(" ")) langOfWord.set(w, (langOfWord.get(w) ?? 0) | (1 << i));
  }
  const words = s.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 60) return "";
  const n = LANGS.length;
  const hits = new Array<number>(n).fill(0);
  const own = new Array<number>(n).fill(0);
  // apart[i * n + j]: words of language i that language j does not use.
  const apart = new Array<number>(n * n).fill(0);
  const byMask = new Map<number, number>();
  for (const w of words) {
    const m = langOfWord.get(w);
    if (m) byMask.set(m, (byMask.get(m) ?? 0) + 1);
  }
  for (const [m, c] of byMask) {
    if ((m & (m - 1)) === 0) own[31 - Math.clz32(m)] += c;
    for (let i = 0; i < n; i++) {
      if (!(m & (1 << i))) continue;
      hits[i] += c;
      for (let j = 0; j < n; j++) if (!(m & (1 << j))) apart[i * n + j] += c;
    }
  }
  // At most one language beats every other two to one.
  const best = hits.findIndex((h, i) => h > 0 && hits.every((_, j) => j === i || (apart[i * n + j] >= 2 * apart[j * n + i] && apart[i * n + j] - apart[j * n + i] >= 5)));
  // A language not listed here (Croatian, Afrikaans) shares many words with one that is, but has few of its own.
  if (best < 0 || hits[best] < 15 || hits[best] < words.length * 0.12 || own[best] < Math.max(2, hits[best] * 0.03)) return "";
  return LANGS[best];
}
