// Gmail: the message list, a conversation, and the compose window.
// Gmail's class names (zA rows, bog subjects, a3s bodies, hP titles) have been
// stable for years; ARIA roles and labels back them up. When the structure is
// not found, the generic extractor takes over.

import type { Action, Block, Field, Item, Page } from "../model";
import { refOf } from "../registry";
import { absUrl, accName, clean, textIn, visible } from "../dom";
import { Out, extractGeneric, newCtx, proseArticle, toAction, toField, walk } from "../extract/generic";
import { setLang, t } from "../i18n";
import type { Adapter } from "./index";

const q = <T extends Element = Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const qa = <T extends Element = Element>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const vis = <T extends Element>(els: T[]) => els.filter((e) => visible(e));

function main(): Element | null {
  return vis(qa("div[role=main], div[data-sift-role=main]")).pop() ?? null;
}

/** A label from a tooltip, without its keyboard shortcut or direction marks: "Discard draft ‪(Ctrl-Shift-D)‬" reads "Discard draft". */
function tipLabel(el: Element): string {
  const s = (el.getAttribute("data-tooltip") || el.getAttribute("aria-label") || "").replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
  return clean(s.replace(/\s*\((ctrl|⌘|cmd|alt|shift|option|control)[^)]*\)\s*$/i, ""));
}

/** A Gmail toolbar button found by its tooltip or label, e.g. "Archive". */
function button(root: ParentNode, ...labels: string[]): Element | null {
  for (const l of labels) {
    const b = vis(qa(`[data-tooltip^="${l}"], [aria-label^="${l}"]`, root).filter((e) => e.getAttribute("role") === "button" || e.localName === "button" || e.localName === "li")).shift();
    if (b) return b;
  }
  return null;
}

function search(): Field | undefined {
  const input = q<HTMLInputElement>("form[role=search] input[name=q], input[name=q][aria-label]");
  const f = input ? toField(input) : null;
  if (!input || !f) return undefined;
  f.kind = "search";
  f.label = clean(input.getAttribute("aria-label")) || t("search");
  f.placeholder = f.label;
  const btn = q("form[role=search] button[aria-label], form[role=search] [role=button][aria-label^='Search']");
  if (btn) f.submit = refOf(btn);
  return f;
}

function nav(): Action[] {
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const a of qa<HTMLAnchorElement>("div[role=navigation] a[href*='#']")) {
    const label = clean(a.getAttribute("aria-label")) || clean(a.getAttribute("title")) || textIn(a);
    const href = absUrl(a.getAttribute("href"));
    if (!label || !href || seen.has(href)) continue;
    seen.add(href);
    out.push({ key: "n:" + refOf(a), label, ref: refOf(a), href });
  }
  return out;
}

function top(): Action[] {
  const compose = vis(qa("[gh=cm], div.T-I.T-I-KE[role=button]")).shift() ?? button(document, "Compose", "Redactar");
  return compose ? [{ ...toAction(compose, textIn(compose) || "Compose"), kind: "primary" }] : [];
}

function base(blocks: Block[], title: string): Page {
  return {
    url: location.href,
    title,
    site: "Gmail",
    lang: document.documentElement.lang || "en",
    search: search(),
    nav: nav(),
    top: top(),
    blocks,
    source: "gmail",
  };
}

// ---------- message list ----------

function row(tr: Element): Item | null {
  const subjectEl = q(".bog, .y6 span:first-child", tr);
  const subject = subjectEl ? textIn(subjectEl) : "";
  const senders = qa(".yX .yW span[email], .yX .yW span[name], .yW .zF, .yW .yP", tr)
    .map((s) => clean(s.getAttribute("name")) || textIn(s))
    .filter(Boolean);
  const lead = [...new Set(senders)].join(", ") || textIn(q(".yX, .yW", tr) ?? tr).split("\n")[0];
  const count = clean(q(".bx0", tr)?.textContent);
  const snippet = clean(q(".y2", tr)?.textContent).replace(/^[\s\-–—]+/, "");
  const dateEl = q(".xW span[title], td.xW span", tr);
  const date = dateEl ? textIn(dateEl) : "";
  const labels = qa(".ar.as .at, .ar.as", tr).map((l) => clean(l.getAttribute("title")) || textIn(l)).filter(Boolean);
  const attach = q(".brd, .aKS, [data-tooltip*=ttach]", tr) ? "📎" : "";
  if (!subject && !snippet) return null;
  const target = q("td.xY.a4W, .xT, .y6", tr) ?? tr;
  const actions: Action[] = [];
  for (const [labelsTry, kind] of [
    [["Archive", "Archivar"], "quiet"],
    [["Delete", "Eliminar"], "danger"],
    [["Mark as read", "Marcar como leído", "Mark as unread", "Marcar como no leído"], "quiet"],
  ] as const) {
    const b = qa("li[data-tooltip], [role=button][data-tooltip]", tr).find((e) => labelsTry.some((l) => (e.getAttribute("data-tooltip") ?? "").startsWith(l)));
    if (b) actions.push({ ...toAction(b, tipLabel(b)), kind });
  }
  return {
    key: "m:" + refOf(tr),
    title: subject || snippet.slice(0, 80),
    ref: refOf(target),
    lead: lead + (count ? ` (${count})` : ""),
    text: snippet || undefined,
    meta: [date, ...labels, attach].filter(Boolean),
    unread: tr.classList.contains("zE"),
    context: [lead, snippet.slice(0, 200)].filter(Boolean).join(" · "),
    actions: actions.length ? actions : undefined,
  };
}

function list(m: Element): Page | null {
  const rows = vis(qa("tr.zA", m));
  const tabs = vis(qa("[role=tab]", m)).filter((tb) => textIn(tb));
  if (!rows.length && !tabs.length) {
    const empty = vis(qa("td.TC, .TC", m)).map((e) => textIn(e)).find(Boolean);
    if (!empty) return null;
  }
  const blocks: Block[] = [];
  if (tabs.length) {
    blocks.push({
      t: "actions",
      key: "tabs",
      actions: tabs.map((tb) => ({ ...toAction(tb, textIn(tb).split("\n")[0]), pressed: tb.getAttribute("aria-selected") === "true", kind: "quiet" as const })),
    });
  }
  const items = rows.map(row).filter(Boolean) as Item[];
  // Message rows Sift cannot read (renamed classes): the generic extractor shows them instead of only the tabs.
  if (!items.length && vis(qa("tr, [role=row]", m)).some((r) => !r.querySelector(".TC") && !r.matches(".TC") && textIn(r).length > 10)) return null;
  if (items.length) blocks.push({ t: "items", key: "mail", items, rewrite: "summary" });
  else {
    const empty = vis(qa("td.TC, .TC", m)).map((e) => textIn(e)).find(Boolean);
    if (empty) blocks.push({ t: "p", key: "empty", content: [empty] });
  }
  const pager: Action[] = [];
  const newer = button(document, "Newer", "Más recientes");
  const older = button(document, "Older", "Más antiguos");
  const range = vis(qa(".Dj, [role=button] .ts")).map((e) => textIn(e)).find(Boolean);
  if (newer && newer.getAttribute("aria-disabled") !== "true") pager.push(toAction(newer, tipLabel(newer) || "Newer"));
  if (older && older.getAttribute("aria-disabled") !== "true") pager.push(toAction(older, tipLabel(older) || "Older"));
  if (range) blocks.push({ t: "p", key: "range", content: [range], small: true });
  if (pager.length) blocks.push({ t: "actions", key: "pager", actions: pager });
  const cur = q("div[role=navigation] .nZ a, div[role=navigation] [aria-current] a");
  const folder = (cur ? textIn(cur) : "") || clean(document.title.split(" - ")[0]).replace(/\s*\(\d+\)$/, "");
  return base(blocks, folder || "Inbox");
}

// ---------- conversation ----------

function body(el: Element): Block[] {
  const out = new Out();
  const ctx = newCtx({
    inArticle: true,
    // Quoted earlier messages and the "..." trimmed content stay folded away.
    drop: (e) => e.matches(".gmail_quote, .yj6qo, .adL > .im, blockquote.gmail_quote, .gmail_signature_prefix"),
  });
  walk(el, out, ctx);
  return out.done();
}

function thread(m: Element): Page | null {
  const subjectEl = vis(qa("h2.hP, h2[data-thread-perm-id]", m)).shift();
  if (!subjectEl) return null;
  const subject = textIn(subjectEl);
  const blocks: Block[] = [];
  const bar: Action[] = [];
  for (const [labels, kind] of [
    [["Back to", "Volver a"], "quiet"],
    [["Archive", "Archivar"], "quiet"],
    [["Delete", "Eliminar"], "danger"],
    [["Mark as unread", "Marcar como no leído"], "quiet"],
    [["Move to", "Mover a"], "quiet"],
  ] as const) {
    const b = button(document, ...labels);
    if (b) bar.push({ ...toAction(b, tipLabel(b) || accName(b)), kind });
  }
  if (bar.length) blocks.push({ t: "actions", key: "toolbar", actions: bar });
  blocks.push({ t: "h", key: "subject", level: 1, text: subject });

  const msgs = vis(qa("div.adn.ads, div.kv, div.kQ, div.h7", m)).filter((e, i, arr) => !arr.some((o) => o !== e && o.contains(e)));
  for (const msg of msgs) {
    const from = q("span.gD", msg);
    const name = from ? clean(from.getAttribute("name")) || textIn(from) : textIn(q(".zF, .yP, .gD", msg) ?? msg).split("\n")[0];
    const email = clean(from?.getAttribute("email"));
    const dateEl = q("span.g3, .g3", msg);
    const date = clean(dateEl?.getAttribute("title")) || (dateEl ? textIn(dateEl) : "");
    const bodyEl = q("div.a3s", msg);
    const head = `${name}${email && email !== name ? ` <${email}>` : ""}${date ? " · " + date : ""}`;
    if (bodyEl && visible(bodyEl)) {
      const to = clean((q(".hb", msg) as HTMLElement | null)?.innerText);
      blocks.push({ t: "h", key: "mh:" + refOf(msg), level: 2, text: name || "Message" });
      blocks.push({ t: "p", key: "mm:" + refOf(msg), content: [head.replace(/^[^<·]+/, "").trim().replace(/^·\s*/, "") + (to ? ` · ${to}` : "")], small: true });
      const bb = body(bodyEl);
      const text = (bodyEl as HTMLElement).innerText ?? "";
      const wc = text.split(/\s+/).filter(Boolean).length;
      // Only running prose may get a short version: a newsletter of links and buttons, or a
      // receipt table, keeps its structure.
      if (wc >= 150) blocks.push({ t: "article", key: "mb:" + refOf(msg), words: wc, blocks: bb, prose: proseArticle(bb) });
      else blocks.push(...bb);
      // Attachments.
      const atts = vis(qa(".aQH .aZo, .aQH span.aV3", msg));
      const links = atts
        .map((a) => {
          const nameEl = q(".aV3", a) ?? a;
          const link = a.closest("a[href]") ?? q("a[href]", a);
          return link ? [{ a: "📎 " + textIn(nameEl), href: absUrl(link.getAttribute("href")), ref: refOf(link) }] : null;
        })
        .filter(Boolean) as any[];
      if (links.length) blocks.push({ t: "ul", key: "att:" + refOf(msg), items: links });
    } else {
      // A folded earlier message: one line, click to open it.
      const snip = clean(q(".iA.g6, .snippet, .y2", msg)?.textContent);
      blocks.push({ t: "items", key: "fold:" + refOf(msg), items: [{ key: "fi:" + refOf(msg), title: snip || "…", lead: name, ref: refOf(msg), meta: [date].filter(Boolean) }] });
    }
  }
  // Reply, reply all, forward.
  const replies: Action[] = [];
  for (const [sel, label] of [
    ["span.ams.bkH, [role=link].ams.bkH", "Reply"],
    ["span.ams.bkI, [role=link].ams.bkI", "Reply all"],
    ["span.ams.bkG, [role=link].ams.bkG", "Forward"],
  ] as const) {
    const b = vis(qa(sel, m)).pop();
    if (b) replies.push({ ...toAction(b, textIn(b) || label), kind: label === "Reply" ? "primary" : "normal" });
  }
  if (replies.length) blocks.push({ t: "actions", key: "replies", actions: replies });
  const inline = editor(m);
  if (inline) blocks.push(inline);
  return base(blocks, subject);
}

// ---------- compose ----------

/** A compose editor (inline reply or compose window) as a Sift form. */
function editor(root: Element): Block | null {
  const bodyEl = vis(qa("div[aria-label='Message Body'][contenteditable], div[contenteditable=true][role=textbox][aria-multiline=true], div.Am[contenteditable]", root)).pop();
  if (!bodyEl) return null;
  const box = bodyEl.closest("div[role=dialog], div.M9, div.AD, td.I5, div.iN") ?? root;
  const fields: Field[] = [];
  for (const input of vis(qa<HTMLInputElement>("input[aria-label*='recipients' i], input[aria-label*='destinatarios' i], input.agP, input[name=to]", box))) {
    const f = toField(input);
    if (f) {
      f.label = clean(input.getAttribute("aria-label")) || "To";
      fields.push(f);
    }
  }
  const subj = q<HTMLInputElement>("input[name=subjectbox]", box);
  const sf = subj && visible(subj) ? toField(subj) : null;
  if (subj && sf) {
    sf.label = clean(subj.getAttribute("aria-label")) || clean(subj.placeholder) || "Subject";
    fields.push(sf);
  }
  const bf = toField(bodyEl);
  if (!bf) return null;
  bf.label = clean(bodyEl.getAttribute("aria-label")) || "Message";
  bf.kind = "editable";
  fields.push(bf);
  const file = q<HTMLInputElement>("input[type=file]", box);
  const ff = file ? toField(file) : null;
  if (ff) {
    // Gmail's own attach button names it ("Attach files").
    const attach = vis(qa("[command=Files], [data-tooltip^='Attach'], [aria-label^='Attach']", box)).shift();
    ff.label = (attach ? tipLabel(attach) : "") || ff.label || "Attach files";
    fields.push(ff);
  }
  const actions: Action[] = [];
  const send = vis(qa("div[role=button][data-tooltip^='Send'], div[role=button][aria-label^='Send'], div[role=button][data-tooltip^='Enviar']", box)).shift();
  if (send) actions.push({ ...toAction(send, textIn(send) || "Send"), kind: "primary" });
  const discard = vis(qa("div[role=button][data-tooltip^='Discard'], div[role=button][aria-label^='Discard'], div[role=button][data-tooltip^='Descartar']", box)).shift();
  if (discard) actions.push({ ...toAction(discard, tipLabel(discard) || "Discard draft"), kind: "danger" });
  // Named as Gmail names it: the window's title, else its Compose button.
  const cm = q("[gh=cm]");
  const name = (box.matches("[role=dialog]") ? clean(q("h2, .aYF", box)?.textContent) : "") || (cm ? textIn(cm) : "") || "Compose";
  return { t: "form", key: "compose:" + refOf(box), title: name, fields, actions };
}

function composeDialog(): Page["dialog"] {
  const box = vis(qa("div[role=dialog]")).find((d) => q("div[aria-label='Message Body'], input[name=subjectbox]", d));
  if (!box) return undefined;
  const form = editor(box);
  if (!form) return undefined;
  const title = clean(q("h2, .aYF", box)?.textContent) || "New message";
  const close = vis(qa("img[aria-label^='Save & close'], img[alt='Close'], [data-tooltip^='Save & close']", box)).shift();
  return { key: "compose:" + refOf(box), title, blocks: [form], close: close ? toAction(close, "Close") : undefined };
}

export const gmail: Adapter = {
  name: "gmail",
  match: (u) => u.hostname === "mail.google.com",
  extract() {
    setLang(document.documentElement.lang || "en");
    // Whatever goes wrong here, the generic extractor still shows the page.
    try {
      const m = main();
      let page = m ? thread(m) ?? list(m) : null;
      if (!page) {
        const g = extractGeneric();
        g.source = "gmail-generic";
        page = g;
      }
      const d = composeDialog();
      if (d) page.dialog = d;
      return page;
    } catch (e) {
      console.warn("sift: gmail adapter failed, using the generic view", e);
      return null;
    }
  },
  quiet: () => qa("div[role=complementary], .aKh, .aj5"),
};
