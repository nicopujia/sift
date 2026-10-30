// Elements the page added or changed right after the user acted through Sift.
// Popups without ARIA roles (menus, "sign in to like" prompts, toasts) are
// found among them.

let until = 0;
/** Until when what changes answers an action of the user's (not only entering a field). */
let actUntil = 0;
let nodes: Element[] = [];
/** Nodes noted while an action's window was open. */
let byAction = new WeakSet<Element>();
/** How many actions (and new pages) there have been: what one opened is told from what the next one did. */
let arms = 0;
export const armCount = () => arms;

/**
 * Start watching after an action, for `ms` milliseconds. `keep`: the user only
 * entered a field: watch longer (what it opens shows next to it), but keep what
 * the last action opened, so a popup the user is now typing in stays found.
 */
export function armRecent(ms = 2500, keep = false) {
  const now = performance.now();
  if (keep) {
    until = Math.max(until, now + ms);
    return;
  }
  arms++;
  until = actUntil = now + ms;
  nodes = [];
  byAction = new WeakSet();
}

/** When each node changed last, latest first (up to three times), once the page had loaded. */
const changedAt = new WeakMap<Node, number[]>();

/**
 * `n` changed again and again in the `ms` before `t`: the page changes it all
 * the time (a clock, a carousel), not in answer to something done at `t`.
 */
export function churned(n: Node, t: number, ms = 5000): boolean {
  const at = changedAt.get(n);
  return !!at && at.filter((x) => x < t && t - x < ms).length >= 2;
}

/** When the page itself last changed: not Sift's marks on it, nor its root and Sift's host. */
let pageChanged = -Infinity;
export const pageChangedAt = () => pageChanged;

export function noteMutations(records: MutationRecord[]) {
  const now = performance.now();
  for (const r of records) {
    const t = r.target as Element;
    if (t === document.documentElement || t.localName === "sift-root" || (r.type === "attributes" && (r.attributeName === "inert" || !!r.attributeName?.startsWith("data-sift")))) continue;
    pageChanged = now;
    break;
  }
  // Not the parser building the page.
  if (document.readyState !== "loading") {
    for (const r of records) {
      const was = changedAt.get(r.target);
      if (was?.[0] !== now) changedAt.set(r.target, [now, ...(was ?? []).slice(0, 2)]);
    }
  }
  if (now > until) return;
  const act = now <= actUntil;
  const note = (n: Element) => {
    nodes.push(n);
    if (act) byAction.add(n);
  };
  for (const r of records) {
    if (r.type === "childList") {
      for (const n of Array.from(r.addedNodes)) if (n.nodeType === 1) note(n as Element);
    } else if (r.type === "attributes" && r.target.nodeType === 1) {
      // Sift's own shield flips `inert` along a path (typing into a rich editor);
      // those are not the page's changes.
      if (r.attributeName === "inert" || r.attributeName?.startsWith("data-sift")) continue;
      // The same value written again (Google re-sets its classes as the page changes) changed nothing.
      if (r.oldValue !== null && r.oldValue === (r.target as Element).getAttribute(r.attributeName ?? "")) continue;
      note(r.target as Element);
    }
    if (nodes.length > 400) {
      // What the action opened stays; what changed later (typing in it) goes first.
      const later = nodes.filter((n) => !byAction.has(n));
      const cut = new Set(later.slice(0, Math.max(0, later.length - 200)));
      nodes = nodes.filter((n) => !cut.has(n));
      // The page changes a lot while the action's window is open (YouTube loading comments): what
      // the action opened first (its popup) stays, with the latest changes.
      if (nodes.length > 300) nodes = [...nodes.slice(0, 100), ...nodes.slice(-200)];
    }
  }
}

/** A new page (single-page navigation): what changed on the old one no longer counts. */
export function clearRecent() {
  arms++;
  nodes = [];
  until = actUntil = 0;
  byAction = new WeakSet();
}

/**
 * Recently touched elements; kept until the next action so a popup stays found.
 * `fromAction`: only those that changed in answer to an action (a click, a
 * submit), not while the user was only in a field.
 */
export function recentNodes(fromAction = false): Element[] {
  // Elements Sift shows through portals (players, maps) change all the time; they are not popups.
  nodes = nodes.filter((n) => n.isConnected && !n.closest("[data-sift-portal]"));
  return fromAction ? nodes.filter((n) => byAction.has(n)) : nodes;
}

/**
 * The page field the user last entered from Sift's page view (not from a sheet):
 * focus stays in Sift, so the page cannot say. The box around it is part of the
 * page Sift already shows, never a popup over it (Google Maps' directions panel).
 */
let entered: WeakRef<Element> | null = null;
export function noteEntered(el: Element | null) {
  entered = el ? new WeakRef(el) : null;
}
export function enteredField(): Element | null {
  const el = entered?.deref() ?? null;
  return el?.isConnected ? el : null;
}
