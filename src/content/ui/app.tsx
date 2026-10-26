import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Action, Block, Dialog, Field, Inline, Item, MediaInfo, Page } from "../model";
import { textOf } from "../model";
import { dirOf, t } from "../i18n";
import { bindBox, mediaOf } from "../portal";
import { deepActive } from "../proxy";
import { elOf } from "../registry";
import { H, changed, lineKey, local, onEnter, onKeys, setLocal, store, type AiResult } from "./store";
import { Markdown } from "./markdown";
import { planShort, sameArticle, shortSource, type ShortPlan } from "../short";

// ---------- small pieces ----------

function A(props: { href?: string; refId?: string; class?: string; id?: string; title?: string; label?: string; current?: boolean; expanded?: boolean; children: any }) {
  return (
    <a
      href={props.href || "#"}
      id={props.id}
      class={props.class}
      data-ref={props.refId}
      title={props.title}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      role={props.expanded !== undefined ? "button" : undefined}
      aria-expanded={props.expanded}
      // A toggle answers Space like a button.
      onKeyDown={props.expanded !== undefined ? (e) => e.key === " " && (e.preventDefault(), H.act(props.refId, props.href)) : undefined}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        H.act(props.refId, props.href);
      }}
    >
      {props.children}
    </a>
  );
}

function Inl({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) =>
        typeof x === "string" ? (
          x
        ) : "a" in x ? (
          x.checked !== undefined ? (
            // A row's select box stays a checkbox in its cell; the page's own box is set.
            <CellCheck key={i} refId={x.ref} label={x.a} checked={x.checked} disabled={x.disabled} />
          ) : x.btn ? (
            // A button in a cell (Edit, Delete, a calendar's day) stays a button, with its state.
            <button
              key={i}
              type="button"
              class="cell-btn"
              data-ref={x.ref}
              aria-label={x.name}
              aria-expanded={x.expanded}
              aria-pressed={x.pressed}
              aria-disabled={x.disabled || undefined}
              onClick={() => H.act(x.ref, x.href)}
            >
              {x.a}
            </button>
          ) : (
            <A key={i} href={x.href} refId={x.ref} expanded={x.expanded}>{x.a}</A>
          )
        ) : "b" in x ? (
          <strong key={i}>{x.b}</strong>
        ) : "i" in x ? (
          <em key={i}>{x.i}</em>
        ) : "code" in x ? (
          <code key={i}>{x.code}</code>
        ) : (
          <br key={i} />
        ),
      )}
    </>
  );
}

/** A checkbox in a table (a row's select box, the header's select all). */
function CellCheck(p: { refId?: string; label: string; checked: boolean | "mixed"; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      class="cell-check"
      data-ref={p.refId}
      aria-label={p.label}
      checked={p.checked === true}
      indeterminate={p.checked === "mixed"}
      disabled={p.disabled}
      // The box takes its new state at once (a page that redraws its rows as the click is
      // handled would see a cancelled click undo it); the page's own state then wins.
      onClick={(e) => {
        if (p.refId) H.check(p.refId, (e.currentTarget as HTMLInputElement).checked);
      }}
    />
  );
}

/** `desc`: the id of what the button acts on (its list entry's title), read after its name. */
function Btn({ a, desc }: { a: Action; desc?: string }) {
  if (a.href && a.kind !== "primary") {
    return (
      <A href={a.href} refId={a.ref} class="btn quiet" current={a.pressed}>
        {a.label}
        {a.badge && <span class="badge">{a.badge}</span>}
      </A>
    );
  }
  return (
    <button
      type="button"
      class={"btn " + (a.kind ?? "") + (a.label.length > 40 ? " long" : "")}
      data-ref={a.ref}
      aria-pressed={a.pressed}
      aria-expanded={a.expanded}
      aria-disabled={a.disabled || undefined}
      aria-describedby={desc}
      // Typing may have just enabled it on the page; H.act checks the page's own state.
      onClick={() => H.act(a.ref, a.href)}
    >
      {a.label}
      {a.badge && <span class="badge">{a.badge}</span>}
    </button>
  );
}

function Heading({ level, children, k }: { level: number; children: any; /** Its block's key, for links to it in the page. */ k?: string }) {
  const L = Math.min(6, Math.max(1, level));
  const Tag = ("h" + L) as "h2";
  return <Tag data-key={k}>{children}</Tag>;
}

// ---------- fields ----------

/** When the user last typed in each Sift field. */
const typedAt = new WeakMap<Element, number>();
/** When the user last typed in, focused, or clicked each Sift field. */
const touchedAt = new WeakMap<Element, number>();
const noteTyping = (e: Event) => {
  typedAt.set(e.currentTarget as Element, Date.now());
  touchedAt.set(e.currentTarget as Element, Date.now());
};
const noteTouch = (e: Event) => touchedAt.set(e.currentTarget as Element, Date.now());
/** When the user last typed in this Sift field (0 if never). */
export const lastTyped = (el: Element) => typedAt.get(el) ?? 0;
/** When the user last typed in, focused, or clicked this Sift field (0 if never). */
export const lastTouched = (el: Element) => touchedAt.get(el) ?? 0;

/**
 * Entering, leaving, and clicking Sift's field do the same on the page field,
 * as Chrome would: pages open date pickers, comboboxes, and recent searches on
 * focus or click, and validate on blur.
 */
function fieldEvents(ref: string) {
  return {
    onFocus: (e: FocusEvent) => {
      noteTouch(e);
      H.focus(ref);
    },
    onBlur: (e: FocusEvent) => H.leave(ref, e.relatedTarget),
    onClick: (e: MouseEvent) => {
      // A press of the user's (not the click a label or a script makes).
      if (!e.isTrusted || e.detail < 1) return;
      noteTouch(e);
      H.fieldClick(ref);
    },
  };
}

function useMirror(f: Field) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.value === f.value) return;
    const root = el.getRootNode() as ShadowRoot;
    // Never under the user's fingers; but a value the page set after an action
    // (a picked suggestion) shows even in the focused field, unless they typed since.
    if (root.activeElement !== el || (store.actAt > (typedAt.get(el) ?? 0) && Date.now() - store.actAt < 3000)) el.value = f.value;
  });
  return ref;
}

function TextField({ f, formRef }: { f: Field; formRef?: string }) {
  const ref = useMirror(f);
  useEffect(() => {
    const el = ref.current;
    if (el && f.kind !== "textarea" && f.kind !== "editable") {
      onEnter.set(el, (e) => {
        e.preventDefault();
        H.submit(f, formRef, f.submit, "enter");
      });
    }
  });
  const common = {
    ref,
    "data-ref": f.ref,
    defaultValue: f.value,
    placeholder: f.placeholder,
    required: f.required,
    disabled: f.disabled,
    readOnly: f.readOnly,
    autoComplete: f.autocomplete,
    onInput: (e: Event) => {
      noteTyping(e);
      H.input(f.ref, (e.currentTarget as HTMLInputElement).value);
    },
    onChange: () => H.commit(f.ref),
    ...fieldEvents(f.ref),
    // The page says the value is wrong, and why (its error text is read with the field).
    "aria-invalid": f.invalid || undefined,
    "aria-describedby": f.error ? "err-" + f.key : undefined,
  };
  return (
    <>
      <label class="field">
        <span>{f.label}</span>
        {f.kind === "textarea" || f.kind === "editable" ? (
          <textarea {...common} />
        ) : (
          <input {...common} type={f.kind as any} name={f.name} min={f.min} max={f.max} step={f.step} aria-valuetext={f.valueText} />
        )}
      </label>
      {f.error && <span class="sr" id={"err-" + f.key}>{f.error}</span>}
    </>
  );
}

/** A select that follows the page: if the site rejects or resets a choice, Sift shows that. */
function SelectField({ f }: { f: Field }) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || (el.getRootNode() as ShadowRoot).activeElement === el || f.multiple) return;
    if (el.value !== f.value) el.value = f.value;
  });
  const { onFocus, onBlur } = fieldEvents(f.ref);
  return (
    <label class="field">
      <span>{f.label}</span>
      <select
        ref={ref}
        data-ref={f.ref}
        disabled={f.disabled}
        multiple={f.multiple}
        // Pages fill a list when it is entered or pressed (mousedown), before it opens.
        onFocus={onFocus}
        onBlur={onBlur}
        onMouseDown={(e) => {
          if (!e.isTrusted || e.button !== 0) return;
          noteTouch(e);
          H.fieldClick(f.ref);
        }}
        onChange={(e) => {
          const s = e.currentTarget as HTMLSelectElement;
          H.select(f.ref, f.multiple ? Array.from(s.selectedOptions).map((o) => o.value) : s.value);
        }}
      >
        {(f.options ?? []).map((o) => (
          <option key={o.value + o.label} value={o.value} selected={o.selected} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Enter on a checkbox or radio does what it does there in Chrome: it clicks the form's submit button. */
function enterSubmits(f: Field, formRef?: string) {
  return (el: HTMLInputElement | null) => {
    if (el) onEnter.set(el, (e) => {
      e.preventDefault();
      H.submit(f, formRef, undefined, "enter");
    });
  };
}

function FieldView({ f, formRef, group }: { f: Field; formRef?: string; group: string }) {
  switch (f.kind) {
    case "checkbox":
      return (
        <label class="check">
          <input type="checkbox" ref={enterSubmits(f, formRef)} data-ref={f.ref} checked={!!f.checked} disabled={f.disabled} onClick={(e) => { e.preventDefault(); H.check(f.ref, !f.checked); }} />
          <span>{f.label}</span>
        </label>
      );
    case "radio":
      return (
        <label class="check">
          <input type="radio" ref={enterSubmits(f, formRef)} data-ref={f.ref} name={group + (f.name ?? "")} checked={!!f.checked} disabled={f.disabled} onClick={(e) => { e.preventDefault(); H.check(f.ref, true); }} />
          <span>{f.label}</span>
        </label>
      );
    case "select":
      return <SelectField f={f} />;
    case "file":
      return (
        <label class="field">
          <span>{f.label}</span>
          <input type="file" data-ref={f.ref} accept={f.accept} multiple={f.multiple} onChange={(e) => { const fl = (e.currentTarget as HTMLInputElement).files; if (fl) H.files(f.ref, fl); }} />
        </label>
      );
    default:
      return <TextField f={f} formRef={formRef} />;
  }
}

function FormView({ b }: { b: Extract<Block, { t: "form" }> }) {
  // Group runs of radios with the same name into one fieldset.
  const parts: any[] = [];
  let i = 0;
  while (i < b.fields.length) {
    const f = b.fields[i];
    // A named group (a fieldset's legend: "Payment method") keeps its name for its fields.
    if (f.group) {
      const g = f.group;
      const inner: any[] = [];
      while (i < b.fields.length && b.fields[i].group?.ref === g.ref) {
        const x = b.fields[i++];
        inner.push(<FieldView key={x.key} f={x} formRef={b.ref} group={b.key} />);
        if (x.after?.length) inner.push(<div key={"a" + x.key} class="row">{x.after.map((a) => <Btn key={a.key} a={a} />)}</div>);
      }
      parts.push(
        <fieldset key={"fs" + f.key}>
          <legend>{g.label}</legend>
          {inner}
        </fieldset>,
      );
      continue;
    }
    if (f.kind === "radio") {
      const run: Field[] = [];
      while (i < b.fields.length && b.fields[i].kind === "radio" && b.fields[i].name === f.name) run.push(b.fields[i++]);
      parts.push(
        <fieldset key={"g" + f.key}>
          {run.map((r) => <FieldView key={r.key} f={r} formRef={b.ref} group={b.key} />)}
        </fieldset>,
      );
      continue;
    }
    parts.push(<FieldView key={f.key} f={f} formRef={b.ref} group={b.key} />);
    // Its own buttons (Show password) right after it, where they are on the page.
    if (f.after?.length) parts.push(<div key={"a" + f.key} class="row">{f.after.map((a) => <Btn key={a.key} a={a} />)}</div>);
    i++;
  }
  return (
    <form class="form" onSubmit={(e) => { e.preventDefault(); H.submit(b.fields.find((f) => f.kind !== "checkbox") ?? null, b.ref); }}>
      {parts}
      {b.actions.length > 0 && <div class="row">{b.actions.map((a) => <Btn key={a.key} a={a} />)}</div>}
    </form>
  );
}

// ---------- items ----------

// Writing systems, and the language a text in one most likely is when it is not the page's.
const SCRIPTS: [string, RegExp, string][] = [
  ["latin", /\p{Script=Latin}/gu, ""],
  ["cyrillic", /\p{Script=Cyrillic}/gu, "ru"],
  ["arabic", /\p{Script=Arabic}/gu, "ar"],
  ["hebrew", /\p{Script=Hebrew}/gu, "he"],
  ["greek", /\p{Script=Greek}/gu, "el"],
  ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, "zh"],
  ["hangul", /\p{Script=Hangul}/gu, "ko"],
  ["thai", /\p{Script=Thai}/gu, "th"],
  ["devanagari", /\p{Script=Devanagari}/gu, "hi"],
];
const LANG_SCRIPT: Record<string, string> = {
  ru: "cyrillic", uk: "cyrillic", bg: "cyrillic", sr: "cyrillic", mk: "cyrillic", be: "cyrillic", kk: "cyrillic",
  ar: "arabic", fa: "arabic", ur: "arabic", he: "hebrew", iw: "hebrew", el: "greek", zh: "cjk", ja: "cjk", ko: "hangul", th: "thai", hi: "devanagari", mr: "devanagari", ne: "devanagari",
};

/** The writing system most letters of a text are in ("" for none, "other" for one not listed). */
function scriptOf(s: string): string {
  let best = "";
  let max = 0;
  for (const [name, re] of SCRIPTS) {
    const n = s.match(re)?.length ?? 0;
    if (n > max) [best, max] = [name, n];
  }
  return best || (/\p{L}/u.test(s) ? "other" : "");
}

const pageScript = (lang: string) => LANG_SCRIPT[(lang || "").toLowerCase().split(/[-_]/)[0]] ?? "latin";

/** A rewritten line in neither the entry's writing system nor the page's (a Russian title on an English page rewritten in Persian) is wrong. */
function fitsScript(line: string, source: string, lang: string): boolean {
  const s = scriptOf(line);
  return !s || s === scriptOf(source) || s === pageScript(lang);
}

/** The language of a text in another writing system than the page's, when the script tells it; screen readers then use the right voice. */
function langOf(text: string, lang: string): string | undefined {
  const s = scriptOf(text);
  if (!s || s === "latin" || s === pageScript(lang)) return undefined;
  if (s === "cyrillic" && /[іїєґ]/i.test(text)) return "uk";
  if (s === "arabic" && /[ٹڈڑںے]/.test(text)) return "ur";
  if (s === "arabic" && /[پچژگیک]/.test(text)) return "fa";
  if (s === "cjk" && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
  return SCRIPTS.find(([name]) => name === s)?.[2] || undefined;
}

function ItemView({ it, thumbs, rewrite, children }: { it: Item; thumbs?: boolean; rewrite?: string; children?: ComponentChildren }) {
  const lang = store.page?.lang ?? "";
  // Names (channels, playlists, products) are never rewritten.
  const raw = rewrite && !it.keepTitle ? store.ai.get(lineKey(it))?.text : undefined;
  const line = raw && fitsScript(raw, rewrite === "summary" ? it.text ?? it.title : it.title, lang) ? raw : undefined;
  const title = rewrite === "oneliner" && line ? line : it.title;
  const snippet = rewrite === "summary" && line ? line : it.text;
  const shown = <span lang={langOf(title, lang)} dir="auto">{title}</span>;
  // Its buttons ("Delete", "Archive") say which entry they act on.
  const tid = "t-" + it.key.replace(/\s/g, "_");
  return (
    <li class={"item" + (it.unread ? " unread" : "") + (it.body ? " post" : "")} data-key={it.key}>
      {thumbs && it.image && <img class="thumb" src={it.image.src} alt="" loading="lazy" decoding="async" />}
      <div class="body">
        {it.unread && <span class="tag unread-tag">{t("unread")}</span>}
        {it.badge && <span class="tag item-badge">{it.badge}</span>}
        {it.lead && <span class="lead" dir="auto">{it.lead}</span>}
        {it.href || it.ref ? (
          <A href={it.href} refId={it.ref} class="title" id={tid} title={title !== it.title ? it.title : undefined}>{shown}</A>
        ) : (
          <span class="title" id={tid}>{shown}</span>
        )}
        {snippet && <p class="snippet" lang={langOf(snippet, lang)} dir="auto">{snippet}</p>}
        {/* A post's date and badges head its text. */}
        {it.body && it.meta.length > 0 && <p class="meta">{it.metaInline ? it.metaInline.map((m, i) => <Fragment key={i}>{i > 0 && " · "}<Inl c={m} /></Fragment>) : it.meta.join(" · ")}</p>}
        {it.body && <div class="post-body"><Blocks blocks={it.body} /></div>}
        {!it.body && it.meta.length > 0 && <p class="meta">{it.metaInline ? it.metaInline.map((m, i) => <Fragment key={i}>{i > 0 && " · "}<Inl c={m} /></Fragment>) : it.meta.join(" · ")}</p>}
        {/* Replies nest under the entry they answer; their "more replies" buttons follow them. */}
        {it.replies && it.replies.length > 0 && <ol class="items replies">{it.replies.map((r) => <ItemView key={r.key} it={r} />)}</ol>}
        {it.actions && <div class="row">{it.actions.map((a) => <Btn key={a.key} a={a} desc={tid} />)}</div>}
        {children}
      </div>
    </li>
  );
}

type Nest = { it: Item; kids: Nest[] };

/** Entries with reply levels as a tree: each reply sits in a list inside the entry it answers. */
function nestItems(items: Item[]): Nest[] {
  const root: Nest[] = [];
  const stack: { d: number; kids: Nest[] }[] = [{ d: -1, kids: root }];
  for (const it of items) {
    const d = it.depth ?? 0;
    while (stack.length > 1 && stack[stack.length - 1].d >= d) stack.pop();
    const n: Nest = { it, kids: [] };
    stack[stack.length - 1].kids.push(n);
    stack.push({ d, kids: n.kids });
  }
  return root;
}

function ItemsView({ b }: { b: Extract<Block, { t: "items" }> }) {
  // A thread: replies are lists nested in the entry they answer, so screen readers say the level.
  const row = (n: Nest) => (
    <ItemView key={n.it.key} it={n.it} thumbs={b.thumbs} rewrite={b.rewrite}>
      {n.kids.length > 0 && <ol class="items replies">{n.kids.map(row)}</ol>}
    </ItemView>
  );
  return (
    <>
      {b.title && <h2>{b.title}</h2>}
      <ol class="items" aria-label={b.title}>
        {b.items.some((it) => it.depth) ? nestItems(b.items).map(row) : b.items.map((it) => <ItemView key={it.key} it={it} thumbs={b.thumbs} rewrite={b.rewrite} />)}
      </ol>
      {b.more && (
        <p class="more">
          <button type="button" class="btn" onClick={() => H.loadMore(b.more!.ref)}>{b.more.label || t("loadMore")}</button>
        </p>
      )}
    </>
  );
}

// ---------- media ----------

function fmt(s: number) {
  if (!isFinite(s)) return "";
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function MediaBar({ media, portalRef }: { media: MediaInfo; portalRef: string }) {
  const [, tick] = useState(0);
  // What plays now in the player (an ad may come first), else the adapter's
  // video, else the one inside the player (it may load into a shadow root later).
  const v = mediaOf(elOf(portalRef), elOf(media.video));
  useEffect(() => {
    const up = () => tick((n) => n + 1);
    const evs = ["play", "playing", "pause", "volumechange", "durationchange", "loadedmetadata", "emptied"];
    for (const e of evs) v?.addEventListener(e, up);
    const iv = setInterval(up, 1000);
    return () => {
      for (const e of evs) v?.removeEventListener(e, up);
      clearInterval(iv);
    };
  }, [v]);
  // A poster that loads its player on click (a JW Player facade): only Play, which starts the real one.
  if (!v) return media.play ? (
    <div class="row media" role="group" aria-label={t("video")}>
      <button type="button" class="btn primary" onClick={() => H.media("play", media, portalRef)}>{t("play")}</button>
    </div>
  ) : null;
  // A player that has not loaded anything is not playing, whatever `paused` says.
  const playing = !v.paused && (!!v.currentSrc || v.readyState > 0);
  const known = isFinite(v.duration) && v.duration > 0;
  const seek = (s: number) => {
    v.currentTime = Math.min(Math.max(0, s), v.duration || Infinity);
    tick((n) => n + 1);
  };
  // The player's own keys, while focus is on its bar (the page never gets keys pressed in Sift):
  // k plays or pauses, j and l go back and ahead 10 s, 0-9 jump to that tenth of the video.
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === "k") H.media("play", media, portalRef);
    else if (k === "j") H.media("back", media, portalRef);
    else if (k === "l") H.media("fwd", media, portalRef);
    else if (/^[0-9]$/.test(k) && known) seek((v.duration * +k) / 10);
    else return;
    e.preventDefault();
  };
  return (
    <div class="row media" role="group" aria-label={t("video")} ref={(el) => void (el && onKeys.set(el, onKey))}>
      <button type="button" class="btn primary" onClick={() => H.media("play", media, portalRef)}>{playing ? t("pause") : t("play")}</button>
      <button type="button" class="btn" onClick={() => H.media("back", media, portalRef)}>{t("back10")}</button>
      <button type="button" class="btn" onClick={() => H.media("fwd", media, portalRef)}>{t("fwd10")}</button>
      <button type="button" class="btn" onClick={() => H.media("mute", media, portalRef)}>{v.muted ? t("unmute") : t("mute")}</button>
      {media.captions && (
        <button
          type="button"
          class="btn"
          // Follows the player's own captions button (the bar redraws every second).
          aria-pressed={(() => {
            const v = elOf(media.captions)?.getAttribute("aria-pressed");
            return v === "true" || v === "false" ? v === "true" : undefined;
          })()}
          onClick={() => H.media("captions", media, portalRef)}
        >
          {t("captions")}
        </button>
      )}
      <button type="button" class="btn" onClick={() => H.media("fullscreen", media, portalRef)}>{t("fullscreen")}</button>
      {/* Any point in the video: arrows step a second, Page Up and Down a tenth, Home and End the ends. */}
      {known && (
        <input
          type="range"
          class="seek"
          min={0}
          max={Math.floor(v.duration)}
          step={1}
          value={Math.floor(v.currentTime)}
          aria-label={t("position")}
          aria-valuetext={`${fmt(v.currentTime)} / ${fmt(v.duration)}`}
          onInput={(e) => seek(+(e.currentTarget as HTMLInputElement).value)}
        />
      )}
      {(known || v.currentTime > 0) && <span class="time" aria-live="off">{fmt(v.currentTime)}{known && ` / ${fmt(v.duration)}`}</span>}
    </div>
  );
}

function PortalView({ b }: { b: Extract<Block, { t: "portal" }> }) {
  const ratio = b.ratio > 0.05 && b.ratio < 4 ? b.ratio : 9 / 16;
  // Keys inside an embedded frame never reach Sift, so Escape cannot work there; Tab can.
  const el = b.media ? null : elOf(b.ref);
  const frame = !!el && (el.localName === "iframe" || !!el.querySelector("iframe"));
  const named = b.label && b.label !== t("interactive") ? `: ${b.label}` : "";
  return (
    <figure class="portal-wrap">
      <div
        class={"portal" + (b.media ? "" : " other")}
        ref={(el) => {
          bindBox(b.ref, el);
          // Keyboard users press Enter here to work inside the original element
          // (a map, a payment field); Escape there comes back here.
          // preventDefault: the key must not also press the control focus moves to.
          if (el && !b.media) onEnter.set(el, (e) => { e.preventDefault(); H.enterPortal(b.ref); });
        }}
        style={{ aspectRatio: `${1 / ratio}`, maxWidth: b.maxWidth ? b.maxWidth + "px" : undefined }}
        role={b.media ? "img" : "group"}
        aria-label={b.media ? b.label : `${t("interactive")}${named}. ${frame ? t("enterToUseFrame") : t("enterToUse")}`}
        // A video box is not a tab stop (Sift's buttons below it are), but Escape
        // from inside the player comes back to it.
        tabIndex={b.media ? -1 : 0}
      />
      {b.media && <MediaBar media={b.media} portalRef={b.ref} />}
    </figure>
  );
}

// ---------- articles ----------

/** The Short version put together, once per result and extraction. */
const plans = new WeakMap<AiResult, { blocks: Block[]; plan: ShortPlan | null }>();

/**
 * The article's Short version, or null while there is none: still being
 * written, refused, not much shorter, or made for another article that the
 * site showed in the same place (a single-page app reusing the element).
 */
function shortPlan(ai: AiResult | undefined, blocks: Block[]): ShortPlan | null {
  if (!ai?.short || !ai.done || ai.error || ai.text.length <= 40) return null;
  const hit = plans.get(ai);
  if (hit && hit.blocks === blocks) return hit.plan;
  const src = shortSource(blocks);
  const plan = sameArticle(ai.short, src) ? planShort(ai.text, ai.short, src) : null;
  plans.set(ai, { blocks, plan });
  return plan;
}

function ArticleView({ b }: { b: Extract<Block, { t: "article" }> }) {
  const ai = store.ai.get("condense:" + b.key);
  const choice = local<"short" | "full" | "auto">("art:" + b.key, "auto");
  const plan = shortPlan(ai, b.blocks);
  const ready = !!plan;
  // Late: the reader started on the full text before the short version came (for this article, or anywhere on the page).
  const late = local("art-late:" + b.key, false) || local("art-read-full", false);
  const short = ready && (choice === "short" || (choice === "auto" && !late));
  if (plan && short) {
    // The short text with the article's own parts in place: buttons, code,
    // link lists, images and video, and its links on the same words.
    // Resolved in the current extraction: after a re-render, the refs of the request's time are dead.
    const links = plan.links;
    const link = (id: number, words: string, key: string) => {
      const l = links[id];
      return l ? <A key={key} href={l.href} refId={l.ref}>{words}</A> : undefined;
    };
    const listId = "short-links-" + b.key;
    return (
      <article class="short">
        <div class="short-head">
          <span class="tag">{t("shortVersion")}</span>
          <button type="button" class="btn quiet" onClick={() => setLocal("art:" + b.key, "full")}>{t("showFull")}</button>
        </div>
        {plan.segs.map((sg, i) => ("md" in sg ? <Markdown key={"m" + i} text={sg.md} link={link} /> : <BlockView key={sg.block.key} b={sg.block} />))}
        {ai!.short!.partial && <p class="small">{t("shortPartial")}</p>}
        {plan.extra.length > 0 && (
          <>
            {/* Links that left with their sentence stay one click away. */}
            <p class="small" id={listId}>{t("shortLinks")}</p>
            <ul class="links" aria-labelledby={listId}>
              {plan.extra.map((l, i) => <li key={i}><A href={l.href} refId={l.ref}>{l.a}</A></li>)}
            </ul>
          </>
        )}
      </article>
    );
  }
  return (
    <article>
      {ready && (
        <div class={choice === "auto" ? "notice" : "short-head"}>
          {choice === "auto" && <span>{t("shortReady")}</span>}
          <button type="button" class="btn quiet" onClick={() => setLocal("art:" + b.key, "short")}>{t("showShort")}</button>
        </div>
      )}
      {!ready && ai && !ai.done && !ai.error && <p class="pending tag">{t("shortening")}</p>}
      <Blocks blocks={b.blocks} />
    </article>
  );
}

// ---------- blocks ----------

function Section({ b }: { b: Extract<Block, { t: "section" }> }) {
  const open = local("sec:" + b.key, !b.collapsed);
  return (
    <details
      class="section"
      data-key={b.key}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        if (now && b.reveal) H.reveal(b.reveal);
        setLocal("sec:" + b.key, now);
      }}
    >
      {/* A heading inside the summary keeps the outline: an h3 in the section follows an h2. */}
      <summary><Heading level={Math.max(2, b.level ?? 2)}>{b.title}</Heading></summary>
      {open && <Blocks blocks={b.blocks} />}
    </details>
  );
}

export function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "h":
      return <Heading level={b.level === 1 ? 2 : b.level} k={b.key}>{b.href ? <A href={b.href} refId={b.ref}>{b.text}</A> : b.text}</Heading>;
    case "p":
      return <p class={b.small ? "small" : undefined} data-scroll-end={b.scrollEnd}><Inl c={b.content} /></p>;
    case "ul":
    case "ol": {
      const L = b.t;
      const isLinks = b.items.every((it) => it.length === 1 && typeof it[0] === "object" && "a" in it[0]);
      return (
        <L class={isLinks ? "links" : undefined} aria-label={b.label} data-scroll-end={b.scrollEnd}>
          {b.items.map((it, i) => <li key={i} aria-current={b.current?.at === i ? (b.current.as as "step") : undefined}><Inl c={it} /></li>)}
        </L>
      );
    }
    case "quote":
      return <blockquote><Inl c={b.content} /></blockquote>;
    case "pre":
      return <pre>{b.text}</pre>;
    case "img": {
      const img = <img class="content" src={b.img.src} alt={b.img.alt} loading="lazy" decoding="async" style={b.img.w ? { width: Math.min(b.img.w, 800) + "px" } : undefined} />;
      return (
        <figure>
          {b.href ? <A href={b.href} refId={b.ref} label={b.img.alt || b.caption || t("openImage")}>{img}</A> : img}
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
    }
    case "portal":
      return <PortalView b={b} />;
    case "items":
      return <ItemsView b={b} />;
    case "form":
      return <FormView b={b} />;
    case "actions": {
      const row = b.actions.map((a) => <Btn key={a.key} a={a} />);
      return b.nav ? <nav class="row actions" aria-label={b.nav}>{row}</nav> : <div class="row actions">{row}</div>;
    }
    case "facts":
      return (
        <dl class="facts">
          {b.rows.map((r, i) => (
            <Fragment key={i}>
              <dt>{r.k}</dt>
              <dd><Inl c={r.v} /></dd>
            </Fragment>
          ))}
        </dl>
      );
    case "table":
      return (
        <div class="table-wrap">
          <table>
            {b.caption && <caption>{b.caption}</caption>}
            {/* An empty corner cell (over the rows' names) heads nothing. */}
            {b.head.length > 0 && (
              <thead>
                <tr>
                  {b.head.map((h, i) => {
                    // A header that sorts its column stays a button (or the page's sort link), with its sort state.
                    const c = b.heads?.[i];
                    if (!h) return <td key={i} />;
                    return (
                      <th key={i} scope="col" aria-sort={c?.sort as any}>
                        {c?.checked !== undefined ? <CellCheck refId={c.ref} label={h} checked={c.checked} /> : c?.href ? <A href={c.href} refId={c.ref}>{h}</A> : c?.ref ? <button type="button" class="th-btn" data-ref={c.ref} onClick={() => H.act(c.ref)}>{h}</button> : h}
                      </th>
                    );
                  })}
                </tr>
              </thead>
            )}
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><Inl c={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "section":
      return <Section b={b} />;
    case "article":
      return <ArticleView b={b} />;
    case "note":
      return <p class={"notice " + (b.tone ?? "")} role={b.tone === "error" ? "alert" : undefined}>{b.text}</p>;
  }
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((b) => <BlockView key={b.key} b={b} />)}</>;
}

// ---------- page chrome ----------

function SearchBox({ f }: { f: Field }) {
  const ref = useMirror(f);
  useEffect(() => {
    if (ref.current) onEnter.set(ref.current, (e) => { e.preventDefault(); H.submit(f, undefined, f.submit, "enter"); });
  });
  return (
    <form class="search" role="search" onSubmit={(e) => { e.preventDefault(); H.submit(f, undefined, f.submit); }}>
      <input
        ref={ref}
        data-ref={f.ref}
        type="search"
        aria-label={f.label || t("search")}
        placeholder={f.placeholder || f.label || t("search")}
        defaultValue={f.value}
        onInput={(e) => {
          noteTyping(e);
          H.input(f.ref, (e.currentTarget as HTMLInputElement).value);
        }}
        {...fieldEvents(f.ref)}
      />
      <button type="submit" class="btn primary">{f.submitLabel || t("search")}</button>
    </form>
  );
}

function Menu({ page }: { page: Page }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div class="layer" onClick={(e) => e.target === e.currentTarget && H.menu(false)}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={t("menu")} tabIndex={-1}>
        <div class="sheet-head">
          <h2>{t("menu")}</h2>
          <button ref={first} type="button" class="btn quiet" onClick={() => H.menu(false)}>{t("close")}</button>
        </div>
        <ul class="links">
          {(page.nav ?? []).map((n) => (
            <li key={n.key}><A href={n.href} refId={n.ref}>{n.label}</A></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** The first line of a dialog's text, to name a dialog that has no title. */
function firstLine(blocks: Block[]): string {
  for (const b of blocks) {
    if (b.t === "h") return b.text;
    if (b.t === "p" || b.t === "quote") {
      const s = textOf(b.content).trim();
      if (s) return s.split(/(?<=[.?!])\s/)[0].slice(0, 100);
    }
    if (b.t === "section" || b.t === "article") {
      const s = firstLine(b.blocks);
      if (s) return s;
    }
  }
  return "";
}

/** A dialog's blocks without its own heading when the sheet's head already shows that title. */
function withoutTitle(blocks: Block[], title: string): Block[] {
  const b = blocks[0];
  const same = (s: string) => !!title && (s.trim() === title.trim() || (title.length >= 120 && s.trim().startsWith(title)));
  if (b?.t === "h" && same(b.text)) return blocks.slice(1);
  if ((b?.t === "section" || b?.t === "article") && b.blocks[0]?.t === "h" && same(b.blocks[0].text)) return [{ ...b, blocks: b.blocks.slice(1) }, ...blocks.slice(1)];
  return blocks;
}

/** The Sift text field the user is typing in, if any. */
function typingField(): HTMLElement | null {
  const a = deepActive();
  return a && a.closest(".sift") && (a.localName === "textarea" || (a.localName === "input" && !/^(checkbox|radio|button|submit|file|range|color)$/.test((a as HTMLInputElement).type))) ? a : null;
}

// A suggestion list the page opened while the user types in a Sift field
// stays next to that field, and focus stays in it.
let anchor: { key: string; el: HTMLElement | null; ref: string | null } = { key: "", el: null, ref: null };

/**
 * The page's popup belongs to the field the user is in: the field says it
 * controls it (aria-controls, aria-owns), it is a list of options or a date
 * grid, or, not being modal, it opened right next to the field. Anything else
 * (a sign-in prompt, a session warning, a promo) is a dialog of its own, even
 * when it opens while the user types.
 */
function tiedTo(d: Dialog, f: HTMLElement): boolean {
  const pop = elOf(d.ref);
  const pf = elOf(f.dataset.ref);
  if (!pop || !pf || pop.contains(pf)) return false;
  const root = pf.getRootNode() as Document | ShadowRoot;
  const ids = ["aria-controls", "aria-owns"].flatMap((n) => (pf.getAttribute(n) ?? "").split(/\s+/)).filter(Boolean);
  if (ids.some((id) => {
    const x = root.getElementById?.(id);
    return !!x && (pop.contains(x) || x.contains(pop));
  })) return true;
  if (pop.matches("[role=listbox], [role=option], [role=grid]") || pop.querySelector("[role=listbox], [role=option], [role=grid]")) return true;
  if (pop.matches("[aria-modal=true], [role=alertdialog], dialog:modal")) return false;
  const a = pf.getBoundingClientRect();
  const b = pop.getBoundingClientRect();
  if (!a.width || !b.width || b.left >= a.right || b.right <= a.left) return false;
  return (b.top >= a.top - 4 && b.top - a.bottom < 60) || (b.bottom <= a.bottom + 4 && a.top - b.bottom < 60);
}

/** The Sift field a dialog is anchored to (a suggestion list), or null for a modal sheet. */
function anchorOf(d: Dialog): HTMLElement | null {
  if (anchor.key !== d.key) {
    // Menus, and a popup or dialog of the field's own that the page opened as
    // the user typed in, focused, or clicked it (a role=dialog suggestion list,
    // a date picker): keys go on in the field, so focus stays there.
    const f = typingField();
    const el = f && (/^menu:/.test(d.key) || ((/^pop:/.test(d.key) || Date.now() - (touchedAt.get(f) ?? 0) < 3000) && tiedTo(d, f))) ? f : null;
    anchor = { key: d.key, el, ref: el?.dataset.ref ?? null };
  }
  // A re-render may have replaced the field: follow the one for the same page element.
  if (anchor.el && !anchor.el.isConnected && anchor.ref) {
    const root = document.querySelector("sift-root")?.shadowRoot;
    const sel = `input[data-ref="${CSS.escape(anchor.ref)}"], textarea[data-ref="${CSS.escape(anchor.ref)}"]`;
    anchor.el = root?.querySelector<HTMLElement>(sel) ?? anchor.el;
  }
  return anchor.el?.isConnected ? anchor.el : null;
}

/** The Sift field the shown suggestion list belongs to, if one is shown. */
export function suggestAnchor(): HTMLElement | null {
  const root = document.querySelector("sift-root")?.shadowRoot;
  return root?.querySelector(".sheet.suggest") && anchor.el?.isConnected ? anchor.el : null;
}

function DialogView({ page }: { page: Page }) {
  const d = page.dialog!;
  const box = useRef<HTMLDivElement>(null);
  const field = anchorOf(d);
  const started = useRef<{ key: string; el: HTMLElement | null }>({ key: "", el: null });
  useEffect(() => {
    if (anchor.el) return;
    // Where the page put focus in its dialog (a session warning's "Stay signed in"), as on the original.
    const own = d.focus ? box.current?.querySelector<HTMLElement>(`[data-ref="${CSS.escape(d.focus)}"]`) : null;
    if (started.current.key === d.key) {
      // The page named it after the sheet opened: move there unless the user moved on.
      const a = (box.current?.getRootNode() as ShadowRoot | undefined)?.activeElement;
      if (own && (a === started.current.el || a === box.current)) own.focus();
      return;
    }
    // A sheet that opens on a field to type in (a location picker, a search) starts there.
    const ctls = Array.from(box.current?.querySelectorAll<HTMLElement>("button, a, input, select, textarea") ?? []).filter((c) => !c.closest(".sheet-head"));
    const first = ctls[0];
    // A site's search panel starts in its search box, even under a link or two (Infobae's "powered by").
    const search = ctls.find((c) => c.matches("input[type=search]") || (c.matches("input:not([type]), input[type=text]") && /search|busca|recherche|suche|pesquis|cerca/i.test(`${c.getAttribute("placeholder") ?? ""} ${c.getAttribute("aria-label") ?? ""}`)));
    const typing = search ?? (first?.matches("input:not([type]), input[type=text], input[type=search]") ? first : null);
    const el = own ?? typing ?? box.current?.querySelector<HTMLElement>("button, a, input, select, textarea");
    started.current = { key: d.key, el: el ?? null };
    el?.focus();
  }, [d.key, d.focus]);
  const name = d.title || firstLine(d.blocks) || page.title;
  if (field) {
    const r = field.getBoundingClientRect();
    const top = Math.round(r.bottom + 4);
    // A field near the bottom of the window (the last one on a short page) gets its list above it.
    const up = innerHeight - top - 16 < 200 && r.top > innerHeight - r.bottom;
    const place = up ? { bottom: Math.round(innerHeight - r.top + 4) + "px", maxHeight: Math.max(160, r.top - 20) + "px" } : { top: top + "px", maxHeight: Math.max(160, innerHeight - top - 16) + "px" };
    return (
      <div
        class="sheet suggest"
        role="group"
        aria-label={d.title || t("suggestions")}
        ref={box}
        style={{ ...place, left: Math.round(r.left) + "px", width: Math.round(Math.max(r.width, 240)) + "px" }}
      >
        <Blocks blocks={d.blocks} />
        {/* The page's own close control, when the list has one and Sift shows it nowhere else. */}
        {d.close && !JSON.stringify(d.blocks).includes(`"ref":"${d.close.ref}"`) && (
          <button type="button" class="btn quiet" onClick={() => H.closeDialog(d.key, d.close?.ref, d.ref)}>{t("close")}</button>
        )}
      </div>
    );
  }
  // A page modal with no close of its own gets no Close here either: its own choices answer it.
  return (
    <div class="layer" onClick={(e) => e.target === e.currentTarget && !d.blocking && H.closeDialog(d.key, d.close?.ref, d.ref)}>
      {/* tabIndex: a click on the sheet's text keeps focus in the sheet. */}
      <div class="sheet" role={d.role ?? "dialog"} aria-modal="true" aria-label={name} aria-describedby={d.desc ? "sift-dialog-desc" : undefined} ref={box} tabIndex={-1}>
        <div class="sheet-head">
          {d.title ? <h2>{d.title}</h2> : <span />}
          {!d.blocking && <button type="button" class="btn quiet" onClick={() => H.closeDialog(d.key, d.close?.ref, d.ref)}>{t("close")}</button>}
        </div>
        {/* The page's description of an alert, said with its name (hidden: the sheet shows it already). */}
        {d.desc && <div id="sift-dialog-desc" hidden>{d.desc}</div>}
        <Blocks blocks={withoutTitle(d.blocks, d.title)} />
      </div>
    </div>
  );
}

export function Toggle() {
  const on = store.mode === "sift";
  return (
    <button
      type="button"
      class="toggle"
      role="switch"
      aria-checked={on ? "true" : "false"}
      aria-label={t("siftView")}
      title={(on ? t("toOriginal") : t("toSift")) + " (Alt+Shift+S)"}
      // Only the user's own click or key: a page script must not switch Sift off.
      onClick={(e) => e.isTrusted && H.toggle()}
    >
      <span aria-hidden="true">{t("sift")}</span>
      <span class="track" aria-hidden="true"><span class="knob" /></span>
    </button>
  );
}

/**
 * The top bar sticks only while it is short next to the screen: at 200% zoom
 * or on a phone it wraps to rows that would cover a quarter of the view, so
 * there it scrolls away with the page. --bar-h tells focus and jumps where
 * content stops being hidden under it.
 */
let barEl: HTMLElement | null = null;
let barObs: ResizeObserver | null = null;
function fitBar() {
  const bar = barEl;
  if (!bar?.isConnected) return;
  // The controls' rows, not a notice that shows for a while under them.
  const rows = (bar.firstElementChild as HTMLElement | null)?.offsetHeight ?? bar.offsetHeight;
  const flat = rows > innerHeight / 8;
  if (flat !== bar.hasAttribute("data-flat")) bar.toggleAttribute("data-flat", flat);
  // A flat bar's notice stays at the top of the window: focus and jumps stop below it.
  const notice = flat ? bar.querySelector<HTMLElement>(".bar-notice")?.offsetHeight ?? 0 : 0;
  bar.parentElement?.style.setProperty("--bar-h", flat ? notice + "px" : bar.offsetHeight + "px");
  bar.style.setProperty("--bar-rows", rows + "px");
}
/** The notice shows or changes size: where focus stops changes with it. */
function watchNotice(el: HTMLElement | null) {
  if (el) barObs?.observe(el);
  fitBar();
}
function watchBar(el: HTMLElement | null) {
  if (el === barEl) return;
  barObs?.disconnect();
  barEl = el;
  if (!el) return;
  if (!barObs) addEventListener("resize", fitBar, { passive: true });
  barObs = new ResizeObserver(fitBar);
  barObs.observe(el);
}

export function App() {
  const page = store.page;
  if (store.mode === "original") return <div class="sift off" lang={page?.lang || undefined} dir={dirOf(page?.lang)}><Toggle /></div>;
  const firstH1 = page?.blocks.slice(0, 6).find((b) => b.t === "h" && b.level === 1) as Extract<Block, { t: "h" }> | undefined;
  const showTitle = page && page.title && !(firstH1 && firstH1.text === page.title);
  const dialog = page?.dialog && !store.dismissed.has(page.dialog.key) && !store.pageModal ? page.dialog : undefined;
  // A modal sheet is open: what is behind it is out of reach, as its aria-modal says.
  // The live region and the switch stay usable.
  const behind = store.menuOpen || (!!dialog && !anchorOf(dialog));
  return (
    <div class="sift" lang={page?.lang || undefined} dir={dirOf(page?.lang)}>
      <button type="button" class="skip" inert={behind} onClick={(e) => (e.currentTarget.getRootNode() as ShadowRoot).getElementById("sift-main")?.focus()}>
        {t("skip")}
      </button>
      <header class="bar" inert={behind} ref={watchBar}>
        <div class="bar-in">
          <span class="site">{page?.site ?? location.hostname}</span>
          {page?.search && <SearchBox f={page.search} />}
          {page?.nav && page.nav.length > 0 && (
            <button type="button" class="btn quiet" aria-haspopup="dialog" onClick={() => H.menu(true)}>{t("menu")}</button>
          )}
          {page?.top && page.top.length > 0 && <div class="top">{page.top.map((a) => <Btn key={a.key} a={a} />)}</div>}
        </div>
        {/* In the sticky bar, so it shows wherever the user is (fixed at the top of the window when the bar
            scrolls away); read out through the one live region below. A toast's buttons (Undo) come with it. */}
        {store.notice && (
          <div class="bar-notice" ref={watchNotice}>
            <p class="notice warn">
              {store.notice}
              {store.noticeActions.map((a) => <Btn key={a.key} a={{ ...a, kind: "quiet" }} />)}
            </p>
          </div>
        )}
      </header>
      <main id="sift-main" tabIndex={-1} inert={behind}>
        {!page || (store.booting && !page.blocks.length) ? (
          <p class="loading" role="status">{t("loading")}</p>
        ) : (
          <>
            {showTitle && <h1>{page.title}</h1>}
            {/* One component with or without the h1: switching components would remount the whole page and lose the reader's place. */}
            <FirstH1Blocks blocks={page.blocks} h1={firstH1} />
            {!page.blocks.length && !page.partial && <p class="muted">{t("nothing")}</p>}
          </>
        )}
      </main>
      <div class="sr" role="status" aria-live="polite">{store.announce}</div>
      {store.menuOpen && page && <Menu page={page} />}
      {dialog && page && <DialogView page={page} />}
      <Toggle />
    </div>
  );
}

/** The page's blocks, with its own first h1 (if any) rendered as Sift's h1. */
function FirstH1Blocks({ blocks, h1 }: { blocks: Block[]; h1?: Extract<Block, { t: "h" }> }) {
  return (
    <>
      {blocks.map((b) =>
        b === h1 ? <h1 key={b.key}>{h1.href ? <A href={h1.href} refId={h1.ref}>{h1.text}</A> : h1.text}</h1> : <BlockView key={b.key} b={b} />,
      )}
    </>
  );
}

export { changed };
