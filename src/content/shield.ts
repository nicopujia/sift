// While Sift is shown, the original page stays loaded and running underneath,
// but out of reach: `inert` keeps it out of keyboard focus, find-in-page, and
// the accessibility tree. Elements shown through portals stay reachable.

const MARK = "data-sift-inert";
const ROLE_MARK = "data-sift-role";
const LANDMARK_TAGS = new Set(["main", "nav", "header", "footer", "aside", "form", "section"]);
const LANDMARK_ROLES = /^(main|navigation|banner|contentinfo|complementary|region|search|form)$/;
let demoted = new Set<Element>();
let active = false;
let exceptions: Element[] = [];
let marked = new Set<Element>();

function parentOf(n: Element): Element | null {
  if (n.parentElement) return n.parentElement;
  const root = n.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function childrenOf(n: Element): Element[] {
  const out = Array.from(n.children);
  const sr = (n as HTMLElement).shadowRoot;
  if (sr) out.push(...Array.from(sr.children));
  return out;
}

/**
 * A host's light-DOM child shown, through its slot, inside an exempted element:
 * a modal dialog in a shadow root (MDN's compat settings) has its Cancel and
 * Save there. Follows the flat tree, slot to slot.
 */
function slottedIntoExempt(c: Element, ex: Set<Element>): boolean {
  if (!c.assignedSlot) return false;
  for (let n: Element | null = c; n; n = n.assignedSlot ?? parentOf(n)) if (ex.has(n)) return true;
  return false;
}

function desired(): Set<Element> {
  const want = new Set<Element>();
  const body = document.body;
  if (!body) return want;
  // Anything else the page or another extension put directly under <html>.
  for (const c of Array.from(document.documentElement.children)) {
    if (c === body || c.localName === "head" || c.localName === "sift-root" || c.localName === "sift-tail" || exceptions.some((e) => c.contains(e))) continue;
    want.add(c);
  }
  if (!exceptions.length) {
    want.add(body);
    return want;
  }
  const path = new Set<Element>();
  for (const e of exceptions) for (let n: Element | null = e; n && n !== document.documentElement; n = parentOf(n)) path.add(n);
  const ex = new Set(exceptions);
  const stack: Element[] = [body];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of childrenOf(n)) {
      if (ex.has(c) || slottedIntoExempt(c, ex)) continue;
      if (path.has(c)) stack.push(c);
      else if (c.localName !== "script" && c.localName !== "style") want.add(c);
    }
  }
  return want;
}

/**
 * Ancestors of a portal stay out of `inert` so the portal works; their own
 * landmark roles would then duplicate Sift's (two "main" regions). Demote them
 * to plain containers while shown.
 */
function demote(path: Set<Element>) {
  for (const el of demoted) {
    if (!path.has(el) || !active) {
      const orig = el.getAttribute(ROLE_MARK);
      if (orig === "") el.removeAttribute("role");
      else if (orig !== null) el.setAttribute("role", orig);
      el.removeAttribute(ROLE_MARK);
      demoted.delete(el);
    }
  }
  if (!active) return;
  for (const el of path) {
    if (demoted.has(el) || el === document.body) continue;
    const role = el.getAttribute("role") ?? "";
    if (LANDMARK_TAGS.has(el.localName) || LANDMARK_ROLES.test(role)) {
      el.setAttribute(ROLE_MARK, role);
      el.setAttribute("role", "none");
      demoted.add(el);
    }
  }
}

function portalPath(): Set<Element> {
  const path = new Set<Element>();
  for (const e of exceptions) for (let n = parentOf(e); n && n !== document.documentElement; n = parentOf(n)) path.add(n);
  return path;
}

function apply() {
  demote(active ? portalPath() : new Set());
  const want = active ? desired() : new Set<Element>();
  for (const el of marked) {
    if (!want.has(el) || !el.isConnected) {
      if (el.hasAttribute(MARK)) {
        el.removeAttribute(MARK);
        (el as HTMLElement).inert = false;
      }
      marked.delete(el);
    }
  }
  for (const el of want) {
    const h = el as HTMLElement;
    if (marked.has(el)) {
      // The site removed it (some re-render their tree): set it again.
      if (!h.inert) h.inert = true;
      continue;
    }
    if (h.inert) continue; // the site made it inert itself; leave it alone
    h.inert = true;
    el.setAttribute(MARK, "");
    marked.add(el);
  }
}

export function shieldOn(except: Element[]) {
  active = true;
  exceptions = except;
  apply();
}

export function shieldOff() {
  active = false;
  exceptions = [];
  apply();
}

/** Re-check after the page changed (new children appear un-shielded). */
export function refreshShield(except?: Element[]) {
  if (!active) return;
  if (except) exceptions = except;
  apply();
}

/**
 * Run `fn` with `target` reachable, for actions that need real focus (typing
 * into a rich editor). Only the path to the target leaves `inert`, not the page.
 */
export function withoutShield<T>(fn: () => T, target?: Element): T {
  if (!active) return fn();
  const before = exceptions;
  if (target) exceptions = [...exceptions, target];
  else active = false;
  apply();
  try {
    return fn();
  } finally {
    exceptions = before;
    active = true;
    apply();
  }
}

export function isShielding(): boolean {
  return active;
}
