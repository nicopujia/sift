// Stable ids for original-page elements. The same element always gets the same
// id, so Sift's UI keeps its keys (and focus) across re-extractions.

let counter = 0;
const ids = new WeakMap<Element, string>();
const refs = new Map<string, WeakRef<Element>>();

export function refOf(el: Element): string {
  let id = ids.get(el);
  if (!id) {
    id = "r" + (++counter).toString(36);
    ids.set(el, id);
    refs.set(id, new WeakRef(el));
  }
  return id;
}

export function elOf(id: string | undefined): Element | null {
  if (!id) return null;
  const el = refs.get(id)?.deref();
  if (!el) {
    refs.delete(id);
    return null;
  }
  return el.isConnected ? el : null;
}

export function sweepRefs(): void {
  for (const [id, r] of refs) if (!r.deref()?.isConnected) refs.delete(id);
}

/** The element `id` named, even after the page removed it (null once it is gone for good). */
export function formerOf(id: string | undefined): Element | null {
  return id ? (refs.get(id)?.deref() ?? null) : null;
}

/**
 * `el` took the place of the element `id` named (a page that swaps a field for
 * a new one): `id` names `el` from now on, and so does `el`'s own id if it had
 * none yet, so Sift's copy keeps its key and focus.
 */
export function adopt(id: string, el: Element): void {
  refs.set(id, new WeakRef(el));
  if (!ids.has(el)) ids.set(el, id);
}
