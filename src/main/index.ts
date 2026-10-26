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
  document.addEventListener(
    "sift-enter",
    (e) => {
      entered = e.composedPath()[0] as Element;
      e.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener(
    "sift-leave",
    (e) => {
      if (e.composedPath()[0] === entered) entered = null;
      e.stopImmediatePropagation();
    },
    true,
  );
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
