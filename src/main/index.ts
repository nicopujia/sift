// Runs in the page's own JavaScript world. Keyboard events created in the
// extension's isolated world cannot carry the legacy keyCode/which values many
// sites still check ("e.keyCode === 13"), so Sift asks this helper to create
// them here, where it can define those values.

if (!(window as any).__siftMain) {
  (window as any).__siftMain = true;
  document.documentElement.setAttribute("data-sift-main", "");
  document.addEventListener(
    "sift-key",
    (e) => {
      // The real target, even inside a shadow root (e.target here is the outermost host).
      const target = e.composedPath()[0] as Element;
      let d: { key: string; code: string; keyCode: number; types: string[] };
      try {
        d = JSON.parse(String((e as CustomEvent).detail));
      } catch {
        return;
      }
      e.stopImmediatePropagation();
      for (const type of d.types) {
        const ev = new KeyboardEvent(type, { key: d.key, code: d.code, bubbles: true, cancelable: true, composed: true });
        for (const prop of ["keyCode", "which"]) Object.defineProperty(ev, prop, { get: () => d.keyCode });
        if (type === "keypress") Object.defineProperty(ev, "charCode", { get: () => d.keyCode });
        // The page cancelled the key: tell Sift, and send no more (as the browser would).
        if (!target.dispatchEvent(ev)) {
          e.preventDefault();
          break;
        }
      }
    },
    true,
  );

  // Sift's field stands for a page field while the user types in it, and Sift
  // sends that field focus and focusin (proxy.ts focus). Some pages also check
  // document.activeElement before showing what they fetched for the field
  // (YouTube drops its search suggestions unless its box is the active
  // element), and that would name Sift's root. While Sift has entered a field
  // with suggestions and focus is in Sift, activeElement names that field, as
  // on the original.
  let entered: Element | null = null;
  // Sift's key on a page segment (detail "key", F1103): only for that key, and the field entered before comes back.
  let keying = false;
  let enteredBefore: Element | null = null;
  document.addEventListener(
    "sift-enter",
    (e) => {
      if ((e as CustomEvent).detail === "key") {
        if (!keying) enteredBefore = entered;
        keying = true;
      }
      entered = e.composedPath()[0] as Element;
      e.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener(
    "sift-leave",
    (e) => {
      if ((e as CustomEvent).detail === "key") {
        if (keying) entered = enteredBefore;
        keying = false;
        enteredBefore = null;
      } else if (e.composedPath()[0] === entered) entered = null;
      e.stopImmediatePropagation();
    },
    true,
  );
  // A date field's segments (React Aria) move on to the next segment with a focus manager that skips
  // inert elements, and the page is inert while Sift is shown. While Sift's key reaches a segment,
  // Sift's own `inert` reads false to the page, so it finds the next one; its focus() there still
  // fails (the page stays inert) and Sift follows it to its copy of that segment (F1103).
  const inertD = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
  if (inertD?.get) {
    const getInert = inertD.get;
    Object.defineProperty(HTMLElement.prototype, "inert", {
      ...inertD,
      get(this: HTMLElement) {
        const v = getInert.call(this);
        return v && keying && this.hasAttribute("data-sift-inert") ? false : v;
      },
    });
  }
  const active = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement");
  if (active?.get) {
    const get = active.get;
    Object.defineProperty(Document.prototype, "activeElement", {
      ...active,
      get(this: Document) {
        const a = get.call(this) as Element | null;
        if (!entered || this !== document || a?.localName !== "sift-root") return a;
        if (!entered.isConnected) {
          entered = null;
          return a;
        }
        // A field inside a shadow root: the document names its outermost host.
        let n: Element = entered;
        for (let r = n.getRootNode(); r instanceof ShadowRoot; r = n.getRootNode()) n = r.host;
        return n;
      },
    });
  }

  // A Copy button that copies with execCommand (clipboard.js, copy-to-clipboard) selects a field or a
  // span it appends to <body> and calls execCommand("copy"). While Sift is shown <body> is inert: the
  // field cannot take focus and an inert selection copies as nothing, while the page says "Link copied".
  // Sift keeps the page inert during its clicks (a page focus() then must fail, F1102), so the copy
  // gets the text the page selected, as the browser copies it on the original (F1040).
  const inertAt = (n: Node | null | undefined): boolean => {
    for (let e: Element | null = n instanceof Element ? n : (n?.parentElement ?? null); e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null))
      if (e.hasAttribute("data-sift-inert")) return true;
    return false;
  };
  // Sift's click on a page element is running (H.act, F1200). With a shown original (a video, a map, a
  // frame) <body> is not inert as a whole, so a popup the page appends to it during the click is not inert
  // yet, and the page's focus() there would take focus out of Sift; Sift's shield makes it inert right
  // after, which blurs it, and a popup that closes on blur closes. While the click runs, a focus() outside
  // what the user answers directly (a shown original, a page modal dialog, full screen) fails as on an
  // inert page, and Sift follows it to its copy.
  let clicking = 0;
  document.addEventListener(
    "sift-click",
    (e) => {
      clicking = (e as CustomEvent).detail === "start" ? clicking + 1 : Math.max(0, clicking - 1);
      e.stopImmediatePropagation();
    },
    true,
  );
  const shownAt = (n: Element): boolean => {
    for (let e: Element | null = n; e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host ?? null))
      if (e.hasAttribute("data-sift-portal") || e.localName === "sift-root" || e === document.fullscreenElement || e.matches(":modal")) return true;
    return false;
  };
  let selField: HTMLInputElement | HTMLTextAreaElement | null = null;
  for (const fproto of [HTMLInputElement.prototype, HTMLTextAreaElement.prototype] as any[])
    for (const name of ["select", "setSelectionRange"]) {
      const orig = fproto[name];
      if (typeof orig !== "function") continue;
      fproto[name] = function (this: HTMLInputElement | HTMLTextAreaElement, ...args: unknown[]) {
        const r = orig.apply(this, args);
        // Only the copy that follows in the same task.
        const f = (selField = this);
        setTimeout(() => selField === f && (selField = null));
        return r;
      };
    }
  const copied = (): string => {
    const f = selField;
    // Never a password: the browser copies none.
    // Or a field the page could not focus during Sift's click (above): it would copy as nothing.
    if (f?.isConnected && (inertAt(f) || (clicking > 0 && !shownAt(f))) && (f as HTMLInputElement).type !== "password") {
      try {
        return f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0);
      } catch {
        return "";
      }
    }
    const sel = getSelection();
    if (!sel?.rangeCount || String(sel) || !inertAt(sel.getRangeAt(0).commonAncestorContainer)) return "";
    let text = "";
    for (let i = 0; i < sel.rangeCount; i++) text += sel.getRangeAt(i).toString();
    return text;
  };
  const exec = (Document.prototype as any).execCommand;
  if (typeof exec === "function") {
    (Document.prototype as any).execCommand = function (this: Document, ...args: unknown[]) {
      let text = "";
      try {
        if (String(args[0]).toLowerCase() === "copy" && siftShown()) text = copied();
      } catch {
        /* never break the page's own call */
      }
      if (!text) return exec.apply(this, args);
      // First in line: the page's own copy listeners can still change or cancel it.
      const fill = (e: Event) => {
        const d = (e as ClipboardEvent).clipboardData;
        if (!d) return;
        d.setData("text/plain", text);
        e.preventDefault();
      };
      addEventListener("copy", fill, true);
      try {
        return exec.apply(this, args);
      } finally {
        removeEventListener("copy", fill, true);
      }
    };
  }

  // A popover opened inside a shadow root sends no toggle event to the
  // document, so Sift would not know it now paints over its view. Tell it.
  const proto = HTMLElement.prototype as any;
  for (const name of ["showPopover", "togglePopover"]) {
    const orig = proto[name];
    if (typeof orig !== "function") continue;
    proto[name] = function (this: HTMLElement, ...args: unknown[]) {
      const r = orig.apply(this, args);
      try {
        if (this.getRootNode() instanceof ShadowRoot && this.matches(":popover-open")) {
          this.dispatchEvent(new CustomEvent("sift-popover", { bubbles: true, composed: true }));
        }
      } catch {
        /* never break the page's own call */
      }
      return r;
    };
  }

  // While Sift is shown the page is inert, so a page script that moves focus
  // (to its error summary, a field, the reply box it just opened) cannot. Tell
  // Sift where it wanted focus to go.
  const focus = proto.focus;
  if (typeof focus === "function") {
    proto.focus = function (this: HTMLElement, ...args: unknown[]) {
      try {
        // During Sift's click, outside what Sift shows of the page: no real focus (above, F1200).
        if (clicking > 0 && this.isConnected && !shownAt(this)) {
          this.dispatchEvent(new CustomEvent("sift-focus", { bubbles: true, composed: true }));
          return;
        }
      } catch {
        /* never break the page's own call */
      }
      const r = focus.apply(this, args);
      try {
        const root = this.getRootNode() as Document | ShadowRoot;
        if (this.isConnected && root.activeElement !== this) this.dispatchEvent(new CustomEvent("sift-focus", { bubbles: true, composed: true }));
      } catch {
        /* never break the page's own call */
      }
      return r;
    };
  }

  // A page script calling focus() (YouTube focuses its player once the watch
  // page has loaded) is not the user moving focus: tell Sift before it moves.
  const pageFocus = proto.focus;
  if (typeof pageFocus === "function") {
    proto.focus = function (this: HTMLElement, ...args: unknown[]) {
      try {
        if (this.isConnected) this.dispatchEvent(new CustomEvent("sift-pagefocus", { bubbles: true, composed: true }));
      } catch {
        /* never break the page's own call */
      }
      return pageFocus.apply(this, args);
    };
  }

  // A view transition paints its snapshots of the page above the top layer, so
  // while it runs the original shows over Sift (YouTube animates its watch page
  // in), and the page does not paint at all while its update runs. While Sift is
  // shown the page changes at once, without the animation: the update still runs.
  const siftShown = () => {
    const root = document.querySelector("sift-root") as HTMLElement | null;
    return !!root && root.offsetWidth > 0;
  };
  const skip = (tr: { skipTransition?: () => void } | null | undefined) => {
    try {
      if (tr && siftShown()) tr.skipTransition?.();
    } catch {
      /* never break the page's own call */
    }
  };
  const startVT = (Document.prototype as any).startViewTransition;
  if (typeof startVT === "function") {
    (Document.prototype as any).startViewTransition = function (this: Document, ...args: unknown[]) {
      const tr = startVT.apply(this, args);
      skip(tr);
      return tr;
    };
  }
  // The same for one that animates in from the previous page (cross-document).
  addEventListener("pagereveal", (e) => skip((e as any).viewTransition));

  // A modal dialog inside a shadow root is invisible to document.querySelector(":modal")
  // and sends no toggle event to the document. Tell Sift when one opens and closes.
  const dproto = HTMLDialogElement.prototype as any;
  const showModal = dproto.showModal;
  if (typeof showModal === "function") {
    dproto.showModal = function (this: HTMLDialogElement, ...args: unknown[]) {
      const r = showModal.apply(this, args);
      try {
        const tell = () => this.dispatchEvent(new CustomEvent("sift-modal", { bubbles: true, composed: true }));
        tell();
        this.addEventListener("close", tell, { once: true });
      } catch {
        /* never break the page's own call */
      }
      return r;
    };
  }

  // A click on Sift's own controls is no click on the page. Sift hides its
  // pointer events from the page already, but its UI needs click itself, so
  // page listeners on the way down (outside-click hooks on window, document or
  // <html> in the capture phase: Booking's date picker) would see it as a click
  // outside their popup and close it before Sift's replayed click reaches it.
  // Those listeners skip clicks whose target is Sift's root.
  const et = EventTarget.prototype as any;
  const add = et.addEventListener;
  const remove = et.removeEventListener;
  if (typeof add === "function" && typeof remove === "function") {
    const wrapped = new WeakMap<object, EventListener>();
    const above = (t: unknown) => t === window || t === document || t === document.documentElement;
    const capture = (o: unknown) => (typeof o === "boolean" ? o : !!(o as AddEventListenerOptions | null)?.capture);
    const wrap = (l: EventListenerOrEventListenerObject) => {
      let w = wrapped.get(l);
      if (!w) {
        w = function (this: unknown, e: Event) {
          if ((e.target as Element | null)?.localName === "sift-root") return;
          return typeof l === "function" ? l.call(this, e) : l.handleEvent(e);
        };
        wrapped.set(l, w);
      }
      return w;
    };
    et.addEventListener = function (this: unknown, type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
      // A link to "#" with a click listener of its own (an FAQ question that opens its answer) is a control:
      // mark it, since Sift's extractor cannot see page listeners.
      try {
        if (type === "click" && l && this instanceof HTMLAnchorElement && /^(#|javascript:.*)$/i.test(this.getAttribute("href") ?? "") && !this.hasAttribute("data-sift-click")) this.setAttribute("data-sift-click", "");
      } catch {
        /* never break the page's own call */
      }
      if (type === "click" && l && (typeof l === "function" || typeof l === "object") && capture(o) && above(this)) return add.call(this, type, wrap(l), o);
      return add.call(this, type, l, o);
    };
    et.removeEventListener = function (this: unknown, type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
      if (type === "click" && l && wrapped.has(l) && capture(o) && above(this)) remove.call(this, type, wrapped.get(l), o);
      return remove.call(this, type, l, o);
    };
  }
}
