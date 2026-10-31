// Amazon: search results, product pages, and the cart. Search selectors were
// verified on a live page (2026-10-24); product and cart selectors use
// Amazon's long-standing element ids. Anything not found falls back to the
// generic extractor, so a changed page degrades instead of breaking.

import type { Action, Block, Field, Inline, Item, Page } from "../model";
import { refOf } from "../registry";
import { absUrl, clean, imgSrc, textIn, visible } from "../dom";
import { Out, extractGeneric, inlineOf, newCtx, toAction, toField, walk } from "../extract/generic";
import { setLang, t } from "../i18n";
import type { Adapter } from "./index";

const q = <T extends Element = Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const qa = <T extends Element = Element>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const txt = (sel: string, root: ParentNode = document) => clean(q(sel, root)?.textContent);

function search(): Field | undefined {
  const input = q<HTMLInputElement>("#twotabsearchtextbox, input[name=field-keywords]");
  const f = input ? toField(input) : null;
  if (!input || !f) return undefined;
  f.kind = "search";
  f.label = clean(input.getAttribute("aria-label")) || t("search");
  f.placeholder = clean(input.placeholder) || f.label;
  const btn = q("#nav-search-submit-button");
  if (btn) f.submit = refOf(btn);
  return f;
}

function top(): Action[] {
  const out: Action[] = [];
  // Labels in the page's own words ("Cart", "Carrito", "Returns & Orders").
  const cart = q<HTMLAnchorElement>("#nav-cart");
  if (cart) {
    const a = toAction(cart, txt("#nav-cart-text-container") || clean(cart.getAttribute("aria-label")) || "Cart");
    const n = txt("#nav-cart-count");
    if (n) a.badge = n;
    out.push(a);
  }
  // The sign-in link itself: some pages wrap it in a div of that id, which a click does nothing on.
  const acct = q("#nav-link-accountList a[href], a#nav-link-accountList") ?? q("#nav-link-accountList");
  if (acct) out.push(toAction(acct, clean(q("#nav-link-accountList-nav-line-1")?.textContent) || textIn(acct).split("\n")[0] || "Account"));
  const orders = q("#nav-orders");
  if (orders) out.push(toAction(orders, textIn(orders).replace(/\s*\n\s*/g, " ") || clean(orders.getAttribute("aria-label")) || "Orders"));
  return out;
}

function nav(): Action[] {
  return qa<HTMLAnchorElement>("#nav-xshop a[href], #nav-main a.nav-a[href]")
    .filter((a) => textIn(a))
    .slice(0, 40)
    .map((a) => ({ key: "n:" + refOf(a), label: textIn(a), ref: refOf(a), href: absUrl(a.getAttribute("href")) }));
}

function base(blocks: Block[], title: string): Page {
  return {
    url: location.href,
    title,
    site: "Amazon",
    lang: document.documentElement.lang || "en",
    search: search(),
    nav: nav(),
    top: top(),
    blocks,
    source: "amazon",
  };
}

function isSponsored(el: Element): boolean {
  if (el.closest(".AdHolder")) return true;
  if (q(".puis-sponsored-label-text, [data-csa-c-owner=sponsor], .s-sponsored-label-info-icon", el)) return true;
  if (qa("a[href]", el).some((a) => /aax-[\w-]+\.amazon\.|\/sspa\/click/.test((a as HTMLAnchorElement).href))) return true;
  return qa("span", el).slice(0, 80).some((s) => s.childElementCount === 0 && /^(sponsored|patrocinado)$/i.test(clean(s.textContent)));
}

// ---------- search ----------

function resultItem(card: Element): Item | null {
  const titleA = q<HTMLAnchorElement>("[data-cy=title-recipe] a:has(h2), h2 a, a:has(h2)", card);
  const h2 = q("[data-cy=title-recipe] h2, h2", card);
  if (!h2) return null;
  let title = clean(h2.getAttribute("aria-label")) || textIn(h2);
  const diff = clean(q("[data-cy=title-recipe] .title-differentiators", card)?.getAttribute("aria-label"));
  if (diff && !title.includes(diff)) title += " " + diff;
  if (!title) return null;
  const price = txt("[data-cy=price-recipe] .a-price:not(.a-text-price) .a-offscreen", card) || txt(".a-price:not(.a-text-price) .a-offscreen", card);
  const was = txt("[data-cy=price-recipe] .a-price.a-text-price .a-offscreen", card);
  // The earlier price as Amazon names it ("Typical price: $199.99", "List: $59.99").
  const wasText = was ? qa("[data-cy=price-recipe] .a-offscreen", card).map((e) => clean(e.textContent)).find((s) => s !== was && s.includes(was)) ?? "" : "";
  // What the price depends on: "Exclusive Prime price", "You pay $22.09 with coupon".
  const recipe = q("[data-cy=price-recipe]", card);
  const terms = recipe
    ? qa(".a-row", recipe)
        .filter((r) => !r.querySelector(".a-row, .a-price, a[href]") && visible(r))
        .map((r) => textIn(r).replace(/\s*\n\s*/g, " "))
        .filter(Boolean)
    : [];
  const rating = txt("[data-cy=reviews-block] .a-icon-alt, .a-icon-star-small .a-icon-alt", card);
  const reviews = clean(q("[data-cy=reviews-block] a[href*=customerReviews], a[href*='#customerReviews']", card)?.getAttribute("aria-label"));
  const bought = txt("[data-cy=reviews-block] .a-row.a-size-base .a-color-secondary", card);
  // Delivery for everyone: a Prime-only date comes with the one for other shoppers ("Or Non-members get ...").
  const delEl = q("[data-cy=delivery-recipe]", card) as HTMLElement | null;
  const delivery = delEl
    ? delEl.innerText
        .split("\n")
        .map((l) => clean(l))
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ")
    : "";
  const badge = txt("[data-component-type=s-status-badge-component]", card) || txt(".a-badge-text", card);
  const img = q<HTMLImageElement>("[data-cy=image-container] img.s-image, img.s-image", card);
  // Other sellers' offers ("More Buying Choices $183.44 (7+ used & new offers)").
  const offers = textIn(q("[data-cy=secondary-offer-recipe]", card) ?? card.ownerDocument.createElement("i"));
  const meta = [
    price ? price + (was && was !== price ? ` (${wasText || was})` : "") : "",
    ...terms,
    rating ? rating.replace(/ out of 5 stars/, "★").replace(/ de 5 estrellas/, "★") + (reviews ? ` · ${reviews}` : "") : "",
    bought,
    delivery,
    offers,
  ].filter(Boolean);
  const actions: Action[] = [];
  // No price shown: Amazon's "Click to see price" link is how to get it.
  const seePrice = price ? null : q<HTMLAnchorElement>("[data-cy=price-recipe] a[href]", card);
  if (seePrice && textIn(seePrice)) actions.push(toAction(seePrice, textIn(seePrice)));
  const atc = q("[data-cy=add-to-cart] input[name='submit.addToCart'], [data-cy=add-to-cart] button", card);
  if (atc && visible(atc)) actions.push({ ...toAction(atc, clean(atc.getAttribute("aria-label")) || "Add to cart"), kind: "primary" });
  return {
    key: "i:" + refOf(card),
    title,
    href: titleA ? absUrl(titleA.getAttribute("href")) : undefined,
    ref: titleA ? refOf(titleA) : undefined,
    image: img ? { src: imgSrc(img), alt: "" } : undefined,
    meta,
    badge: badge || undefined,
    context: badge || undefined,
    actions: actions.length ? actions : undefined,
  };
}

const GROUP_SEL = "#s-refinements > div > div[id], #s-refinements [role=group]";
const HEAD_SEL = "[role=heading], .sf-refinement-heading, [id$='-title']";

/** A filter link's name. "4 Stars & Up" keeps its star count, which sits in hidden icon text. */
function filterLabel(a: Element): string {
  const shown = textIn(a);
  const icon = clean(q(".a-icon-alt", a)?.textContent);
  return icon && !shown.includes(icon) ? `${icon} ${shown}`.trim() : shown;
}

/**
 * Filters: each group a folded list of filter links. One refinement box can hold
 * several groups (Price, then Deals & Discounts), so every heading starts a group;
 * the price range sliders stay as fields.
 */
function filterGroups(): Block[] {
  const out: Block[] = [];
  for (const g of qa(GROUP_SEL)) {
    if (g.parentElement?.closest(GROUP_SEL)) continue;
    // Older layouts name a group only in bold text; a price label ("$1") is not a name.
    const named =
      clean(document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent) ||
      (qa(".a-text-bold, .puis-bold-weight-text", g).map((e) => textIn(e)).find((x) => /\p{L}/u.test(x)) ?? "");
    let cur = { key: refOf(g), title: named, links: [] as Inline[][], fields: [] as Field[], form: undefined as Element | undefined };
    const flush = () => {
      if (!cur.title || (!cur.links.length && !cur.fields.length)) return;
      const body: Block[] = [];
      if (cur.fields.length) {
        const go = cur.form ? qa("input[type=submit], button", cur.form).filter((b) => visible(b)).map((b) => toAction(b)) : [];
        body.push({ t: "form", key: "ff:" + cur.key, ref: cur.form ? refOf(cur.form) : undefined, fields: cur.fields, actions: go });
      }
      if (cur.links.length) body.push({ t: "ul", key: "fl:" + cur.key, items: cur.links.slice(0, 30) });
      // Under the Filters heading (h2), each group is an h3.
      out.push({ t: "section", key: "fg:" + cur.key, title: cur.title, collapsed: true, blocks: body, level: 3 });
    };
    for (const el of qa(`${HEAD_SEL}, li a[href], input[type=range]`, g)) {
      if (el.matches(HEAD_SEL)) {
        const text = textIn(el);
        // The group's own heading only names it; a later heading starts a new group.
        if (!text || el.closest("a")) continue;
        if (cur.links.length || cur.fields.length) {
          flush();
          cur = { key: refOf(el), title: text, links: [], fields: [], form: undefined };
        } else if (!cur.title || cur.title === named) cur.title = text;
      } else if (el.localName === "a") {
        const label = filterLabel(el);
        if (label && visible(el)) cur.links.push([{ a: label, href: absUrl(el.getAttribute("href")), ref: refOf(el) }]);
      } else if (visible(el)) {
        const f = toField(el);
        if (!f) continue;
        // The slider moves through steps; its text value ("$30") is what people read.
        const now = clean(el.getAttribute("aria-valuetext"));
        if (now) f.label = `${f.label}: ${now}`;
        cur.fields.push(f);
        cur.form ??= el.closest("form") ?? undefined;
      }
    }
    flush();
  }
  return out;
}

function results(): Page | null {
  const slot = q(".s-main-slot");
  if (!slot) return null;
  const blocks: Block[] = [];
  // The count ("1-16 of over 50,000 results for …") sits in the breadcrumb's heading or a section of the info bar.
  const infoEl = qa(".s-breadcrumb h2, .s-breadcrumb .a-section, [data-component-type=s-result-info-bar] .a-section").find((s) => /\d/.test(textIn(s)));
  const info = infoEl ? textIn(infoEl).replace(/\s*(Sort by|Ordenar por).*$/i, "") : "";
  const query = (q<HTMLInputElement>("#twotabsearchtextbox")?.value ?? "").trim();
  // Amazon's sort is a native select; drawn any other way, it is left out rather than breaking the page.
  const sort = q<HTMLSelectElement>("select#s-result-sort-select");
  const sf = sort ? toField(sort) : null;
  if (sort && sf) {
    sf.label = (clean(sort.getAttribute("aria-label")) || clean(q("label[for=s-result-sort-select]")?.textContent) || sf.label || "Sort by").replace(/:$/, "");
    blocks.push({ t: "form", key: "sort", fields: [sf], actions: [] });
  }
  const groups = filterGroups();
  if (groups.length) blocks.push({ t: "section", key: "filters", title: t("filters"), collapsed: true, blocks: groups });

  const items: Item[] = [];
  let sponsored = 0;
  for (const card of qa("div.s-main-slot > div[data-component-type=s-search-result]")) {
    if (!visible(card)) continue;
    if (isSponsored(card)) {
      sponsored++;
      continue;
    }
    const it = resultItem(card);
    if (it) items.push(it);
  }
  // Results Sift cannot read (renamed cards or titles) must not leave a page of only "Sort by":
  // the generic extractor shows them instead.
  if (!items.length && !sponsored && slot.querySelector("h2, a[href*='/dp/']")) return null;
  // Amazon titles are long keyword lists: the one-line rewrite keeps the brand, model and
  // identifying numbers (see LINES_RULES) and drops the rest. The count heads the list, so
  // heading navigation reaches the results.
  if (items.length) blocks.push({ t: "items", key: "results", title: info || t("results"), items, thumbs: true, rewrite: "oneliner" });
  else if (info) blocks.push({ t: "p", key: "info", content: [info], small: true });

  const pag = q(".s-pagination-strip");
  if (pag) {
    // Previous, the numbered pages and Next, as links in one compact row. The current
    // page is a link marked current (aria-current="page"), not a pressed button, and
    // the gap before the last page ("…") stays.
    const acts: Action[] = [];
    let gap = false;
    for (const el of qa(".s-pagination-item", pag)) {
      if (el.classList.contains("s-pagination-ellipsis")) {
        gap = true;
        continue;
      }
      const label = textIn(el);
      if (!label || !visible(el)) continue;
      const a = toAction(el, (gap ? "… " : "") + label);
      gap = false;
      a.kind = "quiet";
      if (el.classList.contains("s-pagination-selected") || el.getAttribute("aria-current") === "page") {
        a.pressed = true;
        a.href = location.href;
      } else if (el.classList.contains("s-pagination-disabled") || el.getAttribute("aria-disabled") === "true") a.disabled = true;
      acts.push(a);
    }
    // A navigation landmark, as on the page (role=navigation, aria-label="pagination").
    if (acts.length) blocks.push({ t: "actions", key: "pages", actions: acts, nav: clean(pag.closest("[role=navigation], nav")?.getAttribute("aria-label")) || t("pagination") });
  }
  return base(blocks, query ? `${t("search")}: ${query}` : "Amazon");
}

// ---------- product ----------

function variantBlocks(): Block[] {
  const out: Block[] = [];
  // Native dropdown variations.
  for (const sel of qa<HTMLSelectElement>("#twister select, select[name^='dropdown_selected_'], select[id^='native_dropdown_selected_']")) {
    if (!sel.isConnected) continue;
    const f = toField(sel);
    if (f) {
      f.label = clean(q(`label[for='${sel.id}']`)?.textContent) || f.label || "Option";
      out.push({ t: "form", key: "vs:" + refOf(sel), fields: [f], actions: [] });
    }
  }
  // Button and swatch variations: one row of choices per dimension.
  const rows = qa("#twister .a-section[id^='variation_'], [id^='inline-twister-row-'], #twister-plus-inline-twister > div[id^='inline-twister-row']");
  for (const row of rows) {
    const label = clean(q(".a-form-label, [id^='inline-twister-dim-title'] .a-text-bold, .inline-twister-dim-title-value-truncate-expanded", row)?.textContent).replace(/:$/, "");
    const current = clean(q(".selection, [id^='inline-twister-expanded-dimension-text']", row)?.textContent);
    const choices = qa("li[data-asin], li[data-defaultasin], li.swatchAvailable, li.swatchSelect, li[id^='color_name_'], li[id^='size_name_']", row);
    const actions: Action[] = [];
    for (const li of choices) {
      const btn = q("button, input[type=submit], a, [role=radio]", li) ?? li;
      const name =
        clean(li.getAttribute("title"))?.replace(/^(Click to select|Haz clic para seleccionar)\s*/i, "") ||
        clean(q("img", li)?.getAttribute("alt")) ||
        textIn(li).split("\n")[0];
      if (!name) continue;
      const a = toAction(btn, name.slice(0, 60));
      a.pressed = li.classList.contains("swatchSelect") || li.classList.contains("a-button-selected") || btn.getAttribute("aria-checked") === "true" || q(".a-button-selected", li) !== null;
      a.disabled = li.classList.contains("swatchUnavailable") || undefined;
      a.kind = "quiet";
      actions.push(a);
      if (actions.length >= 30) break;
    }
    if (actions.length) {
      if (label || current) out.push({ t: "p", key: "vl:" + refOf(row), content: [{ b: label || "Option" }, current ? `: ${current}` : ""] });
      out.push({ t: "actions", key: "va:" + refOf(row), actions });
    }
  }
  return out;
}

function facts(): Block[] {
  const rows: { k: string; v: any[] }[] = [];
  for (const tr of qa("#productOverview_feature_div tr, #poExpander tr")) {
    const k = txt("td:first-child", tr);
    const v = txt("td:last-child", tr);
    if (k && v && k !== v) rows.push({ k, v: [v] });
  }
  for (const li of qa("#detailBullets_feature_div li")) {
    const [k, ...rest] = textIn(li).split(/\s*:\s*/);
    const v = rest.join(": ").trim();
    if (k && v && k.length < 60) rows.push({ k: clean(k.replace(/[‎‏]/g, "")), v: [v] });
  }
  for (const tr of qa("#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr")) {
    const k = txt("th", tr);
    const v = txt("td", tr);
    if (k && v) rows.push({ k, v: [v] });
  }
  return rows.length ? [{ t: "facts", key: "facts", rows: rows.slice(0, 40) }] : [];
}

function product(): Page | null {
  const titleEl = q("#productTitle, #title");
  if (!titleEl) return null;
  const title = textIn(titleEl);
  const blocks: Block[] = [];
  const img = q<HTMLImageElement>("#landingImage, #imgTagWrapperId img, #main-image-container img");
  if (img) {
    const src = img.getAttribute("data-old-hires") || imgSrc(img);
    if (src) blocks.push({ t: "img", key: "pimg", img: { src, alt: clean(img.alt) || title } });
  }
  blocks.push({ t: "h", key: "ptitle", level: 1, text: title });
  const brand = q<HTMLAnchorElement>("#bylineInfo");
  const rating = clean(q("#acrPopover")?.getAttribute("title")) || txt("#averageCustomerReviews .a-icon-alt");
  const reviews = txt("#acrCustomerReviewText");
  const line: any[] = [];
  if (brand) line.push({ a: textIn(brand), href: absUrl(brand.getAttribute("href")), ref: refOf(brand) });
  if (rating) line.push((line.length ? " · " : "") + rating + (reviews ? ` (${reviews})` : ""));
  if (line.length) blocks.push({ t: "p", key: "pline", content: line, small: true });

  const price =
    txt("#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen") ||
    txt("#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen") ||
    txt("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen") ||
    txt("#apex_desktop .a-price .a-offscreen") ||
    txt("#price_inside_buybox, #priceblock_ourprice, #priceblock_dealprice");
  const listPrice = txt("#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen");
  const avail = txt("#availability");
  const delivery = clean((q("#mir-layout-DELIVERY_BLOCK, #deliveryBlockMessage") as HTMLElement | null)?.innerText.split("\n").slice(0, 2).join(" "));
  const seller = txt("#merchantInfoFeature_feature_div .offer-display-feature-text, #sellerProfileTriggerId");
  // The list price as Amazon names it ("List Price: $59.99").
  const listText = listPrice ? qa("#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen, #corePriceDisplay_desktop_feature_div .basisPrice .aok-offscreen").map((e) => clean(e.textContent)).find((x) => x !== listPrice && x.includes(listPrice)) ?? "" : "";
  const rows = [
    price && { k: t("price"), v: [price + (listPrice ? ` (${listText || "list " + listPrice})` : "")] },
    avail && { k: t("availability"), v: [avail] },
    delivery && { k: t("delivery"), v: [delivery] },
    seller && { k: t("soldBy"), v: [seller] },
  ].filter(Boolean) as { k: string; v: any[] }[];
  if (rows.length) blocks.push({ t: "facts", key: "buy-facts", rows });

  blocks.push(...variantBlocks());

  // Buy box: quantity, Add to Cart, Buy Now.
  const fields: Field[] = [];
  const qty = q<HTMLSelectElement>("#quantity, select[name=quantity]");
  const qf = qty && qty.isConnected ? toField(qty) : null;
  if (qty && qf) {
    qf.label = (clean(q(`label[for='${qty.id}']`)?.textContent) || qf.label || "Quantity").replace(/:$/, "");
    fields.push(qf);
  }
  const actions: Action[] = [];
  const atc = q("#add-to-cart-button");
  if (atc) actions.push({ ...toAction(atc, clean(atc.getAttribute("value")) || textIn(q("#submit\\.add-to-cart-announce") ?? atc) || "Add to Cart"), kind: "primary" });
  const buy = q("#buy-now-button");
  if (buy) actions.push({ ...toAction(buy, textIn(q("#submit\\.buy-now-announce") ?? buy) || "Buy Now"), kind: "primary" });
  if (fields.length || actions.length) blocks.push({ t: "form", key: "buybox", ref: q("#addToCart") ? refOf(q("#addToCart")!) : undefined, fields, actions });
  // No price and no way to buy means the page changed under these selectors, unless it says the item is unavailable.
  if (!price && !actions.length && !/unavailable|out of stock|no disponible|agotado|nicht verfügbar|indisponible/i.test(avail)) return null;

  // About this item: Amazon's own short feature list, shown whole. It is already a
  // list of points, and a page with controls gets no short version.
  const bullets = qa("#feature-bullets li span.a-list-item, #productFactsDesktopExpander li span.a-list-item").map((s) => textIn(s)).filter(Boolean);
  if (bullets.length) {
    blocks.push({ t: "h", key: "about-h", level: 2, text: txt("#feature-bullets h1, #feature-bullets h2, #productFactsDesktopExpander h3") || "About this item" });
    blocks.push({ t: "ul", key: "about-list", items: bullets.map((b) => [b]) });
  }
  // Section names in the page's own words when it shows them.
  const say = txt("#product-summary p, [data-hook=cr-insights-widget-summary] p");
  if (say) blocks.push({ t: "section", key: "say", title: txt("#product-summary h3, #product-summary h2, [data-hook=cr-insights-widget-heading]") || t("customersSay"), blocks: [{ t: "p", key: "say-p", content: [say] }] });

  const f = facts();
  if (f.length) blocks.push({ t: "section", key: "details", title: txt("#detailBulletsWrapper_feature_div h2, #prodDetails h2, #productDetails_feature_div h2") || t("productDetails"), collapsed: true, blocks: f });
  const desc = q("#productDescription");
  if (desc && textIn(desc)) {
    const out = new Out();
    walk(desc, out, newCtx({ inArticle: true }));
    blocks.push({ t: "section", key: "desc", title: txt("#productDescription_feature_div h2, #productDescription_feature_div h3") || t("description"), collapsed: true, blocks: out.done() });
  }
  const reviewEls = qa("#cm-cr-dp-review-list [data-hook=review], [data-hook=review]").slice(0, 10);
  if (reviewEls.length) {
    const items: Item[] = reviewEls.map((r) => ({
      key: "rv:" + refOf(r),
      title: txt("[data-hook=review-title] span:not(.a-icon-alt), [data-hook=review-title]", r) || "Review",
      lead: txt("[data-hook=review-star-rating] .a-icon-alt, [data-hook=cmps-review-star-rating] .a-icon-alt", r).replace(/ out of 5 stars/, "★"),
      text: txt("[data-hook=review-body]", r).slice(0, 400) || undefined,
      meta: [txt(".a-profile-name", r), txt("[data-hook=review-date]", r)].filter(Boolean),
    }));
    const head = txt("#cm-cr-dp-review-header h3, [data-hook=dp-local-reviews-header] h3, #reviewsMedley h2, #customer-reviews_feature_div h2");
    blocks.push({ t: "section", key: "reviews", title: head || t("reviews"), collapsed: true, blocks: [{ t: "items", key: "rv-list", items }] });
  }
  return base(blocks, title);
}

// ---------- cart ----------

function cart(): Page | null {
  const active = q("#sc-active-cart, [data-name='Active Items'], #activeCartViewForm");
  if (!active) return null;
  const blocks: Block[] = [];
  const heading = txt("#sc-active-cart h1, #sc-active-cart h2, .sc-cart-header h1, h1") || "Shopping Cart";
  blocks.push({ t: "h", key: "cart-h", level: 1, text: heading });
  const empty = q(".sc-your-amazon-cart-is-empty, #sc-empty-cart");
  if (empty && visible(empty)) blocks.push({ t: "p", key: "empty", content: inlineOf(empty) });

  const lines = qa("[data-name='Active Items'] .sc-list-item[data-asin], #sc-active-cart .sc-list-item[data-asin], [data-name='Active Items'] div[data-asin][data-itemid]").filter(
    (el, i, arr) => visible(el) && !arr.some((o) => o !== el && o.contains(el)),
  );
  const items: Item[] = [];
  for (const line of lines) {
    const titleEl = q(".sc-product-title .a-truncate-full, .sc-product-title, .sc-item-product-title-cont a", line);
    const title = titleEl ? textIn(titleEl) : "";
    if (!title) continue;
    const link = q<HTMLAnchorElement>("a.sc-product-link, .sc-item-product-title-cont a, a[href*='/dp/'], a[href*='/gp/product/']", line);
    const price = txt(".sc-product-price, .apex-price-to-pay-value .a-offscreen, .sc-item-price-block .a-offscreen", line);
    const stock = txt(".sc-product-availability", line);
    const qtyVal = txt("[data-a-selector=value], .sc-quantity-textfield, select[name=quantity] option:checked", line) || clean(q<HTMLInputElement>("input[name=quantityBox]", line)?.value);
    const img = q<HTMLImageElement>("img.sc-product-image, img", line);
    const actions: Action[] = [];
    // querySelector returns the first match in document order, which would be the
    // wrapper; the button inside it is what Amazon listens to.
    const dec = q("[data-a-selector=decrement] button", line) ?? q("[data-a-selector=decrement]", line);
    const inc = q("[data-a-selector=increment] button", line) ?? q("[data-a-selector=increment]", line);
    if (dec && visible(dec)) actions.push(toAction(dec, clean(dec.getAttribute("aria-label")) || "Remove one"));
    if (inc && visible(inc)) actions.push(toAction(inc, clean(inc.getAttribute("aria-label")) || "Add one"));
    for (const [sel, label] of [
      ["[data-action=delete] input, input[value=Delete], input[data-action=delete]", "Delete"],
      ["[data-action=save-for-later] input, input[value='Save for later']", "Save for later"],
    ] as const) {
      const b = q(sel, line);
      if (b) actions.push({ ...toAction(b, clean(b.getAttribute("value")) || clean(b.getAttribute("aria-label")) || label), kind: label === "Delete" ? "danger" : "quiet" });
    }
    const it: Item = {
      key: "cl:" + refOf(line),
      title,
      href: link ? absUrl(link.getAttribute("href")) : undefined,
      ref: link ? refOf(link) : undefined,
      image: img ? { src: imgSrc(img), alt: "" } : undefined,
      meta: [price, qtyVal ? `Qty ${qtyVal}` : "", stock].filter(Boolean),
      actions,
    };
    items.push(it);
    // Older carts use a native quantity select: show it as a field.
    const sel = q<HTMLSelectElement>("select[name=quantity]", line);
    const sf = sel && visible(sel) ? toField(sel) : null;
    if (sf) {
      sf.label = `${sf.label && sf.label !== sf.name ? sf.label.replace(/:$/, "") : "Quantity"}: ${title.slice(0, 40)}`;
      (it as any).qtyField = sf;
    }
  }
  // Lines on the page that none of the selectors above could read: the generic extractor shows them.
  if (!items.length && qa("[data-asin]", active).some((e) => e.getAttribute("data-asin") && visible(e))) return null;
  if (items.length) blocks.push({ t: "items", key: "cart-lines", items, thumbs: true });
  const qtyFields = items.map((i) => (i as any).qtyField).filter(Boolean) as Field[];
  if (qtyFields.length) blocks.push({ t: "form", key: "cart-qty", fields: qtyFields, actions: [] });

  const subtotalLabel = txt("#sc-subtotal-label-activecart, #sc-subtotal-label-buybox");
  const subtotal = txt("#sc-subtotal-amount-activecart, #sc-subtotal-amount-buybox");
  if (subtotal) blocks.push({ t: "facts", key: "subtotal", rows: [{ k: subtotalLabel || "Subtotal", v: [subtotal] }] });
  const ptc = q("input[name=proceedToRetailCheckout], #sc-buy-box-ptc-button input, #sc-buy-box-ptc-button button");
  if (ptc) blocks.push({ t: "actions", key: "checkout", actions: [{ ...toAction(ptc, clean(ptc.getAttribute("value")) || textIn(q("#sc-buy-box-ptc-button") ?? ptc) || "Proceed to checkout"), kind: "primary" }] });

  const saved = qa("#sc-saved-cart .sc-list-item[data-asin]").filter((el) => visible(el));
  if (saved.length) {
    const its: Item[] = saved.map((el) => {
      const ti = txt(".sc-product-title .a-truncate-full, .sc-product-title", el);
      const move = q("input[value='Move to cart'], [data-action=move-to-cart] input", el);
      return {
        key: "sv:" + refOf(el),
        title: ti || "Item",
        meta: [txt(".sc-product-price", el)].filter(Boolean),
        actions: move ? [toAction(move, clean(move.getAttribute("value")) || "Move to cart")] : undefined,
      };
    });
    const head = txt("#sc-saved-cart h2, #sc-saved-cart h1, #sc-saved-cart .sc-list-caption");
    blocks.push({ t: "section", key: "saved", title: head || t("savedForLater"), collapsed: true, blocks: [{ t: "items", key: "saved-list", items: its }] });
  }
  return base(blocks, heading);
}

export const amazon: Adapter = {
  name: "amazon",
  match: (u) => /(^|\.)amazon\.(com|ca|co\.uk|de|fr|es|it|com\.mx|com\.br|in|co\.jp|com\.au)$/.test(u.hostname),
  extract(u) {
    setLang(document.documentElement.lang || "en");
    // Whatever goes wrong here, the generic extractor still shows the page.
    try {
      const p = u.pathname;
      let page: Page | null = null;
      // While the HTML of a results page comes in, before its results: only the header, not a full generic read of half a page (perf16).
      if ((p === "/s" || p.startsWith("/s/")) && document.readyState === "loading" && !q(".s-main-slot")) return { ...base([], document.title), partial: true };
      if (p === "/s" || p.startsWith("/s/")) page = results();
      else if (/\/(dp|gp\/product|gp\/aw\/d)\//.test(p)) page = product();
      else if (p.startsWith("/gp/cart") || p.startsWith("/cart")) page = cart();
      if (page && !page.blocks.length) return null;
      if (!page) {
        // Other Amazon pages (checkout, orders, account): generic, with Amazon's header.
        const g = extractGeneric();
        g.search = search() ?? g.search;
        g.top = top();
        g.nav = nav().length ? nav() : g.nav;
        g.source = "amazon-generic";
        return g;
      }
      return page;
    } catch (e) {
      console.warn("sift: amazon adapter failed, using the generic view", e);
      return null;
    }
  },
  quiet: () => qa("#nav-flyout-anchor, .a-popover-preload"),
  contentSel: (u) => (u.pathname === "/s" || u.pathname.startsWith("/s/") ? '[data-component-type="s-search-result"]' : null),
};
