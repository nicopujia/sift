// The generic extractor: works on any page without site knowledge.
// It walks the rendered DOM in order and emits Sift blocks, dropping page
// furniture (ads, nav, footers, banners, share bars) and keeping content,
// lists of items, and the controls needed to act.

import type { Action, Block, Dialog, Field, FieldKind, Img, Inline, Item, Page } from "../model";
import { blocksText, textOf, wordCount } from "../model";
import { elOf, refOf } from "../registry";
import {
  AD_HOSTS, AD_LABEL, NOISE_TOKEN, SHARE_LABEL, SHARE_MAYBE, SOCIAL_HOSTS,
  accName, clean, hasControl, hostOf, hrefOf, imgSrc, isAd, labelNodes, lang, passNo, shadowRootOf, firstLine, spaceAfter, spaceBefore, textIn, textInRaw, textLines, textPrefix, tlen, tokens, visible, visualTwin,
} from "../dom";
import { glyphName } from "../dom";
import { t } from "../i18n";
import { armCount, enteredField, recentNodes } from "../recent";
import { portalElements } from "../portal";

const SKIP = new Set([
  "script", "style", "noscript", "template", "link", "meta", "head", "title", "svg", "math",
  "source", "track", "param", "map", "area", "base", "datalist", "sift-root",
]);

const INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "font", "i", "kbd",
  "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
  "del", "ins", "label", "img", "svg", "output", "nobr", "tt", "big", "strike", "picture",
]);

const BLOCK_SEL =
  "div,p,ul,ol,li,h1,h2,h3,h4,h5,h6,section,article,table,form,header,footer,nav,aside,figure,blockquote,pre,dl,main,details,hr";
const CONTROL_SEL =
  "input:not([type=hidden]),select,textarea,button,[role=button],[role=checkbox],[role=switch],[role=textbox],[role=combobox],[contenteditable=''],[contenteditable=true]";
/** Working surfaces: maps and app canvases that must stay usable as they are. */
const SURFACE_SEL =
  "[role=application], .leaflet-container, .maplibregl-map, .mapboxgl-map, .ol-viewport, gmp-map, [aria-roledescription=map]";

// A bare "footer" counts only as a whole token or a prefix ("footer-links"), not
// as a component part ("card-footer", "modal-footer", "product-info__footer").
const CHROME_TOKEN =
  /(^|[\s_-])(site-?header|global-?header|mast-?head|navbar|nav-?bar|top-?bar|main-?nav|mega-?menu|site-?nav|menu-?bar|site-?footer|global-?footer|page-?footer|bottom-?bar|edition-?(picker|switcher|notice))($|[\s_-])|(^|\s)footer($|[\s_-])/i;
const CODE_CHROME = /(^|[\s_-])((example|code)-?(header|toolbar)|language-?name|copy-?(button|code)|clipboard-?button)($|[\s_-])/i;
const DISMISS = /^(ok|okay|got it|entendido|aceptar|accept|dismiss|close|cerrar|no,? thanks|no gracias|×|✕)$/i;
const COMMENTS_TOKEN = /(^|[\s_-])(comments?|comentarios|disqus|discussion)($|[\s_-])/i;
const LOGO_TOKEN = /logo|icon|avatar|sprite|badge|emoji|spinner|loader|placeholder|pixel|tracking|1x1|spacer|blank\.gif/i;
/** A story's furniture said in words, alone in its box: its end, a "Continue Reading" over the text shown in full, a call to follow the site. */
const STRAY_LABEL = /^(end of (the )?(article|story)|continue reading|follow us( on [\p{L}\s]{1,30})?)$/iu;
/** Section labels in words that no class name says. */
const BOX_LABEL = /^(you (may|might) (also )?like|more (stories|videos|news)|(don'?t|do not) miss|lo m[aá]s (le[ií]do|visto)|m[aá]s (le[ií]d[oa]s|vist[oa]s)|tendencias|te puede interesar|compart[ií]r?)$/iu;

/** A short title line that names a noise box ("Trending", "Related stories", "Share this"): no digits, a few words. */
function boxLabel(s: string): boolean {
  if (/\d/.test(s) || s.split(/\s+/).length > 4) return false;
  return BOX_LABEL.test(s) || NOISE_TOKEN.test(s.toLowerCase().replace(/[\s:]+/g, "-").replace(/-+$/, ""));
}
const NOISE_TEXT =
  /\b(cookies?|consent|we use cookies|usamos cookies|utilizamos cookies|newsletter|subscribe to our|suscr[ií]bete|bolet[ií]n|allow notifications|notificaciones|ad ?blocker|bloqueador de anuncios|accept all|aceptar todo)\b/i;
/** Phrases that only a promo says: a newsletter, the app, following the site, a subscription. */
const PROMO_STRONG =
  /newsletter|sign up (here|for|to)|preferred source|fuente preferida|agregar .{1,30} en google|get the app|download (our|the) ([\w'’-]+ ){0,3}app\b|descarg[aá] (la|nuestra) app|bolet[ií]n|suscr[ií]bete|suscribite|join our|únete a nuestro canal|follow us|s[ií]guenos|whatsapp channel|canal de whatsapp|for just [$£€]|free trial|prueba gratis|all access|applications are open|we're hiring|cook mode|shopping picks|explore games|play now|subscribe now|unlock (unlimited|full|all)|support (our|independent|quality) journalism|become a (member|supporter|subscriber)|apoy[aá] (al |el )?periodismo|hacete socio|suscribirte|^agregar .{1,30} en$/i;
/** Words a promo uses that a news story may use too ("record donation", "on the TikTok app"): promo only in a short call to action. */
const PROMO_WEAK = /(in|on|with) (the|our) [\w\s]{1,30} app\b|donat(e|ion)|give \$\d|gave \$\d|fundrais/i;
const PROMO_LABEL = new RegExp(`${PROMO_STRONG.source}|${PROMO_WEAK.source}`, "i");

/** Text that sells a newsletter, app, follow or donation rather than telling something. */
function promoText(s: string): boolean {
  return PROMO_STRONG.test(s) || (s.length < 70 && PROMO_WEAK.test(s));
}
/** A sentence that asks the reader to do something for the site ("Take the AIQ test"). */
const PROMO_ASK = /(^|[.!?]\s+)(take|try|start|join|play|sign up|subscribe|register|claim|unlock|download|get) (the|our|your)\b/i;

/** A campaign-tagged link that sells: promo words, or the site sending readers to its own product with a call to action. */
function trackedPromo(a: HTMLAnchorElement): boolean {
  const s = textIn(a);
  if (promoText(s)) return true;
  let u: URL;
  try {
    u = new URL(a.href);
  } catch {
    return false;
  }
  return u.hostname.replace(/^www\./, "") === location.hostname.replace(/^www\./, "") && !STORY_PATH.test(u.pathname) && PROMO_ASK.test(s);
}
const FEEDBACK =
  /was this (page|article|answer|information|content) (helpful|useful)|did you find (this|it) helpful|rate this (page|article)|help us improve|¿(te )?(fue|result[oó]|ha resultado) [úu]til|¿te sirvi[oó]/i;
const SPONSORED_HEAD =
  /^(sponsored( content| stories| links| products)?|promoted( content| stories)?|partner content|paid (content|post)|from our partners|around the web|contenido patrocinado|patrocinado|publicidad|ads?|(our )?shopping picks|content lab|sponsored\s*([·•|:–-]\s*)?by\s*\S.{0,60})$/i;
/** Google's ad click redirect ("/aclk?…", googleadservices.com/pagead/aclk). */
const AD_CLICK = /^(https?:\/\/(www\.)?google\.[a-z.]+)?\/aclk\?|^https?:\/\/(www\.)?googleadservices\.com\//i;
/** A plain title line that names a sponsored section; a bare "Ad" or "Publicidad" over an ad slot names only that slot. */
const SPONSORED_SECTION =
  /^(sponsored (content|stories|links|products)|promoted (content|stories)|partner content|paid (content|post)|from our partners|around the web|contenido patrocinado|(our )?shopping picks|content lab)$/i;
/** List rows that only ask you to follow or subscribe on social media ("Follow Daily Mail", "Follow @DailyMail"). */
const FOLLOW_ROW = /^(follow|subscribe|s[ií]gue(nos)?|seguinos|suscr[ií]bete|suivez|folge)\b.{0,40}$/i;
/** Who the row asks you to follow: "us", a handle, or the site's own name with a social link. */
const FOLLOW_WHO = /\b(us|nos)\b|@\w|s[ií]guenos|seguinos|suivez-nous/i;
const SOCIAL_NAME = /facebook|twitter|instagram|youtube|tiktok|linkedin|pinterest|whatsapp|telegram|threads|snapchat|bluesky|flipboard|(^|[\s_-])x([\s_-]|$)/i;
const MEDIA = new Set(["img", "picture", "video", "audio"]);
/** The quote a social post's embed shows until its widget loads (X, Instagram, TikTok, Threads, Bluesky). */
const SOCIAL_EMBED = /(^|[\s_-])(twitter-tweet|twitter-video|instagram-media|tiktok-embed|text-post-media|bluesky-embed)($|[\s_-])/i;
const APPEAL =
  /\bdonat(e|ion)s?\b|give \$\d|gave \$\d|fundraiser\b|if everyone reading this|support (our|independent) journalism|apoy[aá] (al |el )?periodismo|necesit[aá]s suscribirte|(subscribe|sign in|log in) to (comment|join the conversation)|para comentar/i;
/** A control that answers an appeal: "Donate", "Give $5", "Support us", "Subscribe", "Sign in". */
const APPEAL_CTA =
  /^(donate|donar|don[aá]|make a donation|haz una donaci[oó]n|contribute|contribu[ií]r|give( now| today| once| monthly| \$?\d[\d,.]*)?|support (us|now|today|our|independent|quality)\b|become a (member|supporter|subscriber|donor)|apoy[aá]|hacete socio|subscribe|suscr[ií]b|sign in|log in|iniciar sesi[oó]n|ingres[aá])/i;
const APPEAL_URL = /donat|\/give\b|\/giving\b|fundrais|\/support-us|\/contribute|\/become-a-(member|supporter)/i;

/** A line that is only dates, times and reading time ("23 de octubre de 2026 · 19:01 · 9 minutos de lectura"). */
function dateLine(text: string): boolean {
  if (!text || text.length > 120 || !/\d/.test(text)) return false;
  const rest = text
    .replace(/\d{1,2}(\s+de)?\s+[\p{L}.]+(\s+de)?\s+\d{4}|[\p{L}.]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}/giu, "")
    .replace(/\d{1,2}:\d{2}(\s?[ap]\.?m\.?)?(\s?hs?\.?)?|\b[A-Z]{2,4}T\b/g, "")
    .replace(/(hace\s+)?\d+\s+(seconds?|segundos?|minutes?|minutos?|mins?|hours?|horas?|hrs?|days?|d[ií]as?|weeks?|semanas?|months?|meses|years?|años?)\b(\s+ago)?/giu, "")
    .replace(/\d+\s*['’′]?\s*(min(utos?)?\.?|minutes?)(\s+(de lectura|read|reading))?|(tiempo de )?lectura:?|updated:?|actualizado:?|published:?|publicado:?|\b(on|el|at|a las|de lectura|read)\b/gi, "")
    // Reading time in minutes drawn as "6'" (La Nación on a narrow screen).
    .replace(/(^|\s)\d{1,3}\s?['’′](?=\s|$)/g, " ");
  return !/[\p{L}\p{N}]/u.test(rest);
}
/** A live page's button that shows the posts it holds back ("2 new updates", "3 nuevas actualizaciones", "Show 5 new posts"). */
const NEW_POSTS = /^((show|see|ver|mostrar)\s+)?\d+\s+(new|more|nuevas?|nuevos?|m[aá]s)\s+(updates?|posts?|entries|actualizaci[oó]n(es)?|publicaci[oó]n(es)?|entradas?|mensajes?)$/i;
const BYLINE_TOKEN = /(^|[\s_-])(byline|bylines|author|authors|autor|article-?date|dateline|timestamp|published|pubdate|byline-section)($|[\s_-])/i;
// Whole labels only for close and dismiss: "Close issue" and "Cerrar sesión" are real actions.
const SKIP_LABEL =
  /^((skip to|skip navigation|saltar (al|a)|ir al contenido|back to top|volver arriba|ir arriba)\b|(close|cerrar|dismiss|×|✕|x|advertisement|publicidad)$)/i;
/** Copy buttons: what they copy (a share link, an invite code) may be nowhere on screen. */
const COPY_LABEL = /^(copy( link| code| to clipboard)?|copied!?|copiar( el)?( enlace| código)?|copiado!?)$/i;
/** A code block's own toolbar: a <pre> a few levels up. */
function besideCode(el: Element): boolean {
  for (let a = el.parentElement, i = 0; a && a !== document.body && i < 3; a = a.parentElement, i++) if (a.querySelector("pre")) return true;
  return false;
}
/** Controls that only make sense with a pointer and an eye on the original layout. */
const SKIP_EXACT =
  /^((chevron|arrow|caret|angle)[ _-]?(left|right|up|down|back|forward)?|(previous|next|prev) (slide|item|image|page of results)|(navigate|scroll|slide|move) (left|right|forward|back(wards?)?|previous|next)|slide \d+( of \d+)?|go to slide \d+|(comfortable|compact|cozy) (display )?density|copy( code| to clipboard)?|copied!?|(map )?attributions?|copiar( código)?|(copy )?(link|permalink|anchor) to (this )?(section|heading|paragraph)|permalink|expand|collapse|toggle|more|menu|open menu|more (options|actions)|\.\.\.|…)$/i;
const ITEM_ACTION_NOISE =
  /^(filter by|more actions|action menu|more options|options|hide|add to favou?rites|favou?rite|bookmark|share|report|flag|dismiss|not interested|save to|follow|last edited by|(issue body|comment|post) actions)\b/i;
/**
 * A button that opens a menu of actions on a row or on the page ("More",
 * "More actions for Notes.txt", "⋮"): the only way to its Rename, Download or
 * Delete, so it stays a button. It says it opens a menu, or shows only the
 * overflow glyph.
 */
const OVERFLOW_LABEL = /^(more|more (options|actions)|actions|options|action menu|\.\.\.|…|⋮|⋯|︙)( for .{1,120})?$/i;
function overflowMenu(el: Element, label: string): boolean {
  if (el.localName === "a" && el.hasAttribute("href") && !inPage(el)) return false;
  const pop = el.getAttribute("aria-haspopup");
  return OVERFLOW_LABEL.test(label) && (pop === "menu" || pop === "true" || /^[⋮⋯︙]$/.test(textIn(el)));
}
const PAGER_LINK = /^(next|previous|prev|older|newer|first|last|siguiente|anterior|primera|última|suivant|précédent|weiter|zurück|›|»|«|‹|→|←|\d{1,4})$/i;

// IAB standard ad sizes: iframes of exactly these sizes are almost always ads.
const AD_SIZES = [
  [300, 250], [728, 90], [320, 50], [160, 600], [300, 600], [970, 250], [970, 90], [468, 60],
  [320, 100], [336, 280], [250, 250], [200, 200], [120, 600], [300, 50], [300, 100],
];

const EMBED_HOST =
  /youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|spotify\.com|soundcloud\.com|google\.com\/maps|maps\.google|openstreetmap|stripe\.com|paypal\.com|braintree|adyen|recaptcha|hcaptcha|challenges\.cloudflare|turnstile|docs\.google|player\.|jwplayer|brightcove|kaltura|wistia|loom\.com|codepen|codesandbox|figma\.com|typeform/i;

/** Frames that are tools to work with, not something to watch or read. */
const TOOL_HOST =
  /google\.com\/maps|maps\.google|openstreetmap|\/maps?\/|codepen|codesandbox|jsfiddle|stackblitz|replit|figma\.com|docs\.google|typeform|stripe\.com|paypal\.com|braintree|adyen|recaptcha|hcaptcha|challenges\.cloudflare|turnstile/i;

export interface Ctx {
  used: WeakSet<Element>;
  seen: Set<string>;
  inArticle: boolean;
  articleEl: Element | null;
  afterArticle: boolean;
  formRef?: string;
  /** The form around the walk wraps the whole page (ASP.NET): it says nothing about what is a form control. */
  pageForm?: boolean;
  thumbs: boolean;
  vw: number;
  vh: number;
  count: number;
  /** Walking inside a dialog or popup the user opened: its class names ("modal", "popup") are not noise. */
  inDialog?: boolean;
  /** Sift shows its own author and date line, so the site's byline is skipped. */
  hasByline?: boolean;
  /** The author's name in Sift's byline, said once there. */
  byName?: string;
  /** Sift's byline shows the date, so the site's date line is skipped. */
  hasDate?: boolean;
  /** Treat every <nav> as content (pages that are mostly navigation, like portals). */
  keepAllNav?: boolean;
  /** Elements the walker must treat as noise (from site adapters). */
  drop?: (el: Element) => boolean;
  /** The article's first real paragraphs: the site's byline and date sit before them. */
  firstParas?: Element[];
  /** The field that became Sift's search box. */
  searchEl?: Element;
  /** Headings and positioned parts the walk showed, so a popup never repeats them. */
  visited?: WeakSet<Element>;
  /** Small fixed bars with text the walk dropped (Google's account bar): on screen, so never a popup an action opened. */
  bars?: WeakSet<Element>;
  /** The cards shown, by link, so the same story is shown once. */
  cards?: Map<string, Item[]>;
  /** Elements shown as portals, so one player never gets two. */
  portals?: Element[];
  /** Cards found to be ads or promos, dropped whole. */
  promos?: WeakSet<Element>;
  /** The page title's heading. */
  titleEl?: Element | null;
  /** Walking inside a folded comments section. */
  inComments?: boolean;
  /** The posts of a thread being walked (an issue's comments): each one is an entry read in full. */
  postUnits?: Set<Element>;
  /** Walking inside one post of a thread (an answer): its parts are its text, never cards. */
  inPost?: boolean;
  /** Shared by every walk of one page: whether the visit budget ran out and Sift said so. */
  cut?: { noted: boolean };
  /** The page shows nothing behind its chrome: a consent wall over it is the only way in. */
  bare?: boolean;
  /** Layers over the whole window with their own Close button (a zoom gallery), shown as dialogs, not in the page. */
  layers?: Element[];
  /** Walking a popup the user opened that the site hides from screen readers by mistake (aria-hidden on a shown modal). */
  shownHidden?: boolean;
}

const BUDGET = 25000;

/**
 * MediaWiki's tools around an article (Wikipedia and other wikis): the
 * Article/Talk and Read/Edit tabs, the protection badge, navboxes (folded
 * grids of links to other articles) and authority control identifiers.
 */
const WIKI_CHROME = "#p-associated-pages, #p-views, #p-cactions, .vector-page-toolbar, .mw-indicators, .navbox, .navbox-styles, .authority-control, .mw-jump-link, .navbar.plainlinks";

export function newCtx(partial: Partial<Ctx> = {}): Ctx {
  return {
    used: new WeakSet(),
    seen: new Set(),
    inArticle: false,
    articleEl: null,
    afterArticle: false,
    thumbs: false,
    vw: innerWidth,
    vh: innerHeight,
    count: 0,
    cut: { noted: false },
    ...partial,
  };
}

/**
 * The page is longer than one pass may read: noted once, and said after the
 * page's own blocks (cutNote), never inside a folded section or a story the
 * Short version replaces, so a cut page never looks complete.
 */
function budgetCut(_out: Out, ctx: Ctx) {
  if (ctx.cut) ctx.cut.noted = true;
}

/** Says at the end of a pass's top-level blocks that the page was cut. */
function cutNote(blocks: Block[], ctx: Ctx): Block[] {
  if (ctx.cut?.noted) blocks.push({ t: "note", key: "cut", text: t("pageCut"), tone: "info" });
  return blocks;
}

/** Collects blocks in order, grouping runs of items, links, and controls. */
export class Out {
  blocks: Block[] = [];
  /** How many things were added (blocks, items, links, controls), to tell what one part of the walk added. */
  adds = 0;
  private links: Inline[][] = [];
  private linksKey = "";
  private items: Item[] = [];
  private itemsKey = "";
  private fields: Field[] = [];
  private actions: Action[] = [];
  private ctlKey = "";
  private ctlForm?: string;

  push(b: Block) {
    this.adds++;
    this.flush();
    this.blocks.push(b);
  }
  item(it: Item) {
    this.adds++;
    if (this.links.length) this.flushLinks();
    if (this.fields.length || this.actions.length) this.flushControls();
    if (!this.items.length) this.itemsKey = "ci:" + it.key;
    this.items.push(it);
  }
  private flushItems() {
    if (!this.items.length) return;
    this.blocks.push({ t: "items", key: this.itemsKey, items: this.items, thumbs: this.items.some((i) => i.image) });
    this.items = [];
  }
  link(label: string, href: string | undefined, ref: string) {
    this.adds++;
    this.flushItems();
    if (this.fields.length || this.actions.length) this.flushControls();
    if (!this.links.length) this.linksKey = "l:" + ref;
    this.links.push([{ a: label, href, ref }]);
  }
  field(f: Field, form?: string) {
    this.adds++;
    this.flushItems();
    if (this.links.length) this.flushLinks();
    if (this.ctlForm !== form && (this.fields.length || this.actions.length)) this.flushControls();
    // A list row's buttons stay right after their row: a field of the next row, or after the
    // list, starts a run of its own (a form shows its fields first, so it would come before them).
    else if (this.actions.length && rowOf(f.ref) !== rowOf(this.actions[this.actions.length - 1].ref)) this.flushControls();
    if (!this.fields.length && !this.actions.length) this.ctlKey = "c:" + f.ref;
    this.ctlForm = form;
    this.fields.push(f);
  }
  action(a: Action, form?: string) {
    this.adds++;
    this.flushItems();
    if (this.links.length) this.flushLinks();
    if (this.ctlForm !== form && (this.fields.length || this.actions.length)) this.flushControls();
    // A button in its field's own box (a password's Show button) stays next to that field, not after the whole form.
    const f = this.fields[this.fields.length - 1];
    if (f && boxButton(f, a)) {
      (f.after ??= []).push(a);
      return;
    }
    if (!this.fields.length && !this.actions.length) this.ctlKey = "c:" + a.ref;
    this.ctlForm = form;
    this.actions.push(a);
    this.actionAt.push(this.fields.length);
  }
  /** How many fields came before each action, to keep a field-like button where it is (F1012). */
  private actionAt: number[] = [];
  private flushLinks() {
    if (!this.links.length) return;
    this.blocks.push({ t: "ul", key: this.linksKey, items: this.links });
    this.links = [];
  }
  private flushControls() {
    if (!this.fields.length && !this.actions.length) return;
    // A custom select or a Yes/No toggle group between the fields stays there, under its label,
    // not in the row of buttons after the form (F1012).
    if (this.fields.length) {
      const keep: Action[] = [];
      this.actions.forEach((a, i) => {
        const at = this.actionAt[i] ?? this.fields.length;
        const el = elOf(a.ref);
        if (at >= this.fields.length || !fieldButton(el)) return void keep.push(a);
        const f = this.fields[at];
        const g = el!.closest("[role=group], [role=radiogroup]");
        const gref = g ? refOf(g) : a.ref;
        const last = f.before?.[f.before.length - 1];
        if (last && last.ref === gref) last.actions.push(a);
        else (f.before ??= []).push({ ref: gref, label: g ? groupName(g) || undefined : undefined, actions: [a] });
      });
      this.actions = keep;
    }
    this.actionAt = [];
    nameTwins(this.fields, [...this.actions, ...this.fields.flatMap((f) => [...(f.after ?? []), ...(f.before ?? []).flatMap((g) => g.actions)])]);
    if (this.fields.length) this.blocks.push({ t: "form", key: this.ctlKey, ref: this.ctlForm, fields: this.fields, actions: this.actions });
    else this.blocks.push({ t: "actions", key: this.ctlKey, actions: this.actions });
    this.fields = [];
    this.actions = [];
    this.ctlForm = undefined;
  }
  /**
   * Lists of long headlines get a plain one-line rewrite that keeps the news
   * (see processAi). Their teaser text becomes context for the rewrite.
   */
  static rewriteIfLong(b: Block): Block {
    if (b.t !== "items" || b.items.length < 4 || b.rewrite) return b;
    // Comments (read in full, or answered) keep their own words (F1030).
    if (b.items.some((it) => it.body || it.replies)) return b;
    const words = b.items.reduce((n, it) => n + it.title.split(/\s+/).length, 0) / b.items.length;
    // Places named by their address ("Main Street, Indian Orchard, Springfield, Hampden County, …"):
    // short parts between commas. A name stays as it is, however long.
    const address = (s: string) => {
      const parts = s.split(/[,，、]/);
      return parts.length >= 4 && parts.every((p) => p.trim().split(/\s+/).length <= 5) && !/[.!?。！？]$/.test(s.trim());
    };
    if (words > 13 && b.items.filter((it) => address(it.title)).length < b.items.length / 2) {
      b.rewrite = "oneliner";
      b.aiMode = "news";
      for (const it of b.items) {
        if (it.text) {
          it.context = [it.context, it.text.slice(0, 200)].filter(Boolean).join(" · ");
          it.text = undefined;
        }
      }
    }
    return b;
  }
  flush() {
    this.flushItems();
    this.flushLinks();
    this.flushControls();
  }
  done(): Block[] {
    this.flush();
    for (const b of this.blocks) Out.rewriteIfLong(b);
    return this.blocks;
  }
}

/**
 * A button the page uses as a field (a custom select, a toggle of a Yes/No group): it keeps its place
 * among the fields (F1012).
 */
function fieldButton(el: Element | null): boolean {
  if (!el) return false;
  if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox") return true;
  return el.hasAttribute("aria-pressed") && !!el.closest("[role=group], [role=radiogroup]");
}

/** The list entry a control is in, if any. */
const rowOf = (ref: string) => elOf(ref)?.closest("li, [role=listitem]") ?? null;

/**
 * Buttons with one name beside different fields ("Search" after the start and
 * after the destination) say which field each one serves.
 */
/**
 * A button after a text field in a small box of their own (a password's Show
 * button, a Clear button). A stepper's "-" before the field keeps its pair together.
 */
function boxButton(f: Field, a: Action): boolean {
  if (/^(checkbox|radio|select|file)$/.test(f.kind)) return false;
  const fe = elOf(f.ref);
  const be = elOf(a.ref);
  const box = fe?.parentElement;
  if (!box || !be || be.parentElement !== box || /^(form|fieldset|body|main)$/.test(box.localName) || box.childElementCount > 4) return false;
  const kids = Array.from(box.children);
  return !kids.slice(0, kids.indexOf(fe)).some((c) => c.matches("button, input, select, textarea, [role=button]"));
}

function nameTwins(fields: Field[], actions: Action[]) {
  if (fields.length < 2 || actions.length < 2) return;
  const by = new Map<string, Action[]>();
  for (const a of actions) {
    if (a.href) continue;
    const g = by.get(a.label) ?? [];
    g.push(a);
    by.set(a.label, g);
  }
  let fes: (Element | null)[] | null = null;
  for (const [label, g] of by) {
    if (g.length < 2) continue;
    fes ??= fields.map((f) => elOf(f.ref));
    const names = g.map((a) => {
      const b = elOf(a.ref);
      // The one field in the smallest box around the button.
      for (let p = b?.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) {
        const hits = fields.filter((_, j) => !!fes![j] && p!.contains(fes![j]!));
        if (hits.length > 1) return "";
        if (hits.length === 1) return clean((hits[0].label || hits[0].placeholder || "").split(/[,·(]/)[0]).slice(0, 40);
      }
      return "";
    });
    if (names.every(Boolean) && new Set(names).size === names.length) g.forEach((a, i) => (a.label = `${label}: ${names[i]}`));
  }
}

/** A shadow root, open or closed (content scripts may read closed ones). */
export const shadowOf = shadowRootOf;

/** Children in rendered order, looking through shadow roots and slots. */
export function kids(el: Element): Element[] {
  const sr = shadowOf(el);
  if (sr) return Array.from(sr.children);
  if (el.localName === "slot") {
    const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
    return assigned.length ? assigned : Array.from(el.children);
  }
  return Array.from(el.children);
}

function inMain(el: Element): boolean {
  const m = el.closest("main, [role=main], [data-sift-role=main], article");
  // A <main> that says it is none and wraps the site's header or nav (weather.gov's, around the whole page) is only a box.
  // One that wraps a product (Allbirds' <main role=none>, with a breadcrumb at most) is still the main region.
  if (m?.localName === "main" && /^(none|presentation)$/.test(m.getAttribute("role") ?? "") && wrapsSiteBar(m)) return !!m.parentElement && inMain(m.parentElement);
  return !!m;
}

/** A region whose own children include the site's header or nav bar (not a breadcrumb). */
function wrapsSiteBar(m: Element): boolean {
  return Array.from(m.children).some((c) => {
    const role = c.getAttribute("role") ?? "";
    if (c.localName === "header" || role === "banner") return true;
    return (c.localName === "nav" || role === "navigation") && !/breadcrumb|migas/i.test(`${c.getAttribute("aria-label") ?? ""} ${tokens(c)}`);
  });
}

/** Navigation that is part of the content: pagination, in-page tabs, language lists. */
function contentNav(el: Element, ctx: Ctx): boolean {
  const label = `${clean(el.getAttribute("aria-label"))} ${el.getAttribute("aria-labelledby") ? accName(el) : ""} ${tokens(el)}`;
  if (/breadcrumb|migas/i.test(label)) return titlePath(el, ctx);
  if (/paginat|pager|pages|paging|páginas|resultados/i.test(label)) return true;
  const links = Array.from(el.querySelectorAll("a[href], button")).filter((a) => visible(a));
  const pager = links.filter((a) => PAGER_LINK.test(textIn(a) || accName(a))).length;
  if (pager >= 3 && pager >= links.length * 0.6) return true;
  return ctx.keepAllNav || inMain(el);
}

/**
 * A breadcrumb on the title's own line (GitHub's "preact / hooks / src / index.js", the file's name its h1):
 * the folders of what is shown, to go up to, not the site's sections over a story (F963).
 */
function titlePath(el: Element, ctx: Ctx): boolean {
  const h = ctx.titleEl;
  if (!h || !inMain(el) || !el.querySelector("a[href]")) return false;
  const n = el.getBoundingClientRect();
  const t = h.getBoundingClientRect();
  if (!n.height || !t.height) return false;
  const mid = t.top + t.height / 2;
  return mid >= n.top - 4 && mid <= n.bottom + 4;
}

/** A side column's own tools outside its tree of links: a field to fill in (GitHub's "Go to file"), not only links. */
function sidePaneTools(el: Element): boolean {
  if (!el.querySelector("nav, [role=navigation]")) return false;
  return Array.from(el.querySelectorAll("input:not([type=hidden]), select, textarea")).some((f) => visible(f) && !f.closest("nav, [role=navigation]"));
}

/**
 * A <footer> is the site's footer only at page level. Inside a dialog, form,
 * card or list entry it holds that thing's buttons (Delete, Save, Add to cart);
 * inside an article or section it is kept when it holds a control.
 */
function pageFooter(el: Element, ctx: Ctx): boolean {
  if (ctx.inDialog) return false;
  const sel = "form, dialog, [role=dialog], [role=alertdialog], li, [role=listitem], article, section, aside, [role=article]";
  let p = el.parentElement?.closest(sel);
  // A form around the whole page (ASP.NET) is not a form the footer belongs to.
  while (p && p.localName === "form" && pageWide(p)) p = p.parentElement?.closest(sel);
  if (!p) return true;
  // A comment's meta (WordPress's footer.comment-meta: its author and date) is the comment's, not a story's footer.
  if (COMMENTS_TOKEN.test(tokens(el)) || p.matches(".comment, .comment-body, [role=comment]") || !!p.closest("li.comment")) return false;
  // A story's own footer (tags, share bar) stays out unless it holds a form.
  if (/^(article|section|aside)$/.test(p.localName) || p.getAttribute("role") === "article")
    return !el.querySelector(ctx.inArticle ? "input:not([type=hidden]), select, textarea" : CONTROL_SEL);
  return false;
}

/**
 * Class names cut to their BEM block: "site-header__inner" is part of the site
 * header, but "post-header--masthead__hero" is a story's hero, not a masthead.
 */
function blockTokens(el: Element): string {
  return tokens(el).split(/\s+/).map((w) => w.split(/__|--/)[0]).join(" ");
}

function isChrome(el: Element, ctx: Ctx): boolean {
  const tag = el.localName;
  const role = el.getAttribute("role");
  if (role === "contentinfo") return !ctx.inDialog;
  if (tag === "footer") return pageFooter(el, ctx);
  if (tag === "header" || role === "banner") return !ctx.inArticle && (!inMain(el) || barCopy(el, ctx)) && !titleBar(el, ctx);
  if (tag === "nav" || role === "navigation") return !contentNav(el, ctx);
  if (tag === "aside" || role === "complementary") {
    if (NOISE_TOKEN.test(tokens(el))) return true;
    // A checkout's order summary beside its form (the items and the total) is what the form is for.
    if (!inMain(el)) return !orderSummary(el);
    // Side panels inside the main region can hold real facts (a repo's About box).
    const links = Array.from(el.querySelectorAll("a")).reduce((n, a) => n + tlen(a), 0);
    return tlen(el) < 60 || links / (tlen(el) || 1) > 0.6;
  }
  if (CHROME_TOKEN.test(tokens(el)) && siteBar(el, ctx) && !el.querySelector("h1") && !contentFooter(el)) return true;
  return false;
}

/** The actions in Sift's top bar, for the extraction under way. */
let topBar: Action[] = [];

/**
 * A site header the page put inside its main region (weather.com below 768 px):
 * at the top, and every control it shows is already in Sift's top bar, a menu
 * toggle, the site search, or a link home. It is said once, in the bar.
 */
function barCopy(el: Element, ctx: Ctx): boolean {
  if (!topBar.length || el.querySelector("h1") || tlen(el) > 300) return false;
  const r = el.getBoundingClientRect();
  if (r.top + scrollY > 100 || r.height > 200) return false;
  let inBar = 0;
  for (const c of Array.from(el.querySelectorAll("a[href], button, [role=button], input:not([type=hidden]), select"))) {
    if (!visible(c) || c.getBoundingClientRect().width < 1) continue;
    // The bar's own control, or its twin ("Sign in" as a link and as a button).
    const name = (textIn(c) || accName(c)).toLowerCase();
    if (topBar.some((a) => a.ref === refOf(c) || (!!name && a.label.toLowerCase() === name))) {
      inBar++;
      continue;
    }
    if (ctx.searchEl && (c === ctx.searchEl || !!c.closest("form")?.contains(ctx.searchEl))) continue;
    if (c instanceof HTMLAnchorElement && (homeHref(c.href) || localeHome(c.href))) continue;
    if (c.hasAttribute("aria-expanded") || c.hasAttribute("aria-haspopup") || /\bmenu\b/i.test(accName(c))) continue;
    return false;
  }
  return inBar > 0;
}

/** The site's home in one language ("/en-CA", "/es/"). */
function localeHome(href: string): boolean {
  try {
    const u = new URL(href, location.href);
    return u.host === location.host && !u.search && /^\/[a-z]{2}([-_][a-z]{2})?\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * A <header> in the section that holds the page's title, with buttons and no
 * menu, search or link home: the title's own bar (a Craigslist post's reply,
 * favorite and hide), not the site's header.
 */
function titleBar(el: Element, ctx: Ctx): boolean {
  if (el.localName !== "header" || el.getAttribute("role") === "banner" || !ctx.titleEl) return false;
  const sec = el.parentElement?.closest("section, article, aside");
  if (!sec || sec === document.body || !sec.contains(ctx.titleEl)) return false;
  if (!el.querySelector("button, [role=button]") || el.querySelector("nav, [role=navigation], [role=search], input, select, textarea, img, svg")) return false;
  return !Array.from(el.querySelectorAll("a[href]")).some((a) => homeHref((a as HTMLAnchorElement).href));
}

const TOTAL_WORD = /\b(total|subtotal|order summary|your order|resumen (del pedido|de (tu |la )?compra)|tu pedido|importe)\b/i;
const MONEY = /([$€£¥₹]|US\$|R\$)\s?\d|\d[\d.,]*\s?(€|(USD|EUR|ARS)\b)/;
const CHECKOUT_LABEL = /\b(place (your )?order|pay now|check ?out|complete (your )?(purchase|order)|confirm (your )?(order|purchase)|realizar (el )?pedido|finalizar (la )?compra|confirmar (la )?(compra|pedido))\b/i;

/**
 * A side panel that totals what the page's form is for (a checkout's order
 * summary): a total with an amount, few links, on a page with fields to fill
 * or an order to place.
 */
function orderSummary(el: Element): boolean {
  const len = tlen(el);
  if (len < 15 || len > 1500) return false;
  const links = Array.from(el.querySelectorAll("a")).reduce((n, a) => n + tlen(a), 0);
  if (links > len * 0.3) return false;
  const text = textIn(el);
  if (!TOTAL_WORD.test(text) || !MONEY.test(text) || promoText(text)) return false;
  if (document.querySelector("form input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]):not([type=image]), form select, form textarea")) return true;
  return Array.from(document.querySelectorAll("button, input[type=submit], [role=button]")).slice(0, 300).some((b) => CHECKOUT_LABEL.test(textIn(b) || clean((b as HTMLInputElement).value)));
}

/** A button that pays or goes on to pay ("Go to payment", "Pay $40 deposit", "Checkout"). */
const PAY_LABEL = /\b(pay|payment|check ?out|place (your )?order|complete (your )?(purchase|order|booking)|confirm (your )?(order|purchase|booking)|pagar|pago|finalizar (la )?compra|realizar (el )?pedido|confirmar (la )?(compra|pedido|reserva))\b/i;

/**
 * A bar pinned to the window's edge (fixed or sticky, checked by the caller)
 * with the order's total or its pay button, and the terms to accept (a
 * basket's "Total $20.50 · I accept the terms of sale · Go to payment"): the
 * page's main action, not a banner.
 */
function payBar(el: Element): boolean {
  const len = tlen(el);
  if (!len || len > 400 || el.closest("header, nav, [role=banner], [role=navigation], dialog, [role=dialog], [role=alertdialog]")) return false;
  const text = textIn(el);
  if (NOISE_TEXT.test(text) || promoText(text)) return false;
  const btns = Array.from(el.querySelectorAll("button, input[type=submit], input[type=button], [role=button]")).filter((b) => visible(b));
  if (!btns.length || btns.length > 5 || el.querySelectorAll("a[href]").length > 3) return false;
  // Pinned along the window's bottom, or inside the content: a site bar at the top with a cart's "Checkout" is the site's.
  const r = el.getBoundingClientRect();
  if (!(r.bottom >= innerHeight - 4 && r.top > innerHeight * 0.4) && !inMain(el)) return false;
  return btns.some((b) => PAY_LABEL.test(textIn(b) || clean((b as HTMLInputElement).value) || accName(b))) || (TOTAL_WORD.test(text) && MONEY.test(text));
}

/** A bar's save button ("Save", "Save changes", "Publish", "Update", "Apply") and its partner ("Discard", "Cancel"). */
const SAVE_LABEL = /^(save( changes| all| draft)?|apply( changes)?|publish|update|guardar( cambios)?|aplicar( cambios)?|publicar|actualizar|enregistrer|speichern|salva|salvar)$/i;
const DISCARD_LABEL = /^(discard( changes)?|cancel|reset|revert|descartar( cambios)?|cancelar|deshacer|restablecer|annuler|verwerfen|abbrechen|annulla)$/i;
const UNSAVED_TEXT = /\b(unsaved changes?|changes (are )?not saved|cambios sin guardar|modifications non enregistrées|ungespeicherte änderungen|modifiche non salvate)\b/i;

/**
 * A bar pinned to the window (fixed or sticky, checked by the caller) that the page shows once a
 * setting changed: "Unsaved changes · Discard · Save" (Shopify's contextual save bar). It is the
 * page's main action, like the pay bar, inside or outside the main region (F901).
 */
function saveBar(el: Element): boolean {
  const len = tlen(el);
  if (!len || len > 200 || el.matches(DIALOG_SEL) || el.closest("nav, [role=navigation], dialog, [role=dialog], [role=alertdialog]")) return false;
  if (el.querySelector("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea") || el.querySelectorAll("a[href]").length > 2) return false;
  const text = textIn(el);
  if (NOISE_TEXT.test(text)) return false;
  const btns = Array.from(el.querySelectorAll("button, input[type=submit], input[type=button], [role=button]")).filter((b) => visible(b));
  if (!btns.length || btns.length > 5) return false;
  const names = btns.map((b) => textIn(b) || clean((b as HTMLInputElement).value) || accName(b));
  const save = names.some((n) => SAVE_LABEL.test(n));
  const discard = names.some((n) => DISCARD_LABEL.test(n));
  // While it saves ("Saving…"), "Unsaved changes" and "Discard" still say what it is.
  return (save && discard) || ((save || discard) && UNSAVED_TEXT.test(text));
}

/** "3 selected", "2 seleccionados": how many rows a bulk-action bar acts on. */
const SELECTED_COUNT = /\b\d+\s+((items?|rows?|orders?|files?|messages?|elementos?|filas?)\s+)?(selected|chosen|seleccionad[oa]s?|selecionad[oa]s?|sélectionnée?s?|ausgewählt|selezionat[oaie])(?![\p{L}])/iu;

/**
 * A bar pinned along the window's bottom (fixed or sticky, checked by the caller) that
 * the page shows while rows are selected ("2 selected · Mark as shipped · Print labels"):
 * the page's toolbar for them, shown in the page view, never a popup that locks it.
 */
function bulkBar(el: Element): boolean {
  if (el.matches(DIALOG_SEL) || el.closest("header, nav, [role=banner], [role=navigation], dialog, [role=dialog], [role=alertdialog]")) return false;
  const len = tlen(el);
  if (!len || len > 300 || el.querySelector("input:not([type=hidden]):not([type=checkbox]), select, textarea")) return false;
  const btns = Array.from(el.querySelectorAll("button, [role=button]")).filter((b) => visible(b));
  if (!btns.length || btns.length > 8) return false;
  const r = el.getBoundingClientRect();
  if (!(r.bottom >= innerHeight - 4 && r.top > innerHeight * 0.5 && r.width >= innerWidth * 0.5)) return false;
  return SELECTED_COUNT.test(textIn(el)) || !!document.querySelector("[role=row][aria-selected=true]") || rowPicked();
}

/**
 * A checked box that picks its row (an order, a message, a file): the row holds more than the
 * box and its own label. A ticked filter ("Brand: Hydro") in a facet list or a side panel is not (F741).
 */
function rowPicked(): boolean {
  for (const c of Array.from(document.querySelectorAll("tr input[type=checkbox]:checked, li input[type=checkbox]:checked")).slice(0, 40)) {
    const row = c.closest("tr, li")!;
    if (row.closest("aside, [role=complementary], [role=search]")) continue;
    let filters = false;
    for (let a: Element | null = row.parentElement, i = 0; a && a !== document.body && i < 5; a = a.parentElement, i++) if (FILTER_TOKEN.test(tokens(a))) filters = true;
    if (filters) continue;
    const label = (c as HTMLInputElement).labels?.[0];
    const link = Array.from(row.querySelectorAll("a[href]")).some((a) => !a.contains(c) && !label?.contains(a));
    if (link || tlen(row) - (label ? tlen(label) : 0) >= 20) return true;
  }
  return false;
}

/** Pay bars (and bulk-action bars) pinned outside the main region (after it in the page), read after it. */
function payBarsOutside(root: Element): Element[] {
  const out: Element[] = [];
  let n = 0;
  // Only what lies outside the root: the siblings of the root and of each box around it.
  for (let a: Element = root; a !== document.body && a.parentElement; a = a.parentElement) {
    for (const s of Array.from(a.parentElement.children)) {
      if (s === a || SKIP.has(s.localName)) continue;
      for (const b of Array.from(s.querySelectorAll("button, input[type=submit], [role=button]"))) {
        if (n >= 200) return out;
        if (out.some((o) => o.contains(b)) || b.closest("sift-root, header, nav, footer, [role=banner], [role=navigation], [role=contentinfo], dialog, [role=dialog], [role=alertdialog]")) continue;
        n++;
        for (let p = b.parentElement, d = 0; p && p !== a.parentElement && d < 6; p = p.parentElement, d++) {
          const pos = getComputedStyle(p).position;
          if (pos !== "fixed" && pos !== "sticky") continue;
          if (visible(p) && (payBar(p) || bulkBar(p) || saveBar(p))) out.push(p);
          break;
        }
      }
    }
  }
  return out;
}

/** What a site's footer says: its copyright, legal pages and social links. */
const LEGAL = /©|copyright|all rights reserved|derechos reservados|privacy|privacidad|terms|t[ée]rminos|cookies?|impressum|legal|accessibility|accesibilidad|careers|sitemap|contact us|contacto/i;

/**
 * A small "page footer" inside the page's own layout that tells something of
 * the page (a status page's "Incident History" and its regional status links),
 * not the site's footer: no copyright, legal pages or social links.
 */
function contentFooter(el: Element): boolean {
  if (el.localName === "footer" || !/footer/i.test(tokens(el)) || el.parentElement === document.body || tlen(el) > 500) return false;
  const links = Array.from(el.querySelectorAll("a[href]"));
  if (!links.length || links.length > 8 || LEGAL.test(textIn(el))) return false;
  return !links.some((a) => SOCIAL_HOSTS.test(hostOf((a as HTMLAnchorElement).href)) || LEGAL.test(textIn(a) || accName(a)));
}

/** Named like the site's header, footer or nav bar, outside the story and any dialog or form. */
function siteBar(el: Element, ctx: Ctx): boolean {
  if (ctx.inArticle || ctx.inDialog || !CHROME_TOKEN.test(tokens(el)) || !CHROME_TOKEN.test(blockTokens(el)) || (ctx.articleEl && el.contains(ctx.articleEl))) return false;
  const f = el.closest("form, dialog, [role=dialog]");
  return (!f || (f.localName === "form" && pageWide(f))) && !heroImage(el);
}

/** A form that wraps the page (ASP.NET puts everything in one): it holds the title or most of the text. */
function pageWide(form: Element): boolean {
  const c = pageWideCache.get(form);
  if (c && c.pass === passNo()) return c.v;
  const v = !!form.querySelector("h1") || tlen(form) > tlen(document.body) * 0.6;
  pageWideCache.set(form, { pass: passNo(), v });
  return v;
}
const pageWideCache = new WeakMap<Element, { pass: number; v: boolean }>();

/** A large photo that is not a logo: a "masthead hero image" is the story's picture, not the site's header. */
function heroImage(el: Element): boolean {
  return Array.from(el.querySelectorAll("img")).some((im) => {
    const r = im.getBoundingClientRect();
    return r.width >= 300 && r.height >= 150 && !LOGO_TOKEN.test(`${tokens(im)} ${(im as HTMLImageElement).alt}`);
  });
}

/** Positioned over the page rather than in its flow (tooltips, toasts, pop-overs). */
function floating(el: Element): boolean {
  for (let e: Element | null = el, i = 0; e && i < 2; e = e.parentElement, i++) {
    const p = getComputedStyle(e).position;
    if (p === "absolute" || p === "fixed") return true;
  }
  return false;
}

/**
 * Where the site's own byline sits: outside the story or before its first
 * paragraph, and not in comments or quotes, whose authors are content.
 */
function bylineZone(el: Element, ctx: Ctx, nth = 1): boolean {
  for (let a: Element | null = el, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) {
    if (a.localName === "blockquote" || a.localName === "figure" || COMMENTS_TOKEN.test(tokens(a))) return false;
  }
  const art = ctx.articleEl;
  if (!art || !art.contains(el)) return true;
  // The story's first real paragraphs (a dek may come before the date line).
  ctx.firstParas ??= Array.from(art.querySelectorAll("p")).filter((p) => tlen(p) > 80 && !BYLINE_TOKEN.test(tokens(p))).slice(0, 3);
  const mark = ctx.firstParas[Math.min(nth, ctx.firstParas.length) - 1];
  return !mark || (el !== mark && !el.contains(mark) && !!(el.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING));
}

/** The real button inside a web component's shadow root (md-filled-button, sl-button). */
function shadowButton(el: Element): Element | null {
  const sr = shadowOf(el);
  if (!sr || tlen(el) > 80) return null;
  const b = sr.querySelector("button, [role=button], input[type=submit], input[type=button]");
  if (!b || sr.querySelector("p, h1, h2, h3, h4, ul, ol, table, textarea, select, input:not([type=submit]):not([type=button]):not([type=hidden])")) return null;
  return b;
}

/** Text of a code block without its toolbar buttons or line-number gutters. */
function codeText(el: Element): string {
  if (!el.querySelector("button, [data-nosnippet], [aria-hidden=true]")) return el.textContent ?? "";
  let s = "";
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const skip = n.parentElement?.closest("button, [data-nosnippet], [aria-hidden=true]");
    if (!skip || !el.contains(skip)) s += n.nodeValue;
  }
  return s;
}

function isDialog(el: Element): boolean {
  const role = el.getAttribute("role");
  return el.localName === "dialog" || role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true";
}

/** "Close", "Close zoom modal", "Cerrar": the button that puts a layer away. */
const CLOSE_NAME = /^(close|cerrar|dismiss|×|✕|x)(\s[\p{L}\s]{1,30})?$/iu;

/**
 * A layer drawn over the whole window with its own Close button (a zoom
 * gallery, a photo viewer): a dialog without the role. Never the page itself,
 * with its title or main region.
 */
function overlayLayer(el: Element, ctx: Ctx): boolean {
  const r = el.getBoundingClientRect();
  if (r.width * r.height < ctx.vw * ctx.vh * 0.85 || (parseInt(getComputedStyle(el).zIndex) || 0) <= 0) return false;
  if (el.querySelector("main, [role=main], h1") || (ctx.titleEl && el.contains(ctx.titleEl)) || (ctx.articleEl && el.contains(ctx.articleEl))) return false;
  if (!tlen(el) && !el.querySelector("img, video")) return false;
  return Array.from(el.querySelectorAll("button, [role=button]")).some((b) => CLOSE_NAME.test(accName(b)) && visible(b));
}

function isAdSize(w: number, h: number): boolean {
  return AD_SIZES.some(([aw, ah]) => Math.abs(w - aw) <= 3 && Math.abs(h - ah) <= 3);
}

const GENERIC_LINK = /^((read|see|view|learn|show|find out) more|more|details|click here|here|(leer|ver|saber) más)$/i;
/** A picture's name that only says what kind of picture it is ("icon", "Logo link", "site logo"). */
const LOGO_NAME = /(^|\W)(logo|icon|isotipo|logotipo)(\W|$)/i;

/**
 * A control's label as the reader sees it. An aria-label that replaces the
 * visible text ("INFOBAE" over a section title, "Ir al párrafo 2" over a key
 * point, "show questions tagged 'javascript'" over "javascript") gives way to
 * that text; it still names icon-only controls and vague "Read more" links.
 */
function labelOf(el: Element): string {
  let s = accName(el);
  const field = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
  // The words the page shows win over a name they are not part of ("Ingresar" over aria-label "login in"):
  // that name is often a developer's string in another language. A short code ("EN") keeps the name.
  const shown = (vis: string) => !s.toLowerCase().includes(vis.toLowerCase()) && !adds(vis) && (vis.split(" ").length >= 3 || vis.length >= 20 || (vis.match(/\p{L}/gu)?.length ?? 0) >= 4);
  // A name that is the shown words with the row's name put in ("Make Mum the default" over
  // "Make default"), written as words, not a developer's id ("make-default-btn").
  const adds = (vis: string) => {
    if (s.length > 40 || !/\s/.test(s) || /\w[-_]\w/.test(s)) return false;
    const has = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const want = vis.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    let i = 0;
    for (const w of has) if (w === want[i]) i++;
    return want.length > 0 && i === want.length && has.length > want.length;
  };
  if ((el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) && !field) {
    const vis = textIn(el);
    if (vis && vis !== s && /\p{L}.*\p{L}/su.test(vis)) {
      const inName = s.toLowerCase().includes(vis.toLowerCase());
      if (el.localName === "a" ? !(GENERIC_LINK.test(vis) && inName) : shown(vis)) s = vis;
    }
  } else if (field && el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) {
    // A field's own label ("Recordar" beside its box) over an aria-label it does not appear in ("keep-me-loggedin").
    const vis = clean(Array.from((el as HTMLInputElement).labels ?? []).map((l) => textIn(l)).join(" "));
    if (vis && vis.length <= 80 && shown(vis)) s = vis;
  }
  if (s.length > 160) s = s.slice(0, 157).trimEnd() + "…";
  if (s.length <= 3 && /^[<>‹›«»←→\s]+$/.test(s)) s = pagerLabel(el, s);
  return s;
}

/**
 * A pager's arrow link ("›", ">>") named for where it goes ("Next", "Last
 * page"), by its class or its shape; unchanged outside a pager.
 */
function pagerLabel(el: Element, s: string): string {
  if (el.localName !== "a" || !el.hasAttribute("href")) return s;
  const pager = el.closest('[class*=paginat i], [class*=pager i], [aria-label*=paginat i], [aria-label*="pages" i], [aria-label*="páginas" i]');
  const box = el.parentElement?.localName === "li" ? el.parentElement.parentElement : el.parentElement;
  if (!pager && !(box && Array.from(box.querySelectorAll("a[href]")).filter((a) => /^\d{1,4}$/.test(textIn(a))).length >= 2)) return s;
  const hint = `${tokens(el)} ${el.parentElement ? tokens(el.parentElement) : ""} ${el.getAttribute("rel") ?? ""}`;
  const k = /next|siguiente|sig\b/i.test(hint) ? "next" : /last|[uú]ltim/i.test(hint) ? "last" : /prev|anterior/i.test(hint) ? "previous" : /first|primer/i.test(hint) ? "first" : "";
  const sym = s.replace(/\s/g, "");
  const shape = /^(>|›|→|»)$/.test(sym) ? "next" : /^(>>|››|»»)$/.test(sym) ? "last" : /^(<|‹|←|«)$/.test(sym) ? "previous" : /^(<<|‹‹|««)$/.test(sym) ? "first" : "";
  const which = k || shape;
  return which === "next" ? t("next") : which === "last" ? t("lastPage") : which === "previous" ? t("previous") : which === "first" ? t("firstPage") : s;
}

/** A submit button or a control inside a form: the form needs it whatever it says. */
function formControl(el: Element, ctx?: Ctx | null): boolean {
  if (el.getAttribute("type") === "submit") return true;
  if (el instanceof HTMLButtonElement && !el.getAttribute("type") && el.form) return !pageWide(el.form);
  return !!ctx?.formRef && !ctx.pageForm;
}

/** A share link, or a control in a share bar: "Email" that opens a blank mail, "Print" beside "Share". */
function shareTarget(el: Element, href: string | undefined): boolean {
  if (href && /^mailto:(\?|$)|sharer|share\?|intent\/tweet|addtoany|sharethis/i.test(href)) return true;
  for (let a = el.parentElement, i = 0; a && a !== document.body && i < 5; a = a.parentElement, i++) {
    if (/(^|[\s_-])(share|shares|sharing|sharebar|social)($|[\s_-])/i.test(tokens(a)) || /\b(share|compartir)\b/i.test(a.getAttribute("aria-label") ?? "")) return true;
    // A small tool row that also holds "Share" is a share bar.
    if (i < 2 && tlen(a) < 120 && Array.from(a.querySelectorAll("a, button, [role=button]")).some((o) => o !== el && SHARE_LABEL.test(textIn(o) || clean(o.getAttribute("aria-label"))))) return true;
  }
  return false;
}

/**
 * "Close" on a panel of choices the page shows (a map's layer chooser: a
 * heading, radios, checkboxes) is how the user puts it away, not a banner's
 * dismiss. A dialog's own close button is Sift's sheet's.
 */
function closesPanel(b: Element, ctx: Ctx | null): boolean {
  if (ctx?.inDialog || !/^(close|cerrar|×|✕)$/i.test(accName(b))) return false;
  for (let a = b.parentElement, i = 0; a && a !== document.body && i < 4; a = a.parentElement, i++) {
    if (a.querySelector(HEADING_SEL)) return Array.from(a.querySelectorAll("input[type=radio], input[type=checkbox], select")).some((c) => c.checkVisibility());
  }
  // A named main region of its own (Google Maps' place opened beside the results) closes back to the page.
  const region = b.closest("[role=main][aria-label]");
  return !!region && region !== document.querySelector("main, [role=main]") && !!region.querySelector("h1");
}

/**
 * The feed entry or post around `el`, when it links to itself by its headline (a quick post's cover link named by
 * its headline): its "Copy link" copies that same address (The Verge home, F1033).
 */
function headlinedEntry(el: Element): boolean {
  const e = el.closest("article, [role=article], li, [role=listitem]");
  if (!e || tlen(e) > 3000 || !e.querySelector("p")) return false;
  return Array.from(e.querySelectorAll("a[href]")).some((a) => {
    const n = textIn(a) || clean(a.getAttribute("aria-label"));
    return n.length >= 20 && /\s/.test(n) && !inPage(a) && !a.contains(el);
  });
}

export function usefulControl(el: Element, label: string, ctx: Ctx | null = null): boolean {
  if (!label) return false;
  const inForm = formControl(el, ctx);
  // "Sign up" or "Donate" is the point of a landing or charity page, and noise
  // beside a story or in the site's chrome.
  if (PROMO_LABEL.test(label) && !inForm && (!ctx || ctx.articleEl || ctx.inArticle || !inMain(el))) return false;
  const href = el instanceof HTMLAnchorElement ? hrefOf(el) : undefined;
  // "Copy", "Copy code", "Copy link" copy what the page may never show (a share link, an invite code): they stay,
  // except in a share bar, and "Copy link" beside a story, where they copy the page's own address (F904).
  // In a dialog (a Drive-style 'Share "Bakery recipes"'), copying is the dialog's main action: its own name or class does not make it a share bar.
  if (COPY_LABEL.test(label)) return (!!ctx?.inDialog || !shareTarget(el, href)) && !(/link|enlace/i.test(label) && !ctx?.inDialog && (ctx?.inArticle || headlinedEntry(el)));
  if (SKIP_LABEL.test(label) || SHARE_LABEL.test(label) || (SHARE_MAYBE.test(label) && shareTarget(el, href))) return (inForm && !/^(×|✕|x)$/i.test(label)) || closesPanel(el, ctx);
  // "More" or "Menu" that opens a page is a link ("More" on Hacker News); as a button it is a widget toggle.
  // Quantity steppers ("+" named "More", "−") next to a number field are real controls.
  const stepper = () => {
    const box = el.parentElement?.parentElement ?? el.parentElement;
    return !!box?.querySelector("input[type=number], [role=spinbutton], input[inputmode=numeric]");
  };
  // A row's or page's overflow menu ("More", "⋮" that opens Rename, Download, Delete) is how its actions are reached.
  const overflow = overflowMenu(el, label);
  // On a consent prompt, "More options" is one of its choices (the way to choose purposes, F1034).
  if (SKIP_EXACT.test(label) && !overflow && !(href && !inPage(el) && /^(more|menu|\.\.\.|…)$/i.test(label)) && !(/^more$/i.test(label) && !href && stepper()) && !(ctx?.inDialog && /^more options$/i.test(label) && el.closest(CMP_SEL))) return false;
  if (/^[\p{P}\p{S}\s]{1,3}$/u.test(label) && !overflow && !stepper()) return false;
  // A link to a social network is a follow or share button, except in a post's own text
  // (a comment that is just "https://x.com/…") or when it shows its own address.
  if (href && SOCIAL_HOSTS.test(hostOf(href)) && !hostOf(href).endsWith(location.hostname.replace(/^www\./, "")) && !ctx?.inPost && !/^(https?:\/\/|www\.)\S+$/i.test(label)) return false;
  // A link that goes through an ad server ("Play it now!" to doubleclick) is an ad.
  if (href && AD_HOSTS.test(hostOf(href))) return false;
  // Wiki editing tools ("v · t · e" on a template, "View source", "View history") are for editors, not readers.
  if (label.length === 1 && /\btemplate\b/i.test(`${el.getAttribute("title") ?? ""} ${el.querySelector("abbr[title]")?.getAttribute("title") ?? ""}`)) return false;
  if (href && /[?&](action=(edit|history|info|raw|purge)|veaction=edit)\b/.test(href)) return false;
  // A post's edit history ("Last edited by trusktr") and its menu ("Issue body actions") say nothing of what it says.
  if (/^(last edited by|(issue body|comment|post|review) actions)\b/i.test(label)) return false;
  // An avatar that links where the name beside it links ("@trusktr's profile", then "trusktr") is that link again.
  if (href && pictureTwin(el)) return false;
  // A carousel's dots ("Page 1", "Page 2") only move the slides.
  // A bare number is a dot only outside the slides: a size picker set in a swiper's slides is a choice (F937).
  if (!href && /^((page|slide|item) )?\d+$/i.test(label) && el.closest("[class*=carousel], [class*=slick], [class*=swiper], [class*=slider], [class*=glide]") && (!/^\d+$/.test(label) || slideDot(el))) return false;
  if (href && /^mailto:\?|sharer|share\?|intent\/tweet|pinterest\.com\/pin\/create|news\.google\.com|google\.com\/preferences\/source|profile\.google\.com\/cp\/|trust-?project/i.test(href)) return false;
  return true;
}

/**
 * A number-only button that moves a carousel ("1 2 3" under TOI's slider): it sits outside the slides,
 * in a dots or pagination box, says "slide" or "page" in its name, or its row counts up from 1.
 */
function slideDot(el: Element): boolean {
  if (el.closest(".swiper-slide, .slick-slide, .glide__slide, .splide__slide, .carousel-item, [aria-roledescription=slide]")) return false;
  // A "qty-slider" or "range-slider" with no slides has no dots.
  const CAR = "[class*=carousel], [class*=slick], [class*=swiper], [class*=slider], [class*=glide]";
  let car = el.closest(CAR);
  for (let i = 0; car && !car.querySelector("[class*=slide]:not([class*=slider]), .carousel-item, [aria-roledescription=slide]"); i++) car = i < 4 ? (car.parentElement?.closest(CAR) ?? null) : null;
  if (!car) return false;
  if (el.closest("[class*=dots], [class*=pagination], [class*=bullet], [class*=indicator], [role=tablist]")) return true;
  if (/\b(slide|page|go to)\b/i.test(el.getAttribute("aria-label") ?? "")) return true;
  const row = el.parentElement?.localName === "li" ? el.parentElement.parentElement : el.parentElement;
  const first = row?.querySelector("button, [role=button], a");
  return !!first && textIn(first) === "1";
}

// Boxes with more than 6 links, per pass, so a wall of 3000 pictures climbs into its list once, not once per picture.
const manyLinks = new WeakMap<Element, number>();

/** A link with no words of its own, only a picture, near a link with words to the same place. */
function pictureTwin(a: Element): boolean {
  if (textIn(a) || !a.querySelector("img, svg, picture")) return false;
  const href = (a as HTMLAnchorElement).href;
  let box = a.parentElement;
  for (let i = 0; box && i < 4; i++, box = box.parentElement) {
    if (manyLinks.get(box) === passNo()) break;
    const links = box.querySelectorAll("a[href]");
    if (links.length > 6) {
      manyLinks.set(box, passNo());
      break;
    }
    for (const b of Array.from(links)) if (b !== a && (b as HTMLAnchorElement).href === href && textIn(b) && visible(b)) return true;
  }
  return false;
}

/** A label for a checkbox the page keeps hidden: pressing it opens or closes a panel drawn with CSS. */
function checkboxToggle(l: Element): boolean {
  const c = (l as HTMLLabelElement).control;
  return c instanceof HTMLInputElement && c.type === "checkbox" && !visible(c);
}

/** Words that sell another product of the site: listen to its radio, play its games, get its app. */
const CTA_SELL = /(^|[^\p{L}])(escuch[aá]r?|listen|play|jug[aá]r?|descarg[aá]r?|download|watch now|mir[aá]|the app|la app|our app|nuestra app|try it|prob[aá]|descubr[ií]|discover)(?!\p{L})/iu;
/** A sign-in, account or help link is a real action, never a cross-promotion. */
const CTA_REAL = /log ?in|sign ?(in|up|on)|register|account|help|support|contact|ayuda|soporte|iniciar sesi|ingres[aá]|cuenta|registr|contacto/i;

/** One button-styled link to another of the site's own products (a subdomain), beside a slogan of a few words, and nothing else to read or use. */
function ctaStrip(el: Element): boolean {
  const links = el.querySelectorAll("a[href]");
  if (links.length !== 1 || el.querySelector(`${HEADING_SEL}, ul, ol, form, input, button, video, iframe, p`)) return false;
  const a = links[0] as HTMLAnchorElement;
  if (!/(^|[\s_-])(ds-)?(button|btn|cta)($|[\s_-])/i.test(tokens(a)) || !a.hostname || a.hostname === location.hostname) return false;
  // Only a strip that sells ("Escuchá + música"), never "Already have an account? Log in" or "Need help?".
  const said = `${textIn(a)} · ${textIn(el)}`;
  if (!CTA_SELL.test(said) || CTA_REAL.test(`${said} ${a.hostname} ${a.pathname}`)) return false;
  // The same site: "masmusica.lanacion.com.ar" from "www.lanacion.com.ar".
  const site = (h: string) => {
    const p = h.split(".");
    return p.slice(/^(com|co|org|net|gov|edu|ac|gob)$/.test(p[p.length - 2] ?? "") ? -3 : -2).join(".");
  };
  if (site(a.hostname) !== site(location.hostname)) return false;
  const rest = tlen(el) - tlen(a);
  return rest >= 8 && rest <= 60;
}

/** The appeal asks: a button or link that says "Donate", a heading that makes the appeal, or a link to a donation page. */
function appealAsks(el: Element): boolean {
  for (const c of Array.from(el.querySelectorAll("a[href], button, [role=button], input[type=submit]"))) {
    const label = textIn(c) || clean(c.getAttribute("aria-label")) || clean((c as HTMLInputElement).value);
    if (label.length < 40 && APPEAL_CTA.test(label)) return true;
    if (c.localName === "a" && APPEAL_URL.test(c.getAttribute("href") ?? "")) return true;
  }
  return Array.from(el.querySelectorAll(HEADING_SEL)).some((h) => APPEAL.test(textIn(h)));
}

/**
 * Text with no letters or digits ("| |", "•••", "›") or a bare list number
 * ("1.") reads as a stray fragment. Prices, scores, times and dates are values.
 */
function isFragment(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text) || /^\d{1,3}[.)]$/.test(text.trim());
}

/**
 * The panel of a set of tabs the page shows ("Alternatives | Complete the
 * dish"): whatever its class says ("related content"), it is what the chosen
 * tab shows.
 */
function tabPanel(el: Element): boolean {
  if (el.closest("[role=tabpanel]")) return true;
  // The tab widget itself says so ("tabbed-pocket", "tabs") and holds the tab buttons beside this panel.
  for (let a = el.parentElement, i = 0; a && i < 4 && a !== document.body; a = a.parentElement, i++) {
    if (!/(^|[\s_-])(tabs?|tabbed|tab-?panels?|tab-?container)([\s_-]|$)/i.test(tokens(a))) continue;
    const tab = a.querySelector("[role=tab], [role=tablist], [class*=tab-button], [class*=tab-btn]");
    if (tab && !el.contains(tab)) return true;
  }
  return false;
}

/** A link without an address that a script makes clickable: a click handler, a tab stop, or a pointer cursor. */
function clickableAnchor(e: Element): boolean {
  // An empty href ("") is a link to this page, styled as a link by the browser: not a script's button.
  if (e.hasAttribute("href")) return false;
  return e.hasAttribute("onclick") || e.hasAttribute("tabindex") || e.hasAttribute("data-action") || getComputedStyle(e).cursor === "pointer";
}

/** A link to "#" that a script handles in place (a question that opens its answer), not a mark to scroll to. */
function scriptLink(e: Element): boolean {
  // data-sift-click: the page gave it a click listener of its own (src/main/index.ts marks it).
  return e.hasAttribute("onclick") || e.hasAttribute("data-sift-click") || e.hasAttribute("data-action") || e.hasAttribute("aria-expanded") || e.hasAttribute("aria-controls") || e.hasAttribute("aria-haspopup") || e.getAttribute("role") === "button";
}

/** An in-page anchor ("#step-1"), which is not a destination. */
function inPage(a: Element): boolean {
  const raw = a.getAttribute("href") ?? "";
  if (raw.startsWith("#")) return true;
  const h = (a as HTMLAnchorElement).href;
  return !!h && h.split("#")[0] === location.href.split("#")[0] && h.includes("#");
}

/**
 * A link to the very entry it sits in (a live blog post's time, "?page=with:block-1#block-1"):
 * the post's own permalink, not another page it names.
 */
function selfLink(a: Element): boolean {
  const h = (a as HTMLAnchorElement).href;
  const i = h ? h.indexOf("#") : -1;
  if (i < 0 || h.slice(0, i).split("?")[0] !== location.href.split("#")[0].split("?")[0]) return false;
  const id = decodeURIComponent(h.slice(i + 1));
  return !!id && !!a.parentElement?.closest(`[id="${CSS.escape(id)}"]`);
}

// ---------- inline content ----------

/** Child nodes as rendered: a <slot> shows its assigned nodes, not its fallback. */
function childNodesOf(n: Node): Node[] {
  if (n.nodeType === 1 && (n as Element).localName === "slot") {
    const as = (n as HTMLSlotElement).assignedNodes({ flatten: true });
    if (as.length) return as;
  }
  return Array.from(n.childNodes);
}

/** An icon-sized picture whose alt is a word that means something ("Not included", "Yes"), not a logo, a file name or the words beside it. */
function iconWord(img: HTMLImageElement, alt: string): boolean {
  if (alt.length > 40 || LOGO_NAME.test(alt) || /\.(png|jpe?g|gif|svg|webp)$/i.test(alt)) return false;
  const w = img.width || img.getBoundingClientRect().width, h = img.height || img.getBoundingClientRect().height;
  if (!w || !h || w > 32 || h > 32) return false;
  const around = img.parentElement ? textIn(img.parentElement).toLowerCase() : "";
  return !around.includes(alt.toLowerCase());
}

export function inlineOf(el: Element, ctx: Ctx | null = null, buttons = false): Inline[] {
  return inlineNodes(childNodesOf(el), ctx, buttons);
}

/**
 * Inline content of a run of sibling nodes (text with its links and emphasis).
 * With `buttons`, small buttons stay in place as clickable words (a version
 * number in a table cell); otherwise controls are left to the walker.
 */
export function inlineNodes(nodes: Node[], ctx: Ctx | null = null, buttons = false): Inline[] {
  const out: Inline[] = [];
  // The last characters written, for the same joining rules as the text reader
  // (dom.ts): "$19."+"99" stays a price, "EXCLUSIVE"+"Insiders" are two words.
  let tail = "";
  const put = (x: Inline) => {
    out.push(x);
    const s = typeof x === "string" ? x : "a" in x ? x.a : "b" in x ? x.b : "i" in x ? x.i : "code" in x ? x.code : "\n";
    if (s) tail = s.length >= 2 ? s.slice(-2) : (tail + s).slice(-2);
  };
  // Where the links said so far go.
  const hrefsSaid = new Set<string>();
  // Keep the spaces around inline elements: "esperaba,<b> Patricia</b>".
  const padded = (e: Element, node: Inline) => {
    const raw = textInRaw(e);
    if (/^\s/.test(raw)) put(" ");
    put(node);
    if (/\s$/.test(raw)) put(" ");
  };
  // Children of a node without building arrays; a <slot> gives its assigned nodes.
  const walkIn = (n: Node) => {
    const host = n.nodeType === 11 ? (n as ShadowRoot).host : (n as Element);
    if (n.nodeType === 1 && (n as Element).localName === "slot") walk(childNodesOf(n), null, host.parentElement);
    else walk(null, n.firstChild, host);
  };
  const walk = (list: Node[] | null, first: ChildNode | null, parent: Element | null) => {
    // The element that wrote the text just before, at this level.
    let prev: Element | null = null;
    let cited = false;
    const sep = (e: Element, t: string) => {
      if (spaceBefore(tail, t, e, prev, parent)) put(" ");
    };
    let i = 0;
    for (let c: Node | undefined | null = list ? list[0] : first; c; c = list ? list[++i] : c.nextSibling) {
      if (c.nodeType === 3) {
        // Icon-font glyphs (Private Use Area) are pictures, not text.
        const tx = (c.textContent ?? "").replace(/\s+/g, " ").replace(/[\ue000-\uf8ff]|\udb80[\udc00-\udfff]/g, "");
        if (!tx) continue;
        // "1990s.[1]Next" without its citation mark is two sentences.
        if ((prev && spaceAfter(prev, tail, tx)) || (cited && /[.!?]$/.test(tail) && /^\p{Lu}/u.test(tx))) put(" ");
        put(tx);
        prev = null;
        cited = false;
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      const tag = e.localName;
      if (tag === "slot") {
        walkIn(e);
        continue;
      }
      if (buttons && (tag === "button" || e.getAttribute("role") === "button") && visible(e)) {
        let label = labelOf(e);
        // A short value whose meaning is an icon's tooltip (MDN's "26.2" drawn as "Partial support") says it,
        // and so do the marks after it ("49" with "See implementation notes.").
        const tips = label.length <= 16 ? Array.from(e.querySelectorAll("abbr[title]"), (a) => clean(a.getAttribute("title"))) : [];
        // A plain value already means full support; partial, none and notes are said.
        const said = tips.map((tip) => (tip.split(/\s[–—-]\s/).pop() ?? "").replace(/\.$/, "")).filter((l) => l && !label.includes(l) && !/^full support$/i.test(l));
        // In a table cell the marks show short ("71 no, flag *"), so a wide compatibility table fits (F962);
        // the full words stay its name, for screen readers and as its tooltip.
        const brief = said.length && e.closest("td, th") ? briefMarks(label, said) : "";
        if (said.length) label = `${label} (${said.join(", ")})`;
        if (label) {
          // It shows its own words when its name only says more about them ("Edit" named "Edit order 1006",
          // a calendar's "3" named "November 3, 2026"); the name stays for screen readers.
          const vis = textIn(e);
          const shown = brief || (vis && vis !== label && !said.length && vis.length <= 40 && /[\p{L}\p{N}]/u.test(vis) && (e.hasAttribute("aria-label") || e.hasAttribute("aria-labelledby")) ? vis : label);
          sep(e, shown);
          // A button stays a button, with its state: open (the cell's history), chosen (a calendar's day), disabled (a booked day).
          const part: Extract<Inline, { a: string }> = { a: shown, ref: refOf(e), btn: true };
          if (shown !== label) part.name = label;
          const ex = e.getAttribute("aria-expanded");
          if (ex === "true" || ex === "false") part.expanded = ex === "true";
          const pr = e.getAttribute("aria-pressed") ?? e.getAttribute("aria-selected") ?? e.closest("[role=gridcell][aria-selected]")?.getAttribute("aria-selected");
          if (pr === "true" || pr === "false") part.pressed = pr === "true";
          if ((e as HTMLButtonElement).disabled || e.getAttribute("aria-disabled") === "true") part.disabled = true;
          put(part);
          prev = e;
        }
        continue;
      }
      // An icon that names itself ("Not included", "Yes" drawn as a cross or a tick) says its words (F1010).
      if (tag === "svg" && e.getAttribute("role") === "img" && e.getAttribute("aria-hidden") !== "true" && visible(e)) {
        const label = clean(e.getAttribute("aria-label")) || (e.hasAttribute("aria-labelledby") ? accName(e) : "");
        if (label && !LOGO_NAME.test(label) && !/(^|\W)logo(\W|$)/i.test(`${e.getAttribute("class") ?? ""} ${e.getAttribute("category") ?? ""}`)) {
          sep(e, label);
          put(label);
          prev = e;
        }
        continue;
      }
      if (SKIP.has(tag) || tag === "button" || tag === "input" || tag === "select" || tag === "textarea") continue;
      // A visual copy ("$19.99") of screen-reader text that Sift drops is what people read,
      // and so is a separator kept from screen readers ("Coffee shop · 1 Ferry Building").
      if (e.getAttribute("aria-hidden") === "true" && !visualTwin(e) && !/^\s*[·•|]\s*$/.test(e.textContent ?? "")) continue;
      if (!visible(e)) continue;
      if (isAd(e) || ctx?.drop?.(e)) continue;
      // A wiki's editing chrome inside a cell (a template's "v · d · e" links) is no part of its text.
      if (!INLINE.has(tag) && e.matches(WIKI_CHROME)) continue;
      if (tag === "br") {
        put({ br: true });
        prev = null;
        continue;
      }
      if (isCitation(e)) {
        cited = true;
        continue;
      }
      // A picture drawn by CSS that names itself ("4.8 stars", "Wheelchair accessible entrance"),
      // or a rating whose digits are drawn for the eye only ("4.2" inside "4.2 stars 1,204 reviews").
      if (e.getAttribute("role") === "img" && tag !== "img" && (!textIn(e) || clean(e.getAttribute("aria-label")).includes(textIn(e)))) {
        const label = clean(e.getAttribute("aria-label"));
        if (label) {
          sep(e, label);
          put(label);
          prev = e;
        }
        continue;
      }
      // A rating drawn as stars is read by its name ("4 out of 5 stars").
      if (e.hasAttribute("aria-label")) {
        const g = glyphName(e, textIn(e));
        if (g) {
          sep(e, g);
          put(g);
          prev = e;
          continue;
        }
      }
      // A label that names a field elsewhere is read with that field, not twice.
      if (tag === "label") {
        const c = (e as HTMLLabelElement).control;
        if (c && !e.contains(c) && visible(c)) continue;
      }
      if (tag === "img") {
        const alt = clean((e as HTMLImageElement).alt);
        // Keep emoji-like inline images as their alt text, and an icon that says what it means
        // ("Not included" drawn as a cross beside a feature) unless the words beside it say it already (F1010).
        if (alt && (alt.length <= 3 || iconWord(e as HTMLImageElement, alt))) {
          sep(e, alt);
          put(alt);
          prev = e;
        }
        continue;
      }
      if (tag === "a" && (e as HTMLAnchorElement).href) {
        // An in-page jump drawn only by CSS ("^" back to the citation) has nothing to read,
        // and one back to where a note was cited ("Jump up to: 1 2") goes nowhere in Sift.
        // An icon a script runs, named by its aria-label ("Previous page" on "#back"), is a control; a disabled one does nothing.
        // (A heading's own anchor, "Permalink: Install" or "Direct link to Install", goes nowhere in Sift.)
        const iconCtl = !textIn(e) && e.hasAttribute("aria-label") && e.getAttribute("aria-disabled") !== "true" && !BACKLINK.test(clean(e.getAttribute("aria-label"))) && !ANCHOR_NAME.test(clean(e.getAttribute("aria-label"))) && inPage(e) && usefulControl(e, labelOf(e), ctx);
        if (inPage(e) && !iconCtl && (!textIn(e) || BACKLINK.test(textIn(e)) || BACKLINK.test(clean(e.getAttribute("aria-label"))) || (textIn(e).length <= 3 && !!e.parentElement && /^(\^|↑|jump up)/i.test(textIn(e.parentElement))))) continue;
        let label = textIn(e) || accName(e);
        // A pager's arrow ("›", ">>") says where it goes.
        if (label.length <= 3 && /^[<>‹›«»←→\s]+$/.test(label)) label = pagerLabel(e, label);
        // A link that is only a logo ("Wikibooks logo") says nothing in a sentence,
        // and an avatar beside the name it shows ("JoviDeCroock JoviDeCroock") says it twice.
        if (!textIn(e) && (/(^|\W)(logo|icon)(\W|$)/i.test(label) || (!!e.parentElement && linkWords(e.parentElement).has(label)))) continue;
        // Picture-only links side by side (badges, flags, a topic's posters) each stay a link by its name,
        // never glued to the one before; in a row of avatars the name says whose ("llogiq", not "llogiq's profile").
        if (!textIn(e) && (pictureLink(e.previousElementSibling) || pictureLink(e.nextElementSibling))) {
          label = label.replace(/^(profile of|perfil de)\s+(?=\S)|(?<=\S)['’]s profile$/i, "");
          if (prev && pictureLink(prev) && tail && !/\s$/.test(tail)) put(" ");
        }
        // A long link to "#" in a story (a key point a script scrolls to) goes nowhere in Sift: it reads as text.
        // Elsewhere it is kept: a script may handle it in place (a question that opens its answer).
        if (e.getAttribute("href") === "#" && label.length >= 60 && (!ctx || ctx.inArticle) && !scriptLink(e)) {
          sep(e, textInRaw(e));
          put(textInRaw(e));
          prev = e;
          continue;
        }
        if (label) {
          const href = hrefOf(e) ?? (e as HTMLAnchorElement).href;
          sep(e, textInRaw(e) || label);
          // A long excerpt that links again where its title links (a pinned topic's text) reads as text.
          if (label.length >= 60 && hrefsSaid.has(href)) padded(e, label);
          else padded(e, { a: label, href, ref: refOf(e) });
          hrefsSaid.add(href);
          prev = e;
        }
        continue;
      }
      // A link without an address that scripts make clickable ("clear") is still something to click.
      if (tag === "a" && clickableAnchor(e)) {
        const label = labelOf(e);
        if (label) {
          sep(e, textInRaw(e) || label);
          padded(e, { a: label, ref: refOf(e) });
          prev = e;
        }
        continue;
      }
      if ((tag === "b" || tag === "strong") && !e.querySelector("a")) {
        const tx = textIn(e);
        if (tx) {
          sep(e, textInRaw(e));
          padded(e, { b: tx });
          prev = e;
        } else if (/\s/.test(e.textContent ?? "")) put(" "); // "people<strong>&nbsp;</strong>were" (Fox): the space stays.
        continue;
      }
      if ((tag === "em" || tag === "i") && !e.querySelector("a")) {
        const tx = textIn(e);
        if (tx) {
          sep(e, textInRaw(e));
          padded(e, { i: tx });
          prev = e;
        } else if (/\s/.test(e.textContent ?? "")) put(" ");
        continue;
      }
      if ((tag === "code" || tag === "kbd") && !e.querySelector("a")) {
        const tx = clean(e.textContent);
        if (tx) {
          sep(e, textInRaw(e) || tx);
          padded(e, { code: tx });
          prev = e;
        }
        continue;
      }
      const block = !INLINE.has(tag);
      if (block) put(" ");
      else sep(e, textInRaw(e));
      const sr = shadowOf(e);
      const before = out.length;
      walkIn(sr ?? e);
      if (block) put(" ");
      if (out.length > before) prev = block ? null : e;
    }
  };
  const first = nodes[0];
  const parent = first ? (first.parentNode?.nodeType === 11 ? (first.parentNode as ShadowRoot).host : first.parentElement) : null;
  walk(nodes, null, parent);
  return tidy(out);
}

// Per-pass lookups for picture-only links, built once per container so a
// wall of a thousand photos or avatars costs one scan, not one per photo.
const wordedHrefCache = new WeakMap<Element, { pass: number; set: Set<string> }>();
const linkWordCache = new WeakMap<Element, { pass: number; set: Set<string> }>();

/** Addresses of the links with words under a container. */
function wordedHrefs(c: Element): Set<string> {
  const hit = wordedHrefCache.get(c);
  if (hit && hit.pass === passNo()) return hit.set;
  const set = new Set<string>();
  for (const o of Array.from(c.querySelectorAll("a[href]"))) if (textIn(o)) set.add((o as HTMLAnchorElement).href);
  wordedHrefCache.set(c, { pass: passNo(), set });
  return set;
}

/** The words of the links under a container. */
function linkWords(c: Element): Set<string> {
  const hit = linkWordCache.get(c);
  if (hit && hit.pass === passNo()) return hit.set;
  const set = new Set<string>();
  for (const o of Array.from(c.querySelectorAll("a"))) {
    const w = textIn(o);
    if (w) set.add(w);
  }
  linkWordCache.set(c, { pass: passNo(), set });
  return set;
}

/**
 * A link to a picture file around that picture, with no words of its own but
 * its file name and size (Discourse shows "signal-2026-10-18-101319 · 800×772
 * 66.8 KB" on hover): a screenshot in a post, shown as the picture rather than
 * a link named after its file.
 */
function linkedShot(a: Element, ctx: Ctx): { img: HTMLImageElement; im: Img } | null {
  if (!/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test((a as HTMLAnchorElement).pathname ?? "")) return null;
  const imgs = a.querySelectorAll("img");
  if (imgs.length !== 1) return null;
  const img = imgs[0] as HTMLImageElement;
  let rest = textIn(a);
  for (const n of [clean(img.alt), clean(a.getAttribute("title"))]) if (n) rest = rest.split(n).join(" ");
  rest = rest.replace(/\d+\s*[×x]\s*\d+|\d+([.,]\d+)?\s*(bytes|[kmg]i?b)\b/gi, " ");
  if (/[\p{L}\p{N}]/u.test(rest) || !visible(img)) return null;
  const im = contentImage(img, { ...ctx, inArticle: true }, 150, 100);
  return im ? { img, im } : null;
}

/** A link that is only a picture (a badge, a flag, an avatar). */
function pictureLink(c: Element | null): boolean {
  return !!c && c.localName === "a" && c.hasAttribute("href") && !!c.querySelector("img") && !textIn(c);
}

/** Links from a note back to where it was cited ("^", "↑", "Jump up to: 1"). */
/** The name of a heading's own anchor link ("Permalink: Install", "Direct link to Install", "Link to this section"). */
const ANCHOR_NAME = /^(permalink|(direct |permanent |copy )?link( to)?\b|anchor|(jump|skip|scroll|go) to)/i;
const BACKLINK = /^(\^|↑|↩|jump up( to:?)?( [\da-z]{1,3})?|back to (text|citation|reference))$/i;

/** Citation markers like [1] or [citation needed] are noise when reading. */
function isCitation(e: Element): boolean {
  return e.localName === "sup" && !!e.querySelector("a") && /^\[?[\d\w\s,–-]{0,20}\]?$/.test(clean(e.textContent));
}

export function tidy(parts: Inline[]): Inline[] {
  // Word-joiner marks sit between adjacent inline elements; they become a space
  // only when both sides are letters or digits.
  const merged: Inline[] = [];
  const endsWord = (x: Inline | undefined) => {
    const s = typeof x === "string" ? x : x && "a" in x ? x.a : x && "b" in x ? x.b : x && "i" in x ? x.i : x && "code" in x ? x.code : "";
    return /[\p{L}\p{N}.!?;:,]$/u.test(s);
  };
  const startsWord = (x: Inline | undefined) => {
    const s = typeof x === "string" ? x : x && "a" in x ? x.a : x && "b" in x ? x.b : x && "i" in x ? x.i : x && "code" in x ? x.code : "";
    return /^[\p{L}\p{N}]/u.test(s);
  };
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    if (p === "⁠") {
      p = endsWord(merged[merged.length - 1]) && startsWord(parts[i + 1]) ? " " : "";
      if (!p) continue;
    } else if (typeof p === "string") p = p.replace(/⁠/g, "");
    const last = merged[merged.length - 1];
    if (typeof p === "string" && typeof last === "string") merged[merged.length - 1] = (last + p).replace(/ {2,}/g, " ");
    else merged.push(p);
  }
  // Trim leading and trailing whitespace and line breaks.
  while (merged.length && (typeof merged[0] === "string" ? !(merged[0] as string).trim() : "br" in (merged[0] as object))) merged.shift();
  while (merged.length) {
    const l = merged[merged.length - 1];
    if (typeof l === "string" ? !l.trim() : "br" in (l as object)) merged.pop();
    else break;
  }
  // Separators whose links were hidden or dropped ("1 hour ago | | [–]") collapse to one.
  for (let i = 0; i < merged.length; i++) if (typeof merged[i] === "string") merged[i] = (merged[i] as string).replace(/([|·•])(\s*[|·•])+/g, "$1");
  if (typeof merged[0] === "string") merged[0] = (merged[0] as string).trimStart();
  const li = merged.length - 1;
  if (li >= 0 && typeof merged[li] === "string") merged[li] = (merged[li] as string).trimEnd();
  return merged.filter((p) => p !== "");
}

/**
 * A short run of text that is only there to sell a newsletter, app, or follow.
 * Inside a story only a plug that is mostly its link counts ("Sign up HERE to
 * our newsletter"), never a sentence that mentions one.
 */
function isPromo(c: Inline[], inArticle = false): boolean {
  let linked = 0;
  for (const x of c) if (typeof x === "object" && "a" in x) linked += x.a.length;
  if (!linked) return false;
  const s = textOf(c);
  if (s.length >= 200 || (inArticle && linked < s.length * 0.4)) return false;
  return promoText(s);
}

/** Cards that sell rather than tell: an all-caps "SHOPPING" or "SPONSORED" tag at either end of the title. */
const SELL_TAG = /^(SHOPPING|AFFILIATE|SPONSORED|PROMOTED|ADVERTISEMENT|PATROCINADO|PUBLICIDAD)\b|\b(SHOPPING|AFFILIATE|SPONSORED|PROMOTED|ADVERTISEMENT|PATROCINADO|PUBLICIDAD)$/;
/** Cards that call to action rather than tell a story: "VISIT OUR ROYALS CHANNEL", "Enter your zip code here", "Use our search tool". */
const CTA_TITLE =
  /\b(click|tap|sign up|subscribe|enter [\w\s]{1,30}|find out more|more from [\w\s]{1,30}) here[!.]?$|^(subscribe to|sign up( for| to)?|download) (our|the|your|more|us)\b|^(visit|explore|discover|check out|get more|join|follow|listen to) (our|your|us)\b|\b(use|try) our [\w\s]{1,30}(tool|calculator|map|quiz|search|tracker|finder)\b|\benter your (zip|post) ?code\b|^welcome to (the |our )?[\w\s'’]{1,30}$|\bexplore the collection\b/i;
/** "… HERE" in capitals ends a call to action ("Get more from DC Insider HERE"); "The robots are here" is a story. */
const CTA_CAPS = /\bHERE[!.]?$/;

const PLAY_CTA = /^(jugar|jug[aá] ahora|play|play now|start playing|jouer|spielen)$/i;
/** Words that SPONSORED_SECTION or PLAY_HEAD need, to skip reading most title lines. */
const SECTION_HINT = /sponsor|promot|partner|paid|around the web|patrocinado|shopping|content lab|play|games|jug/i;
/** A section header that sells the site's games ("Play now · Explore Games >"). */
const PLAY_HEAD = /\b(play now|explore games|more games|all games|jug[aá] ahora)\b/i;

/** Promo words a headline may use too ("Thousands sign up for free bread classes", "Four-day week free trial ends"). */
const TITLE_PROMO_WEAK = /sign up (here|for|to)|free trial|prueba gratis|newsletter|bolet[ií]n|join our|applications are open|we're hiring|all access|whatsapp channel|canal de whatsapp|download (our|the) ([\w'’-]+ ){0,3}app\b|descarg[aá] (la|nuestra) app/gi;

/**
 * A card that sells or calls to action rather than tells a story. Words a
 * headline may also use count only when the card leads to a sign-up, the app,
 * or another site.
 */
function promoCard(title: string, href?: string): boolean {
  if (SELL_TAG.test(title) || CTA_CAPS.test(title)) return true;
  if (title.length >= 120) return false;
  if (CTA_TITLE.test(title)) return true;
  if (!promoText(title)) return false;
  if (promoText(title.replace(TITLE_PROMO_WEAK, " "))) return true;
  // "Sign up to First Edition" (or "… launches The Spotlight: Sign up for …") asks; "Thousands sign up for bread classes" tells.
  if (/(^|[:.!?|–—]\s*|\s-\s)(sign up|join our|subscribe|follow|download|descarg[aá]|s[ií]gue)\b/i.test(title)) return true;
  // A card that leads to a WhatsApp or Telegram channel sells it; one that leads to a story tells about it.
  return !href || promoHref(href) || SOCIAL_HOSTS.test(hostOf(href));
}

/** A promo word that names a whole part of a link's path, or starts it ("/subscribe", "/sign-up-for-first-edition"). */
const PROMO_PATH_HEAD = /^(sign-?up|subscri[a-z]*|newsletters?|register|apps?|download|join|membership|free-?trial|offers?)([-_.]|$)/i;
/** One that ends a short part ("/football-daily-email-sign-up", "/email-newsletters"). */
const PROMO_PATH_TAIL = /[-_](sign-?up|subscribe|newsletters?|register|app|download|join|membership|free-?trial|offers?)$/i;

/**
 * A sweepstakes banner (Booking's "No purchase necessary… $5,000 Cruise Giveaway… Enter here"): a small box
 * with a heading and a link and no fields, that says the contest's legal line or links to its entry page.
 * It sells, and its heading is never the page's (F858).
 */
function sweepstakes(el: Element): boolean {
  const n = tlen(el);
  if (n < 20 || n > 500 || el.localName === "p" || !el.querySelector(HEADING_SEL) || !el.querySelector("a[href]") || el.querySelector("input, select, textarea")) return false;
  const promo =
    /\bno purchase necessary\b|\bsin obligaci[oó]n de compra\b/i.test(el.textContent ?? "") ||
    Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]")).some((a) => {
      // A post filed under "Giveaways" (/category/giveaways/) is not a promo for one.
      if (/\b(tag|category)\b/i.test(a.rel)) return false;
      try {
        const segs = new URL(a.href).pathname.split("/");
        return segs.some((seg, i) => /^(sweepstakes?|giveaways?|sorteos?)(\.\w+)?$/i.test(seg) && !/^(categor(y|ies|ia|[ií]as)|cat|tags?|topics?|labels?|etiquetas?|temas?|archives?)$/i.test(segs[i - 1] ?? ""));
      } catch {
        return false;
      }
    });
  return promo && !ownContest(el);
}

/**
 * A box that is the page's own content, not a promo on top of it (F936): the contest page's own heading
 * (the document is titled so), the page's main region, or one entry of a list of same-shaped cards.
 */
function ownContest(el: Element): boolean {
  if (el.matches("main, [role=main]") || el.querySelector("main, [role=main]")) return true;
  const h = textIn(el.querySelector(HEADING_SEL)!).toLowerCase();
  if (h.length > 3 && document.title.replace(/\s+/g, " ").toLowerCase().includes(h)) return true;
  const cls = el.getAttribute("class") ?? "";
  for (const s of Array.from(el.parentElement?.children ?? [])) {
    if (s !== el && s.localName === el.localName && (s.getAttribute("class") ?? "") === cls && s.querySelector(HEADING_SEL)) return true;
  }
  return false;
}

/** A heading inside a sweepstakes banner. */
function inSweepstakes(h: Element): boolean {
  for (let a: Element | null = h; a && a !== document.body; a = a.parentElement) {
    if (tlen(a) > 500) return false;
    if (sweepstakes(a)) return true;
  }
  return false;
}

/**
 * A link to a sign-up, subscription or app page. A story's slug repeats its
 * headline ("thousands-sign-up-for-free-bread-classes"), so a promo word
 * inside a long slug says nothing, and neither does another site's address.
 */
function promoHref(href: string): boolean {
  let path = "";
  try {
    path = new URL(href, location.href).pathname;
  } catch {
    return false;
  }
  return path.split("/").some((seg) => PROMO_PATH_HEAD.test(seg) || (PROMO_PATH_TAIL.test(seg) && seg.split(/[-_]+/).length <= 5));
}

/** An element classed as the entry's title ("p.title", "div.result-title"), with a title's length. */
function titleHolder(el: Element): Element | null {
  for (const h of Array.from(el.querySelectorAll('[class~="title" i], [class*="-title" i], [class*="_title" i]')).slice(0, 4)) {
    if (h.querySelector(HEADING_SEL) || /sub-?title|list-?title/i.test(h.getAttribute("class") ?? "")) continue;
    // A title is words, not an identifier with its download links ("arXiv:2603.28957 [pdf, ps]").
    if (h.querySelectorAll("a[href]").length > 1) continue;
    const n = textIn(h).length;
    if (n >= 10 && n <= 300) return h;
  }
  return null;
}

/** A vote arrow: a link named or classed "upvote" or "vote" (Lobsters' a.upvoter, Hacker News' .votearrow). */
function voteLink(a: Element): boolean {
  if (textIn(a).length > 12) return false;
  const inner = a.firstElementChild;
  return /(^|[\s_-])(up-?)?vot(e|er|ers|earrow|ing)?($|[\s_-])|upvote/i.test(`${tokens(a)} ${a.getAttribute("title") ?? ""} ${a.getAttribute("aria-label") ?? ""} ${inner ? `${tokens(inner)} ${inner.getAttribute("title") ?? ""}` : ""}`) || /[?&/](up)?vote\b/i.test(a.getAttribute("href") ?? "");
}

/** A link or button that acts on the entry (report, flag, share, reply) rather than opening it. */
function actionLabel(label: string): boolean {
  return ITEM_ACTION_NOISE.test(label) || TOOL_TITLE.test(label) || SHARE_LABEL.test(label) || /^(report( abuse| this)?|flag|reply|responder|edit|delete|remove|helpful|not helpful|unhelpful|write a review|hide|past|favorite|un-?vote|upvote|downvote|vote)$/i.test(label);
}

function hasDirectText(el: Element): boolean {
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test(c.nodeValue ?? "")) return true;
  return false;
}

function isInlineish(el: Element): boolean {
  const tag = el.localName;
  // A picture that names itself ("4.2 stars" drawn as five boxes) reads as its name, in the line.
  if (el.getAttribute("role") === "img" && el.hasAttribute("aria-label")) return true;
  if (INLINE.has(tag)) return !blockInside(el);
  if (tag.includes("-")) {
    const d = getComputedStyle(el).display;
    return d.startsWith("inline") && !blockInside(el);
  }
  return false;
}

/** Holds a block element, not counting the boxes a named picture is drawn with. */
function blockInside(el: Element): boolean {
  if (!el.querySelector(BLOCK_SEL)) return false;
  if (!el.querySelector("[role=img][aria-label]")) return true;
  return Array.from(el.querySelectorAll(BLOCK_SEL)).some((b) => {
    const pic = b.closest("[role=img][aria-label]");
    return !pic || !el.contains(pic);
  });
}

/** Holds a picture big enough to be content, which inline text handling would drop. */
function hasBigImage(el: Element): boolean {
  const img = el.localName === "img" ? el : el.querySelector("img");
  return !!img && img.getBoundingClientRect().width >= 100;
}

function isTextBlock(el: Element): boolean {
  if (hasControl(el)) return false;
  let inline: boolean;
  if (hasDirectText(el)) inline = !Array.from(el.children).some((c) => visible(c) && !isInlineish(c) && !SKIP.has(c.localName));
  else {
    const cs = Array.from(el.children).filter((c) => !SKIP.has(c.localName));
    inline = cs.length > 0 && cs.every((c) => isInlineish(c));
  }
  return inline && !hasBigImage(el);
}

// ---------- images, media, surfaces ----------

/**
 * A lazy photo the hidden original never scrolled to, sized by its height alone (width:auto in a
 * box with an aspect ratio: the Mirror's in-story photos), has no width until it loads: its box's
 * width stands for it (F1039). Its own width otherwise.
 */
function lazyWidth(img: HTMLImageElement, r: DOMRect = img.getBoundingClientRect()): number {
  if (r.width || img.naturalWidth || r.height < 50) return r.width;
  if (!(img.loading === "lazy" || img.hasAttribute("srcset") || img.hasAttribute("data-src"))) return 0;
  return img.parentElement?.getBoundingClientRect().width ?? 0;
}

export function contentImage(img: HTMLImageElement, ctx: Ctx, minW = 160, minH = 100): Img | null {
  const r = img.getBoundingClientRect();
  const src = imgSrc(img);
  if (!src || src.startsWith("data:image/gif")) return null;
  const w = r.width || img.naturalWidth || lazyWidth(img, r);
  let h = r.height || img.naturalHeight;
  // A lazy photo the hidden original never scrolled to has not loaded (BBC at narrow widths): it has
  // its width but no height yet. Its size attributes, else a 16:9 guess, stand for it.
  if (!h && !img.naturalWidth && w >= minW && (img.loading === "lazy" || img.hasAttribute("srcset") || img.hasAttribute("data-src"))) {
    const aw = Number(img.getAttribute("width")) || 0;
    const ah = Number(img.getAttribute("height")) || 0;
    h = aw && ah ? (w * ah) / aw : w * 0.5625;
  }
  if (w < minW || h < minH) return null;
  if (LOGO_TOKEN.test(`${tokens(img)} ${img.alt} ${src.split("?")[0]}`)) return null;
  if (img.closest("a") && !ctx.inArticle && !img.closest("figure")) return null;
  return { src, alt: clean(img.alt ?? img.getAttribute("alt")), w: Math.round(w), h: Math.round(h) };
}

/** The parent element, or the shadow host for the top of a shadow tree. */
function parentOrHost(el: Element): Element | null {
  return el.parentElement ?? ((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
}

/**
 * The element that holds a video and its own controls: ancestors about the
 * video's size. A smaller or collapsed wrapper (one whose player Sift lifted
 * out) is not the player, so the same player is found on every pass.
 */
export function playerOf(video: Element): Element {
  const vr = video.getBoundingClientRect();
  let el: Element = video;
  for (let i = 0; i < 8; i++) {
    const p = parentOrHost(el);
    if (!p || p === document.body) break;
    const r = p.getBoundingClientRect();
    // A box that also holds the story's text or the player's caption is the page, not the player.
    if (Array.from(p.children).some((c) => c !== el && /^(p|h[1-6]|ul|ol|article|section|figcaption|blockquote|table|form)$/.test(c.localName) && tlen(c) > 20)) break;
    if (r.width <= vr.width * 1.15 + 4 && r.height <= vr.height * 1.3 + 4 && r.width >= vr.width - 4 && r.height >= vr.height - 4) el = p;
    else break;
  }
  return el;
}

/** Whether `a` holds `b`, across shadow roots. */
function holds(a: Element, b: Element): boolean {
  for (let n: Element | null = b; n; n = parentOrHost(n)) if (n === a) return true;
  return false;
}

/** One portal per player or surface: never one inside another, or around one. */
function claimPortal(el: Element, ctx: Ctx): boolean {
  ctx.portals ??= [];
  if (ctx.portals.some((p) => p === el || holds(p, el) || holds(el, p))) return false;
  ctx.portals.push(el);
  return true;
}

/** A portal's name: short, cut at a word, with stray HTML entities decoded ("HTML Demo: &lt;details&gt;"). */
function portalLabel(s: string): string {
  let x = clean(s);
  if (/&[#\w]+;/.test(x)) {
    const ta = document.createElement("textarea");
    ta.innerHTML = x;
    x = clean(ta.value);
  }
  // Sift adds its own period after the name.
  if (x.length <= 80) return x.replace(/[\s.]+$/, "");
  // Cut after a whole sentence or part ("Map · Use arrow keys to pan the map"), else at a word.
  const cut = x.slice(0, 81);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" · "), cut.endsWith(".") ? 80 : -1);
  if (end > 20) return cut.slice(0, end).replace(/[\s,;:·.-]+$/, "");
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut.slice(0, 80)).replace(/[\s,;:·.-]+$/, "") + "…";
}

/** A host name that says nothing to a reader ("2820e4598277ee24911b9e1b6fe9c6cda64bcc7d.mdnplay.dev"). */
function hashHost(host: string): boolean {
  const first = host.split(".")[0];
  return /^[0-9a-f]{16,}$/i.test(first) || (first.length >= 24 && /\d/.test(first) && /^[0-9a-z]+$/i.test(first));
}

/** A content warning or guidance note on a player. */
const WARNING = /upsetting|distressing|disturbing|graphic|warning|guidance|viewer discretion|sensitive|advertencia|contenido sensible|im[aá]genes sensibles/i;

/** Words a player shows over its video besides its controls and times ("Contains upsetting scenes"). */
function playerNote(player: Element): string {
  let s = "";
  let warn = "";
  const tw = document.createTreeWalker(player, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n && s.length < 80; n = tw.nextNode()) {
    const v = clean(n.nodeValue);
    const own = n.parentElement;
    // The caption under the player names it already.
    if (!v || !own || !/\p{L}{3}/u.test(v) || !visible(own) || own.closest("figcaption")) continue;
    // A warning printed on the play button ("Contains upsetting scenes") is still the player's note.
    const warning = WARNING.test(v) || WARNING.test(tokens(own));
    if (!warning && own.closest("button, [role=button], [role=slider], [aria-hidden=true], select, option, label")) continue;
    if (/^(play|pause|mute|unmute|live|play video|watch|\d+:\d+.*|loaded:.*|duration.*|current time.*|.*\b\d+ (seconds?|segundos?|minutes?|minutos?)\b.*|volume.*|volumen.*|\d+%)$/i.test(v)) continue;
    if (warning && !warn && v.length <= 80) warn = v;
    s += (s ? " " : "") + v;
  }
  return s.length <= 80 ? s : warn;
}

/** Generic frame titles that say nothing about what is in it. */
const VAGUE_LABEL = /^(runner|iframe|frame|embed|embedded content|content|player|video player|widget|untitled|null|undefined)$/i;

/** A caption or heading that names an embedded thing: its figure's caption, else the heading just before it. */
function nearbyName(el: Element): string {
  const fig = el.closest("figure");
  const cap = fig?.querySelector("figcaption");
  if (cap && textIn(cap)) return textIn(cap);
  // A caption right after the player's box, with no <figure> around them (BBC: div > player + figcaption).
  const next = fig ? null : siblingCaption(el, el);
  if (next && textIn(next)) return textIn(next);
  let prev: Element | null = el;
  for (let i = 0; prev && i < 4; i++) {
    const s = prev.previousElementSibling;
    if (s) {
      if (heading(s)) return textIn(s);
      break;
    }
    prev = prev.parentElement;
  }
  return "";
}

/**
 * A map or app surface, not a whole app or post that only carries
 * role=application: those have their own text and links to read.
 */
function surfaceOnly(el: Element): boolean {
  if (el.getAttribute("role") !== "application") return true;
  return !el.querySelector("h1, h2, h3, p, article") && el.querySelectorAll("a[href]").length < 5;
}

function surfaceBlock(el: Element, label: string, ctx: Ctx | null = null): Block | null {
  const r = el.getBoundingClientRect();
  if (r.width < 300 || r.height < 200) return null;
  if (ctx && !claimPortal(el, ctx)) return null;
  // A map says it is a map; an editor or example says what it is.
  const isMap = el.matches(".leaflet-container, .maplibregl-map, .mapboxgl-map, .ol-viewport, gmp-map, [aria-roledescription=map]") || /\bmap\b/i.test(el.getAttribute("aria-label") ?? "");
  let name = portalLabel(label || el.getAttribute("aria-label") || "");
  if (!name || VAGUE_LABEL.test(name)) name = portalLabel(nearbyName(el));
  if (isMap && !/\b(map|mapa)\b/i.test(name)) name = name ? `${t("map")} · ${name}` : t("map");
  // A small map set beside a listing (Craigslist's 300 px one) keeps its size: it is a detail, not the page's tool.
  // Measured before Sift lifts it into its own box, which then sets its size.
  if (!el.hasAttribute("data-sift-portal")) ownWidth.set(el, r.width);
  const w = ownWidth.get(el) ?? r.width;
  return {
    t: "portal", key: "v:" + refOf(el), ref: refOf(el), ratio: Math.min(r.height / Math.max(1, r.width), 1.2),
    label: name || t("interactive"), tool: true, maxWidth: w < 480 && w < innerWidth * 0.6 ? Math.round(w) : undefined,
  };
}
/**
 * An interactive chart or map of data: a big SVG of many shapes with its own
 * select or buttons, and no prose or title of the story around it.
 */
function dataWidget(el: Element): boolean {
  if (SKIP.has(el.localName) || /^(svg|img|figure|a|button|p|li|table|ul|ol|form|select)$/.test(el.localName) || tlen(el) > 4000) return false;
  if (!el.querySelector("select, button, [role=button]") || el.querySelector("h1, h2, article, video, iframe")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 300 || r.height < 250 || r.height > innerHeight * 2.5) return false;
  // Prose in it, in <p>s or as runs of text between <br>s (TOI's story box), makes it the story, not a widget.
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if ((n.nodeValue?.length ?? 0) > 150 && !SKIP.has(n.parentElement?.localName ?? "") && clean(n.nodeValue).length > 150) return false;
  return Array.from(el.querySelectorAll("svg")).some((s) => {
    const q = s.getBoundingClientRect();
    return q.width >= 250 && q.height >= 200 && s.querySelectorAll("path, polygon").length >= 20;
  });
}

/**
 * A small chart in a story (La Nación's seat charts: an SVG of a few arcs with each side's seats
 * beside it): its short labels and numbers say little apart from the drawing (F929).
 */
function dataChart(el: Element): boolean {
  if (SKIP.has(el.localName) || /^(svg|img|figure|a|button|p|li|table|ul|ol|form|select)$/.test(el.localName) || tlen(el) > 400) return false;
  if (el.querySelector("h1, h2, h3, h4, a[href], button, input, select, textarea, video, img, iframe:not([aria-hidden=true])") || el.closest("a[href], button")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 300 || r.height < 200 || r.height > innerHeight * 1.5) return false;
  const parts = chartParts(el);
  const nums = parts.filter((s) => NUM_PART.test(s)).length;
  if (nums < 3 || nums * 3 < parts.length || parts.some((s) => s.length > 40)) return false;
  return Array.from(el.querySelectorAll("svg")).some((s) => {
    const q = s.getBoundingClientRect();
    return q.width >= 200 && q.height >= 100 && s.querySelectorAll("path, rect, circle, polygon").length >= 2;
  });
}
const NUM_PART = /^[\d.,%\s+-]+$/;

/** A map's name or class ("Mapa de Sudamérica…", "ln-nd-mapa-gobiernos"). */
const MAP_HINT = /(^|[^\p{L}])(maps?|mapas?|cartes?|karten?|choropleth)([^\p{L}]|$)/iu;

/**
 * A map drawn in SVG in a story (La Nación's two maps of South America, each country colored
 * left or right): its title, legend, years and notes say little apart from the drawing, and its
 * country names are drawing text. Kept as a picture with its title and legend, like a chart (F1037).
 */
function dataMap(el: Element): boolean {
  if (SKIP.has(el.localName) || /^(svg|img|figure|a|button|p|li|table|ul|ol|form|select)$/.test(el.localName) || tlen(el) > 1200) return false;
  const svgs = Array.from(el.querySelectorAll("svg"));
  if (!svgs.length || el.querySelector("h1, h2, h3, h4, a[href], button, input, select, textarea, video, img, iframe:not([aria-hidden=true])") || el.closest("a[href], button")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 300 || r.height < 200 || r.height > innerHeight * 2.5) return false;
  // Its words outside the drawing are a title, a legend and short notes, not prose.
  const parts = chartParts(el);
  if (parts.length > 16 || parts.some((p) => p.length > 160)) return false;
  return svgs.some((s) => {
    const q = s.getBoundingClientRect();
    if (q.width < 200 || q.height < 150 || s.querySelectorAll("path, polygon").length < 8) return false;
    return MAP_HINT.test(`${s.getAttribute("aria-label") ?? ""} ${tokens(s)} ${tokens(el)}`);
  });
}

/** A map said in words for its name: its title and legend, then each drawing's places as it names them ("Argentina: Izquierda"). */
function mapLabel(el: Element): string {
  const said = chartParts(el).join(" · ");
  const maps: string[] = [];
  for (const s of Array.from(el.querySelectorAll("svg"))) {
    const named = Array.from(s.querySelectorAll("[aria-label]")).map((x) => clean(x.getAttribute("aria-label")));
    const texts = Array.from(s.querySelectorAll("text")).map((x) => clean(x.textContent));
    const places = Array.from(new Set((named.some(Boolean) ? named : texts).filter(Boolean)));
    if (!places.length) continue;
    const own = clean(s.getAttribute("aria-label"));
    maps.push((own ? own + ": " : "") + places.join(", "));
  }
  return [said, ...maps].map((x) => x.replace(/[\s.]+$/, "")).filter(Boolean).join(". ");
}

/** A chart's words and numbers in order, outside its drawing. */
function chartParts(el: Element): string[] {
  const out: string[] = [];
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const v = clean(n.nodeValue);
    if (v && !n.parentElement?.closest("svg, style, script") && visible(n.parentElement!)) out.push(v);
  }
  return out;
}

/** A chart said in words for its name: "Diputados: PT + Aliados 124 · Bolsonarismo 131 · … · 513 bancas". */
function chartLabel(name: string, el: Element): string {
  const parts = chartParts(el);
  const said = parts.map((s, i) => (i === 0 ? "" : (NUM_PART.test(s) && !NUM_PART.test(parts[i - 1])) || (i === parts.length - 1 && NUM_PART.test(parts[i - 1])) ? " " : " · ") + s).join("");
  return name ? `${name}: ${said}` : said;
}

/** A working surface's width on the page, before Sift showed it in its own box. */
const ownWidth = new WeakMap<Element, number>();

function portalBlock(el: Element, ctx: Ctx): Block | null {
  const tag = el.localName;
  const r = el.getBoundingClientRect();
  if (tag === "iframe") {
    const src = (el as HTMLIFrameElement).src || "";
    if (r.width < 60 || r.height < 30) return null;
    if (isAdSize(r.width, r.height) && !EMBED_HOST.test(src)) return null;
    if (!EMBED_HOST.test(src) && (r.width < 250 || r.height < 120)) return null;
    // Same-origin frames: extract their content instead of showing them raw.
    const doc = sameOriginDoc(el as HTMLIFrameElement);
    if (doc && doc.body && textIn(doc.body).length > 50 && !EMBED_HOST.test(src)) return null;
    if (!claimPortal(el, ctx)) return null;
    let label = portalLabel(el.getAttribute("title") || el.getAttribute("aria-label") || "");
    // An untitled frame as wide as the page is the page's own tool (BART's "Trip Planner"): it takes the page's name.
    const wide = (el.hasAttribute("data-sift-portal") && el.parentElement ? el.parentElement : el).getBoundingClientRect().width >= innerWidth * 0.6;
    if (!label || VAGUE_LABEL.test(label)) label = portalLabel(nearbyName(el)) || (/maps?\.|\/maps/.test(src) ? t("map") : (wide && portalLabel(clean(document.title).split(/\s+[|\-–—·•]\s+/)[0])) || (hostOf(src) && !hashHost(hostOf(src)) ? `${t("example")} · ${hostOf(src)}` : t("example")));
    // A map, a code runner, a document or a payment form is a tool; a video, a post or a chart is part of what is told.
    const tool = TOOL_HOST.test(src) || undefined;
    return { t: "portal", key: "v:" + refOf(el), ref: refOf(el), ratio: r.height / Math.max(1, r.width), label, maxWidth: Math.round(r.width), tool };
  }
  if (tag === "video") {
    if (r.width < 200 || r.height < 112) return null;
    const player = playerOf(el);
    if (!claimPortal(player, ctx)) return null;
    // The player's own controls, poster, settings and overlay ("Play video") are the portal's, not page content.
    ctx.used.add(player);
    for (const c of Array.from(player.querySelectorAll("*"))) ctx.used.add(c);
    const pr = player.getBoundingClientRect();
    const name = portalLabel(el.getAttribute("aria-label") || el.getAttribute("title") || player.getAttribute("aria-label") || nearbyName(player)) || t("video");
    // A warning the player shows over the video ("Contains upsetting scenes") is part of its name.
    const note = playerNote(player);
    return {
      t: "portal", key: "v:" + refOf(player), ref: refOf(player), ratio: pr.height / Math.max(1, pr.width),
      label: note && !name.includes(note) ? `${name} · ${note}` : name,
      media: { video: refOf(el) },
    };
  }
  if (tag === "audio") {
    // A podcast or audio clip with its own controls stays playable.
    if (!(el as HTMLAudioElement).controls || r.width < 100 || r.height < 20) return null;
    return {
      t: "portal", key: "v:" + refOf(el), ref: refOf(el), ratio: r.height / Math.max(1, r.width),
      label: clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title")) || t("audio"), maxWidth: Math.round(r.width),
    };
  }
  if (tag === "canvas" || tag === "embed" || tag === "object") return surfaceBlock(el, "", ctx);
  return null;
}

/**
 * Click-to-load players: a poster with a play button that loads the real
 * player on click (JW Player facades, lite-youtube). Hints that an element is one.
 */
const FACADE_SEL =
  "[data-has-jwplayer], [data-video-id], [data-video-id-jw], [data-jw-media-id], [data-youtube-id], [data-videoid], lite-youtube, lite-vimeo, lite-player, [class*=facade i], [id^=facade], [class*=video-player i], [class*=videoplayer i], [class*=video-poster i], [class*=lazy-video i], [class*=lazy-youtube i]";
const FACADE_TOKEN = /(^|[\s_-])(facade|lite-?(youtube|vimeo)|video-?(player|poster|placeholder|facade|preview)|videoplayer|player-?(poster|placeholder|facade)|lazy-?(video|youtube|player)|yt-?lite)($|[\s_-])/i;
const PLAY_TOKEN = /(^|[\s_-])(play|play-?(button|btn|icon)|button-?play|btn-?play|big-?play(-?button)?|lty-playbtn|ytp-large-play-button|vjs-big-play-button)($|[\s_-])/i;

function facadeHint(el: Element): boolean {
  return /^lite-/.test(el.localName) || el.hasAttribute("data-has-jwplayer") || el.hasAttribute("data-video-id") || el.hasAttribute("data-video-id-jw") || el.hasAttribute("data-youtube-id") || FACADE_TOKEN.test(tokens(el));
}

/** The control that starts a facade: a play button, else the facade itself when it is the click target. */
function playTarget(el: Element): Element | null {
  for (const c of Array.from(el.querySelectorAll("*")).slice(0, 200)) {
    const label = `${c.getAttribute("aria-label") ?? ""} ${c.getAttribute("title") ?? ""}`;
    if (PLAY_TOKEN.test(tokens(c)) || /\b(play|reproducir|reproduzir|lire|abspielen|riproduci)\b/i.test(label)) return c;
  }
  if (/^lite-/.test(el.localName) || el.getAttribute("role") === "button" || getComputedStyle(el).cursor === "pointer") return el;
  const pointer = Array.from(el.children).find((c) => getComputedStyle(c).cursor === "pointer" && tlen(c) < 40);
  return pointer ?? null;
}

/** A click-to-load player, shown as a video whose Play button starts the real one. */
function facadeBlock(el: Element, ctx: Ctx): Block | null {
  if (el.querySelector("iframe")) return null;
  let r = el.getBoundingClientRect();
  // A player box that takes its height from its frame (Fox's video-player, 0 px tall in a 16:9 box) has the frame's size.
  for (let p = el.parentElement, i = 0; r.height < 1 && p && i < 2; p = p.parentElement, i++) {
    const pr = p.getBoundingClientRect();
    if (Math.abs(pr.width - r.width) < 2 && pr.height >= 112) r = pr;
  }
  if (r.width < 200 || r.height < 112) return null;
  // Once loaded, the same box holds the real video: it stays the same portal (same key, same name), now with its video.
  const video = el.querySelector("video") ?? deepQuery(el, "video");
  if (video) {
    const vr = video.getBoundingClientRect();
    if (vr.width < 200 || r.width * r.height > vr.width * vr.height * 2.2) return null;
  } else if (tlen(el) > 200) return null;
  const play = video ? null : playTarget(el);
  if ((!video && !play) || !claimPortal(el, ctx)) return null;
  ctx.used.add(el);
  for (const c of Array.from(el.querySelectorAll("*"))) ctx.used.add(c);
  let cfg = "";
  try {
    cfg = clean(JSON.parse(el.getAttribute("data-config") ?? "{}")?.title);
  } catch {
    cfg = "";
  }
  const img = el.querySelector("img");
  const name = portalLabel(el.getAttribute("aria-label") || el.getAttribute("title") || cfg || nearbyName(el) || clean(img?.alt) || clean(el.getAttribute("videotitle"))) || t("video");
  // A box the site gives an aspect ratio, made taller by a tall poster (La Nación's vertical videos: a
  // 16:9 box 1051 px tall until its player loads, F924), keeps the shape its player will have.
  let ratio = r.height / Math.max(1, r.width);
  const ar = /([\d.]+)\s*\/\s*([\d.]+)/.exec(getComputedStyle(el).aspectRatio);
  if (ar && +ar[1] > 0 && +ar[2] / +ar[1] < ratio * 0.8) ratio = +ar[2] / +ar[1];
  return { t: "portal", key: "v:" + refOf(el), ref: refOf(el), ratio, label: name, media: video ? { video: refOf(video) } : { play: refOf(play!) } };
}

/**
 * A photo you click to see bigger: a button (or role=button box) that holds a
 * content picture and at most its caption ("La crecida del arroyo…" over a
 * lightbox, a shop's zoomable gallery photo). It reads as the photo.
 */
function photoButton(el: Element): boolean {
  if (el.localName !== "button" && el.getAttribute("role") !== "button") return false;
  if (el.localName === "input" || el.querySelector(HEADING_SEL + ", p:not(figcaption p), ul, ol, input, select, textarea")) return false;
  const img = el.querySelector("img");
  if (!img || lazyWidth(img) < 160) return false;
  const cap = el.querySelector("figcaption");
  return tlen(el) - (cap ? tlen(cap) : 0) <= 20;
}

/** querySelector through nested open or closed shadow roots, a few levels deep. */
function deepQuery(root: ParentNode, sel: string, depth = 3): Element | null {
  const hit = root.querySelector(sel);
  if (hit || depth <= 0) return hit;
  for (const e of Array.from(root.querySelectorAll("*"))) {
    if (!e.localName.includes("-")) continue;
    const sr = shadowOf(e);
    const h = sr && deepQuery(sr, sel, depth - 1);
    if (h) return h;
  }
  return null;
}

/**
 * Widgets Sift cannot read but must keep usable: a custom element whose
 * (often closed) shadow root holds a player, a canvas, or an editor.
 */
function widgetBlock(el: Element, ctx: Ctx): Block | null {
  const sr = shadowOf(el);
  if (!sr) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 280 || r.height < 150) return null;
  // Players nest their <video> in more components (BBC: smp-toucan-player > smp-playback).
  const video = sr.querySelector("video") ?? deepQuery(sr, "video");
  if (video && video.getBoundingClientRect().width >= 200) return portalBlock(video, ctx);
  const isClosed = !(el as HTMLElement).shadowRoot;
  const label = clean(el.getAttribute("name")) || accName(el);
  // Editors and canvases are tools ("Try it" playgrounds nest them in more shadow roots).
  if (deepQuery(sr, "textarea, [contenteditable], .cm-editor, .monaco-editor")) return surfaceBlock(el, label || t("editor"), ctx);
  if (isClosed || deepQuery(sr, "canvas")) return surfaceBlock(el, label, ctx);
  // A frame alone is a tool only when the component has little readable text of its own.
  if (sr.querySelector("iframe") && !sr.querySelector("p, h1, h2, h3, h4, li")) return surfaceBlock(el, label, ctx);
  return null;
}

const challengeWatched = new WeakSet<Element>();

/** The box that holds a Cloudflare check's response field (the check's frame is beside it, in a closed shadow root). */
function turnstileBox(el: Element): boolean {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "input" && ((c as HTMLInputElement).name === "cf-turnstile-response" || c.id.startsWith("cf-chl-widget"))) return true;
  return false;
}

/** The box of a Cloudflare check (Turnstile) around its response field, as a tool portal named by its frame (F956). */
function challengeBlock(el: Element, ctx: Ctx): Block | null {
  const r = el.getBoundingClientRect();
  if (r.width < 100 || r.height < 40) {
    // Its frame is drawn a moment later in its closed shadow root, which no change in the page tells:
    // once the box has its size, the page is read again.
    if (!challengeWatched.has(el) && typeof ResizeObserver === "function") {
      challengeWatched.add(el);
      const ro = new ResizeObserver(() => {
        const q = el.getBoundingClientRect();
        if (!el.isConnected) ro.disconnect();
        else if (q.width >= 100 && q.height >= 40) {
          ro.disconnect();
          document.dispatchEvent(new CustomEvent("sift-reread"));
        }
      });
      ro.observe(el);
    }
    return null;
  }
  if (!visible(el) || !claimPortal(el, ctx)) return null;
  let label = "";
  let w = r.width;
  for (const c of Array.from(el.children)) {
    try {
      const f = ((c as HTMLElement).shadowRoot ?? (chrome.dom?.openOrClosedShadowRoot?.(c as HTMLElement) as ShadowRoot | null))?.querySelector("iframe");
      label ||= clean(f?.getAttribute("title"));
      // The checkbox's frame (300 px) in a wider box (650 px): the portal is the frame's width.
      const fw = f?.getBoundingClientRect().width ?? 0;
      if (fw >= 100 && fw < w) w = fw;
    } catch {}
  }
  label = portalLabel(label || clean(el.querySelector("iframe[title]")?.getAttribute("title")) || nearbyName(el));
  return { t: "portal", key: "v:" + refOf(el), ref: refOf(el), ratio: r.height / Math.max(1, w), label: label || t("interactive"), maxWidth: Math.round(w), tool: true };
}

function sameOriginDoc(f: HTMLIFrameElement): Document | null {
  try {
    return f.contentDocument;
  } catch {
    return null;
  }
}

// ---------- controls ----------

const INPUT_KINDS: Record<string, FieldKind> = {
  text: "text", search: "search", email: "email", password: "password", number: "number", tel: "tel",
  url: "url", date: "date", time: "time", "datetime-local": "datetime-local", month: "month", week: "week",
  color: "color", range: "range", checkbox: "checkbox", radio: "radio", file: "file",
};

/** A field's name as words ("first_name" reads "first name"); codes like "q" or "f12" are no label. */
function humanName(name: string): string {
  const s = clean(name.replace(/[_\-[\].]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
  // A coder's name ("inputstring", "txtField", "aspnetForm") says what the field is in code, not what to type.
  if (/input|string|txt|field|param|ctl|ctrl|(^|\s)form|form$|^(val|value)$/i.test(s)) return "";
  return /^\p{L}{3,}/u.test(s) && !/\d/.test(s) ? s.toLowerCase() : "";
}

/** What the page says is wrong with a field it marks invalid: its aria-errormessage, else the error among what describes it. */
function fieldError(el: Element): string | undefined {
  const root = el.getRootNode() as Document | ShadowRoot;
  const byIds = (attr: string) =>
    (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean).map((id) => root.getElementById?.(id)).filter((x): x is HTMLElement => !!x && x.checkVisibility());
  const msg = byIds("aria-errormessage");
  const err = msg.length ? msg : byIds("aria-describedby").filter((d) => d.getAttribute("role") === "alert" || /err|invalid|warn/i.test(d.id + " " + d.className));
  return clean(err.map((d) => d.textContent ?? "").join(" ")).slice(0, 200) || undefined;
}

/** Text as a screen reader reads it: without what the page keeps from it (aria-hidden glyphs), with its screen-reader-only words. */
function heardText(el: Element): string {
  let s = "";
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) s += c.nodeValue;
      else if (c.nodeType === 1 && (c as Element).getAttribute("aria-hidden") !== "true" && !(c as Element).hasAttribute("hidden") && !/^(script|style|template|noscript)$/.test((c as Element).localName)) {
        s += " ";
        walk(c);
        s += " ";
      }
    }
  };
  walk(el);
  return clean(s);
}

/**
 * What else the page says about a field (its aria-describedby, less its error): a hint, its
 * rules, its message as the user types ("ana is taken"). Read with Sift's field, as on the page.
 */
function fieldDesc(el: Element, error?: string): string | undefined {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  if (!ids.length) return undefined;
  const root = el.getRootNode() as Document | ShadowRoot;
  const parts = ids.map((id) => root.getElementById?.(id)).filter((x): x is HTMLElement => !!x && x !== el && x.checkVisibility()).map(heardText);
  return clean(parts.filter((t) => t && !error?.includes(t)).join(" ")).slice(0, 300) || undefined;
}

/** A placeholder the page draws itself over an empty field (a "…-placeholder" box beside it, over it) names it (F732). */
function drawnPlaceholder(el: Element): string {
  const r = el.getBoundingClientRect();
  for (const c of Array.from(el.parentElement?.children ?? [])) {
    if (c === el || !/placeholder/i.test(tokens(c)) || !visible(c)) continue;
    const b = c.getBoundingClientRect();
    const s = textIn(c);
    if (s && s.length <= 80 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return s;
  }
  return "";
}

export function toField(el: Element): Field | null {
  const ref = refOf(el);
  const invalid = el.getAttribute("aria-invalid") === "true" || undefined;
  const error = invalid && fieldError(el);
  const base = {
    key: "f:" + ref, ref, label: labelOf(el), disabled: (el as HTMLInputElement).disabled || el.getAttribute("aria-disabled") === "true",
    invalid, error, desc: fieldDesc(el, error || undefined),
  };
  if (el instanceof HTMLInputElement) {
    const kind = INPUT_KINDS[el.type] ?? "text";
    return {
      ...base, kind, value: el.value, name: el.name || undefined, placeholder: el.placeholder || undefined,
      checked: kind === "checkbox" || kind === "radio" ? el.checked : undefined,
      required: el.required || undefined, readOnly: el.readOnly || undefined,
      min: el.min || undefined, max: el.max || undefined, step: el.step || undefined,
      autocomplete: el.autocomplete || undefined, accept: el.accept || undefined, multiple: el.multiple || undefined,
      maxLength: el.maxLength >= 0 ? el.maxLength : undefined, minLength: el.minLength > 0 ? el.minLength : undefined, pattern: el.pattern || undefined,
      combo: /^(text|search|email|url|tel)$/.test(kind) && (el.getAttribute("role") === "combobox" || el.parentElement?.getAttribute("role") === "combobox" || !!el.list || /^(list|both)$/.test(el.getAttribute("aria-autocomplete") ?? ""))
        ? el.getAttribute("aria-autocomplete") || "none" : undefined,
      // An unlabeled box is named by its form, when that says what it does (weather.gov's "getForecast").
      label: base.label || clean(el.placeholder) || drawnPlaceholder(el) || humanName(el.name) || (kind === "text" && el.form ? humanName(el.form.getAttribute("name") || el.form.id) : ""),
    };
  }
  if (el instanceof HTMLTextAreaElement) {
    // An unlabeled box in a form is named by what its button does ("add comment").
    const go = !base.label && el.form ? Array.from(el.form.querySelectorAll("input[type=submit], button:not([type=button])")).find((b) => visible(b)) : null;
    const label = base.label || drawnPlaceholder(el) || (go ? clean((go as HTMLInputElement).value) || textIn(go) : "") || humanName(el.name);
    return {
      ...base, label, kind: "textarea", value: el.value, name: el.name || undefined, placeholder: el.placeholder || undefined, required: el.required || undefined, readOnly: el.readOnly || undefined,
      maxLength: el.maxLength >= 0 ? el.maxLength : undefined, minLength: el.minLength > 0 ? el.minLength : undefined,
    };
  }
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options).map((o) => ({ value: o.value, label: clean(o.label || o.text), selected: o.selected, disabled: o.disabled || undefined }));
    return { ...base, kind: "select", value: el.value, name: el.name || undefined, options, multiple: el.multiple || undefined, required: el.required || undefined };
  }
  const role = el.getAttribute("role");
  if (role === "checkbox" || role === "switch" || role === "radio") {
    return { ...base, kind: role === "radio" ? "radio" : "checkbox", value: "", checked: el.getAttribute("aria-checked") === "true" };
  }
  if (role === "slider") {
    // Its text is its value ("5"); unnamed, it is named by the words beside it ("Volume").
    const named = el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.hasAttribute("title");
    const around = el.parentElement ? clean(textIn(el.parentElement).replace(textIn(el), "")) : "";
    const attr = (n: string) => el.getAttribute(n) || undefined;
    return {
      ...base, kind: "range", label: named || around.length > 60 ? base.label : around,
      value: attr("aria-valuenow") ?? "", min: attr("aria-valuemin"), max: attr("aria-valuemax"), valueText: attr("aria-valuetext"),
    };
  }
  // A spinbutton the page draws ("18:00" between "Earlier" and "Later") keeps its role, value and limits;
  // its keys go to the page, which decides the new value (F902).
  if (role === "spinbutton") {
    const attr = (n: string) => el.getAttribute(n) || undefined;
    return {
      ...base, kind: "spinbutton", value: attr("aria-valuenow") ?? "", min: attr("aria-valuemin"), max: attr("aria-valuemax"),
      valueText: attr("aria-valuetext") ?? (clean(textIn(el)) || undefined), readOnly: el.getAttribute("aria-readonly") === "true" || undefined,
    };
  }
  if ((el as HTMLElement).isContentEditable || role === "textbox" || role === "searchbox") {
    return { ...base, kind: "editable", value: (el as HTMLElement).innerText ?? "", placeholder: clean(el.getAttribute("aria-placeholder") || el.getAttribute("placeholder") || el.getAttribute("data-placeholder")) || undefined };
  }
  return null;
}

const PRIMARY_CLASS = /^((btn|button|s-btn|is|c-btn|o-btn)(-|--|__)?)?(primary|cta)((-|--|__)?(btn|button))?$|^[a-z]+-button--(start|primary|cta)$/i;

export function toAction(el: Element, label = labelOf(el)): Action {
  const ref = refOf(el);
  const a: Action = { key: "a:" + ref, label, ref };
  if (el instanceof HTMLAnchorElement && el.getAttribute("href")) a.href = hrefOf(el);
  const role = el.getAttribute("role") ?? "";
  // A tab or listbox option says it is chosen with aria-selected, a menu checkbox with aria-checked.
  const pressed =
    el.getAttribute("aria-pressed") ??
    (role === "tab" || role === "option" ? el.getAttribute("aria-selected") : null) ??
    (/^(menuitemcheckbox|menuitemradio|radio)$/.test(role) ? el.getAttribute("aria-checked") : null) ??
    el.getAttribute("aria-current");
  if (pressed === "true" || pressed === "false" || pressed === "page") a.pressed = pressed !== "false";
  // A site that marks the chosen tab or toggle only with a class ("tab--active", "sel") says so to Sift too.
  else if (!el.hasAttribute("aria-current")) {
    const chosen = classState(el, SELECTED_CLASS);
    if (chosen !== undefined) a.pressed = chosen;
  }
  const exp = el.getAttribute("aria-expanded");
  if (exp === "true" || exp === "false") a.expanded = exp === "true";
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true" || DISABLED_CLASS.test(el.getAttribute("class") ?? "")) a.disabled = true;
  // A form's submit button leads, but only in a form with something to fill in: a page of vote
  // buttons inside one big form (Stack Overflow) is not a page of primary actions.
  const form = (el as HTMLButtonElement).form;
  const explicitSubmit = (el.getAttribute("type") === "submit" || (el instanceof HTMLButtonElement && !el.getAttribute("type") && !!form)) && (!form || !!form.querySelector("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select"));
  // A class that names the button primary ("btn-primary"), not a utility color ("hover:bg-theme-primary-200").
  if (explicitSubmit || Array.from(el.classList).some((c) => PRIMARY_CLASS.test(c))) a.kind = "primary";
  return a;
}

/** Class names that mark the chosen one of a set ("active", "is-selected", "tab-button--active", "sel"). */
const SELECTED_CLASS = /(^|\s)((is-|is_)?(active|selected|current|sel|checked|chosen)|[\w-]+(--|__|-|_)(active|selected|current|checked))(\s|$)/i;
/** Class names that mark a choice that cannot be had ("btn-size disabled", "sold-out"). */
const DISABLED_CLASS = /(^|\s)((is-|is_)?(disabled|unavailable|sold-?out|out-?of-?stock)|[\w-]+(--|__|-|_)(disabled|unavailable|sold-?out))(\s|$)/i;

/**
 * Whether a button is the chosen one of its set by its class alone: it has the
 * marking class and a sibling of its kind does not (true), or a sibling has it
 * and it does not (false). A class every sibling shares marks nothing.
 */
function classState(el: Element, re: RegExp): boolean | undefined {
  const p = el.parentElement;
  if (!p) return undefined;
  // Siblings, or the buttons in the siblings' boxes (each tab wrapped in an <li>).
  const wrapped = p.children.length === 1 && !!p.parentElement && p.localName !== "body";
  const set = classSet(wrapped ? p.parentElement! : p, el.localName, wrapped, re);
  const mine = re.test(el.getAttribute("class") ?? "") || (wrapped && re.test(p.getAttribute("class") ?? ""));
  // The set counts this button too, unless its wrapper is of its own kind and stands for it.
  const self = !wrapped || p.localName !== el.localName ? 1 : 0;
  const peers = set.n - self;
  const marked = set.marked - (self && mine ? 1 : 0);
  if (!peers || peers > 30) return undefined;
  if (mine && marked < peers) return true;
  if (!mine && marked > 0 && marked < peers + 1) return false;
  return undefined;
}

/** Per pass and box: how many buttons of one kind its children are or hold, and how many carry the class. Read once, so a set of a thousand costs one scan. */
const classSetCache = new WeakMap<Element, { pass: number; m: Map<string, { n: number; marked: number }> }>();
function classSet(box: Element, tag: string, wrapped: boolean, re: RegExp): { n: number; marked: number } {
  let c = classSetCache.get(box);
  if (!c || c.pass !== passNo()) classSetCache.set(box, (c = { pass: passNo(), m: new Map() }));
  const k = `${tag} ${wrapped} ${re.source}`;
  let v = c.m.get(k);
  if (v) return v;
  v = { n: 0, marked: 0 };
  for (const ch of Array.from(box.children)) {
    const x = wrapped && ch.localName !== tag ? ch.querySelector(tag) : ch;
    if (!x || x.localName !== tag) continue;
    v.n++;
    if (re.test(x.getAttribute("class") ?? "") || (wrapped && re.test(x.parentElement?.getAttribute("class") ?? ""))) v.marked++;
  }
  c.m.set(k, v);
  return v;
}

function isControl(el: Element): boolean {
  const tag = el.localName;
  if (tag === "button" || tag === "select" || tag === "textarea") return true;
  if (tag === "input") return (el as HTMLInputElement).type !== "hidden";
  const role = el.getAttribute("role");
  if (role && /^(button|checkbox|switch|radio|textbox|searchbox|combobox|tab|menuitem|menuitemcheckbox|menuitemradio|option|slider|spinbutton)$/.test(role)) return true;
  const ce = el.getAttribute("contenteditable");
  if (ce === "" || ce === "true" || ce === "plaintext-only") return !el.parentElement?.closest("[contenteditable]");
  return false;
}

function controlInto(el: Element, out: Out, ctx: Ctx) {
  const tag = el.localName;
  const role = el.getAttribute("role");
  const isFieldish =
    (tag === "input" && !["button", "submit", "reset", "image"].includes((el as HTMLInputElement).type)) ||
    tag === "select" || tag === "textarea" || role === "checkbox" || role === "switch" || role === "radio" || role === "slider" || role === "spinbutton" ||
    role === "textbox" || role === "searchbox" || (el as HTMLElement).isContentEditable;
  if (isFieldish) {
    // A read-only box of text that is not for typing (GitHub's file view keeps the code in one,
    // transparent, under the lines it draws) is that text: shown as code.
    if (el instanceof HTMLTextAreaElement && (el.readOnly || el.getAttribute("aria-readonly") === "true") && el.getAttribute("inputmode") === "none" && el.value.trim()) {
      out.push({ t: "pre", key: "pre:" + refOf(el), text: el.value });
      return;
    }
    // A ghost field drawn under the real one, only to show its inline completion (queryly's "Search Suggestion"), is not a field.
    if (el instanceof HTMLInputElement && el.tabIndex < 0 && ghostField(el)) return;
    const f = toField(el);
    if (!f) return;
    // The search form's language picker, labeled only by its code ("en"), says what it sets.
    const sf = (ctx.searchEl as HTMLInputElement | undefined)?.form;
    if (el instanceof HTMLSelectElement && sf && el.form === sf && f.label.length <= 5 && (/lang/i.test(el.name + " " + el.id) || !!el.querySelector("option[lang]"))) f.label = t("searchLanguage");
    const g = groupOf(el);
    if (g) f.group = g;
    if (f.kind === "radio" || f.kind === "checkbox") {
      const card = choiceCard(el, ctx);
      if (card) {
        f.label = card.name;
        f.detail = card.detail;
      }
    }
    out.field(f, ctx.formRef);
    return;
  }
  // A button that holds a paragraph (a key point that jumps to its place) reads
  // as that paragraph, still clickable.
  const vis = textIn(el);
  if (vis.length > 100 && !ctx.formRef) {
    out.push({ t: "p", key: "p:" + refOf(el), content: [{ a: vis, ref: refOf(el) }] });
    return;
  }
  const label = labelOf(el);
  // An icon that only shows a tooltip (a status page's "Operational" check, its "?" info) says it as text.
  const tip = !ctx.formRef ? tooltipText(el, label) : "";
  if (tip) {
    out.push({ t: "p", key: "p:" + refOf(el), content: [tip], small: true });
    return;
  }
  if (!usefulControl(el, label, ctx)) return;
  // The same gallery offered under every photo of a story ("+6 View gallery" six times) is offered once.
  if (ctx.inArticle && PHOTO_ACTION.test(label)) {
    const k = "gallery:" + label;
    if (ctx.seen.has(k)) return;
    ctx.seen.add(k);
  }
  // Each comment's "Reply", each row's "Delete" and each "120" in a row of
  // versions is its own control, even right after one with the same label.
  out.action(toAction(el, label), ctx.formRef);
}

/**
 * A choice drawn as a card (a plan: its name, price, text and feature list, all in the label around its
 * radio): a short name, the card's heading or first line, and the rest of the card under it, each part
 * on its own, instead of one run-on label cut at 160 characters (F1011). Null for a plain label.
 */
function choiceCard(el: Element, ctx: Ctx): { name: string; detail: Block[] } | null {
  const box = el instanceof HTMLInputElement ? el.closest("label") : el;
  if (!box || tlen(box) < 20 || tlen(box) > 3000 || !box.firstElementChild) return null;
  // A card holds only its choice: a link or another control in it is read the usual way.
  if (Array.from(box.querySelectorAll("input:not([type=hidden]), select, textarea, button, a[href], [role=button], [role=checkbox], [role=radio]")).some((c) => c !== el)) return null;
  const key = "cd:" + refOf(box) + ":";
  const pieces: { el: Element | null; block: Block }[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    const content = inlineNodes(run, ctx);
    run = [];
    if (clean(textOf(content))) pieces.push({ el: null, block: { t: "p", key: key + pieces.length, content } });
  };
  const go = (n: Element) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        run.push(c);
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (e === el) continue;
      const d = getComputedStyle(e).display;
      if (d.startsWith("inline") || d === "contents" || d === "none") {
        run.push(e);
        continue;
      }
      flush();
      if (!visible(e) || e.getAttribute("aria-hidden") === "true") continue;
      if (e.localName === "ul" || e.localName === "ol") {
        const items = Array.from(e.children).filter((li) => visible(li)).map((li) => inlineOf(li, ctx)).filter((x) => clean(textOf(x)));
        if (items.length) pieces.push({ el: e, block: { t: e.localName, key: key + pieces.length, items } });
        continue;
      }
      const at = pieces.length;
      go(e);
      flush();
      if (pieces.length === at + 1 && !pieces[at].el) pieces[at].el = e;
    }
  };
  go(box);
  flush();
  if (pieces.length < 2 || !(pieces.length >= 3 || pieces.some((p) => p.block.t !== "p") || tlen(box) > 80)) return null;
  // The name: a heading in the card, else its first line that is not a badge pinned over it ("Most popular").
  const hd = box.querySelector(HEADING_SEL);
  const badge = (e: Element | null) => !!e && /^(absolute|fixed)$/.test(getComputedStyle(e).position);
  const named =
    (hd && pieces.find((p) => p.el && (p.el === hd || p.el.contains(hd) || hd.contains(p.el)))) ||
    pieces.find((p) => p.block.t === "p" && !badge(p.el));
  if (!named || named.block.t !== "p") return null;
  const name = clean(textOf(named.block.content));
  if (!name || name.length > 80) return null;
  return { name, detail: pieces.filter((p) => p !== named).map((p) => p.block) };
}

const GROUP_SEL = "fieldset, [role=radiogroup], [role=group]";
const GROUP_FIELD = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea, [role=radio], [role=checkbox], [role=switch]";
const checkOrRadio = (f: Element) => /^(checkbox|radio)$/.test((f as HTMLInputElement).type ?? "") || /^(radio|checkbox|switch)$/.test(f.getAttribute("role") ?? "");

/** The fields shown in a group: its own, not those of a group inside it (once per pass: every field asks). */
function groupFields(g: Element): Element[] {
  const c = groupFieldsCache.get(g);
  if (c && c.pass === passNo()) return c.v;
  const v = Array.from(g.querySelectorAll(GROUP_FIELD)).filter((f) => f.parentElement?.closest(GROUP_SEL) === g && visible(f));
  groupFieldsCache.set(g, { pass: passNo(), v });
  return v;
}
const groupFieldsCache = new WeakMap<Element, { pass: number; v: Element[] }>();

/** The name of a group: its legend (even one kept for screen readers), else its own aria name. */
function groupName(g: Element): string {
  const lg = g.localName === "fieldset" ? Array.from(g.children).find((c) => c.localName === "legend") : undefined;
  return (lg ? textIn(lg) || clean(lg.textContent) : "") || clean(g.getAttribute("aria-label")) || (g.hasAttribute("aria-labelledby") ? accName(g) : "");
}

/**
 * The named group a field belongs to ("Payment method" over Card and PayPal):
 * a fieldset with its legend, or a radio group or group with a name, around
 * choices or several fields. A lone text field keeps its own label only.
 */
function groupOf(el: Element): { ref: string; label: string } | undefined {
  const g = el.parentElement?.closest(GROUP_SEL);
  if (!g) return undefined;
  const label = groupName(g);
  if (!label || label.length > 200) return undefined;
  if (!checkOrRadio(el) && groupFields(g).length < 2) return undefined;
  return { ref: refOf(g), label };
}

/** A fieldset's legend that its fields show as their group's name. */
function shownLegend(el: Element): boolean {
  const g = el.parentElement;
  if (!g || g.localName !== "fieldset") return false;
  const fs = groupFields(g);
  return fs.length >= 2 || fs.some(checkOrRadio);
}

/** A field out of the tab order that another field beside it covers exactly. */
function ghostField(el: HTMLInputElement): boolean {
  const r = el.getBoundingClientRect();
  return !!el.parentElement && Array.from(el.parentElement.children).some((c) => {
    if (c === el || c.localName !== "input" || (c as HTMLInputElement).tabIndex < 0) return false;
    const o = c.getBoundingClientRect();
    return Math.abs(o.left - r.left) < 3 && Math.abs(o.top - r.top) < 3 && Math.abs(o.width - r.width) < 3 && Math.abs(o.height - r.height) < 3;
  });
}

/**
 * The words of a button that is only a tooltip's anchor: an icon (or "?")
 * marked by a tooltip library, which opens nothing and does nothing. Its
 * tooltip is what it says. "" for a real button.
 */
function tooltipText(el: Element, label: string): string {
  if (el.hasAttribute("aria-expanded") || el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-pressed") || (el as HTMLButtonElement).type === "submit") return "";
  if (!/^[?iⓘ]?$/.test(textIn(el))) return "";
  const tip = clean(el.getAttribute("data-original-title") || el.getAttribute("data-tooltip") || el.getAttribute("data-tippy-content"));
  if (!tip || tip.length > 300 || !/(^|[\s_-])tool-?tip(ster(ed)?)?($|[\s_-])/i.test(`${tokens(el)} ${el.getAttribute("data-js-hook") ?? ""} ${el.getAttribute("data-toggle") ?? ""}`)) return "";
  // An icon that does something ("Delete", "Copy") is a button whatever its tooltip.
  if (/^(delete|remove|edit|copy|share|save|close|open|add|download|print|like|follow|reply|report|borrar|eliminar|editar|copiar|guardar|cerrar|abrir|agregar|descargar)\b/i.test(label || tip)) return "";
  return tip;
}

// ---------- items (repeated cards) ----------

/** Classes that name what an element is, without state or BEM modifiers. */
function baseClasses(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) => !c.includes("--") && !/active|selected|current|hover|focus|first|last|odd|even|visible|hidden|show|open|separator|featured|highlight|\d/.test(c),
  );
}

function signature(el: Element): string {
  return el.localName + "." + baseClasses(el).sort().slice(0, 2).join(".");
}

/**
 * An empty link drawn over a whole card and named by its headline (The
 * Guardian: <a aria-label="Helen Haines's condition improves…">). It is the
 * card's link; the linked headings under it are other stories.
 */
function coverLink(a: Element): boolean {
  if (/\S/.test(a.textContent ?? "") || a.querySelector("img, svg, picture") || inPage(a)) return false;
  // Unnamed, it is named by the card's heading (Clarín's "Lo más leído"); see coverOf.
  if (a.hasAttribute("aria-label") && !/\p{L}{3}/u.test(a.getAttribute("aria-label") ?? "")) return false;
  const r = a.getBoundingClientRect();
  return r.width >= 120 && r.height >= 50;
}

/** The cover link of a card whose heading (not itself a link) says what the link's name says. */
function coverOf(el: Element, heading: Element | null): HTMLAnchorElement | undefined {
  if (!heading || heading.closest("a[href]") || heading.querySelector("a[href]")) return undefined;
  const h = norm(textIn(heading));
  if (!h) return undefined;
  return (Array.from(el.querySelectorAll("a[href]")) as HTMLAnchorElement[]).find((a) => {
    if (!coverLink(a) || !visible(a)) return false;
    const l = norm(a.getAttribute("aria-label") ?? "");
    // An unnamed cover link is the card's own when it sits right in the card, over its one heading.
    if (!a.hasAttribute("aria-label")) return a.parentElement === el && el.querySelectorAll(HEADING_SEL).length === 1;
    return !!l && (h.includes(l) || l.includes(h));
  });
}

/**
 * Holds a covered card (or is one, with `self`), which is read where its cover
 * link is (see coverCard), never as part of a bigger card.
 */
function holdsCover(el: Element, self = false): boolean {
  for (const a of Array.from(el.querySelectorAll("a[href][aria-label]"))) {
    const box = a.parentElement;
    if (box && (self || box !== el) && coverLink(a) && coverOf(box, box.querySelector(HEADING_SEL)) === a) return true;
  }
  return false;
}

/** Links that read like headlines or titles (not "More", not icons). */
function headlineLinks(el: Element): number {
  const as = el.localName === "a" ? [el] : Array.from(el.querySelectorAll("a[href]"));
  let n = 0;
  const seen = new Set<string>();
  for (const a of as) {
    const h = (a as HTMLAnchorElement).href;
    // A source in parentheses after the headline ("(https://example.com/…)") is not another headline.
    // A card's cover link counts as its headline, so two cards under one box are two.
    if ((tlen(a) >= 25 || (clean(a.getAttribute("aria-label")).length >= 25 && coverLink(a))) && !seen.has(h) && !inPage(a) && !selfLink(a) && visible(a) && !/^\(.*\)$/.test(textIn(a))) {
      seen.add(h);
      n++;
    }
  }
  return n;
}

const HEADING_SEL = "h1,h2,h3,h4,h5,h6,[role=heading]";
/** A heading that is a link, or holds one. */
const LINKED_HEADING = HEADING_SEL.split(",").map((h) => `${h} a[href], a[href] ${h}`).join(",");

/**
 * A link that names its card: in or around its heading or image, or the whole
 * text of its own line. A link inside a sentence ("leavened by <a>Clostridium</a>")
 * is part of the text, never the card's title.
 */
function titleLink(a: Element, member: Element): boolean {
  if (a === member) return true;
  if (a.closest(HEADING_SEL) || a.querySelector(HEADING_SEL + ",img,picture")) return true;
  // The line the link sits on: inline neighbours up to the nearest block boundaries.
  let b: Element = a;
  while (b.parentElement && b.parentElement !== member && INLINE.has(b.parentElement.localName)) b = b.parentElement;
  let line = tlen(b);
  const side = (start: ChildNode | null, next: (n: ChildNode) => ChildNode | null) => {
    for (let n = start; n; n = next(n)) {
      if (n.nodeType === 3) line += (n.nodeValue ?? "").trim().length;
      else if (n.nodeType === 1 && INLINE.has((n as Element).localName)) {
        // The source after a headline ("(example.com)") is not part of its line.
        if (!/^\(.*\)$/.test(textIn(n as Element))) line += tlen(n as Element);
      } else if (n.nodeType === 1) break;
    }
  };
  side(b.previousSibling, (n) => n.previousSibling);
  side(b.nextSibling, (n) => n.nextSibling);
  return tlen(a) >= line * 0.7;
}

/**
 * A link that names the member: long enough to be a title, or wrapping its
 * heading or image. Inside an article only a linked heading counts, so
 * sections of a story never turn into cards.
 */
function prominentLink(el: Element, strict = false): boolean {
  if (el.localName === "a" && !inPage(el)) return true;
  for (const a of Array.from(el.querySelectorAll("a[href]"))) {
    // Links in a closed popover (a share sheet's license link) name nothing, nor does a post's own permalink.
    if (inPage(a) || selfLink(a) || !visible(a) || !titleLink(a, el)) continue;
    if (strict) {
      if (a.closest(HEADING_SEL) || a.querySelector(HEADING_SEL)) return true;
      continue;
    }
    if (actionLabel(textIn(a))) continue;
    if (tlen(a) >= 12 || a.querySelector("h1,h2,h3,h4,h5,h6,img,picture") || a.closest("h1,h2,h3,h4,h5,h6")) return true;
  }
  return false;
}

/**
 * A message the page put up (a form's "Thanks, your review was sent", its heading focused, then
 * "Back to Rye sourdough loaf" on a line of its own): its heading is no link, and its one link goes
 * somewhere else. It reads as a heading, its text and that link, not as a list entry whose title
 * is the link (F1013).
 */
function statusBox(el: Element): boolean {
  const hd = el.querySelector(HEADING_SEL);
  if (!hd || hd.closest("a[href]") || hd.querySelector("a[href]") || el.localName === "a") return false;
  const links = Array.from(el.querySelectorAll("a[href]")).filter((a) => visible(a));
  if (links.length !== 1) return false;
  // The heading the page moved focus to (tabindex=-1) is where the reader is told what happened.
  if (hd.getAttribute("tabindex") === "-1") return true;
  const a = links[0];
  if (!(hd.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
  // On a line of its own, after the text, naming something other than the heading.
  const line = a.parentElement;
  return !!line && line !== el && isBlockish(line) && tlen(line) <= tlen(a) + 3 && !!line.previousElementSibling && !textIn(a).toLowerCase().includes(textIn(hd).toLowerCase());
}

const isBlockish = (e: Element) => !getComputedStyle(e).display.startsWith("inline");

/** A single story or product card: one headline link, little else. */
function asCard(el: Element, ctx: Ctx): Item | null {
  if (ctx.inArticle || ctx.inPost || el === ctx.articleEl || (ctx.articleEl && el.contains(ctx.articleEl))) return null;
  // The block with the page's own title is the page's header, not a card.
  if (ctx.titleEl && el.contains(ctx.titleEl)) return null;
  const raw = tlen(el);
  if (raw < 15 || raw > 1400) return null;
  if (el.localName !== "a" && !el.querySelector("a[href]")) return null;
  // A block with code or a quote is a post's text ("h2 > a" over a paragraph and a code block), not a card.
  if (el.querySelector("nav, [role=tablist], [role=menu], [role=navigation], ul ul, table, form, pre, blockquote")) return null;
  const all = textIn(el);
  const len = all.length;
  if (len < 15 || len > 700) return null;
  // A box that sells goes; a story whose headline only names a channel, app or newsletter
  // ("How 'Lula's Army' WhatsApp channel helped…") stays, and toItem's promoCard judges it by its link.
  if (len < 200 && promoText(all)) {
    const head = el.querySelector(HEADING_SEL);
    const ht = head ? textIn(head) : "";
    if (ht.length < 25 || promoText(all.replace(ht, " ")) || promoText(ht.replace(TITLE_PROMO_WEAK, " "))) return null;
  }
  if (holdsCover(el)) return null;
  if (statusBox(el)) return null;
  // Several headings of its own are a list of parts (weather.com's days, each an h3 over its row), not one card.
  if (el.querySelectorAll(HEADING_SEL).length >= 3) return null;
  const heads = headlineLinks(el);
  // A list entry named by a short linked heading ("Uncontrolled input") over its details is a card too;
  // a heading alone over nothing (a section's title) is not.
  const entry = heads === 0 && (el.localName === "li" || el.getAttribute("role") === "listitem") && el.querySelectorAll(LINKED_HEADING).length === 1 && tlen(el) > tlen(el.querySelector(HEADING_SEL)!) + 15;
  if ((heads !== 1 && !entry) || !prominentLink(el)) return null;
  // A toolbar over a list of one entry (GitHub issues with one result) is not part of the entry:
  // the list item is the card, and the toolbar's links and filters stay usable.
  // So is a results panel's heading over its one result (OpenStreetMap: "Search Results", "Nominatim", the place, "More results").
  if (el.localName !== "li" && el.getAttribute("role") !== "listitem") {
    for (const hl of [el.querySelector(LINKED_HEADING), Array.from(el.querySelectorAll("a[href]")).find((a) => tlen(a) >= 25)]) {
      const row = hl?.closest("li, [role=listitem]");
      if (row && row !== el && el.contains(row) && tlen(el) > tlen(row) + 20) return null;
    }
  }
  // Several linked headings are several cards (a carousel of short recipe titles), not one.
  const headed = new Set(Array.from(el.querySelectorAll(HEADING_SEL)).map((h) => ((h.closest("a[href]") ?? h.querySelector("a[href]")) as HTMLAnchorElement | null)?.href).filter(Boolean));
  if (headed.size >= 2) return null;
  const linkCount = el.localName === "a" ? 1 : el.querySelectorAll("a[href]").length;
  const hasHeading = !!el.querySelector("h1,h2,h3,h4,h5,h6,[role=heading]") || /^h[1-6]$/.test(el.localName);
  // A row with a linked heading (an issue with its labels, author and comment count) may carry more links.
  if (linkCount > (hasHeading && el.querySelector(LINKED_HEADING) ? 12 : 6)) return null;
  const isLink = el.localName === "a" && !!el.querySelector("div,p,span,h1,h2,h3,h4,h5,h6,img,picture");
  if (!hasHeading && !isLink && el.localName !== "article") return null;
  // A hidden preview clip (shown on hover) does not make a story card a player.
  if (el.querySelector(CONTROL_SEL.replace("button,", "")) || Array.from(el.querySelectorAll("video,iframe")).some((v) => visible(v))) return null;
  return toItem(el, ctx);
}

/**
 * A card drawn under an empty link that covers it (The Guardian: the link,
 * then the picture, headline and snippet, then a list of linked related
 * stories). It is one entry with that link; each related story follows as an
 * entry of its own, so no story is lost or glued to another. Only a box whose
 * own child is the cover link, so a row of two cards is never one.
 */
function coverCard(el: Element, out: Out, ctx: Ctx): boolean {
  if (ctx.inArticle || ctx.inPost || (ctx.articleEl && el.contains(ctx.articleEl)) || (ctx.titleEl && el.contains(ctx.titleEl))) return false;
  const cover = Array.from(el.children).find((c) => c.localName === "a" && c.hasAttribute("href") && coverLink(c));
  if (!cover || coverOf(el, el.querySelector(HEADING_SEL)) !== cover) return false;
  // A card with fields of its own stays walked, so they stay usable.
  if (el.querySelector(CONTROL_SEL.replace("button,", ""))) return false;
  const it = toItem(el, ctx);
  if (!it) return !!ctx.promos?.has(el);
  if (!repeatCard(it, ctx)) out.item(it);
  // A player in the card stays usable, after its entry.
  for (const v of Array.from(el.querySelectorAll("video, iframe"))) {
    const b = portalBlock(v, ctx);
    if (b) out.push(b);
  }
  for (const a of Array.from(el.querySelectorAll("a[href]"))) {
    if (a === cover || inPage(a) || !visible(a) || !(a.querySelector(HEADING_SEL) || a.closest(HEADING_SEL))) continue;
    const s = toItem(a, ctx);
    // A bold label over a linked story ("Political violence" over its headline) is its kicker, not its name.
    if (s?.keepTitle && s.text && s.title.split(/\s+/).length <= 4) {
      s.meta.unshift(s.title);
      s.title = s.text;
      s.text = undefined;
      s.keepTitle = undefined;
    }
    if (s && !repeatCard(s, ctx)) out.item(s);
  }
  return true;
}

/**
 * A headline link that holds the links of its related stories (G1's script builds "a.bstn-hl-link > ul > li > a.bstn-related",
 * which HTML could not nest): the headline is its entry, with its kicker, and each related story follows as an
 * entry of its own, so no story is glued to the headline or opens its page (F1001).
 */
function nestedLinkCard(el: Element, out: Out, ctx: Ctx): boolean {
  if (ctx.inArticle || ctx.inPost || (ctx.titleEl && el.contains(ctx.titleEl))) return false;
  const href = hrefOf(el);
  const inner = Array.from(el.querySelectorAll("a[href]")).filter((a) => hrefOf(a) !== href && visible(a) && textIn(a));
  if (!href || !inner.length) return false;
  // The headline's own words, piece by piece (the kicker, then the title), outside the related links.
  const parts: string[] = [];
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    const s = clean(n.nodeValue);
    if (s && p && !inner.some((a) => a.contains(p)) && visible(p)) parts.push(s);
  }
  if (!parts.length) return false;
  const title = parts.reduce((a, b) => (b.length > a.length ? b : a));
  const at = parts.indexOf(title);
  const it: Item = { key: "i:" + refOf(el), title, href, ref: refOf(el), meta: parts.slice(0, at).length ? [parts.slice(0, at).join(" ")] : [] };
  if (!repeatCard(it, ctx)) out.item(it);
  for (const a of inner) {
    const s = toItem(a, ctx);
    if (s && !repeatCard(s, ctx)) out.item(s);
  }
  return true;
}

/**
 * Repeated siblings that look like cards (videos, products, results). Returns
 * the member elements; siblings that are not members are walked normally, so
 * nothing is silently dropped.
 */
/** A read-only field that holds an embed code or a link to copy, not a value to set. */
function copyField(f: Element): boolean {
  return f.localName === "input" && (f as HTMLInputElement).readOnly && /^\s*(<|https?:\/\/)/i.test((f as HTMLInputElement).value);
}

export function detectItems(el: Element, ctx: Ctx): Set<Element> | null {
  // Empty dividers between the entries (Google Maps' result feed) are not entries of another kind.
  const ch = kids(el).filter((k) => !SKIP.has(k.localName) && visible(k) && !isAd(k) && k.getAttribute("aria-hidden") !== "true" && (tlen(k) > 0 || MEDIA.has(k.localName) || !!k.querySelector("img, picture, video, iframe, svg, input, button, select, textarea")));
  if (ch.length < 3) return null;
  const groups = new Map<string, Element[]>();
  for (const k of ch) {
    const s = signature(k);
    let g = groups.get(s);
    if (!g) groups.set(s, (g = []));
    g.push(k);
  }
  let best: Element[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  const tag = best[0]?.localName;
  // Siblings of the same kind that carry an extra class ("--first", "--featured") belong too.
  const baseSet = new Set(best[0] ? baseClasses(best[0]) : []);
  // In a list of results every entry counts, whatever class marks its type (Sphinx's "kind-object", "kind-text").
  const anyLi = tag === "li" && resultList(el);
  const members = ch.filter(
    (k) => k.localName === tag && (anyLi || best.includes(k) || baseClasses(k).some((c) => baseSet.has(c)) || (!baseSet.size && !baseClasses(k).length)),
  );
  if (members.length < 3 || members.length < ch.length * 0.6) return null;
  if (tag === "p" || tag === "br" || /^h[1-6]$/.test(tag)) return null;
  let prominent = 0;
  const unnamed: Element[] = [];
  let total = 0;
  let simple = 0;
  let withFields = 0;
  for (const k of members) {
    const links = k.localName === "a" ? [k] : Array.from(k.querySelectorAll("a[href]"));
    const n = tlen(k);
    total += n;
    if (prominentLink(k, ctx.inArticle)) prominent++;
    else if (links.length) unnamed.push(k);
    // A hidden field or a read-only embed code to copy (NPR's audio cards) is not a field of the row (F738).
    if (Array.from(k.querySelectorAll("input:not([type=hidden]), select, textarea")).some((f) => visible(f) && !copyField(f))) withFields++;
    // A member that shows nothing but one short link (a hidden popover aside): this is a link list, not cards.
    const shown = links.filter((a) => visible(a));
    if (shown.length === 1 && n < 400 && textIn(shown[0]).length >= textIn(k).length - 2 && textIn(k).length < 60) simple++;
    else if (links.length === 1 && n < 60 && tlen(links[0]) >= n - 2) simple++;
  }
  // Entries named by an element classed "title" rather than by a link (arXiv's results), when the first few are.
  if (prominent < members.length * 0.6 && !ctx.inArticle && unnamed.length && unnamed.slice(0, 3).every((k) => titleHolder(k))) {
    for (const k of unnamed) if (titleHolder(k)) prominent++;
  }
  if (prominent < members.length * 0.6) return null;
  if (simple > members.length * 0.7) return null;
  // Rows with their own fields (cart lines with a quantity) are walked so the fields stay usable.
  if (withFields >= members.length * 0.5) return null;
  // Rows that each hold a post's text (Stack Overflow's answers) are posts read in full, not story cards (F855).
  if (!ctx.inComments && members.filter((k) => postBodyOf(k)).length >= members.length * 0.5) return null;
  // Members that hold several headlines are groups of cards: look deeper. A few
  // entries with sub-pages of their own (a search result's sections) are still entries.
  let heads = 0;
  let multi = 0;
  // A box whose headlines are a list of its own ("Most read" among the stories) is walked, so every story in it stays.
  const boxes = new Set<Element>();
  // A member holding several story cards (NPR's featured block of linked headlines) is walked too, so each story stays.
  const storyBoxes: Element[] = [];
  for (const k of members) {
    const arts = Array.from(k.querySelectorAll("article")).filter((a) => {
      const up = a.parentElement?.closest("article");
      return !up || !k.contains(up);
    });
    if (arts.length > 1) {
      // A member holding several posts (a Discourse thread whose far posts are unloaded) is the thread, not a card.
      // A story's headline is its own, not one in a link preview inside a post.
      const stories = arts.filter((a) => Array.from(a.querySelectorAll(LINKED_HEADING)).some((h) => h.closest("article") === a));
      if (stories.length * 2 <= arts.length) return null;
      storyBoxes.push(k);
    }
    const h = headlineLinks(k);
    if (h >= 3 && listedHeadlines(k, h)) {
      boxes.add(k);
      continue;
    }
    heads += h;
    if (h > 1) multi++;
  }
  const cards = members.length - boxes.size;
  if (cards < 2) return null;
  if (heads > cards * 1.5 && multi > cards * 0.3) return null;
  for (const k of storyBoxes) boxes.add(k);
  if (members.length - boxes.size < 2) return null;
  // Covered cards are read one by one where their cover links are, with the stories linked under them.
  if (members.some((k) => holdsCover(k, true))) return null;
  const avg = total / members.length;
  // Long raw text may be hidden (a full abstract behind "More", typeset math): what shows is what counts.
  if (avg < 12 || (avg > 1200 && members.reduce((n, k) => n + textIn(k).length, 0) / members.length > 1200)) return null;
  // The story itself (or the block with the page's title) sitting in one of the rows is walked, not made a card.
  const own = (k: Element) => (!!ctx.articleEl && (k === ctx.articleEl || k.contains(ctx.articleEl))) || (!!ctx.titleEl && k.contains(ctx.titleEl));
  return new Set(members.filter((k) => !own(k) && !boxes.has(k)));
}

/** All of a box's headline links sit in lists inside it (a title over a ranked list of stories). */
function listedHeadlines(k: Element, h: number): boolean {
  // A box whose first link comes before its lists (a search result's title over its sections) is one entry.
  // A short link in the box's own heading ("Most read" to the full ranking) is the box's title, not an entry.
  const first = Array.from(k.querySelectorAll("a[href]")).find((a) => visible(a) && !(tlen(a) < 25 && k.contains(a.closest(HEADING_SEL))));
  const tagged = first?.closest("ol, ul, [role=list]");
  const list = tagged && tagged !== k && k.contains(tagged) ? tagged : first ? rowGroup(first, k) : null;
  if (!list) return false;
  let n = list === tagged ? 0 : headlineLinks(list);
  for (const l of Array.from(k.querySelectorAll("ol, ul, [role=list]"))) {
    const outer = l.parentElement?.closest("ol, ul, [role=list]");
    if ((outer && k.contains(outer)) || (list !== tagged && list.contains(l))) continue;
    n += headlineLinks(l);
  }
  return n >= h;
}

/** Three or more rows of one kind under a box, each with one headline link (a ranking drawn with divs): a list without the tag. */
function rowGroup(a: Element, k: Element): Element | null {
  for (let r = a.parentElement; r && r !== k; r = r.parentElement) {
    const g = r.parentElement;
    if (!g || !k.contains(g)) break;
    const rows = Array.from(g.children).filter((c) => c.localName === r.localName && c.className === r.className);
    if (rows.length >= 3 && rows.length >= g.childElementCount * 0.6 && rows.every((c) => headlineLinks(c) === 1)) return g;
  }
  return null;
}

/** A text that is just a price ("$20.98", "US$ 1.299", "1.299,00 €"), not "$7m mansion". */
const PRICE = /^(from |desde |a partir de )?(([$€£¥₹]|US\$|R\$|ARS|USD|EUR)\s?\d[\d.,]*|\d[\d.,]*\s?([€$]|USD|EUR|ARS))$/i;

/** The visible name of a filter chip ("Filter by label feature request" shows "feature request"), or "". */
function chipText(b: Element): string {
  const full = clean(b.getAttribute("aria-label")) || clean(b.textContent);
  if (!ITEM_ACTION_NOISE.test(full)) return "";
  const vis = textIn(b);
  // A glyph ("⋮" on "More actions for Notes.txt") names no chip.
  return vis && vis !== full && !ITEM_ACTION_NOISE.test(vis) && vis.length < 60 && /[\p{L}\p{N}]/u.test(vis) ? vis : "";
}

/** What a bare number in a card counts, from its own label or its comment link. */
function countLabel(from: Element, card: Element, n: string): string {
  for (let e: Element | null = from; e && e !== card.parentElement; e = e.parentElement) {
    const al = clean(e.getAttribute("aria-label") || e.getAttribute("title"));
    if (al && al.includes(n) && /\p{L}{3}/u.test(al) && al.length < 40) return al;
    if (COMMENTS_TOKEN.test(tokens(e)) || /#comments?\b/i.test(e.getAttribute("href") ?? "")) return t("nComments", { n });
    // A speech-bubble icon beside the number.
    const icon = tlen(e) <= n.length + 4 ? e.querySelector("svg, img, i") : null;
    if (icon && /comment|bubble|reply|replies/i.test(`${tokens(icon)} ${icon.getAttribute("aria-label") ?? ""} ${icon.getAttribute("alt") ?? ""}`)) return t("nComments", { n });
    if (e === card) break;
  }
  return "";
}

/** Visible, and so is every ancestor up to `top` (text inside a screen-reader-only box is not). */
function shownWithin(e: Element, top: Element): boolean {
  for (let a: Element | null = e; a && a !== top; a = a.parentElement) if (!visible(a)) return false;
  return true;
}

/** Marks a card as an ad or promo, so the walker drops it whole instead of reading its parts. */
function promo(el: Element, ctx: Ctx): null {
  (ctx.promos ??= new WeakSet()).add(el);
  return null;
}

const TOOL_TITLE = /^(share|follow|unfollow|report|flag|save|bookmark|edit|improve this (question|answer|post))$/i;

/** A missing photo's placeholder text, not information about the item. */
const NO_IMAGE = /^(no image( available)?|no photo|image (not )?available|image unavailable|sin imagen|sin foto)$/i;

/**
 * The name and the snippet of a title element whose first line is set larger
 * or bolder than the lines after it ("Tramitar el Pasaporte" over "Para viajar
 * fuera del país…"). A kicker set smaller than its headline ("LIVE") is no name.
 */
function splitSnippet(el: Element): [string, string] | null {
  const lines = textLines(el);
  if (lines.length < 2 || lines[0].length < 3 || lines[0].length > 150) return null;
  const rest = clean(lines.slice(1).join(" "));
  if (rest.length < 15) return null;
  // A day and its readings ("Mon 26 · Mostly Sunny 14% 49° 67°") are one row, not a name and a snippet.
  if (lines[0].length <= 12 && rest.length <= 80 && /\d\s*°/.test(rest)) return null;
  const weight = (p: Element) => {
    const cs = getComputedStyle(p);
    return parseFloat(cs.fontSize) * 1000 + (parseInt(cs.fontWeight) || 400);
  };
  let first = -1;
  let before = "";
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (!p || !/\S/.test(n.nodeValue ?? "") || !visible(p)) continue;
    const w = weight(p);
    if (first < 0) first = w;
    else if (w < first) return clean(before) === lines[0] ? [lines[0], rest] : null;
    else if (w > first) return null;
    before += n.nodeValue;
  }
  return null;
}

/** An in-place toggle's words: "▽ More", "Show less", "Ver más". */
const TOGGLE_LABEL = /(^|\s)(more|less|show|hide|expand|collapse|m[aá]s|menos|ver|mostrar|ocultar)\b|[▽△▼▲]/i;

/** A detail line's parts tidied like its text: no stray separators at its ends. */
function metaLine(parts: Inline[]): Inline[] {
  const out = tidy(parts);
  const trim = (i: number, re: RegExp) => {
    if (typeof out[i] === "string") out[i] = (out[i] as string).replace(re, "");
  };
  trim(0, /^[|·•/]+\s*/);
  trim(out.length - 1, /\s*[|·•/]+$/);
  return out.filter((x) => x !== "");
}

/**
 * A short label heading over the headline (NPR's "h3.slug > a" to its section before "h2.title > a"
 * to the story, or "WATCH" over a video's linked title) is a kicker: the card is named by the later
 * heading whose link the card's other links (its picture, its teaser) share (F739).
 */
function kickerHeading(el: Element, first: Element | null): Element | null {
  if (!first || el.localName === "a" || first.closest("a[href]") === el) return first;
  const words = (e: Element) => textIn(e).split(/\s+/).filter(Boolean).length;
  const n = words(first);
  // A linked label names its section or its show ("The Indicator from Planet Money"); an unlinked one is a word or two.
  if (!n || n > (first.closest("a[href]") || first.querySelector("a[href]") ? 8 : 3)) return first;
  const hrefOfH = (h: Element) => ((h.closest("a[href]") ?? h.querySelector("a[href]")) as HTMLAnchorElement | null)?.href;
  const fh = hrefOfH(first);
  const NEST = "li, article, [role=listitem], [role=article], [role=comment]";
  // Entries under a section label, with no words of the label's own outside them ("Trending Right Now" over its
  // card, "Fun Pumpkin-Shaped Foods" over four, Food Network), are the card itself: their headlines and links count.
  // A comment has its own text beside its replies.
  const subs = Array.from(el.querySelectorAll(NEST)).filter((a) => {
    const up = a.parentElement?.closest(NEST);
    return !a.contains(first) && (!up || up === el || !el.contains(up) || up.contains(first));
  });
  let inner = subs.length > 0;
  if (inner) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t && inner; t = tw.nextNode()) {
      const p = t.parentElement;
      if (p && !first.contains(p) && !subs.some((x) => x.contains(p)) && !p.closest("a[href], script, style") && (t.textContent ?? "").trim()) inner = false;
    }
  }
  // Else a nested entry (a reply under a comment, with its own author heading) is not part of this card: its
  // author never names the card, and its links never count.
  const own = (x: Element) => {
    if (inner) return true;
    for (let a = x.parentElement; a && a !== el; a = a.parentElement)
      if (a.matches(NEST) && !a.contains(first)) return false;
    return true;
  };
  const hs = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")).slice(1, 5).filter(own);
  if (!hs.length) return first;
  const count = new Map<string, number>();
  for (const a of Array.from(el.querySelectorAll("a[href]")) as HTMLAnchorElement[]) if (own(a)) count.set(a.href, (count.get(a.href) ?? 0) + 1);
  const fc = fh ? count.get(fh) ?? 0 : 0;
  const level = (h: Element) => (/^h[1-6]$/.test(h.localName) ? +h.localName[1] : +(h.getAttribute("aria-level") ?? 2) || 2);
  // A linked label ranks below the headline it sits over; a later, smaller heading ("12 comments" under a story) is not the name.
  return hs.find((h) => {
    const x = hrefOfH(h);
    return !!x && x !== fh && (count.get(x) ?? 0) >= 2 && (count.get(x) ?? 0) > fc && (fh ? level(h) <= level(first) : words(h) > n) && !COMMENTS_LINK.test(textIn(h)) && visible(h);
  }) ?? first;
}

/** A box that holds a comment's replies ("ul.replies", WordPress's "ol.children", Lobsters' "ol.comments"). */
const REPLY_BOX = /(^|[\s_-])(repl(y|ies)|children|comments?|subthread|thread)($|[\s_-])/i;

/**
 * The replies nested in a comment: entries built like it (same tag and classes) inside it,
 * each the nearest one to it (a reply's own replies are its). In a list item they sit in a
 * list of their own ("li.c > ul.replies > li.c"). Their text, author and time are theirs (F905).
 */
function repliesIn(el: Element, ctx: Ctx): Element[] {
  if (el.localName === "a") return [];
  const base = baseClasses(el).sort().slice(0, 2);
  // A plain list item counts only with its replies in a sub-list; a plain box is any box.
  if (!base.length && el.localName !== "li") return [];
  const sig = signature(el);
  const out: Element[] = [];
  // A plain list item's reply opens like it (avatar, name, time); a bullet in its text does not.
  const shape = (e: Element) => Array.from(e.children).slice(0, 2).map((c) => c.localName).join(" ");
  const own = shape(el);
  for (const d of Array.from(el.querySelectorAll(el.localName + base.map((c) => "." + CSS.escape(c)).join("")))) {
    if (signature(d) !== sig || out.some((r) => r.contains(d)) || !visible(d) || !tlen(d)) continue;
    // A list or a quote in the comment's own text is its words.
    const words = d.parentElement?.closest(`${POST_BODY}, blockquote, p`);
    if (words && el.contains(words)) continue;
    const box = d.parentElement;
    if (!box) continue;
    if (!base.length && (box === el || !box.matches("ul, ol") || d.childElementCount < 2 || shape(d) !== own)) continue;
    // Outside a comments area, the box between says it holds replies.
    if (!ctx.inComments) {
      let said = false;
      for (let b: Element | null = box; b && b !== el && !said; b = b.parentElement) said = REPLY_BOX.test(tokens(b));
      if (!said) continue;
    }
    out.push(d);
  }
  if (!out.length) return out;
  // The comment itself says something besides its replies; a box of comments is not one.
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if (/\S/.test(n.nodeValue ?? "") && !out.some((r) => r.contains(n))) return out;
  return [];
}

export function toItem(el: Element, ctx: Ctx): Item | null {
  if (ctx.drop?.(el)) return null;
  const allText = textIn(el);
  if (!allText) return null;
  // Replies nested in it are entries of their own under it, never its words, author or links (F905).
  const replyEls = repliesIn(el, ctx);
  const inReply = (n: Node) => replyEls.length > 0 && replyEls.some((r) => r.contains(n));
  // A comment is named by its own author; only a story card has a kicker over its headline.
  let h0 = replyEls.length ? Array.from(el.querySelectorAll(HEADING_SEL)).find((h) => !inReply(h)) ?? null : el.querySelector(HEADING_SEL);
  // A comment's paragraphs marked up as a heading (Lobsters' div role=heading) are its text, never its name (F1030).
  const prose = h0 && proseHeading(h0) ? h0 : null;
  if (prose) h0 = Array.from(el.querySelectorAll(HEADING_SEL)).find((h) => !inReply(h) && !proseHeading(h)) ?? null;
  const heading = ctx.inComments ? h0 : kickerHeading(el, h0);
  // A comment's own text (GitHub's markdown body) is read in full, with its paragraphs and code, not as a snippet.
  const body0 = (ctx.inComments ? postBodyOf(el) : null) ?? prose;
  const bodyEl = body0 && !inReply(body0) ? body0 : null;
  const links = (el.localName === "a" ? [el] : Array.from(el.querySelectorAll("a[href]"))).filter(
    (a) => visible(a) && !inPage(a) && !SOCIAL_HOSTS.test(hostOf((a as HTMLAnchorElement).href)) && !bodyEl?.contains(a) && !inReply(a),
  ) as HTMLAnchorElement[];
  let main: HTMLAnchorElement | undefined = heading
    ? (heading.closest("a[href]") as HTMLAnchorElement) || (heading.querySelector("a[href]") as HTMLAnchorElement) || undefined
    : undefined;
  // An empty link drawn over the card and named by its headline (The Guardian) is its target,
  // never a linked story under it.
  const cover = main ? undefined : coverOf(el, heading);
  if (cover) main = cover;
  // Only a link that names the card is its target, never one from a later sentence,
  // and never one that acts on the card ("Report abuse" under a review).
  if (!main && links.length) {
    // A vote arrow (Lobsters' "31" to /login) never names the entry (F1030).
    const named = links.filter((a) => titleLink(a, el) && !actionLabel(textIn(a) || accName(a)) && !voteLink(a));
    // A link in the entry's own sub-list (a result's sections) names a part, not the entry.
    const sub = (a: Element) => {
      const li = a.parentElement?.closest("li, [role=listitem]");
      return !!li && li !== el && el.contains(li);
    };
    const own = named.filter((a) => !sub(a));
    // The source after a headline ("(https://example.com/post)", a bare address) never outranks the headline (F857).
    const pool = own.length ? own : named;
    const worded = pool.filter((a) => !/^\(.*\)$|^(https?:\/\/|www\.)\S+$/i.test(textIn(a)));
    main = (worded.length ? worded : pool).sort((a, b) => textIn(b).length - textIn(a).length)[0];
    // A short row whose one link is its name, before its size and its menu ("Notes.txt 2 KB ⋮"), opens with that link.
    if (!main && !heading && !ctx.inComments && allText.length <= 120) {
      const plain = links.filter((a) => !actionLabel(textIn(a) || accName(a)) && !voteLink(a));
      if (plain.length === 1 && textIn(plain[0]) && allText.startsWith(textIn(plain[0]))) main = plain[0];
    }
  }
  if (!main && el.localName === "a") main = el as HTMLAnchorElement;
  // A clickable tile opens itself; a link inside it ("Syllabus") is not its title unless it is the heading.
  const tile = el.getAttribute("role") === "button" && el.localName !== "button";
  if (tile && main && !(heading && (heading.contains(main) || main.contains(heading)))) main = undefined;
  // An avatar linked like the name beside it: the name is the title, not the photo's alt ("User profile").
  if (main && !textIn(main)) {
    const href = main.href;
    const twin = links.find((a) => a !== main && a.href === href && textIn(a));
    if (twin) main = twin;
  }
  // No heading and no link that names it (an arXiv result): its element classed "title" names it,
  // and its first link that is not an action opens it.
  // (A link without spaces, like a DOI, names no entry either.)
  const holder = !heading && (!main || !/\s/.test(textIn(main))) && links.length ? titleHolder(el) : null;
  if (holder) main = (holder.querySelector("a[href]") as HTMLAnchorElement | null) ?? links.find((a) => !actionLabel(textIn(a)) && !voteLink(a));
  let title = heading ? textIn(heading) : holder ? textIn(holder) : "";
  const titleFromLink = !title && !!main;
  if (!title && main) title = textIn(main) || accName(main);
  if (!title) title = textLines(el)[0] ?? "";
  title = clean(title);
  if (!title) return null;
  // A heading or link that holds the entry's name and then a snippet in smaller type
  // (a search result): the first line is the name, the rest its snippet.
  let snippet = "";
  const named = heading ?? (titleFromLink ? main : undefined);
  const split = named ? splitSnippet(named) : null;
  if (split) [title, snippet] = split;
  // The headline the cover link names, without the section label over it ("Australia news"), which goes to the meta line.
  let kicker = "";
  const coverName = cover ? clean(cover.getAttribute("aria-label")) : "";
  if (coverName && !split && title.length > coverName.length + 1 && title.endsWith(coverName)) {
    kicker = clean(title.slice(0, -coverName.length));
    title = coverName;
  }
  // A post's own tools ("Share", "Follow", "Improve this answer") are controls, not entries.
  if (TOOL_TITLE.test(title) || SHARE_LABEL.test(title)) return null;
  if (title.length > 200) title = title.slice(0, 197).trimEnd() + "…";
  // A bold headline and its sub-headline in one link ("<strong>Indiana Fever fire GM…</strong> Sixth place isn't enough"):
  // the bold part is the title, the rest says more about it.
  let subhead = "";
  const bold = titleFromLink && main ? main.querySelector("strong, b") : null;
  if (bold && textIn(bold).length >= 20 && title.startsWith(textIn(bold)) && title.length > textIn(bold).length + 3) {
    subhead = clean(title.slice(textIn(bold).length));
    title = textIn(bold);
  }

  // Text pieces grouped by their nearest block, so a sentence stays whole even
  // when it holds links or highlights; pieces from different elements are joined
  // with a space when CSS was what kept them apart.
  const meta: string[] = [];
  let text = "";
  const seenT = new Set([title]);
  // Links that lead somewhere of their own (the discussion, an upvote) become the
  // entry's actions; ones that act on it ("flag", "hide") say nothing as text.
  const linkActs: Action[] = [];
  const unsaid = new Set<Element>();
  for (const a of links) {
    if (a === main || (main && a.contains(main))) continue;
    // Stories linked under a covered card are entries of their own (see coverCard), not its words.
    if (cover && (a.querySelector(HEADING_SEL) || a.closest(HEADING_SEL))) {
      unsaid.add(a);
      continue;
    }
    const l = textIn(a);
    if (voteLink(a)) {
      const act = toAction(a, clean(a.getAttribute("aria-label") || a.getAttribute("title")) || t("upvote"));
      // The score drawn on the arrow (Lobsters' "73") is said with it.
      if (/^\d[\d,.]*[kKmM]?$/.test(l) && !act.label.includes(l)) act.badge = l;
      if (linkActs.length < 3) linkActs.push(act);
      unsaid.add(a);
    } else if (COMMENTS_LINK.test(l) || REPLY_LINK.test(l)) {
      // "Reply" on a post opens its reply box: something to press, like its comments.
      if (linkActs.length < 3) linkActs.push(toAction(a, l));
      unsaid.add(a);
    } else if (l && actionLabel(l)) unsaid.add(a);
  }
  // On a post people reply to, its author's name opens their profile: it leads the post's links.
  if (linkActs.some((x) => REPLY_LINK.test(x.label))) {
    const who = links.find((a) => a !== main && !unsaid.has(a) && !(main && a.contains(main)) && profileLink(a));
    if (who) {
      linkActs.unshift({ ...toAction(who, textIn(who)), kind: "quiet" });
      unsaid.add(who);
    }
  }
  // An in-place toggle a script runs ("▽ More" under a cut abstract) is the entry's button.
  let expanded = false;
  for (const a of Array.from(el.querySelectorAll("a:not([href])"))) {
    const l = textIn(a);
    if (!l || l.length > 30 || !TOGGLE_LABEL.test(l) || !visible(a) || !clickableAnchor(a) || inReply(a)) continue;
    if (/less|fewer|menos|collapse|hide|ocultar/i.test(l)) expanded = true;
    if (linkActs.length < 4) linkActs.push(toAction(a, l));
    unsaid.add(a);
  }
  // The entry's other links (its pdf, its authors, its tags, its sub-pages) stay links in its details.
  // (A teaser that links where the title links is the card's own text, not another link.)
  const kept = new Set(links.filter((a) => a !== main && !(main && (a.contains(main) || a.href === main.href)) && !unsaid.has(a) && !!textIn(a) && usefulControl(a, textIn(a), ctx)));
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const groups = new Map<Element, { s: string; last: Element | null; parts: Inline[]; linked: number }>();
  const picsRead = new Set<Element>();
  const openMenu = el.querySelector("[role=menu]");
  let spaced = false;
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const own = n.parentElement;
    if (!own || bodyEl?.contains(own) || inReply(own)) continue;
    // A space between two elements ("<b>function</b> <i>outer</i>") still parts their words.
    if (!/\S/.test(n.textContent ?? "")) {
      if (n.textContent) spaced = true;
      continue;
    }
    if (unsaid.size) {
      const a = own.closest("a");
      if (a && unsaid.has(a)) continue;
    }
    // A sponsored card says so in a small label, even inside its title link ("CONTENT LAB").
    const nv = n.nodeValue ?? "";
    if (nv.length < 40 && AD_LABEL.test(clean(nv)) && !own.firstElementChild && visible(own)) return promo(el, ctx);
    // A rating drawn for the eye ("4.2" over five stars) reads as the picture's name ("4.2 stars").
    const pic = own.closest("[role=img][aria-label]");
    if (pic && pic !== el && el.contains(pic)) {
      if (picsRead.has(pic) || !visible(pic)) continue;
      picsRead.add(pic);
      let gp: Element = pic;
      while (gp !== el && gp.parentElement && INLINE.has(gp.localName)) gp = gp.parentElement;
      const g = groups.get(gp) ?? { s: "", last: null, parts: [], linked: 0 };
      const said = (g.s && !/\s$/.test(g.s) ? " " : "") + clean(pic.getAttribute("aria-label"));
      g.s += said;
      g.parts.push(said);
      g.last = pic;
      groups.set(gp, g);
      continue;
    }
    // A separator kept from screen readers ("Coffee shop · 1 Ferry Building") still parts the words.
    const btn = own.closest(/^\s*[·•|]\s*$/.test(nv) ? "button,[role=button],script,style" : "button,[role=button],script,style,[aria-hidden=true]");
    // Text inside a button is the button's, except a clickable tile's own text (btn === el).
    // A filter chip ("Filter by author: jakearchibald") reads as its name, in place: "by jakearchibald was closed".
    // A price drawn for the eye (aria-hidden) beside its screen-reader twin is the price people see.
    if (btn && btn !== el && !(btn.matches("button,[role=button]") && el.contains(btn) && chipText(btn)) && !(btn.getAttribute("aria-hidden") === "true" && el.contains(btn) && visualTwin(btn) && !btn.parentElement?.closest("button,[role=button],[aria-hidden=true]"))) continue;
    if (heading?.contains(own) || holder?.contains(own)) continue;
    // The credit in capitals under the card's photo ("SAMEER AL-DOUMY/AFP") names who took it, not the story (F649).
    const fc = own.closest("figcaption");
    // (Le Monde's lifestyle cards put it beside the text, away from the photo: the card's photo counts.)
    if (fc && fc !== el && el.contains(fc) && (fc.parentElement?.querySelector("img, picture") || el.querySelector("img, picture"))) {
      const c = textIn(fc);
      if (c.length <= 80 && c === c.toLocaleUpperCase() && /\p{Lu}{2}/u.test(c)) continue;
    }
    if (own !== el && !shownWithin(own, el)) continue;
    // The row's menu the user opened (Rename, Download, Delete) shows in Sift's sheet, not as the row's words.
    if (openMenu && openMenu.contains(own)) continue;
    const sup = own.closest("sup");
    if (sup && isCitation(sup)) continue;
    if (titleFromLink && main?.contains(own)) continue;
    let p: Element = own;
    while (p !== el && p.parentElement && (INLINE.has(p.localName) || p.localName === "button") && p !== main) p = p.parentElement;
    const g = groups.get(p) ?? { s: "", last: null, parts: [], linked: 0 };
    let piece = (n.textContent ?? "").replace(/\s+/g, " ");
    // Pieces from different elements join as the text reader joins them: "$19."+"99", but "5." "16 ratings".
    // Two buttons side by side are two things, however deep their words sit (GitHub's label chips "feature request", "types").
    const chips = !!g.last && g.last !== own && twoControls(g.last, own, el);
    // As the text reader joins them: text after an inline element inside the same box ("<span>glob</span>al_stmt")
    // is parted only by that element's own edge, an element after text ("i<span>glob</span>") only by its own.
    const gap = () =>
      own.contains(g.last) ? spaceAfter(g.last!, g.s.slice(-2), piece) : g.last!.contains(own) ? spaceBefore(g.s.slice(-2), piece, own, null, own.parentElement) : spaceBefore(g.s.slice(-2), piece, own, g.last, own.parentElement);
    if (g.last && g.last !== own && g.s && (spaced || chips || gap()) && !/^\s/.test(piece)) piece = (chips && /[\p{L}\p{N}]$/u.test(g.s) ? ", " : " ") + piece.replace(/^\s+/, "");
    spaced = false;
    g.s += piece;
    const la = kept.size ? own.closest("a[href]") : null;
    if (la && kept.has(la as HTMLAnchorElement)) {
      // One link's words are one link, even when they sit in several elements.
      const prev = g.parts[g.parts.length - 1];
      if (typeof prev === "object" && "a" in prev && prev.ref === refOf(la)) prev.a += piece;
      else {
        const lead = piece.match(/^\s*/)![0];
        if (lead) g.parts.push(lead);
        g.parts.push({ a: piece.trimStart(), href: hrefOf(la) ?? (la as HTMLAnchorElement).href, ref: refOf(la) });
      }
      g.linked += piece.trim().length;
    } else g.parts.push(piece);
    g.last = own;
    groups.set(p, g);
  }
  // The details in reading order, with their links when they have some.
  const metaParts: (Inline[] | undefined)[] = [];
  const addMeta = (m: string, parts?: Inline[], first = false) => {
    if (first) {
      meta.unshift(m);
      metaParts.unshift(parts);
    } else {
      meta.push(m);
      metaParts.push(parts);
    }
  };
  for (const [p, g] of groups) {
    // Lone separators left beside removed links ("Por X · |") are not meta.
    const tx = clean(g.s).replace(/([|·•])(\s*[|·•])+/g, "$1").replace(/^[|·•/]+\s*|\s*[|·•/]+$/g, "");
    // Sponsored or ad items go.
    if (AD_LABEL.test(tx)) return promo(el, ctx);
    if (!tx || seenT.has(tx) || (title.includes(tx) && tx.length > 3 && !g.linked) || isFragment(tx) || NO_IMAGE.test(tx)) continue;
    if (!visible(p)) continue;
    // A sub-page's own preview (under "Overview" in a result's list of sections) is that page's, not the entry's.
    if (!g.linked && kept.size) {
      const li = p.closest("li, [role=listitem]");
      if (li && li !== el && el.contains(li) && Array.from(li.querySelectorAll("a[href]")).some((a) => kept.has(a as HTMLAnchorElement))) continue;
    }
    seenT.add(tx);
    // A bare count next to an icon ("71" beside a speech bubble) says what it counts.
    if (/^\d[\d,.]*[kKmM]?$/.test(tx)) {
      const what = countLabel(g.last ?? p, el, tx);
      if (what) {
        if (meta.length < 8) addMeta(what);
        continue;
      }
      // A rank in a top-10 list ("6" before the headline) is the list's order, which Sift shows by position.
      if (/^\d{1,3}$/.test(tx) && (el.closest("ol") || /(^|[\s_-])(rank|ranking|order|position|index|number|num)([\s_-]|$)/i.test(tokens(g.last ?? p)))) continue;
    }
    // A line that is mostly links (its authors, its tags) is details to follow, not a snippet.
    const parts = g.linked ? metaLine(g.parts) : undefined;
    // A comment's own paragraph is its text, however short ("Agreed, and the crossing needs a light too.") (F905).
    const said = ctx.inComments && p.localName === "p" && !g.linked && /\s/.test(tx) && !dateLine(tx);
    if ((tx.length >= 70 || said) && g.linked < tx.length * 0.5) {
      // Later paragraphs join the text instead of vanishing.
      if (!text) text = tx;
      else if (text.length < (expanded ? 6000 : 600)) text += " " + tx;
    } else if (meta.length < 8) addMeta(tx, parts);
  }
  if (snippet && !text.includes(snippet)) text = text ? snippet + " " + text : snippet;
  if (subhead && !text) text = subhead;
  else if (subhead) addMeta(subhead, undefined, true);
  if (kicker && !meta.includes(kicker)) addMeta(kicker, undefined, true);
  // An abstract the user opened in full ("▽ More") is shown in full.
  if (text.length > 600 && !expanded) text = text.slice(0, 597).trimEnd() + "…";
  // The price leads the meta line.
  const order = meta.map((m, i) => i).sort((a, b) => +PRICE.test(meta[b]) - +PRICE.test(meta[a]));
  const sortedParts = order.map((i) => metaParts[i]);
  meta.splice(0, meta.length, ...order.map((i) => meta[i]));
  metaParts.splice(0, metaParts.length, ...sortedParts);

  let image: Img | undefined;
  const hasPrice = meta.some((m) => PRICE.test(m)) || Array.from(el.querySelectorAll("[class*=price i], [itemprop=price]")).some((p) => PRICE.test(textIn(p)));
  if (ctx.thumbs || hasPrice) {
    const imgs = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
    let bestA = 0;
    for (const im of imgs) {
      if (inReply(im)) continue;
      const r = im.getBoundingClientRect();
      const a = r.width * r.height;
      const src = imgSrc(im);
      if (a > bestA && r.width >= 48 && src && !LOGO_TOKEN.test(src.split("?")[0])) {
        bestA = a;
        image = { src, alt: clean(im.alt) };
      }
    }
  }

  const actions: Action[] = [...linkActs];
  // A clickable tile opens itself; the links inside it ("Syllabus") are its actions.
  if (!main && tile) {
    for (const a of links) {
      const l = labelOf(a);
      if (l && actions.length < 2 && usefulControl(a, l, ctx)) actions.push(toAction(a, l));
    }
  }
  for (const b of Array.from(el.querySelectorAll("button,[role=button],input[type=submit],input[type=button]"))) {
    if (!visible(b) || b === main || b === el || bodyEl?.contains(b) || inReply(b)) continue;
    const label = labelOf(b);
    // "Filter by label: feature request" is a filter, but its visible text is the
    // item's label or author (the "Filter by" part may be screen-reader text).
    const vis = chipText(b);
    if (vis) {
      // Already read in place unless its line was the title or a duplicate.
      if (!Array.from(seenT).some((x) => x.includes(vis)) && meta.length < 8) addMeta(vis);
      continue;
    }
    // The row's overflow menu ("More actions for Notes.txt") holds its Rename, Download and Delete.
    const overflow = overflowMenu(b, label);
    if (!usefulControl(b, label, ctx) || label === title || ((label.length > 40 || ITEM_ACTION_NOISE.test(label)) && !overflow)) continue;
    // "Copy link" on an entry that links to itself copies the address its title already gives (F1033).
    if (main && !ctx.inDialog && COPY_LABEL.test(label) && /link|enlace/i.test(label)) continue;
    // Its entry's name is said with it already (Sift's button is described by the title).
    actions.push(toAction(b, overflow && label.toLowerCase().endsWith(" for " + title.toLowerCase()) ? label.slice(0, -(title.length + 5)) : label));
    if (actions.length >= 2 + linkActs.length) break;
  }

  // A card whose link goes through an ad server is an ad; one that sells or calls to action is a promo.
  if ((main && AD_HOSTS.test(hostOf(main.href))) || promoCard(title, main?.href)) return promo(el, ctx);
  // A game or app tile whose only call is "Play" ("Rompecabezas · Jugar").
  if (meta.some((m) => PLAY_CTA.test(m))) return promo(el, ctx);
  // A tile of the site's games, labelled so (La Nación's "Edición especial: … fotos de Charly García" · "Juegos").
  // A dated or numbered story in a games section ("/games/2026/oct/25/lara-croft-…", The Guardian) is a story (F736).
  if (main && meta.some((m) => /^(juegos|games|jeux|spiele)$/i.test(m)) && /^\/(juegos|games|jeux|spiele)\//i.test(main.pathname) && !/\/(19|20)\d\d\/|\/\d{4,}(\/|$)/.test(main.pathname)) return promo(el, ctx);
  const ref = main ? refOf(main) : refOf(el);
  let body: Block[] | undefined;
  if (bodyEl) {
    const sub = new Out();
    const cctx: Ctx = { ...ctx, seen: new Set(), inPost: true, inArticle: false };
    walk(bodyEl, sub, cctx);
    ctx.count = cctx.count;
    const bs = sub.done();
    if (bs.length) body = bs;
  }
  // A link that became an action is not said again as meta.
  const shown = meta.map((m, i) => i).filter((i) => !actions.some((a) => a.label === meta[i]));
  const rich = shown.some((i) => metaParts[i]);
  // A reply is a comment, whatever area it sits in.
  const rctx: Ctx = ctx.inComments ? ctx : { ...ctx, inComments: true };
  const replies = replyEls.map((r) => toItem(r, rctx)).filter((r): r is Item => !!r);
  ctx.count = rctx.count;
  return {
    key: "i:" + refOf(el), title, href: main ? hrefOf(main) : undefined, body, replies: replies.length ? replies : undefined,
    ref, meta: shown.map((i) => meta[i]), metaInline: rich ? shown.map((i) => metaParts[i] ?? [meta[i]]) : undefined, text: text || undefined, image, actions: actions.length ? actions : undefined,
    // A name set apart from its snippet ("Tramitar el Pasaporte") is never rewritten.
    keepTitle: split ? true : undefined,
  };
}

// ---------- article detection ----------

/**
 * In navigation, a footer, an aside or a real form (one closest() for speed;
 * a form that wraps the whole page, ASP.NET style, does not count).
 */
function outsideProse(el: Element, sel: string): boolean {
  const c = el.closest(sel);
  return !!c && (c.localName !== "form" || !pageWide(c));
}

/**
 * Class names of posts in a thread or a list of results: the word ends the
 * class or comes before a number ("comment", "js-answer", "post-123"), so a
 * story's own parts ("post-content", "entry-header", "comment-form") are not posts.
 */
const POST_TOKEN = /(^|[\s_-])(answers?|comments?|replies|reply|reviews?|results?|threads?|posts?|messages?|entry|entries)(?=$|\s|[_-]\d)/i;

const POST_TYPE = /schema\.org\/(Answer|Comment|Review)$/i;

/** The words that name an element as a post ("answer" for "answer js-answer accepted-answer"), singular. */
function postWords(el: Element): string[] {
  const out: string[] = [];
  const s = `${el.localName} ${baseClasses(el).join(" ")} ${/^[\w-]+$/.test(el.id) ? el.id : ""}`;
  const re = new RegExp(POST_TOKEN.source, "gi");
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[2].toLowerCase().replace(/(ies)$/, "y").replace(/s$/, ""));
  const it = POST_TYPE.exec(el.getAttribute("itemtype") ?? "");
  if (it) out.push(it[1].toLowerCase());
  return out;
}

/** Named as a post in a thread or a result in a list ("answer", "comment", "arxiv-result", schema.org Answer). */
function postNamed(el: Element): boolean {
  return postWords(el).length > 0;
}

/** Two posts of one kind: siblings named by the same word ("answer accepted-answer" beside "answer"). */
function samePost(a: Element, b: Element): boolean {
  const wa = postWords(a);
  return wa.length > 0 && postWords(b).some((w) => wa.includes(w));
}

/**
 * Holds repeated posts as children: two or more named as answers, comments or
 * results, or three or more with prose of their own (not a photo's caption)
 * and what posts carry (a time, a vote or reply button, an author).
 */
function postGroup(el: Element): boolean {
  const named = new Map<string, number>();
  const plain = new Map<string, number>();
  for (const c of Array.from(el.children)) {
    // A short reply named as one ("Thanks, I agree") is still a post.
    const pw = /^(div|li|article|section)$/.test(c.localName) ? postWords(c) : [];
    if (!/^(div|li|article|section)$/.test(c.localName) || tlen(c) < (pw.length ? 30 : 80) || !c.querySelector("p, pre, blockquote")) continue;
    const k = signature(c);
    // Posts of one kind count together, whatever their extra classes ("accepted-answer").
    if (pw.length) named.set(pw[0], (named.get(pw[0]) ?? 0) + 1);
    else if (c.querySelector("time, button, [role=button], [itemprop=author]") && Array.from(c.querySelectorAll("p, pre, blockquote")).reduce((n, p) => n + tlen(p), 0) >= 200) plain.set(k, (plain.get(k) ?? 0) + 1);
  }
  for (const n of named.values()) if (n >= 2) return true;
  for (const n of plain.values()) if (n >= 3) return true;
  return false;
}

/**
 * A list of results (GOV.UK's search, HN Search, a catalogue): three or more
 * entries of one kind, each named by a link on a line of its own over a short
 * description or its details. Its descriptions are prose, but the list is not a
 * story, and neither is one long entry in it.
 */
function resultList(el: Element): boolean {
  const c = resultCache.get(el);
  if (c && c.pass === passNo()) return c.v;
  if (el.localName === "dl") {
    const v = resultDefs(el);
    resultCache.set(el, { pass: passNo(), v });
    return v;
  }
  const kinds = new Map<string, number>();
  let n = 0;
  for (const c of Array.from(el.children)) {
    if (!/^(li|article|div)$/.test(c.localName)) continue;
    n++;
    const len = tlen(c);
    if (len < 30 || len > 600) continue;
    const a = c.querySelector("a[href]");
    if (!a || inPage(a) || a.closest("p") || tlen(a) < 4 || len - tlen(a) < 15 || !titleLink(a, c)) continue;
    // The entries of one <ul> are one kind, whatever class marks each one's type (Sphinx: "kind-object", "kind-text").
    const k = c.localName === "li" && /^(ul|ol)$/.test(el.localName) ? "li" : signature(c);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  let v = false;
  for (const m of kinds.values()) if (m >= 3 && m >= n * 0.6) v = true;
  resultCache.set(el, { pass: passNo(), v });
  return v;
}
const resultCache = new WeakMap<Element, { pass: number; v: boolean }>();

/**
 * Search results as a <dl> (MoinMoin's full-text search, F1044): three or more
 * terms, most of them one link to another page over a short snippet in the
 * <dd> after it. A glossary's terms are not links.
 */
function resultDefs(dl: Element): boolean {
  let n = 0;
  let hits = 0;
  for (const dt of Array.from(dl.children)) {
    if (dt.localName !== "dt") continue;
    n++;
    const links = dt.querySelectorAll("a[href]");
    const len = tlen(dt);
    // The link is the term's name: most of it, or what it starts with ("Pinning . . . 1 match").
    if (links.length !== 1 || inPage(links[0]) || tlen(links[0]) < 4 || len > 200 || (tlen(links[0]) < len * 0.5 && !textIn(dt).startsWith(textIn(links[0])))) continue;
    let dd = dt.nextElementSibling;
    while (dd && dd.localName !== "dd" && dd.localName !== "dt") dd = dd.nextElementSibling;
    if (dd?.localName === "dd" && tlen(dd) >= 10 && tlen(dd) <= 800) hits++;
  }
  return hits >= 3 && hits >= n * 0.6;
}

/** A list of results right after `el` (a toolbar's sibling, or the list one level inside it). */
function resultsAfter(el: Element): boolean {
  let s = el.nextElementSibling;
  for (let i = 0; s && i < 3; s = s.nextElementSibling, i++) if (resultList(s) || Array.from(s.children).some((c) => resultList(c))) return true;
  return false;
}

/** Walking a filter panel Sift folds: a box of filters inside it is part of that one fold. */
let inFilterPanel = false;

/** A panel named for filters or facets ("cl-search-filters-panel", "filters-sidebar", "facets"). */
const FILTER_TOKEN = /(^|[\s_-])(filters?|facets?|refine(ments)?)($|[\s_-])/i;

/**
 * A long panel of search filters beside the results and before them in the page's order
 * (Craigslist's sidebar: categories, price, make and model, a dozen groups): narrow, mostly
 * fields and choices, with the results in a wider box after it.
 */
function filterPanel(el: Element, ctx: Ctx): boolean {
  if (ctx.inDialog || ctx.inArticle || ctx.articleEl || !/^(div|section|aside|fieldset)$/.test(el.localName)) return false;
  if (ctx.searchEl && el.contains(ctx.searchEl)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 120 || r.width > ctx.vw * 0.4 || r.height < ctx.vh * 0.5 || tlen(el) > 3000) return false;
  const fields = Array.from(el.querySelectorAll("input:not([type=hidden]), select, [role=checkbox], [role=radio]")).filter((f) => visible(f));
  if (fields.length < 6) return false;
  const choices = fields.filter((f) => f.matches("[type=checkbox], [type=radio], [role=checkbox], [role=radio]")).length;
  if (choices < 4 && !FILTER_TOKEN.test(tokens(el))) return false;
  // A product's buy box (sizes, colors, "Add to cart") is the page's own form, not filters (F735).
  if (Array.from(el.querySelectorAll("button, input[type=submit], [role=button]")).some((b) => BUY_LABEL.test(b.textContent || (b as HTMLInputElement).value || b.getAttribute("aria-label") || ""))) return false;
  for (let a: Element | null = el, i = 0; a && a !== document.body && i < 4; a = a.parentElement, i++) {
    for (let s = a.nextElementSibling; s; s = s.nextElementSibling) {
      if (!visible(s) || s.localName === "footer" || s.getAttribute("role") === "contentinfo") continue;
      const sr = s.getBoundingClientRect();
      // The results sit beside the panel (side by side, overlapping in height), not below it as a footer or a reviews list does (F735).
      const beside = (sr.left >= r.right - 4 || sr.right <= r.left + 4) && sr.top < r.bottom - 40 && sr.bottom > r.top + 40;
      // Links inside a map (its controls and credits) are not results: a panel beside a map (OpenStreetMap's "Map Layers") is the tool's own.
      if (beside && sr.width > r.width * 1.5 && Array.from(s.querySelectorAll("a[href]")).filter((l) => !l.closest(SURFACE_SEL)).length >= 10) return true;
    }
  }
  return false;
}
const BUY_LABEL = /\b(add to (cart|bag|basket|trolley)|buy (it )?now|agregar al carrito|a[ñn]adir al (carrito|cesta)|comprar ahora|ajouter au panier|in den warenkorb)\b/i;

/** Inside one entry of a list of results. */
function inResultList(el: Element): boolean {
  for (let a: Element | null = el, i = 0; a && a.parentElement && a.parentElement !== document.body && i < 6; a = a.parentElement, i++) if (resultList(a.parentElement)) return true;
  return false;
}

/** Inside one of several answers, comments or results: one answer is not the page's article. */
function inPostGroup(el: Element): boolean {
  for (let a: Element | null = el, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) {
    const p = a.parentElement;
    if (!p || !postNamed(a)) continue;
    if (Array.from(p.children).some((c) => c !== a && tlen(c) >= 30 && samePost(a, c))) return true;
  }
  return false;
}

/** Vote buttons ("Up vote", "upvote", a vote arrow): what a post in a thread carries and a story does not. */
const VOTE = /\b(up[ -]?vote|down[ -]?vote|vote[ _-]?(up|down)|votearrow|vote-?button)\b/i;

/**
 * A post of a thread: a question, or a post with vote buttons in its own unit
 * (the box around it that is not much bigger: its votes, author and tools).
 */
function threadPost(el: Element): boolean {
  const len = tlen(el) || 1;
  let unit: Element = el;
  for (let a: Element | null = el, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) {
    if (/schema\.org\/(Question|Answer)$/i.test(a.getAttribute("itemtype") ?? "")) return true;
    if (tlen(a) > len * 1.6 + 400) break;
    unit = a;
  }
  for (const b of Array.from(unit.querySelectorAll("button, a, [role=button]")).slice(0, 80)) {
    if (!VOTE.test(`${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""} ${tokens(b)} ${b.firstElementChild ? tokens(b.firstElementChild) : ""}`)) continue;
    // Votes on the readers' comments below a story are the comments', not the story's.
    let inComment = false;
    for (let a = b.parentElement; a && a !== unit; a = a.parentElement) if (COMMENTS_TOKEN.test(tokens(a)) || postWords(a).some((w) => w === "comment" || w === "reply")) { inComment = true; break; }
    if (!inComment) return true;
  }
  return false;
}

export function findArticle(root: Element): Element | null {
  const scores = new Map<Element, number>();
  const ps = root.querySelectorAll("p, pre, blockquote");
  // Appeals and banners (a fundraising overlay) can hold more prose than a short page; they are never its article.
  const noisy = new Map<Element, boolean>();
  const inNoise = (e: Element | null): boolean => {
    if (!e || e === root) return false;
    let v = noisy.get(e);
    if (v === undefined) {
      const tk = tokens(e);
      v = (NOISE_TOKEN.test(tk) && !COMMENTS_TOKEN.test(tk)) || isAd(e) || inNoise(e.parentElement);
      noisy.set(e, v);
    }
    return v;
  };
  for (const p of Array.from(ps)) {
    const tx = clean(p.textContent);
    if (tx.length < 40) continue;
    if (outsideProse(p, "nav,footer,aside,[role=navigation],[role=complementary],form")) continue;
    if (inNoise(p.parentElement)) continue;
    const s = 1 + Math.min(tx.length / 100, 3) + (tx.match(/[,，、]/g)?.length ?? 0) * 0.3;
    const parent = p.parentElement;
    // A result's info line set right in its list (MoinMoin's "1.4k - rev: 1", F1044) is part of an entry, not a story's paragraph.
    if (!parent || (parent.localName === "dl" && resultList(parent))) continue;
    scores.set(parent, (scores.get(parent) ?? 0) + s);
    const gp = parent.parentElement;
    if (gp) scores.set(gp, (scores.get(gp) ?? 0) + s / 2);
    // One grid cell per paragraph (BBC at narrow widths): wrappers that hold only
    // this paragraph are not where the story is; the first ancestor that holds more is.
    if (gp && parent.childElementCount === 1 && gp.childElementCount === 1) {
      let up = gp.parentElement;
      for (let i = 0; up && up !== root && up.childElementCount === 1 && i < 4; i++) up = up.parentElement;
      if (up && (up === root || root.contains(up))) scores.set(up, (scores.get(up) ?? 0) + s);
    }
  }
  const rank = () => {
    const ranked: [Element, number][] = [];
    for (const [el, s] of scores) {
      if (s < 8) continue;
      const links = Array.from(el.querySelectorAll("a")).reduce((n, a) => n + clean(a.textContent).length, 0);
      const len = clean(el.textContent).length || 1;
      const adj = s * (1 - Math.min(links / len, 0.9));
      if (adj >= 8) ranked.push([el, adj]);
    }
    return ranked.sort((a, b) => b[1] - a[1]);
  };
  let ranked = rank();
  // No story in <p>s: one set as runs of text between <br>s in a box (TOI's div.ihgno, F832).
  // Each long run is a paragraph of that box.
  if (!ranked.length) {
    // One of several entries of one kind, each named by its own title link (a status page's incidents), is not the story (F955).
    const entries = new Map<Element, boolean>();
    const titled = (c: Element) => {
      const l = c.querySelector("a[href]");
      return !!l && !l.closest("p") && titleLink(l, c);
    };
    const inEntries = (el: Element): boolean => {
      let v = entries.get(el);
      if (v !== undefined) return v;
      v = false;
      for (let a: Element | null = el, i = 0; a && a !== root && a.parentElement && i < 4; a = a.parentElement, i++) {
        const k = signature(a);
        if (k.endsWith(".") || !titled(a)) continue;
        if (Array.from(a.parentElement.children).some((c) => c !== a && signature(c) === k && titled(c))) {
          v = true;
          break;
        }
      }
      entries.set(el, v);
      return v;
    };
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const parent = n.parentElement;
      if (!parent || !/^(div|section|article|td)$/.test(parent.localName) || (n.nodeValue?.length ?? 0) < 80) continue;
      const tx = clean(n.nodeValue);
      if (tx.length < 80 || !/[.!?。]["'”’)]?$/.test(tx)) continue;
      if (outsideProse(parent, "nav,footer,aside,[role=navigation],[role=complementary],form") || inNoise(parent) || inEntries(parent)) continue;
      const s = 1 + Math.min(tx.length / 100, 3) + (tx.match(/[,，、]/g)?.length ?? 0) * 0.3;
      scores.set(parent, (scores.get(parent) ?? 0) + s);
      const gp = parent.parentElement;
      if (gp) scores.set(gp, (scores.get(gp) ?? 0) + s / 2);
    }
    ranked = rank();
  }
  // A list of results or a thread is not one story; one answer or result in it is not either.
  let best: Element | null = ranked.find(([el]) => !postGroup(el) && !inPostGroup(el) && !resultList(el) && !inResultList(el))?.[0] ?? null;
  if (!best) return null;
  // Articles split into blocks and <section>s: climb while an ancestor holds
  // clearly more prose. Wrappers with the same prose are passed through.
  // List entries of running text count too (a listicle's tips, a recipe's steps), links do not.
  const proseCache = new Map<Element, number>();
  const prose = (el: Element): number => {
    let v = proseCache.get(el);
    if (v !== undefined) return v;
    v = Array.from(el.querySelectorAll("p, pre, blockquote, li")).reduce((n: number, p) => {
      if (outsideProse(p, "nav,footer,aside,form")) return n;
      if (p.localName !== "li") return n + clean(p.textContent).length;
      const len = tlen(p);
      if (len < 25 || p.querySelector("p, pre, blockquote, li")) return n;
      let links = 0;
      // A card under an empty cover link (The Guardian's "More on this story") is a link, not prose.
      for (const a of Array.from(p.getElementsByTagName("a"))) links += a.hasAttribute("aria-label") && coverLink(a) ? len : tlen(a);
      return links > len * 0.5 ? n : n + len;
    }, 0);
    proseCache.set(el, v);
    return v;
  };
  let node: Element = best;
  let cur: Element = best;
  for (let i = 0; i < 10; i++) {
    const up: Element | null = cur.parentElement;
    if (!up || up === document.body || up === document.documentElement || !root.contains(up) && up !== root) break;
    const pu = prose(up);
    const pn = prose(node);
    if (pu <= pn * 1.05) {
      cur = up;
      continue;
    }
    if (pu < pn * 1.25) break;
    // More prose that sits in repeated posts (the answers below a question, the next stories) is not this story.
    if (postGroup(up) || resultList(up) || Array.from(up.children).some((c) => !c.contains(cur) && (postGroup(c) || resultList(c)))) break;
    const links = Array.from(up.querySelectorAll("a")).reduce((n: number, a) => n + clean(a.textContent).length, 0);
    if (links / (clean(up.textContent).length || 1) > 0.5) break;
    node = cur = up;
  }
  best = node;
  if (wordCount(clean(best.textContent)) < 150) return null;
  // A question with its vote buttons (or any post that people vote on) is a post of a thread, not a story.
  if (threadPost(best)) return null;
  // Prefer an enclosing <article> when it is not much bigger than the best node.
  const art = best.closest("article,[itemprop=articleBody],[role=article]");
  if (art && art !== best && clean(art.textContent).length < clean(best.textContent).length * 1.8) return art;
  return best;
}

// ---------- the walker ----------

/**
 * Walk an element's children in order. Text that sits directly in it is kept:
 * runs of text and inline elements between blocks or controls become their own
 * paragraphs ("Install <code>bun</code><ul>…", "<td>$19.99</td>", "Hi,<div>…").
 */
export function walk(parent: Element, out: Out, ctx: Ctx, skip?: Element | null) {
  // A <slot> shows the light-DOM nodes assigned to it, text included; else its fallback.
  if (parent.localName === "slot") {
    const as = (parent as HTMLSlotElement).assignedNodes({ flatten: true });
    walkNodes(as.length ? as : Array.from(parent.childNodes), parent, out, ctx, skip);
    return;
  }
  if (shadowOf(parent) || !hasDirectText(parent)) {
    const ks = kids(parent);
    // Rows of one kind, each with its own buttons (a place and its Favorite), keep their buttons apart.
    const rows = controlRows(ks);
    // A panel drawn to the right of a map follows it (F874; see walkNodes).
    let after: Map<Element, Element[]> | null = null;
    const copies = marqueeCopies(ks);
    for (const el of ks) {
      if (el === skip || copies?.has(el)) continue;
      const map = mapBefore(el);
      if (map) {
        (after ??= new Map()).set(map, [...(after.get(map) ?? []), el]);
        continue;
      }
      if (rows) out.flush();
      visit(el, out, ctx);
      visitSide(after?.get(el), out, ctx);
      after?.delete(el);
    }
    for (const ps of after?.values() ?? []) for (const p of ps) visit(p, out, ctx);
    if (rows) out.flush();
    return;
  }
  walkNodes(Array.from(parent.childNodes), parent, out, ctx, skip);
}

/**
 * A marquee repeats its strip to scroll without end (G1's quote ticker holds the same quotes 8 times):
 * a sibling that says exactly what an earlier one said, with the same links, is a copy and is said once (F1001).
 */
function marqueeCopies(ks: Element[]): Set<Element> | null {
  if (ks.length < 2) return null;
  let byLen: Map<number, Element[]> | null = null;
  let out: Set<Element> | null = null;
  const key = (e: Element) => `${e.localName}|${(e.textContent ?? "").replace(/\s+/g, " ").trim()}|${Array.from(e.querySelectorAll("a[href]"), (a) => (a as HTMLAnchorElement).href).join(" ")}`;
  for (const k of ks) {
    const n = tlen(k);
    // Short twins ("Yes", "Reply") are separate controls; only a long run of the same words is a copy.
    if (n < 40) continue;
    const same = (byLen ??= new Map<number, Element[]>()).get(n);
    if (!same) {
      byLen.set(n, [k]);
      continue;
    }
    if (!k.querySelector("input, select, textarea") && same.some((o) => key(o) === key(k))) (out ??= new Set()).add(k);
    else same.push(k);
  }
  return out;
}

/** Sibling rows of one kind (2 to 50), each with a button and another button or link of its own, and no field to fill. */
function controlRows(ks: Element[]): boolean {
  if (ks.length < 2 || ks.length > 50) return false;
  const row = (k: Element) => k.querySelectorAll("button, [role=button], a[href]").length >= 2 && !k.querySelector("input, select, textarea");
  // Cheap tests first: this runs for every container walked.
  const tag = ks[0].localName;
  if (ks.some((k) => k.localName !== tag) || !hasControl(ks[0]) || !hasControl(ks[1]) || !row(ks[0]) || !row(ks[1])) return false;
  const sig = signature(ks[0]);
  return ks.every((k) => signature(k) === sig) && ks.every(row);
}

/** Walk a run of nodes in order: loose text and inline elements become paragraphs, the rest is visited. */
function walkNodes(nodes: Node[], parent: Element, out: Out, ctx: Ctx, skip?: Element | null) {
  let run: Node[] = [];
  let first = 0;
  // The text after an unlabeled checkbox that became its label ("[x] Write tests") is not said twice.
  let named: Set<Node> | null = null;
  const flush = () => {
    if (run.length) textRun(run, parent, first, out, ctx);
    run = [];
  };
  // Panels the page draws to the right of the map after them (F874), by the map's box.
  let after: Map<Element, Element[]> | null = null;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (named?.has(n)) continue;
    if (n.nodeType === 3) {
      if (!run.length) first = i;
      run.push(n);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const e = n as Element;
    if (e === skip || SKIP.has(e.localName)) continue;
    // A panel the page draws to the right of its map (OpenStreetMap's "Map Layers") comes after
    // the map, as one reads them: a choice in it then shows on the map just above it (F874).
    const map = mapBefore(e);
    if (map) {
      flush();
      (after ??= new Map()).set(map, [...(after.get(map) ?? []), e]);
      continue;
    }
    const smallImg = (e.localName !== "img" && e.localName !== "picture") || !hasBigImage(e);
    if (e.localName === "br" || (smallImg && isInlineish(e) && !isControl(e) && !hasControl(e))) {
      if (!run.length) first = i;
      run.push(e);
      continue;
    }
    // A short run that labels a field moved to Sift's top bar ("Search: [ ]") goes with it.
    if (ctx.used.has(e) && run.length && textOf(inlineNodes(run, ctx)).trim().length <= 40) run = [];
    const unlabeled = e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio") && !e.labels?.length && !e.closest("label") && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby") && !clean(e.title);
    // A checkbox at the end of its row takes the row's words as its label ("bicycles 5481"):
    // the words are not said again before it, only the row's links stay.
    if (unlabeled && run.length && !labelNodes(e).length && accName(e) === textIn(parent)) run = run.filter((n) => n.nodeType === 1 && ((n as Element).localName === "a" || !!(n as Element).querySelector("a")));
    flush();
    if (unlabeled) named = new Set(labelNodes(e));
    visit(e, out, ctx);
    visitSide(after?.get(e), out, ctx);
    after?.delete(e);
  }
  flush();
  // A map passed over: its panels still show.
  for (const ps of after?.values() ?? []) for (const p of ps) visit(p, out, ctx);
}

/** The blocks of the panels drawn beside a map (F874), which move with it (routeFirst, F1071). */
const sideBlocks = new WeakSet<Block>();
function visitSide(ps: Element[] | undefined, out: Out, ctx: Ctx) {
  if (!ps?.length) return;
  out.flush();
  const n = out.blocks.length;
  for (const p of ps) visit(p, out, ctx);
  out.flush();
  for (const b of out.blocks.slice(n)) sideBlocks.add(b);
}

/** The maps on the page, found once per pass. */
let mapsAt = -1;
let maps: Element[] = [];
/** The later sibling holding a map that `el`, a narrow panel of controls, is drawn to the right of (F874). */
function mapBefore(el: Element): Element | null {
  if (mapsAt !== passNo()) {
    mapsAt = passNo();
    maps = Array.from(document.querySelectorAll(".leaflet-container, .maplibregl-map, .mapboxgl-map, .ol-viewport, gmp-map"));
  }
  const p = el.parentElement;
  if (!maps.length || !p || document.dir === "rtl") return null;
  for (const m of maps) {
    if (!p.contains(m) || el.contains(m) || !(el.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.width > innerWidth * 0.4 || r.height < 100) return null;
    let s: Element = m;
    while (s.parentElement && s.parentElement !== p) s = s.parentElement;
    // A map Sift already shows sits in Sift's box (and the page closes the gap it left): its own width
    // was measured before, and the page's flex order (OpenStreetMap's map-ui: order 1) says which comes first.
    const mr = m.getBoundingClientRect();
    const lifted = m.hasAttribute("data-sift-portal");
    const drawnAfter = /flex|grid/.test(getComputedStyle(p).display) && +getComputedStyle(el).order > +getComputedStyle(s).order;
    const beside = drawnAfter || (lifted ? r.left >= innerWidth * 0.5 : r.left >= mr.right - 4 && r.top < mr.bottom - 40 && r.bottom > mr.top + 40);
    if (!beside || (lifted ? ownWidth.get(m) ?? 0 : mr.width) < r.width * 1.5 || !el.querySelector("input, button, [role=button]")) continue;
    return s;
  }
  return null;
}

/**
 * The post a link belongs to, when it is one of a stream of posts (Discourse's
 * article per post): a link is told apart from repeats within its own post
 * only, so a second post by the same author still shows its author.
 */
function postScope(el: Element | null | undefined): string {
  const a = el?.closest("article");
  const up = a?.parentElement?.parentElement;
  if (!a || !up || up.querySelectorAll(":scope > article, :scope > * > article").length < 2) return "";
  return "@" + refOf(a);
}

/** A run of loose text and inline elements inside a container, as a paragraph. */
function textRun(nodes: Node[], parent: Element, at: number, out: Out, ctx: Ctx) {
  const content = inlineNodes(nodes, ctx);
  const text = textOf(content).trim();
  if (!text || AD_LABEL.test(text) || isFragment(text)) return;
  if (content.length === 1 && typeof content[0] === "object" && "a" in content[0]) {
    const c = content[0] as { a: string; href?: string; ref?: string };
    const a = nodes.find((n) => n.nodeType === 1 && ((n as Element).localName === "a" || (n as Element).querySelector("a"))) as Element | undefined;
    // The link may sit in a web component's shadow root, where querySelector does not reach.
    const link = elOf(c.ref) ?? (a?.localName === "a" ? a : a?.querySelector("a"));
    if (link && usefulControl(link, c.a, ctx)) {
      const key = "link:" + c.href + "|" + c.a + postScope(link);
      if (!ctx.seen.has(key)) {
        ctx.seen.add(key);
        out.link(c.a, c.href, c.ref!);
      }
    }
    return;
  }
  if (isPromo(content, ctx.inArticle)) return;
  out.push({ t: "p", key: "p:" + refOf(parent) + ":" + at, content });
}

const HEAD_CTL = "button, [role=button], [role=tab], [aria-expanded]";

/**
 * Controls inside a heading: one that is the whole heading (an accordion
 * toggle), or small ones beside its words ("How to bake bread [Share]"),
 * which leave the heading's own text without them.
 */
function headingControls(el: Element): { whole: Element | null; small: Element[]; text: string } {
  const text = textIn(el);
  const all = Array.from(el.querySelectorAll(HEAD_CTL)).filter((b) => visible(b));
  const top = all.filter((b) => !all.some((o) => o !== b && o.contains(b)));
  if (!top.length) return { whole: null, small: [], text };
  const whole = top.find((b) => {
    const bt = textIn(b);
    return !!bt && bt.length >= text.length * 0.6;
  });
  if (whole) return { whole, small: [], text };
  const parts: string[] = [];
  const go = (n: Element) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) parts.push(c.nodeValue ?? "");
      else if (c.nodeType === 1 && !top.includes(c as Element)) {
        if (top.some((b) => (c as Element).contains(b))) go(c as Element);
        else parts.push(textInRaw(c as Element));
      }
    }
  };
  go(el);
  return { whole: null, small: top, text: clean(parts.join("")) };
}

/** A heading's own words, without a small button inside it. */
export function headingText(el: Element): string {
  return headingControls(el).text;
}

function heading(el: Element): number {
  const m = /^h([1-6])$/.exec(el.localName);
  if (m) return +m[1];
  if (el.getAttribute("role") === "heading" && !proseHeading(el)) return +(el.getAttribute("aria-level") || 2);
  return 0;
}

/** Paragraphs a site marked up as a heading (Lobsters' comment text, div role=heading): text, not a heading (F1030). */
function proseHeading(el: Element): boolean {
  return !/^h[1-6]$/.test(el.localName) && el.getAttribute("role") === "heading" && (!!el.querySelector("p, ul, ol, blockquote, pre, hr, table") || tlen(el) > 200);
}

/**
 * The heading that opens a container, e.g. "Sponsored content": near its top
 * and its first heading of all, so a rail's heading never names the wrapper
 * that also holds the story.
 */
function leadHeadingEl(el: Element): Element | null {
  const h = el.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > * > h1, :scope > * > h2, :scope > * > h3, :scope > * > h4, :scope > header h2, :scope > header h3");
  return h && el.querySelector(HEADING_SEL) === h ? h : null;
}

/** A <nav> kept as content: a short row of links (tabs, pages) or a link list. */
function navInto(el: Element, out: Out, ctx: Ctx) {
  // A long list grouped under its own headings ("1,000,000+ articles") keeps the groups.
  if (el.querySelector("h2, h3, h4") && el.querySelectorAll("a[href]").length > 16) {
    const sub = { ...ctx, keepAllNav: true };
    for (const c of kids(el)) visit(c, out, sub);
    ctx.count = sub.count;
    return;
  }
  const links = Array.from(el.querySelectorAll("a[href], button, [role=tab]")).filter((a) => visible(a) && !ctx.used.has(a));
  const acts: Action[] = [];
  const seen = new Set<string>();
  for (const a of links) {
    const label = labelOf(a);
    if (!usefulControl(a, label) || label.length > 80) continue;
    // A picture link named only "icon" or "logo" beside its labelled twin (a portal's emblem).
    if (!textIn(a) && LOGO_NAME.test(label)) continue;
    const k = label + "|" + ((a as HTMLAnchorElement).href ?? "");
    if (seen.has(k)) continue;
    seen.add(k);
    const act = toAction(a, label);
    act.kind = "quiet";
    acts.push(act);
  }
  if (!acts.length) return;
  if (acts.length <= 16) {
    // A named one (a pager) stays a navigation landmark; unnamed ones would be landmarks no one can tell apart.
    const nav = clean(el.getAttribute("aria-label")) || clean(document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent) || undefined;
    out.push({ t: "actions", key: "nav:" + refOf(el), actions: acts, nav });
    return;
  }
  for (const a of acts) {
    if (a.href) out.link(a.label, a.href, a.ref);
    else out.action(a);
  }
}

// The pass that last warned of a node it could not read (one warning a pass).
let skipWarned = -1;

/**
 * A box of text the page scrolls on its own, small next to the window (terms
 * to scroll to the end of before Agree enables). Sift shows its text in full.
 */
function scrollBox(el: Element): boolean {
  const h = el.clientHeight;
  if (!h || el.scrollHeight <= h + 8 || h > innerHeight * 0.6 || el === document.body || el === document.documentElement) return false;
  return /auto|scroll/.test(getComputedStyle(el).overflowY) && tlen(el) >= 200;
}

/**
 * Visits one element. A node that fails to read (an odd custom element, a
 * shadow root in a state Sift did not expect) is left out; the rest of the
 * page still shows.
 */
export function visit(el: Element, out: Out, ctx: Ctx) {
  try {
    const at = out.blocks.length;
    const box = scrollBox(el);
    visitEl(el, out, ctx);
    // Its last text block marks the box's end: reaching it in Sift scrolls the page's box to its end too.
    const last = box && out.blocks.length > at ? out.blocks[out.blocks.length - 1] : null;
    if (last && (last.t === "p" || last.t === "ul" || last.t === "ol")) last.scrollEnd = refOf(el);
  } catch (err) {
    if (skipWarned !== passNo()) {
      skipWarned = passNo();
      console.warn("[sift] skipped a node it could not read", el, err);
    }
  }
}

/** The code lines a file view draws for the eye (aria-hidden), while it has no accessible copy of them yet. */
function drawnCode(el: Element): string {
  const lines = el.querySelector(".react-code-lines");
  if (!lines || !visible(lines)) return "";
  for (let a = el.parentElement, i = 0; a && i < 6; a = a.parentElement, i++) if (a.querySelector("textarea[inputmode=none]")) return "";
  const rows = Array.from(lines.querySelectorAll(".react-file-line, [id^=LC]"));
  return rows.map((r) => (r.textContent ?? "").replace(/\n$/, "")).join("\n").replace(/\s+$/, "");
}

function visitEl(el: Element, out: Out, ctx: Ctx) {
  if (ctx.count > BUDGET) return budgetCut(out, ctx);
  const tag = el.localName;
  if (SKIP.has(tag) || ctx.used.has(el)) return;
  // Inside a player shown as a portal, through its shadow roots (its controls are the portal's).
  if (ctx.portals?.length && el.getRootNode() !== document && ctx.portals.some((p) => holds(p, el))) return;
  if (el.getAttribute("aria-hidden") === "true" && !el.querySelector("video") && !ctx.shownHidden) {
    // GitHub's file view draws its code for the eye (aria-hidden) about a second before it mounts
    // the screen reader's copy (a read-only text box, read in controlInto): until then the drawn lines are the code (F872).
    const code = drawnCode(el);
    if (code) out.push({ t: "pre", key: "pre:" + refOf(el), text: code });
    return;
  }
  // A tooltip only describes the control under focus or the pointer (a map's "Layers" button).
  if (el.getAttribute("role") === "tooltip") return;
  // A bot check's widget (Cloudflare's "Verify you are human") draws its frame in a closed shadow root
  // that no frame rule sees: its box is shown as it is, for the person to do themselves (F956).
  if (turnstileBox(el)) {
    const b = challengeBlock(el, ctx);
    if (b) {
      out.push(b);
      return;
    }
  }
  if (!visible(el)) return;
  // Only elements that show count toward the budget: hidden menus and scripts cost little.
  if (++ctx.count > BUDGET) return budgetCut(out, ctx);
  if (tag === "slot") return walk(el, out, ctx);
  if (isAd(el) || ctx.drop?.(el)) return;
  // A link through Google's ad click redirect is an ad, labeled or not (Maps' tour ad under "Sponsored · By …": F961).
  if (tag === "a" && AD_CLICK.test(el.getAttribute("href") ?? "")) return;
  if (!ctx.inArticle && sweepstakes(el)) return;
  if (el.matches(WIKI_CHROME)) return;
  // A breadcrumb told only by its schema (TOI's ul itemtype BreadcrumbList), and the site's furniture
  // around a story said in words: "End of Article", "Continue Reading" over a text shown in full,
  // a label left from a dropped box ("Trending" over its slider) (F832).
  if (/schema\.org\/BreadcrumbList$/i.test(el.getAttribute("itemtype") ?? "")) return;
  if (!ctx.inDialog && tlen(el) < 40 && !el.matches("a[href], button, [role=button], h1") && !el.querySelector("a[href], button, [role=button], input, select, textarea, img, svg, video, h1")) {
    const said = textIn(el);
    if (STRAY_LABEL.test(said)) return;
    const next = el.nextElementSibling;
    // Only a label that names the box ("Trending" over trending_slider): an address, a phone or a recipe's yield
    // beside social icons or a share bar is content (F934).
    if (said && el.parentElement?.childElementCount === 2 && !el.previousElementSibling && next && boxLabel(said) && NOISE_TOKEN.test(tokens(next)) && !COMMENTS_TOKEN.test(tokens(next)) && !next.querySelector("main, [role=main], h1") && !(ctx.articleEl && next.contains(ctx.articleEl)) && !MEDIA.has(next.localName) && !tabPanel(next) && !socialSignIn(next, tokens(next)) && !promoStory(next, tokens(next))) return;
  }
  // A promo set as a lone tracked link inside the story (TOI's "Take the AIQ test", utm_campaign=aiq_test).
  // A tracked heading or figure is the story's own (a gift guide's product names): only words that sell make a promo (F935).
  if (ctx.inArticle && tlen(el) < 200 && !el.matches(`a, p, figure, ${HEADING_SEL}`) && !el.querySelector(`figure, ${HEADING_SEL}`)) {
    const ls = el.querySelectorAll<HTMLAnchorElement>("a[href]");
    if (ls.length === 1 && tlen(ls[0]) >= tlen(el) - 2 && /[?&]utm_campaign=/i.test(ls[0].getAttribute("href") ?? "") && trackedPromo(ls[0])) return;
  }
  // Inside a story only: on a portal (www.wikipedia.org) the languages are the content.
  if (ctx.inArticle && /lang/i.test(tokens(el)) && languageBar(el)) return languagesInto(el, out, ctx);
  if (isDialog(el) && !ctx.inDialog) return;
  // A player that calls itself an application (JW Player) is a video, with Sift's media controls;
  // an app that only holds a video somewhere in it is not.
  if (el.matches(SURFACE_SEL)) {
    // While its ad plays, the ad's video is the one shown (the story's own video waits, hidden): the player stays a portal.
    const v = Array.from(el.querySelectorAll("video")).find((x) => visible(x) && x.getBoundingClientRect().width >= 200) ?? el.querySelector("video");
    const vr = v?.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (v && vr && visible(v) && vr.width >= 200 && er.width * er.height <= vr.width * vr.height * 1.6) {
      const b = portalBlock(v, ctx);
      if (b) {
        out.push(b);
        return;
      }
    }
  }
  // Maps and app surfaces stay as they are, inside Sift's layout.
  if (el.matches(SURFACE_SEL) && surfaceOnly(el)) {
    const b = surfaceBlock(el, "", ctx);
    if (b) {
      out.push(b);
      const c = overlayControls(el, ctx);
      if (c) out.push(c);
      return;
    }
  }
  // A results map or chart in a story (La Nación's svelte div.ln-root: an SVG map of 54 states, a select
  // and two buttons) is one thing, shown as it is: its labels and values apart say nothing (F828).
  // A small chart (a seat chart) is kept the same way, its numbers in its name (F929).
  // A map drawn in SVG is kept as a picture too, its places in its name (F1037).
  const widget = ctx.inArticle && !ctx.inDialog ? (dataWidget(el) ? dataWidget : dataChart(el) ? dataChart : dataMap(el) ? dataMap : null) : null;
  if (widget) {
    // The widget itself, not the layout boxes around it.
    let w = el;
    for (let i = 0; i < 6; i++) {
      const ks = Array.from(w.children).filter((c) => !SKIP.has(c.localName) && visible(c));
      if (ks.length !== 1 || !widget(ks[0])) break;
      // A chart's labels may sit beside its drawing, outside a narrower box (La Nación's seat charts).
      if (widget !== dataWidget && ks[0].getBoundingClientRect().width < w.getBoundingClientRect().width - 2) break;
      w = ks[0];
    }
    const b = surfaceBlock(w, "", ctx);
    if (b?.t === "portal") {
      b.tool = undefined;
      // It reflows at Sift's width: as tall as what it holds there, not scaled down to the page's shape.
      const wr = w.getBoundingClientRect();
      // A map's panels stack at a narrow width (two maps one over the other): it may be taller (F1037).
      b.ratio = Math.min(Math.max(wr.height, w.scrollHeight) / Math.max(1, wr.width), widget === dataMap ? 3.95 : 1.6);
      if (widget === dataChart) {
        b.chart = true;
        // Named by the short title just before it ("Diputados", set in a plain div), not by the notes under it.
        let a: Element | null = w;
        for (let i = 0; a && i < 5 && !a.previousElementSibling; i++) a = a.parentElement;
        const s = a?.previousElementSibling;
        const title = s && tlen(s) <= 60 && !s.querySelector("a[href], button") ? textIn(s) : "";
        b.label = chartLabel(title || (b.label === t("interactive") ? "" : b.label), w);
      } else if (widget === dataMap) {
        b.chart = true;
        b.label = mapLabel(w);
      }
      out.push(b);
      return;
    }
  }
  if ((tag === "nav" || el.getAttribute("role") === "navigation") && !isChrome(el, ctx)) return navInto(el, out, ctx);
  // A page header that holds the page's title (its h1 and standfirst outside <main>):
  // the title and what follows it stay, the site's logo and menu before it go.
  if ((tag === "header" || el.getAttribute("role") === "banner") && ctx.titleEl && el.contains(ctx.titleEl) && isChrome(el, ctx) && !CHROME_TOKEN.test(tokens(el)) && storyHeader(el, ctx.titleEl)) return fromTitle(el, out, ctx);
  // A site header built from a plain box (MoinMoin's div#header: logo, login, search, page actions, then the page's h1):
  // the title comes first; the header's links and page tools follow it (F1046).
  if (tag === "div" && /^header$/i.test(el.id || tokens(el)) && ctx.titleEl && el.contains(ctx.titleEl) && !inMain(el) && !ctx.inArticle && tlen(el) < 1500) {
    const ks = kids(el);
    const i = ks.findIndex((k) => k === ctx.titleEl || k.contains(ctx.titleEl!));
    if (i > 0) {
      fromTitle(el, out, ctx);
      for (const k of ks.slice(0, i)) visit(k, out, ctx);
      return;
    }
  }
  if (isChrome(el, ctx)) return;
  // A site bar outside the main region that also holds the page's title (an h1
  // in the masthead) keeps only the title.
  if (CHROME_TOKEN.test(tokens(el)) && siteBar(el, ctx) && tlen(el) < 1500 && !inMain(el) && !contentFooter(el)) {
    for (const h of Array.from(el.querySelectorAll("h1"))) visit(h, out, ctx);
    return;
  }
  if (el === ctx.articleEl) return article(el, out, ctx);
  // A long panel of filters before the results folds away, so the results come first; every filter stays a click away.
  if (!inFilterPanel && filterPanel(el, ctx)) {
    const sub = new Out();
    inFilterPanel = true;
    try {
      walk(el, sub, ctx);
    } finally {
      inFilterPanel = false;
    }
    const blocks = sub.done();
    // The page's title set inside it (Craigslist's "for sale") stays on top.
    for (const h of blocks.filter((b) => b.t === "h" && b.level === 1)) out.push(h);
    const rest = blocks.filter((b) => !(b.t === "h" && b.level === 1));
    if (rest.length) out.push({ t: "section", key: "filters:" + refOf(el), title: t("filters"), blocks: rest, collapsed: true });
    return;
  }
  // A post of a thread: its author and date, then its own text in full.
  if (ctx.postUnits?.has(el)) {
    const it = toItem(el, ctx);
    if (it) {
      out.item(it);
      return;
    }
  }
  // A picture drawn from parts (a route's elevation chart: a canvas and its axis labels) is
  // one thing that says its name ("Total ascent of 243 ft. Total descent of 72 ft."); its parts say nothing alone.
  if (el.getAttribute("role") === "img" && tag !== "img" && tag !== "svg" && !el.querySelector("a[href], button, input, select, textarea, [role=button], [role=link]")) {
    const name = accName(el);
    if (name && el.hasAttribute(el.hasAttribute("aria-label") ? "aria-label" : "aria-labelledby")) {
      out.flush();
      // The same values shown just before without their meaning ("243 ft · 72 ft" by two arrow icons) are said once.
      const last = out.blocks[out.blocks.length - 1];
      const nums = (x: string): string[] => x.match(/\d[\d.,]*/g) ?? [];
      if (last?.t === "p" && last.content.every((c) => typeof c === "string")) {
        const prev = textOf(last.content);
        if (prev.length <= 40 && nums(prev).length && nums(prev).every((n) => nums(name).includes(n))) out.blocks.pop();
      }
      out.push({ t: "p", key: "p:" + refOf(el), content: [name] });
      return;
    }
  }
  // Answers on a Q&A page (schema.org Answer) each get a heading with their votes,
  // so one answer never runs into the next.
  if (el.hasAttribute("itemscope") && /schema\.org\/Answer$/i.test(el.getAttribute("itemtype") ?? "") && !ctx.inDialog) return answer(el, out, ctx);
  const tk = tokens(el);
  // (After a dek, too: The Guardian's "Tom Phillips in São Paulo and Tiago Rogero in Brasília" follows its standfirst.)
  if (ctx.hasByline && BYLINE_TOKEN.test(tk) && tlen(el) < 300 && bylineZone(el, ctx, 2)) return;
  // The author's name alone over the story, already said in Sift's byline (La Nación's long-form "Guido Bovone" link, F827).
  if (ctx.byName && tlen(el) < 80 && !heading(el) && norm(textIn(el)) === norm(ctx.byName) && bylineZone(el, ctx, 2)) return;
  // A count over the story ("108" on La Nación's comments button): a number is not an action to offer (F827).
  if (ctx.hasByline && el.matches("button, [role=button]") && /^\d[\d.,]*\s*[kKmM]?$/.test(textIn(el)) && bylineZone(el, ctx, 2)) return;
  // Sift shows the date in its own byline; the site's date and reading-time line goes.
  // A player whose only text is its length ("1:18", BBC's uncaptioned lead video) is not a date line.
  if (ctx.hasDate && tlen(el) < 120 && !heading(el) && bylineZone(el, ctx, 3) && dateLine(textIn(el)) && !el.querySelector("figure, video, audio, iframe")) return;
  // A copy button classed "copy-code" away from any code block copies something the page may not show (an invite code, F904).
  if (CODE_CHROME.test(tk) && tlen(el) < 80 && !(COPY_LABEL.test(textIn(el) || clean(el.getAttribute("aria-label"))) && !besideCode(el))) return;
  if (!ctx.inDialog && /reaction/i.test(`${tag} ${tk}`) && reactionBar(el)) return;
  // A live page's "2 new updates" button (The Guardian's toast, pinned over the posts) shows the posts
  // it holds back: it stays, as on the page, wherever it is pinned and whatever its box is called.
  if (tlen(el) < 60 && NEW_POSTS.test(textIn(el))) {
    const b = el.matches("button, [role=button]") ? el : el.querySelector("button, [role=button]");
    if (b && visible(b) && !ctx.used.has(b)) {
      out.action(toAction(b, textIn(b) || labelOf(b)), ctx.formRef);
      return;
    }
  }
  // Media carry their own size and logo checks; "img-share" on a photo is a share hook, not a share bar.
  if (!ctx.inDialog && !MEDIA.has(tag) && NOISE_TOKEN.test(tk) && !(ctx.articleEl && el.contains(ctx.articleEl)) && !el.querySelector("main,[role=main],[data-sift-role=main],h1") && !tabPanel(el)) {
    if (!COMMENTS_TOKEN.test(tk) && !socialSignIn(el, tk) && !promoStory(el, tk) && !mainFeed(el, tk, ctx)) return;
  }
  // A "Was this page helpful? Yes / No" widget is never part of the story, even inside it.
  if (ctx.inArticle && !ctx.inDialog && tlen(el) < 400 && feedbackWidget(el)) return;
  // Nor is the site's AI answer box ("Ask The Independent anything", its canned questions and its own summary) (F732).
  if (ctx.inArticle && !ctx.inDialog && AI_BOX.test(tk) && !el.querySelector("h1, main, [role=main]")) return;
  // Prose filters stay out of the story: "can help improve flexibility" or
  // "the senator's fundraising haul" are sentences, not widgets.
  if (!ctx.inDialog && !ctx.inArticle && tag !== "body" && tag !== "main") {
    const small = tlen(el) < 400;
    // Feedback widgets ("Was this page helpful?").
    if (small && FEEDBACK.test(textIn(el))) return;
    // Donation and subscription appeals with their own buttons ("Donate", "Give $5"),
    // not news about a donation, nor a short page's wrapper around its main region and footer (F726).
    if (tlen(el) < 900 && el.querySelector("a[href], button") && !el.querySelector("h1,main,[role=main],[data-sift-role=main]") && !(ctx.articleEl && el.contains(ctx.articleEl)) && APPEAL.test(textIn(el)) && appealAsks(el)) return;
    // A strip that sends readers to another of the site's products with one call-to-action button and a slogan
    // (La Nación's radio: "El mundo necesita más música" · "Escuchá + música") is a cross-promotion.
    if (tlen(el) < 120 && ctaStrip(el)) return;
    // Small floating notices whose only control is "Okay" or "Got it" are banners;
    // an invitation with Accept and Decline is a choice.
    if (small && textIn(el).length < 300) {
      const btns = Array.from(el.querySelectorAll("button,[role=button]"));
      if (btns.length >= 1 && btns.length <= 2 && btns.some((b) => DISMISS.test(accName(b))) && el.querySelectorAll("a[href]").length <= 1 && !el.querySelector("input,select,textarea") && !btns.some((b) => closesPanel(b, ctx))) {
        if (NOISE_TEXT.test(textIn(el)) || (btns.every((b) => DISMISS.test(accName(b))) && (!inMain(el) || floating(el)))) return;
      }
    }
    // Sections headed "Sponsored content" or "Around the web", by a heading or a
    // plain title line ("OUR SHOPPING PICKS" over affiliate deals).
    if (!/^h[1-6]$/.test(tag)) {
      const n = tlen(el);
      const first = el.firstElementChild;
      // An ad slot that opens a section ("Publicidad" over a banner) names only itself.
      // A section whose header line sells ("Play now · Explore Games >") is a promo.
      // (The title line is read only when its raw text could name such a section.)
      const head = n < 6000 && !!first && first.nextElementSibling !== null && tlen(first) < 60 && SECTION_HINT.test(first.textContent ?? "") && !isAd(first) ? firstLine(first) : "";
      // The heading may say so only in its name (Google Maps' h1 "Sponsored · By Viator" over a tour ad) (F961).
      const lead = leadHeadingEl(el);
      const adHead = !!lead && (SPONSORED_HEAD.test(textIn(lead)) || SPONSORED_HEAD.test(clean(lead.getAttribute("aria-label"))));
      const sponsored = adHead || (!!head && ((n > 80 && SPONSORED_SECTION.test(head)) || PLAY_HEAD.test(head)));
      // An h1 that is that sponsored heading does not make the block the page's own.
      if (sponsored && !(ctx.articleEl && el.contains(ctx.articleEl)) && !Array.from(el.querySelectorAll("h1,main,[role=main],[data-sift-role=main]")).some((x) => x !== lead)) return;
    }
  }
  // (Not an original Sift shows over its place: the fixed position is Sift's own, not the page's.
  // Read as a small fixed bar, MDN's "Try it" editor went from the view while the user typed in it.)
  if (!ctx.inArticle && tag !== "body" && !el.hasAttribute("data-sift-portal")) {
    const cs = getComputedStyle(el);
    // A frame Sift lifted into its own box is fixed only because Sift put it there: it is still where the page had it.
    const lifted = el.hasAttribute("data-sift-portal");
    // A zoom gallery or photo viewer drawn over the whole page is its dialog.
    if (cs.position === "fixed" && !lifted && !ctx.inDialog && overlayLayer(el, ctx)) {
      (ctx.layers ??= []).push(el);
      return;
    }
    if ((cs.position === "fixed" && !lifted) || cs.position === "sticky") {
      const r = el.getBoundingClientRect();
      // Sticky parts of the content (a product's info column, a chat composer,
      // tab bars) stay; small fixed bars and badges go.
      const keep =
        !!el.querySelector("h1, " + SURFACE_SEL) ||
        !!el.querySelector("textarea, [contenteditable=''], [contenteditable=true]") ||
        (cs.position === "sticky" && inMain(el) && !el.querySelector("nav, [role=navigation]") && !!el.querySelector("input:not([type=hidden]), select, [role=tablist]")) ||
        // A lone button pinned over the content (a feed's "Show 3 new posts") is something to press.
        (cs.position === "sticky" && inMain(el) && loneControl(el)) ||
        // The results' own toolbar pinned over the list (Craigslist's sort order, view and count;
        // Infobae's search count and sort pinned over the results its overlay shows).
        (!el.querySelector("nav, [role=navigation]") && !!el.querySelector('[class*="sort" i], [id*="sort" i], [aria-label*="sort" i], [aria-haspopup=listbox]') && (inMain(el) || resultsAfter(el))) ||
        // A panel with its own Close button (a map's directions or layers) is the page's, not a banner.
        Array.from(el.querySelectorAll("button, [role=button]")).some((b) => closesPanel(b, ctx)) ||
        // A checkout's bar with the total, the terms and the pay button is the page's main action.
        payBar(el) ||
        // So is the bar of actions for the rows the user selected ("2 selected · Mark as shipped").
        bulkBar(el) ||
        // And the bar of unsaved changes ("Unsaved changes · Discard · Save", F901).
        saveBar(el) ||
        // So is the bar of a search panel whose results replaced the page (Infobae's queryly: its box, "Búsqueda Avanzada", its close).
        (!!ctx.searchEl && el.contains(ctx.searchEl) && Array.from(el.querySelectorAll("label")).some((l) => checkboxToggle(l) && CLOSE_NAME.test(accName(l))));
      // Dropped, but on screen (a live region is not: the toasts it shows come and go).
      const bar = () => {
        if (cs.position === "fixed" && r.width >= 80 && r.height >= 24 && tlen(el) >= 2 && !el.matches(LIVE_SEL) && !el.querySelector(LIVE_SEL)) ctx.bars?.add(el);
      };
      // A file browser's side column pinned beside its file (GitHub's tree pane): its branch picker and
      // "Go to file" stay, its tree of links goes as navigation (F963).
      const pane = !keep && cs.position === "sticky" && inMain(el) && r.width < ctx.vw * 0.4 && r.height > r.width && sidePaneTools(el);
      // Its heading names the tree, and its splitter only resizes the column.
      if (pane) for (const n of Array.from(el.querySelectorAll("nav, [role=navigation], h1, h2, h3, h4, [role=heading], [role=slider], [role=separator]"))) if (!n.matches("[role=slider], [role=separator]") || /splitter|resiz|drag/i.test(accName(n))) ctx.used.add(n);
      if (!keep && !pane && r.width * r.height < ctx.vw * ctx.vh * 0.4) return bar();
      if (NOISE_TEXT.test(textPrefix(el, 400))) return bar();
    }
    // Positioned parts the page shows are never offered again as popups; ones it
    // dropped (a fixed popup the user just opened) still can be.
    if (cs.position === "absolute" || cs.position === "fixed") ctx.visited?.add(el);
  }

  // A label that only works a hidden checkbox (a CSS-only panel's close: queryly's "close" picture) is a button.
  if (tag === "label" && !textIn(el) && checkboxToggle(el) && CLOSE_NAME.test(accName(el))) {
    out.action(toAction(el, t("close")), ctx.formRef);
    return;
  }

  const lvl = heading(el);
  if (lvl) {
    const full = textIn(el);
    if (!full || AD_LABEL.test(full) || SPONSORED_HEAD.test(full)) return;
    const hc = headingControls(el);
    // A heading that is a button (an accordion, a tab) must stay usable: it
    // becomes that button, with its open or closed state.
    if (hc.whole) {
      const act = toAction(hc.whole, full.length <= 160 ? full : labelOf(hc.whole));
      out.push({ t: "actions", key: "hb:" + refOf(hc.whole), actions: [act] });
      return;
    }
    // Small controls beside the heading's words ("Share", "Edit", "#") come after it, as themselves.
    const text = hc.text;
    const after = () => {
      for (const b of hc.small) visit(b, out, ctx);
    };
    if (!text) return after();
    const a = (el.querySelector("a[href]") || el.closest("a[href]")) as HTMLAnchorElement | null;
    if (text.length > 110 && lvl > 1) {
      out.push({ t: "p", key: "p:" + refOf(el), content: [{ b: text }] });
      return after();
    }
    ctx.visited?.add(el);
    const h: Block = { t: "h", key: "h:" + refOf(el), level: lvl, text };
    // A card inside the story that links another story is related reading, after it (see article()).
    if (a && clean(textIn(a)) === text && relatedCard(a, ctx)) {
      relatedLink(out, text, hrefOf(a) ?? a.href, refOf(a));
      return after();
    }
    // A heading that only links to its own anchor ("Step 1") is not a link.
    if (a && !inPage(a) && clean(textIn(a)) === text) {
      h.href = hrefOf(a);
      h.ref = refOf(a);
    }
    out.push(h);
    return after();
  }

  // A poster that loads its player on click is a video.
  if (facadeHint(el)) {
    const b = facadeBlock(el, ctx);
    if (b) {
      out.push(b);
      return;
    }
  }
  // A clickable photo (a figure with role=button that opens a viewer, a zoomable
  // gallery photo) is a photo; other clickable tiles with a picture are buttons named by their text.
  if ((tag === "figure" && el.getAttribute("role") === "button" && el.querySelector("img")) || photoButton(el)) return figure(el, out, ctx);
  // A thumbnail button for a photo already shown (named after it) adds nothing.
  if ((tag === "button" || el.getAttribute("role") === "button") && !textIn(el) && el.querySelector("img") && ctx.seen.has("photo:" + labelOf(el))) return;
  // A clickable tile with a heading and text (a course card with role=button) is an entry you can open,
  // not one long button: its title opens it, its text and links stay readable.
  if (el.getAttribute("role") === "button" && tag !== "button" && el.querySelector(HEADING_SEL + ", p") && textIn(el).length > 40) {
    const it = toItem(el, ctx);
    if (it) {
      out.item(it);
      return;
    }
  }
  // An ARIA 1.0 combobox wraps its text box (Google Maps' "Choose starting point"): the box is the field.
  if (el.getAttribute("role") === "combobox" && tag !== "input" && tag !== "select" && tag !== "textarea") {
    const box = el.querySelector("input:not([type=hidden]), textarea, [contenteditable=''], [contenteditable=true]");
    if (box) {
      if (visible(box) && !ctx.used.has(box)) controlInto(box, out, ctx);
      return;
    }
  }
  if (isControl(el)) return controlInto(el, out, ctx);
  // A filter group (Craigslist's "bicycle type", La Nación's "Autor"): its options show right under its button.
  if (disclosureGroup(el, out, ctx)) return;

  if (tag.includes("-")) {
    const w = widgetBlock(el, ctx);
    if (w) {
      out.push(w);
      return;
    }
    // A web component button (Material, Shoelace) keeps its real <button> in its shadow root.
    const inner = shadowButton(el);
    if (inner) {
      const label = labelOf(el) || labelOf(inner);
      if (usefulControl(el, label, ctx)) out.action(toAction(inner, label), ctx.formRef);
      return;
    }
  }

  if ((tag === "div" || tag === "li" || tag === "article") && coverCard(el, out, ctx)) return;
  if (tag === "a" && el.querySelector("a[href]") && nestedLinkCard(el, out, ctx)) return;
  if (tag === "a" || tag === "article" || tag === "li" || tag === "div" || tag === "section" || tag.includes("-")) {
    const card = asCard(el, ctx);
    if (card) {
      if (!repeatCard(card, ctx)) out.item(card);
      return;
    }
    if (ctx.promos?.has(el)) return;
  }

  switch (tag) {
    case "p": {
      // A paragraph holding a button is walked so the button stays ("Sign in with a passkey").
      if (hasControl(el)) break;
      const content = inlineOf(el, ctx);
      const tx = textOf(content).trim();
      if (!tx || AD_LABEL.test(tx) || isFragment(tx)) return;
      if (content.length === 1 && typeof content[0] === "object" && "a" in content[0] && tx.length < 90 && !ctx.inArticle) {
        const c = content[0] as { a: string; href?: string; ref?: string };
        if (usefulControl(el.querySelector("a") ?? el, c.a, ctx)) out.link(c.a, c.href, c.ref!);
        return;
      }
      if (isPromo(content, ctx.inArticle)) return;
      const more = readMoreLink(content, el, ctx);
      if (more) return relatedLink(out, more.a, more.href, more.ref);
      // A link to another story in capitals, alone in its paragraph (Fox's "AMERICANS WARNED ABOUT PARIS
      // TRAVEL …"), is related reading: it joins the related links after the story (F648).
      if (ctx.inArticle && !ctx.inDialog && content.length === 1 && typeof content[0] === "object" && "a" in content[0]) {
        const c = content[0] as { a: string; href?: string; ref?: string };
        const a = el.querySelector("a[href]");
        // Only a link to a story: a call to act ("APPLY FOR THE STORM RELIEF GRANT ONLINE") is the story's own (F742).
        if (c.href && c.ref && a && !inPage(a) && c.a.length >= 20 && c.a.split(/\s+/).length >= 4 && c.a === c.a.toLocaleUpperCase() && /\p{Lu}/u.test(c.a) && storyHref(c.href) && !CAPS_CTA.test(c.a)) {
          relatedLink(out, c.a, c.href, c.ref);
          return;
        }
      }
      out.push({ t: "p", key: "p:" + refOf(el), content });
      return;
    }
    case "ul":
    case "ol":
      return list(el, out, ctx);
    case "dl":
      return defs(el, out, ctx);
    case "table":
      return table(el as HTMLTableElement, out, ctx);
    case "blockquote": {
      // Code quoted in a reply stays a code block in its place, between the quote's words.
      if (el.querySelector("pre")) {
        let run: Node[] = [];
        let n = 0;
        const flush = () => {
          const content = inlineNodes(run, ctx);
          if (textOf(content).trim()) out.push({ t: "quote", key: "q:" + refOf(el) + (n++ ? ":" + n : ""), content });
          run = [];
        };
        for (const c of childNodesOf(el)) {
          if (c.nodeType === 1 && ((c as Element).localName === "pre" || (c as Element).querySelector("pre"))) {
            flush();
            visit(c as Element, out, ctx);
          } else run.push(c);
        }
        flush();
        return;
      }
      const content = inlineOf(el, ctx);
      // A social post's fallback (X's blockquote.twitter-tweet before its widget loads) is one post, shown whole (F647).
      if (textOf(content).trim()) out.push({ t: "quote", key: "q:" + refOf(el), content, ...(SOCIAL_EMBED.test(tokens(el)) ? { embed: true } : {}) });
      return;
    }
    case "pre": {
      // Code only: toolbars inside the <pre> ("Copy" buttons) are not part of it.
      const code = el.querySelector(":scope > code") ?? el;
      const text = codeText(code).replace(/\s+$/, "").replace(/^\n+/, "");
      if (text) out.push({ t: "pre", key: "pre:" + refOf(el), text });
      return;
    }
    case "figure":
    case "picture":
    case "img":
      return figure(el, out, ctx);
    case "video":
    case "audio":
    case "iframe":
    case "canvas":
    case "embed":
    case "object": {
      const b = portalBlock(el, ctx);
      if (b) out.push(b);
      return;
    }
    case "form": {
      const prev = ctx.formRef;
      const prevWide = ctx.pageForm;
      ctx.formRef = refOf(el);
      ctx.pageForm = pageWide(el);
      walk(el, out, ctx);
      out.flush();
      ctx.formRef = prev;
      ctx.pageForm = prevWide;
      return;
    }
    case "details":
      return details(el as HTMLDetailsElement, out, ctx);
    case "label":
      if ((el as HTMLLabelElement).control) {
        // The field takes this text as its label; walk only nested controls.
        for (const c of Array.from(el.querySelectorAll(CONTROL_SEL))) if (!ctx.used.has(c)) controlInto(c, out, ctx);
        // Links in that text ("I agree to the Terms of Service") still open, beside the field.
        for (const a of Array.from(el.querySelectorAll("a[href]"))) {
          let l = labelOf(a);
          if (!visible(a) || !l || !usefulControl(a, l, ctx)) continue;
          // An icon link in the label says which choice it is about ("Layer Info: Standard", not eight "Layer Info").
          const own = textIn(el);
          if (!textIn(a) && own && !l.includes(own)) l = `${l}: ${own}`;
          const act = toAction(a, l);
          act.kind = "quiet";
          out.action(act, ctx.formRef);
        }
        return;
      }
      break;
    case "hr":
      return;
    case "legend":
      // Its fields show it as their group's name (Sift's fieldset), not as a loose line before them.
      if (shownLegend(el)) return;
      break;
    case "a": {
      if (!(el as HTMLAnchorElement).getAttribute("href")) {
        if (clickableAnchor(el)) return controlInto(el, out, ctx);
        break;
      }
      const href = hrefOf(el) ?? (el as HTMLAnchorElement).href;
      // A link around a section heading is that heading, linked.
      const hd = el.querySelector(HEADING_SEL);
      // A section's title drawn as its logo (La Nación's "LN Bienestar": a picture, its words hidden) reads as the picture's name.
      const hdText = hd ? textIn(hd) || clean(hd.querySelector("img")?.getAttribute("alt")) : "";
      if (hd && visible(hd) && tlen(hd) >= tlen(el) * 0.6 && hdText && !(!textIn(hd) && LOGO_NAME.test(hdText))) {
        if (!usefulControl(el, textIn(el) || hdText, ctx)) return;
        if (relatedCard(el, ctx)) return relatedLink(out, hdText, href, refOf(el));
        out.push({ t: "h", key: "h:" + refOf(hd), level: heading(hd) || 2, text: hdText, href: inPage(el) ? undefined : href, ref: refOf(el) });
        return;
      }
      if (!textIn(el) && el.querySelector("img, svg")) {
        // A link that is only a logo image ("Wikibooks logo") says nothing.
        if (/(^|\W)(logo|icon)(\W|$)/i.test(labelOf(el))) return;
        // An avatar beside the name that links to the same profile.
        const near = el.parentElement?.parentElement?.parentElement;
        if (near && wordedHrefs(near).has((el as HTMLAnchorElement).href)) return;
      }
      // A screenshot that opens in full (Discourse's lightbox, its file name and size shown on hover) is the picture.
      const shot = linkedShot(el, ctx);
      if (shot) {
        out.push({ t: "img", key: "img:" + refOf(shot.img), img: shot.im, href, ref: refOf(el) });
        return;
      }
      const label = labelOf(el);
      if (!usefulControl(el, label, ctx) || isFragment(label)) return;
      // A long link to "#" in a story (a key point a script scrolls to) goes nowhere in Sift: it reads as text.
      // Elsewhere it is kept: a script may handle it in place (a question that opens its answer).
      if (el.getAttribute("href") === "#" && label.length >= 60 && ctx.inArticle && !scriptLink(el)) {
        out.push({ t: "p", key: "p:" + refOf(el), content: [textIn(el)] });
        return;
      }
      const key = "link:" + href + "|" + label + postScope(el);
      if (ctx.seen.has(key)) return;
      ctx.seen.add(key);
      // A link wrapping a big media element is about the media.
      const v = el.querySelector("video,iframe");
      if (v) return visit(v, out, ctx);
      // A big picture drawn as the link's CSS background (weather.com's radar map) is what it shows.
      const bg = bgPicture(el);
      if (bg) {
        bg.alt = nearbyName(el) || label;
        out.push({ t: "img", key: "img:" + refOf(el), img: bg, caption: label !== bg.alt ? label : undefined, href, ref: refOf(el) });
        return;
      }
      out.link(label, href, refOf(el));
      return;
    }
  }

  // Comments: keep them, but folded away, once (a comment's own "comment-body" is not another section).
  // One comment among others ("div.comment" beside "div.comment") is not the comments area: their parent is.
  // A thread's posts may hold the one Sift took for the article (its longest comment): that is one post among the others.
  const artIn = !!ctx.articleEl && el.contains(ctx.articleEl);
  if (!ctx.inComments && tlen(el) > 200 && (!artIn || !!ctx.articleEl!.closest(POST_BODY)) && (COMMENTS_TOKEN.test(tk) ? !oneOfComments(el) : commentList(el)) && (!artIn || threadWith(el)) && !storyBody(el, ctx)) {
    const sub = new Out();
    // The sub-walk shares the page's visit budget.
    const sctx: Ctx = { ...ctx, inArticle: false, inComments: true, articleEl: artIn ? null : ctx.articleEl };
    const thread = artIn || threadWith(el);
    if (thread) sctx.postUnits = postUnitsIn(el);
    // The thread's own first post (the issue itself) is one entry, read in full.
    const single = thread && postBodies(el).length === 1 && !detectItems(el, sctx) ? toItem(el, sctx) : null;
    if (single) sub.item(single);
    else walk(el, sub, sctx);
    ctx.count = sctx.count;
    const blocks = sub.done();
    if (!blocks.length) return;
    // Below a story or a post they fold away; on a page that is the thread they are its content.
    if (thread || (!ctx.articleEl && !postBeside(el))) {
      for (const b of blocks) out.push(b);
      return;
    }
    const sec: Block = { t: "section", key: "s:" + refOf(el), title: t("comments"), blocks, collapsed: !expandedByPage(el) };
    commentFolds.add(sec);
    out.push(sec);
    return;
  }

  // A strip of small readings side by side (weather.com's hours) is one line.
  if (!ctx.inArticle && el.childElementCount >= 8) {
    const line = readingStrip(el, ctx);
    if (line) {
      out.push(line);
      return;
    }
  }

  const members = detectItems(el, ctx);
  if (members) return itemsInto(el, members, out, ctx);

  // "Search [Stories] by [Popularity] for [All time]": the menus stay in their sentence.
  const sentence = controlSentence(el, ctx);
  if (sentence) {
    out.push({ t: "p", key: "p:" + refOf(el), content: sentence });
    return;
  }

  if (!ctx.inArticle && !ctx.inDialog && sectionMenu(el)) return;
  // A small cell of short lines that give one reading ("03:00 · 38°", "Wind · 2 mph SE") is one line.
  if (!ctx.inArticle) {
    const line = valueLine(el);
    if (line) {
      out.push({ t: "p", key: "p:" + refOf(el), content: [line] });
      const days = badDays(el);
      if (days) out.push({ t: "p", key: "days:" + refOf(el), content: [days] });
      return;
    }
  }
  if (isTextBlock(el)) {
    const content = inlineOf(el, ctx);
    const text = textOf(content).trim();
    if (!text || AD_LABEL.test(text) || isFragment(text) || captionOfControl(el, text)) return;
    if (content.length === 1 && typeof content[0] === "object" && "a" in content[0]) {
      const c = content[0] as { a: string; href?: string; ref?: string };
      // The link may sit in a web component's shadow root, where el.querySelector does not reach.
      const a = elOf(c.ref) ?? el.querySelector("a");
      const shot = a && linkedShot(a, ctx);
      if (shot) {
        out.push({ t: "img", key: "img:" + refOf(shot.img), img: shot.im, href: c.href, ref: refOf(a) });
        return;
      }
      if (!a || usefulControl(a, c.a, ctx)) {
        const key = "link:" + c.href + "|" + c.a + postScope(a);
        if (!ctx.seen.has(key)) {
          ctx.seen.add(key);
          out.link(c.a, c.href, c.ref!);
        }
      }
      return;
    }
    if (isPromo(content, ctx.inArticle)) return;
    const more = readMoreLink(content, el, ctx);
    if (more) return relatedLink(out, more.a, more.href, more.ref);
    // Short notes read small; a line that leads with a link is a title, not a note.
    const leadsWithLink = typeof content[0] === "object" && "a" in content[0];
    out.push({ t: "p", key: "p:" + refOf(el), content, small: text.length < 40 && !ctx.inArticle && !leadsWithLink ? true : undefined });
    return;
  }

  // Elements with their own shadow root or plain containers: go deeper.
  const adds = out.adds;
  walk(el, out, ctx);
  // A label over a list or carousel that showed nothing (the Daily Mail's "Shorts" over videos it plays only in place) labels nothing.
  const last = out.blocks[out.blocks.length - 1];
  if (out.adds === adds + 1 && last?.t === "p" && last.content.every((c) => typeof c === "string") && textOf(last.content).length <= 30 && el.querySelector("ol, ul, [role=list]")) {
    const src = elOf(/^p:(r[0-9a-z]+)/.exec(last.key)?.[1]);
    if (src && el.contains(src)) out.blocks.pop();
  }
}

/**
 * A button or link alone, or a box around just one with no other words, that
 * no other control in the content repeats (a pinned copy of "Add to cart" is a copy).
 */
function loneControl(el: Element): boolean {
  const sel = "button, a[href], [role=button]";
  const cs = el.matches(sel) ? [el] : Array.from(el.querySelectorAll(sel));
  if (cs.length !== 1 || tlen(el) > tlen(cs[0]) + 4) return false;
  const label = textIn(cs[0]);
  const box = el.closest("main, [role=main], [data-sift-role=main], article");
  return !!label && !Array.from(box?.querySelectorAll(sel) ?? []).some((o) => o !== cs[0] && textIn(o) === label && visible(o));
}

/**
 * One line of words with menus or buttons in it ("Search [Stories] by
 * [Popularity] for [All time]"): a sentence whose controls are clickable words
 * in place. Read apart, it is a run of stray words and buttons.
 */
function controlSentence(el: Element, ctx: Ctx): Inline[] | null {
  if (tlen(el) > 120 || !hasControl(el) || el.querySelector("input:not([type=hidden]), textarea, select, p, table, img, video, iframe, " + HEADING_SEL)) return null;
  const all = Array.from(el.querySelectorAll("button, [role=button], [role=combobox]")).filter((c) => visible(c) && !ctx.used.has(c));
  const ctls = all.filter((c) => !all.some((o) => o !== c && o.contains(c)));
  // Only menus that open in place (a combobox, a button with a popup); "Add to cart" stays a button.
  if (!ctls.length || ctls.length > 4 || !ctls.every((c) => c.getAttribute("role") === "combobox" || c.hasAttribute("aria-haspopup") || c.hasAttribute("aria-expanded"))) return null;
  // A share menu or a promo beside a link is a social bar, not a sentence: the walker drops what is noise.
  if (ctls.some((c) => !usefulControl(c, labelOf(c), ctx))) return null;
  const r = el.getBoundingClientRect();
  if (!r.height || r.height > 56 || ctls.some((c) => c.getBoundingClientRect().height > r.height)) return null;
  const out: Inline[] = [];
  let words = 0;
  const go = (n: Element) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        const tx = (c.nodeValue ?? "").replace(/\s+/g, " ");
        if (tx.trim()) {
          out.push(tx);
          words++;
        }
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as Element;
      if (SKIP.has(e.localName) || e.getAttribute("role") === "listbox" || !visible(e)) continue;
      if (ctls.includes(e)) {
        const label = labelOf(e);
        if (!label || label.length > 40) return false;
        // An ARIA combobox opens from its toggle inside (HN Search's label), not from its box.
        const toggle = e.getAttribute("role") === "combobox" ? e.querySelector("button, [role=button], [tabindex]:not([tabindex='-1'])") : null;
        out.push(" ", { a: label, ref: refOf(toggle ?? e) }, " ");
        continue;
      }
      // A link in the line stays a link in place ("· [Saved searches]"); one inside a box is left to the walker.
      if (e.localName === "a" && e.hasAttribute("href")) {
        const label = textIn(e) || accName(e);
        if (!label || label.length > 60 || !usefulControl(e, label, ctx)) return false;
        out.push(" ", { a: label, href: hrefOf(e) ?? (e as HTMLAnchorElement).href, ref: refOf(e) }, " ");
        continue;
      }
      if (e.querySelector("a[href]") || go(e) === false) return false;
      if (!INLINE.has(e.localName)) out.push(" ");
    }
    return true;
  };
  if (!go(el) || !words) return null;
  const content = tidy(out);
  if (isPromo(content, ctx.inArticle)) return null;
  // Words around the controls, not a toolbar of buttons with a count beside them.
  return content.some((x) => typeof x === "string" && /\p{L}{2}/u.test(x)) ? content : null;
}

/** A story's header: after its title comes a standfirst (a paragraph of its own words), not menus and a logo. */
function storyHeader(el: Element, title: Element): boolean {
  return Array.from(el.querySelectorAll("p")).some((p) => {
    if (!(title.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) || tlen(p) < 40) return false;
    const links = Array.from(p.querySelectorAll("a")).reduce((n, a) => n + tlen(a), 0);
    return links < tlen(p) * 0.5;
  });
}

/**
 * A "Was this page helpful? Yes / No" box (MDN keeps it in a web component's
 * shadow root): its question, read through shadow roots, and buttons to answer.
 */
/** A site's AI question box in a story, by its vendor's or its own class (DeeperDive's #deeper-dive-container, .dd-widget). */
const AI_BOX = /(^|[\s_-])(deeper-?dive|dd-widget|ai-?(assistant|answers?|chat|widget)|ask-?ai)($|[\s_-])/i;

function feedbackWidget(el: Element): boolean {
  // Cheap first: the raw text says it, or a web component right inside may hold it.
  const raw = el.textContent ?? "";
  if (raw.length >= 1200 || (!FEEDBACK.test(raw) && !el.localName.includes("-") && !Array.from(el.children).some((c) => c.localName.includes("-")))) return false;
  let s = textIn(el);
  if (s.length >= 400) return false;
  const comps = Array.from(el.querySelectorAll("*")).filter((e) => e.localName.includes("-"));
  if (el.localName.includes("-")) comps.push(el);
  for (const e of comps) {
    const sr = shadowOf(e);
    if (sr && e !== el) for (const c of Array.from(sr.children)) if (!SKIP.has(c.localName)) s += " " + textIn(c);
  }
  if (s.length >= 600 || !FEEDBACK.test(s)) return false;
  return !!el.querySelector("button, [role=button]") || comps.some((e) => !!shadowOf(e) && !!deepQuery(shadowOf(e)!, "button, [role=button]"));
}

/** Walk a header from its title on: the part that holds the title, then everything after it. */
function fromTitle(el: Element, out: Out, ctx: Ctx) {
  const ks = kids(el);
  const i = ks.findIndex((k) => k === ctx.titleEl || k.contains(ctx.titleEl!));
  if (i < 0) return;
  if (ks[i] === ctx.titleEl) visit(ks[i], out, ctx);
  else fromTitle(ks[i], out, ctx);
  for (const k of ks.slice(i + 1)) visit(k, out, ctx);
}

/** Sections made from a page's comments area, which stay out of the story they follow. */
const commentFolds = new WeakSet<Block>();

/** The page's links to itself in other languages: most of its links (six or more) are marked with their language. */
function languageBar(el: Element): boolean {
  const links = Array.from(el.querySelectorAll("a[href]"));
  if (links.length < 6) return false;
  return langLinks(links).length >= links.length * 0.7;
}

function langLinks(links: Element[]): Element[] {
  return links.filter((a) => a.hasAttribute("hreflang") || a.hasAttribute("lang") || !!a.parentElement?.hasAttribute("lang"));
}

/**
 * A wiki's bar of other languages over its article (the OpenStreetMap wiki's
 * 29 languages): a folded list after the story, so the story starts at once.
 */
function languagesInto(el: Element, out: Out, ctx: Ctx) {
  const sub = new Out();
  for (const a of langLinks(Array.from(el.querySelectorAll("a[href]")))) {
    const label = textIn(a);
    if (label && visible(a)) sub.link(label, hrefOf(a) ?? (a as HTMLAnchorElement).href, refOf(a));
  }
  const blocks = sub.done();
  if (!blocks.length) return;
  const sec: Block = { t: "section", key: "langs:" + refOf(el), title: t("otherLanguages"), blocks, collapsed: true };
  // It follows the story, as its comments do, and is no part of its Short version.
  commentFolds.add(sec);
  out.push(sec);
}

/**
 * Holds the story's opening paragraphs (after a dek) and no comments of its own:
 * the story's body, whatever its class names say ("comments-enabled"), is never its comments.
 */
function storyBody(el: Element, ctx: Ctx): boolean {
  const art = ctx.articleEl;
  if (!art || !art.contains(el)) return false;
  ctx.firstParas ??= Array.from(art.querySelectorAll("p")).filter((p) => tlen(p) > 80 && !BYLINE_TOKEN.test(tokens(p))).slice(0, 3);
  if (!ctx.firstParas.slice(0, 2).some((p) => el.contains(p))) return false;
  let posts = 0;
  for (const c of Array.from(el.querySelectorAll("div, li, article, section"))) if (postWords(c).includes("comment") && ++posts >= 2) return false;
  return true;
}

/** A post's own text, written by its author (GitHub's markdown body, a schema.org text). */
const POST_BODY = ".markdown-body, [itemprop=text]";

/** The outermost post text inside a comment, if it shows. */
function postBodyOf(el: Element): Element | null {
  const b = el.querySelector(POST_BODY);
  return b && visible(b) && tlen(b) > 0 ? b : null;
}

/** The post texts in `scope`, not counting one nested in another (GitHub nests two markdown bodies). */
function postBodies(scope: ParentNode): Element[] {
  return Array.from(scope.querySelectorAll(POST_BODY)).filter((b) => !b.parentElement?.closest(POST_BODY) && visible(b));
}

/** Each post of a thread inside `el`: the largest part around one post text that holds no other. */
function postUnitsIn(el: Element): Set<Element> {
  const out = new Set<Element>();
  for (const b of postBodies(el)) {
    let u = b;
    while (u.parentElement && u.parentElement !== el && postBodies(u.parentElement).length === 1) u = u.parentElement;
    if (u !== b) out.add(u);
  }
  return out;
}

/**
 * Comments that are a thread with the post they answer (an issue and its
 * comments): the post and its answers are written alike, so the page is the
 * thread, read in full, not a story with comments below it.
 */
function threadWith(el: Element): boolean {
  const own = postBodies(el);
  if (!own.length) return false;
  const kind = own[0].className;
  return postBodies(document).some((b) => !el.contains(b) && !b.contains(el) && b.className === kind);
}

/** Several comments side by side, with no wrapper named for them ("div.thread" of "div.comment"). */
function commentList(el: Element): boolean {
  let n = 0;
  for (const c of Array.from(el.children)) if (COMMENTS_TOKEN.test(tokens(c)) && postWords(c).includes("comment") && ++n >= 2) return true;
  return false;
}

/** One comment beside others of its kind. */
function oneOfComments(el: Element): boolean {
  const p = el.parentElement;
  if (!p || !postWords(el).includes("comment")) return false;
  const sig = signature(el);
  return Array.from(p.children).some((c) => c !== el && signature(c) === sig);
}

/** Comments that answer something beside them: a story or a post with prose of its own. */
function postBeside(el: Element): boolean {
  for (let a: Element = el, i = 0; a.parentElement && a.parentElement !== document.body && i < 3; a = a.parentElement, i++) {
    for (const s of Array.from(a.parentElement.children)) {
      if (s === a || COMMENTS_TOKEN.test(tokens(s))) continue;
      const n = (s.localName === "p" ? tlen(s) : 0) + Array.from(s.querySelectorAll("p, pre")).reduce((k, p) => k + tlen(p), 0);
      if (n >= 150) return true;
    }
  }
  return false;
}

/** The page shows these comments opened: the user asked for them ("Show all comments" became "Collapse comments"). */
function expandedByPage(el: Element): boolean {
  if (el.id && document.querySelector(`[aria-controls~="${CSS.escape(el.id)}"][aria-expanded=true]`)) return true;
  for (const b of Array.from(el.querySelectorAll("button, a, [role=button]")).slice(0, 40)) {
    const label = clean(b.getAttribute("aria-label")) || textIn(b);
    if (/^(collapse|hide|show (less|fewer)|ocultar|contraer|mostrar menos)\b.*\b(comments?|replies|comentarios|respuestas)\b/i.test(label)) return true;
  }
  return false;
}

/**
 * A row of short links beside a section's linked title ("ECONOMÍA | Dólar Hoy
 * · Índices · Campo"): the section's own menu, which the site menu already has.
 */
function sectionMenu(el: Element): boolean {
  const p = el.parentElement;
  if (!p || p.children.length > 3 || tlen(p) > 400 || /^(ul|ol|nav)$/.test(el.localName) || el.getElementsByTagName("a").length < 3 || el.querySelector(HEADING_SEL + ",img,input,button")) return false;
  const links = Array.from(el.querySelectorAll("a[href]"));
  if (links.length < 3) return false;
  let linked = 0;
  for (const a of links) {
    const t = textIn(a);
    if (t.length > 30 || t.split(" ").length > 4) return false;
    linked += t.length;
  }
  if (linked < textIn(el).replace(/[\s|·•,/-]+/g, "").length * 0.85) return false;
  // The title beside it is a heading that links to the section.
  return Array.from(p.children).some((c) => c !== el && Array.from(c.querySelectorAll(HEADING_SEL)).concat(heading(c) ? [c] : []).some((h) => !!(h.closest("a[href]") ?? h.querySelector("a[href]"))));
}

/**
 * A small cell whose short lines give one reading: an hour and its
 * temperature ("03:00 · 38°"), a label and its value ("Wind · 2 mph SE").
 * Each line is its own block on the page; read apart they lose their pairs.
 */
function valueLine(el: Element): string {
  if (tlen(el) > 120 || hasDirectText(el) || hasControl(el)) return "";
  const parts: string[] = [];
  const cells: Element[] = [];
  let digit = false;
  let empty = 0;
  for (const c of kids(el)) {
    if (SKIP.has(c.localName) || !visible(c)) continue;
    const tx = textIn(c);
    if (!tx) {
      empty++;
      continue;
    }
    if (tx.length > 30 || parts.length >= 8 || isInlineish(c) || /^(a|h[1-6]|ul|ol|dl|table|label|figure)$/.test(c.localName) || c.querySelector("a, img, picture, video, iframe, h1, h2, h3, h4, h5, h6, ul, ol, table, [role=heading]") || textLines(c).length > 1) return "";
    if (/\d/.test(tx)) digit = true;
    parts.push(tx);
    cells.push(c);
  }
  // The column titles over such rows, with blank cells over the columns they do not name ("Humidity · Wind · Precipitation").
  const titles = !digit && empty > 0 && parts.length >= 2 && parts.length + empty >= 5 && parts.every((p) => p.length <= 20 && !/[.,:;!?]/.test(p));
  if (parts.length > 4 || titles) {
    // More than four only as one row of cells side by side (weather.com's quarter
    // hours: "19:30 59° Clear 2% 74% 8 mph 0 in"), read as the row's button reads.
    const mids = cells.map((c) => {
      const r = c.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    });
    if (mids.some((m) => Math.abs(m - mids[0]) > 8) || parts.join("").length > 80 || !(digit || titles)) return "";
    return parts.join(titles ? " · " : " ");
  }
  return parts.length >= 2 && digit && parts.join("").length <= 60 ? parts.join(" · ") : "";
}

/**
 * The days a row of daily bars beside a legend that ends "Today" (a status
 * page's 90-day uptime) colors as not fine, with their dates: the last bar is
 * today, each one before it a day earlier. Green and grey days say nothing;
 * red ones were major outages.
 */
function badDays(legend: Element): string {
  if (!/\b(today|hoy|hoje|aujourd'hui|heute|oggi)\b/i.test(textIn(legend))) return "";
  const svg = Array.from(legend.parentElement?.children ?? []).find((c) => c.localName === "svg");
  if (!svg) return "";
  // Only the bars drawn inside the chart: at a narrow width it shows the last 30 days of 90.
  const box = svg.getBoundingClientRect();
  const bars = Array.from(svg.querySelectorAll("rect")).filter((r) => {
    const b = r.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.right > box.left + 0.5 && b.left < box.right - 0.5;
  });
  if (bars.length < 14) return "";
  const fmt = new Intl.DateTimeFormat(lang() || undefined, { month: "short", day: "numeric" });
  const now = new Date();
  const days: string[] = [];
  bars.forEach((r, i) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(r).fill);
    if (!m) return;
    const [red, green, blue] = [+m[1], +m[2], +m[3]];
    // Green (a good day) or grey (no data) says nothing.
    if ((green > red * 1.3 && green > blue) || Math.max(red, green, blue) - Math.min(red, green, blue) < 30) return;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (bars.length - 1 - i));
    // Red is a major outage; the page's own tooltip tells the rest.
    days.push(red > 180 && green < 120 ? `${fmt.format(d)} (${t("major")})` : fmt.format(d));
  });
  return days.length ? t("incidents", { days: days.join(", ") }) : "";
}

/**
 * A strip of small readings laid side by side (weather.com's hours: "3 pm 56°",
 * "5:53 pm Sunset"): one wrapped line instead of a line each, its links kept,
 * and the readings the page fades out (the hours gone by) left out.
 */
function readingStrip(el: Element, ctx: Ctx): Block | null {
  const cells = Array.from(el.children).filter((c) => !SKIP.has(c.localName) && c.localName !== "svg" && visible(c));
  if (cells.length < 8) return null;
  const tops = new Set(cells.slice(0, 8).map((c) => Math.round(c.getBoundingClientRect().top)));
  if (tops.size > 1) return null;
  const texts = cells.map((c) => textIn(c));
  // Readings: short, with a number and a unit or a word ("56°", "3 pm"), not a pager's bare numbers.
  if (texts.some((tx) => !tx || tx.length > 30) || texts.filter((tx) => /\d/.test(tx) && /[^\d\s.,:]/.test(tx)).length < cells.length * 0.75) return null;
  // A row of buttons (dates, showtimes, sizes) stays a row of buttons to press, however long:
  // a cell that is or holds a control is not a reading.
  if (cells.some((c) => isControl(c) || hasControl(c) || c.matches("[onclick], [tabindex]:not([tabindex='-1'])") || c.querySelector("[onclick], h1, h2, h3, h4, img"))) return null;
  const content: Inline[] = [];
  cells.forEach((c, i) => {
    // A reading that is or holds a link (an hour that opens its details, a day's page) keeps it.
    const own = c.matches("a[href]");
    const links = !own && !!c.querySelector("a[href]");
    if (!own && !links && parseFloat(getComputedStyle(c).opacity) < 0.6) return;
    if (content.length) content.push(" · ");
    if (own) content.push({ a: texts[i], href: hrefOf(c), ref: refOf(c) });
    else if (links) content.push(...inlineOf(c, ctx));
    else content.push(texts[i]);
    ctx.used.add(c);
  });
  return content.length ? { t: "p", key: "strip:" + refOf(el), content } : null;
}

/**
 * A group in a filter form that is a title button and the checkboxes or radios
 * it opens. Open, the button and its options stay together, in that order,
 * instead of the options landing among the form's fields and the button in its
 * row of actions. Closed, it is one more button of the form.
 */
function disclosureGroup(el: Element, out: Out, ctx: Ctx): boolean {
  const first = el.firstElementChild;
  if (!first || (first.localName !== "button" && first.getAttribute("role") !== "button") || !visible(first) || el.children.length > 3) return false;
  // Outside a form, only a button that says it opens and closes the group.
  if (!ctx.formRef && !first.hasAttribute("aria-expanded")) return false;
  const label = labelOf(first);
  if (!label || label.length > 40) return false;
  const opts = Array.from(el.querySelectorAll("input[type=checkbox], input[type=radio], [role=checkbox], [role=radio]"));
  if (opts.length < 2 || el.querySelectorAll("button, [role=button]").length > 3 || el.querySelector("input[type=text], input:not([type]), select, textarea")) return false;
  // Options in a closed inner part ("Ver más", aria-hidden while folded) are not shown yet.
  const shown = opts.filter((o) => visible(o) && !ctx.used.has(o) && !el.contains(o.closest("[aria-hidden=true]")));
  const act = toAction(first, label);
  act.expanded = shown.length > 0;
  if (!shown.length) {
    if (usefulControl(first, label, ctx)) out.action(act, ctx.formRef);
    return true;
  }
  out.push({ t: "actions", key: "fg:" + refOf(first), actions: [act] });
  const fields = shown.map((o) => toField(o)).filter((f): f is Field => !!f);
  for (const o of shown) ctx.used.add(o);
  if (fields.length) out.push({ t: "form", key: "fgo:" + refOf(el), ref: ctx.formRef, title: label, fields, actions: [] });
  // Anything else in the group ("show more") stays usable after its options.
  for (const b of Array.from(el.querySelectorAll("button, [role=button]"))) if (b !== first && visible(b) && !ctx.used.has(b)) controlInto(b, out, ctx);
  return true;
}

/** A short caption that repeats the name of the button beside it (a map's "Layers" under its button). */
function captionOfControl(el: Element, text: string): boolean {
  if (text.length > 40 || el.querySelector("a")) return false;
  for (let a = el.parentElement, i = 0; a && i < 2 && tlen(a) < 300; a = a.parentElement, i++) {
    for (const b of Array.from(a.querySelectorAll("button, [role=button]"))) {
      if (!el.contains(b) && (textIn(b) === text || clean(b.getAttribute("aria-label")) === text) && visible(b)) return true;
    }
  }
  return false;
}

/**
 * The same story twice (a carousel clone, a second module) is shown once: the
 * same link with the same title, or the same long headline. Cards that share a
 * link but say different things (weather's "Sunrise", "Moon phase") all stay.
 */
function repeatCard(it: Item, ctx: Ctx): boolean {
  const t = it.title.toLowerCase();
  if (!it.href) {
    // A card without a link (a carousel clone) is said once; its linked twin wins (see dropLinklessTwins).
    const key = "cardn:" + t;
    if (ctx.seen.has(key)) return true;
    ctx.seen.add(key);
    return false;
  }
  ctx.cards ??= new Map();
  const cards = ctx.cards;
  const shown = cards.get(it.href) ?? [];
  // The same long headline under the same page with other tracking parameters is the same story;
  // two listings with one title (a repost) are two.
  const page = t.length >= 40 ? "cardt:" + it.href.split(/[?#]/)[0] : "";
  const twin = shown.find((x) => sameStory(x.title.toLowerCase(), t)) ?? (page ? cards.get(page)?.find((x) => x.title.toLowerCase() === t) : undefined);
  if (twin && !otherEntry(it, twin)) return true;
  const add = (k: string) => cards.set(k, [...(cards.get(k) ?? []), it]);
  add(it.href);
  if (page) add(page);
  return false;
}

/**
 * Two entries side by side in one list that share a link and a title but say
 * different things: separate submissions of one link (HN Search: another
 * author, points and comments), or search hits at other anchors of one page.
 * A carousel's clone says the same; a second module sits elsewhere.
 */
function otherEntry(a: Item, b: Item): boolean {
  const ea = a.key.startsWith("i:") ? elOf(a.key.slice(2)) : null;
  const eb = b.key.startsWith("i:") ? elOf(b.key.slice(2)) : null;
  const pa = ea?.parentElement;
  const pb = eb?.parentElement;
  if (!pa || !pb || ea === eb || (pa !== pb && (!pa.parentElement || pa.parentElement !== pb.parentElement))) return false;
  const said = (x: Item) => [...x.meta, x.text ?? "", x.href?.split("#")[1] ?? ""].join("|");
  return said(a) !== said(b);
}

/** Words in two different buttons of one entry (links to two places are told apart by the text reader). */
function twoControls(a: Element, b: Element, el: Element): boolean {
  const ca = a.closest("button, [role=button]");
  const cb = b.closest("button, [role=button]");
  return !!ca && !!cb && ca !== cb && el.contains(ca) && el.contains(cb) && ca !== el && cb !== el;
}

/** Two titles for one link tell the same story when most words of the shorter are in the longer. */
function sameStory(a: string, b: string): boolean {
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const words = (s: string) => new Set(s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
  const wa = words(a);
  const wb = words(b);
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (!small.size) return false;
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return n >= small.size * 0.5;
}

/** Cards without a link whose title a linked card also shows (carousel clones) go; the linked one stays. */
function dropLinklessTwins(blocks: Block[]) {
  const linked = new Set<string>();
  const collect = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === "items") for (const it of b.items) if (it.href) linked.add(it.title.toLowerCase());
      if (b.t === "section" || b.t === "article") collect(b.blocks);
    }
  };
  collect(blocks);
  if (!linked.size) return;
  const prune = (bs: Block[]) => {
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      if (b.t === "items") {
        b.items = b.items.filter((it) => it.href || it.actions?.length || !linked.has(it.title.toLowerCase()));
        if (!b.items.length) bs.splice(i, 1);
      } else if (b.t === "section" || b.t === "article") prune(b.blocks);
    }
  };
  prune(blocks);
}

/** In a column of its own beside the story's column (GitHub's sidebar starts above its README), not under the story. */
function besideArticle(el: Element, ctx: Ctx): boolean {
  if (!ctx.articleEl || el.contains(ctx.articleEl)) return false;
  const a = ctx.articleEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.width > 0 && a.width > 0 && r.top < a.bottom && (r.left >= a.right - 1 || r.right <= a.left + 1);
}

/** A short list about the page itself (a repository's Releases, Contributors, Languages), not a rail of links to other stories. */
function aboutThisPage(members: Set<Element>): boolean {
  if (members.size > 12) return false;
  let stories = 0;
  for (const m of members) {
    const a = m.matches("a[href]") ? m : m.querySelector("a[href]");
    if (a && storyHref((a as HTMLAnchorElement).href)) stories++;
  }
  return stories < 2;
}

/** A link to a story on this site: a dated path, an article id, or a long slug of words ("/travel/americans-warned-about-paris-travel"). */
function storyHref(href: string): boolean {
  if (!href || hostOf(href).replace(/^www\./, "") !== location.hostname.replace(/^www\./, "")) return false;
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return false;
  }
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return /\/(19|20)\d\d\/(\d\d?|[a-z]{3})\//i.test(path) || /(^|[-_/])(article|nid|id)[-_]?\d{5,}/i.test(path) || last.replace(/\.\w+$/, "").split(/[-_]+/).filter((w) => /\p{L}{2}/u.test(w)).length >= 4;
}

/** Walk a container whose card-like children form a list, keeping everything in order. */
function itemsInto(el: Element, members: Set<Element>, out: Out, ctx: Ctx) {
  // A list after the story (more stories) folds away; one in a column beside it
  // (a repository's About, Releases and Languages beside its README) is facts about the page, shown.
  // A rail of other stories beside it ("Top stories", "Most read") still folds (F740).
  const folded = ctx.afterArticle && !ctx.inArticle && !(besideArticle(el, ctx) && aboutThisPage(members));
  const target = folded ? new Out() : out;
  // A ranked list ("Most read", top 10) is whole even when its stories were shown above.
  const own = el.localName === "ol" ? { ...ctx, seen: new Set<string>(), cards: undefined } : ctx;
  let made = 0;
  for (const k of kids(el)) {
    if (members.has(k)) {
      const it = toItem(k, ctx);
      if (it) {
        // Two comments by one author are two posts, not one card repeated.
        if (it.body || !repeatCard(it, own)) {
          target.item(it);
          made++;
        }
      } else if (!ctx.promos?.has(k)) visit(k, target, ctx); // Not an entry ("Improve this answer"): its controls stay.
    } else visit(k, target, ctx);
  }
  if (folded) {
    const blocks = target.done();
    if (!blocks.length) return;
    const last = out.blocks[out.blocks.length - 1];
    // A short plain line over the list ("Más leídas de Sociedad") is its heading.
    const label = last?.t === "p" && last.content.every((c) => typeof c === "string") && textOf(last.content).length <= 60 ? textOf(last.content) : "";
    const prevH = last?.t === "h" ? last : null;
    // Named by the heading before it or its own first heading ("About"), not a generic "More links".
    const lead = blocks[0]?.t === "h" ? blocks[0] : null;
    const title = prevH?.t === "h" ? prevH.text : label || (lead?.t === "h" ? lead.text : t("moreLinks"));
    if (prevH || label) out.blocks.pop();
    else if (lead && title === lead.text) blocks.shift();
    if (!blocks.length) return;
    out.push({ t: "section", key: "s:" + refOf(el), title, blocks, collapsed: true });
  }
  void made;
}

function answer(el: Element, out: Out, ctx: Ctx) {
  const own = (sel: string) => Array.from(el.querySelectorAll(sel)).find((x) => x.parentElement?.closest("[itemscope]") === el);
  const votesEl = own("[itemprop=upvoteCount]");
  const votes = votesEl ? clean(votesEl.getAttribute("content")) || textIn(votesEl) : "";
  const authorEl = own("[itemprop=author]");
  const nameEl = authorEl?.querySelector("[itemprop=name]");
  const author = nameEl ? textIn(nameEl) : authorEl ? textLines(authorEl)[0] ?? "" : "";
  const title = [
    author ? t("answerBy", { name: author.slice(0, 60) }) : t("answer"),
    votes ? t("votes", { n: votes }) : "",
    el.getAttribute("itemprop") === "acceptedAnswer" ? t("accepted") : "",
  ].filter(Boolean).join(" · ");
  const sub = new Out();
  const prev = ctx.inPost;
  ctx.inPost = true;
  walk(el, sub, ctx);
  ctx.inPost = prev;
  const blocks = sub.done();
  if (blocks.length) out.push({ t: "section", key: "ans:" + refOf(el), title, blocks });
}

function article(el: Element, out: Out, ctx: Ctx) {
  const sub = new Out();
  const prev = ctx.inArticle;
  ctx.inArticle = true;
  walk(el, sub, ctx);
  ctx.inArticle = prev;
  // The readers' comments follow the story; they are not part of it (nor of its short version).
  const all = sub.done();
  // Nor are cards of other stories set between its paragraphs: they join the related links after it.
  const blocks = all.filter((b) => !commentFolds.has(b) && !relatedCards.has(b));
  const cards = all.filter((b) => relatedCards.has(b));
  const related = trailingRelated(blocks);
  const words = wordCount(blocksText(blocks));
  out.push({ t: "article", key: "art:" + refOf(el), blocks, words, prose: proseArticle(blocks) });
  if (related || cards.length) {
    const rel = related?.blocks ?? [];
    if (cards.length) rel.unshift({ t: "ul", key: cards[0].key, items: cards.flatMap((b) => (b.t === "ul" ? b.items : [])) });
    out.push({ t: "section", key: "rel:" + refOf(el), title: related?.title || t("moreLinks"), blocks: rel, collapsed: true });
  }
  for (const b of all) if (commentFolds.has(b)) out.push(b);
  ctx.afterArticle = true;
}

/** A call to act that opens a link ("APPLY FOR …", "DOWNLOAD THE FORM", "READ THE FULL REPORT"), not a headline. */
const CAPS_CTA = /^(apply|register|sign up|enroll|download|donate|buy|book|order|reserve|rsvp|subscribe|join|request|submit|file|pay|renew|schedule|contact|call|email|read the full|view the full|see the full|get (your|the|a)|solicit[aá]|inscrib|registr[aá]te|descarg[aá]|don[aá]|compr[aá]|reserv[aá]|ped[ií])(?!\p{L})/iu;

/** Cards of other stories set inside a story (BBC's links-block "chester-card"), moved after it by article(). */
const relatedCards = new WeakSet<Block>();
const RELATED_CARD = "[data-testid*=card i], [data-testid*=links-grid i], [data-component*=links-block i], [data-component*=related i]";

/** A link to another story from a small card inside the story: related reading, not a section of this one. */
function relatedCard(a: Element, ctx: Ctx): boolean {
  if (!ctx.inArticle || ctx.inDialog || inPage(a)) return false;
  const card = a.closest(RELATED_CARD);
  return !!card && tlen(card) < 400 && (!ctx.articleEl || ctx.articleEl.contains(card)) && !(ctx.titleEl && card.contains(ctx.titleEl));
}

function relatedLink(out: Out, text: string, href: string, ref: string) {
  const b: Block = { t: "ul", key: "rc:" + ref, items: [[{ a: text, href, ref }]] };
  relatedCards.add(b);
  out.push(b);
}

/** A label that sends the reader to another story ("READ MORE:", "Leia também:"). */
const READ_MORE = /^(read more|read also|also read|see also|more on this( story)?|leer m[aá]s|lea tambi[eé]n|lee tambi[eé]n|te puede interesar|leia (tamb[eé]m|mais)|veja tamb[eé]m|lire aussi|[àa] lire aussi|lesen sie auch|mehr zum thema|leggi anche)\s*[:：›»>|-]?$/i;

/**
 * A line inside a story that is only a "READ MORE:" label and a link to another story
 * (the Mirror's ReadMore box): related reading, after the story, not part of it (F1038).
 * The link, or the null when the line is the story's own.
 */
function readMoreLink(content: Inline[], el: Element, ctx: Ctx): { a: string; href: string; ref: string } | null {
  if (!ctx.inArticle || ctx.inDialog) return null;
  const links = content.filter((c): c is { a: string; href?: string; ref?: string } => typeof c === "object" && "a" in c);
  if (links.length !== 1 || !links[0].href || !links[0].ref) return null;
  const label = clean(content.filter((c) => c !== links[0]).map((c) => (typeof c === "string" ? c : "b" in c ? c.b : "i" in c ? c.i : "")).join(""));
  if (!label || !READ_MORE.test(label) || links[0].a.split(/\s+/).length < 3) return null;
  const a = elOf(links[0].ref);
  if (a && inPage(a)) return null;
  return storyHref(links[0].href) || /read-?more/i.test(`${tokens(el)} ${el.getAttribute("data-testid") ?? ""} ${a?.getAttribute("data-tmdatatrack") ?? ""}`)
    ? { a: links[0].a, href: links[0].href, ref: links[0].ref }
    : null;
}

/**
 * Other stories listed at the end of a story ("Últimas noticias" and its
 * headlines, "MÁS NOTICIAS", linked headlines of related reports): they follow
 * it, folded, instead of reading as its last part. Cut from `blocks`.
 */
function trailingRelated(blocks: Block[]): { title: string; blocks: Block[] } | null {
  const linkRow = (b: Block) => b.t === "ul" && b.items.length <= 2 && b.items.every((it) => it.length === 1 && typeof it[0] === "object" && "a" in it[0]);
  let i = blocks.length;
  let lists = 0;
  let heads = 0;
  let title = "";
  while (i > 0) {
    const b = blocks[i - 1];
    // (Posts of a thread read in full are the story's own, not other stories.)
    if (b.t === "items" && b.items.length >= 3 && b.items.every((it) => it.href && !it.body)) lists++;
    else if (b.t === "h" && b.href) heads++;
    else if (linkRow(b) && !lists && !heads) {
      // A "More news" link after the list.
    } else if (b.t === "h" && !b.href && (lists || heads >= 2)) {
      title = b.text;
      i--;
      break;
    } else break;
    i--;
  }
  if (!lists && heads < 2) return null;
  // Never most of the story.
  if (i < blocks.length / 2) return null;
  return { title, blocks: blocks.splice(i) .filter((b) => !(b.t === "h" && !b.href && b.text === title)) };
}

/**
 * Running prose that may be condensed: most of its text in paragraphs, quotes
 * and lists, no form, a handful of controls for its length, no real list of
 * items, no thread of answers, little link text, no tool (a map, an editor).
 * A Q&A thread, results, a recipe with its tabs, or a reference page of tables
 * and code keeps its full structure. Videos, posts and photos embedded in a
 * story, and the buttons that open its photos, do not make it less of a story.
 */
export function proseArticle(blocks: Block[]): boolean {
  let prose = 0;
  let other = 0;
  let links = 0;
  let actions = 0;
  let sections = 0;
  let answers = 0;
  // Terms of a reference list read as blocks (an API's entries, a glossary): a reference page, not a story.
  let terms = 0;
  let heads = 0;
  let itemText = 0;
  let fields = false;
  let surface = false;
  const linkText = (c: Inline[]) => {
    for (const x of c) if (typeof x === "object" && "a" in x) links += x.a.length;
  };
  const cellText = (c: Inline[]) => {
    other += textOf(c).length;
    linkText(c);
  };
  const walkB = (bs: Block[]) => {
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      switch (b.t) {
        case "p":
        case "quote": {
          const n = textOf(b.content).length;
          if (b.key.startsWith("dt:")) terms++;
          if (b.t === "p" && b.small) other += n;
          else prose += n;
          linkText(b.content);
          break;
        }
        case "ul":
        case "ol":
          for (const it of b.items) {
            prose += textOf(it).length;
            linkText(it);
          }
          break;
        case "h":
        case "pre":
          other += b.text.length;
          if (b.t === "h") heads++;
          break;
        case "table":
          for (const r of b.rows) for (const c of r) cellText(c);
          break;
        case "facts":
          for (const r of b.rows) cellText(r.v);
          break;
        case "items": {
          let n = 0;
          for (const it of b.items) n += it.title.length + (it.text?.length ?? 0);
          other += n;
          if (b.items.length >= 3) itemText += n;
          break;
        }
        case "form":
          if (b.fields.length) fields = true;
          actions += b.actions.length;
          break;
        case "actions":
          // Links in a row ("see also", a navbox title) are links; buttons are controls,
          // except those that open the photo just before them ("+6 View gallery").
          for (const a of b.actions) {
            if (a.href) {
              links += a.label.length;
              other += a.label.length;
            } else if (bs[i - 1]?.t !== "img" && !PHOTO_ACTION.test(a.label)) actions++;
          }
          break;
        case "portal":
          if (b.tool) surface = true;
          break;
        case "section":
          sections++;
          if (b.key.startsWith("ans:")) answers++;
          walkB(b.blocks);
          break;
        case "article":
          walkB(b.blocks);
          break;
        default:
          break;
      }
    }
  };
  walkB(blocks);
  const total = prose + other || 1;
  // A short guide in headed parts (GOV.UK's "Renew": 280 words under 5 headings) is as quick to read as any summary of it.
  if (total < 2400 && heads >= 3) return false;
  // A long story may carry a few more buttons (listen, key points, summary) than a short one.
  return !fields && !surface && answers < 2 && terms < 4 && sections < 4 && actions <= 6 + Math.floor(prose / 1500) && itemText < total * 0.2 && prose >= total * 0.6 && links < total * 0.35;
}

/** Buttons that open a story's photos: a gallery, a bigger view. */
const PHOTO_ACTION = /gallery|galer[ií]a|enlarge|zoom|ampliar|(view|open|see) (photo|image|picture)s?|ver (foto|imagen)|abrir imagen|open image/i;

function list(el: Element, out: Out, ctx: Ctx) {
  const members = detectItems(el, ctx);
  if (members) return itemsInto(el, members, out, ctx);
  const all = kids(el);
  const lis = all.filter((li) => li.localName === "li" && visible(li) && !isAd(li));
  // Other children of a list (a div of filters in a <ul>) are content too, walked in their place.
  const others = all.some((c) => c.localName !== "li" && !SKIP.has(c.localName));
  // A list whose entries are single links joins the running link list.
  const linkOnly = !others && lis.length > 0 && lis.every((li) => {
    const a = li.querySelectorAll("a[href]");
    return a.length === 1 && clean(textIn(a[0])) === textIn(li) && !li.querySelector(CONTROL_SEL);
  });
  if (linkOnly) {
    for (const li of lis) {
      const a = li.querySelector("a[href]") as HTMLAnchorElement;
      const label = labelOf(a);
      if (!usefulControl(a, label, ctx)) continue;
      const href = hrefOf(a) ?? a.href;
      const key = "link:" + href + "|" + label + postScope(a);
      if (ctx.seen.has(key)) continue;
      ctx.seen.add(key);
      out.link(label, href, refOf(a));
    }
    return;
  }
  // Entries with block structure or controls are walked (keeping their own
  // text); plain entries around them stay list rows.
  const kind = el.localName === "ol" ? "ol" : "ul";
  let rows: Inline[][] = [];
  let part = 0;
  // Its name and its current entry (a checkout's step) stay, as the page marks them.
  const label = clean(el.getAttribute("aria-label")) || undefined;
  let current: { at: number; as: string } | undefined;
  const flush = () => {
    if (rows.length) out.push({ t: kind, key: "list:" + refOf(el) + (part ? ":" + part : ""), items: rows, label, current });
    rows = [];
    current = undefined;
    part++;
  };
  for (const li of others ? all : lis) {
    if (li.localName !== "li" || ctx.postUnits?.has(li)) {
      flush();
      visit(li, out, ctx);
      continue;
    }
    if (others && (!visible(li) || isAd(li))) continue;
    // Options of a listbox or menu ("Filter by label") are choices to pick, not text.
    if (isControl(li)) {
      flush();
      controlInto(li, out, ctx);
      continue;
    }
    if (li.querySelector(CONTROL_SEL + ",ul,ol,table,h1,h2,h3,h4,h5,h6,img,video,iframe,p,div > div") || hasControl(li)) {
      flush();
      // A row whose words name its one checkbox ("bicycles 5481 [ ]"): its links, then the checkbox, not the words again.
      const boxes = li.querySelectorAll("input:not([type=hidden]), select, textarea, button");
      const box = boxes.length === 1 && boxes[0] instanceof HTMLInputElement && (boxes[0].type === "checkbox" || boxes[0].type === "radio") ? boxes[0] : null;
      if (box && !box.labels?.length && !box.getAttribute("aria-label") && accName(box) === textIn(li) && !li.querySelector("ul, ol, table, h1, h2, h3, h4, h5, h6, img, p")) {
        for (const a of Array.from(li.querySelectorAll("a[href]"))) visit(a, out, ctx);
        if (visible(box)) controlInto(box, out, ctx);
        continue;
      }
      // A checkbox whose own label is empty, with the entry's words beside it (Tasty Recipes' ingredients:
      // aria-label "8 tablespoons of salted butter", then that text): one checkbox named by the words as they
      // show now, which follow a switch of units while its aria-label does not; not its name, then the words again (F1045).
      const words = box?.type === "checkbox" && box.labels?.length && Array.from(box.labels).every((l) => !textIn(l)) ? textIn(li) : "";
      if (box && words && words.length <= 300 && visible(box) && !li.querySelector("ul, ol, table, h1, h2, h3, h4, h5, h6, img, p")) {
        for (const a of Array.from(li.querySelectorAll("a[href]"))) visit(a, out, ctx);
        const f = toField(box);
        if (f) {
          f.label = words;
          const g = groupOf(box);
          if (g) f.group = g;
          out.field(f, ctx.formRef);
        }
        continue;
      }
      // An entry the site marks as its own promotion ("ds-home-aside__autopromo": "Partner Services ·
      // Le Monde for hotels") goes, as such a box does outside a list (F649).
      if (!ctx.inDialog && /(^|[\s_-])auto-?promos?($|[\s_-])/i.test(tokens(li))) continue;
      // A card under an empty cover link (Clarín's most read) is one entry with that link.
      if (coverCard(li, out, ctx)) continue;
      // An entry of a short list (one search result) is a card like any other.
      const card = asCard(li, ctx);
      if (card) {
        if (!repeatCard(card, ctx)) out.item(card);
        continue;
      }
      if (ctx.promos?.has(li)) continue;
      // A small entry that gives one reading ("Feels Like · 58°") is one line, as outside a list.
      const line = !ctx.inArticle && !li.querySelector(CONTROL_SEL) ? valueLine(li) : "";
      if (line) {
        out.push({ t: "p", key: "p:" + refOf(li), content: [line] });
        continue;
      }
      walk(li, out, ctx);
      continue;
    }
    const c = inlineOf(li, ctx);
    const tx = textOf(c).trim();
    if (tx && !isFragment(tx) && !isPromo(c, ctx.inArticle) && (ctx.inArticle || !followRow(li, tx, kind))) {
      const cur = li.getAttribute("aria-current");
      if (cur && cur !== "false") current = { at: rows.length, as: /^(page|step|location|date|time)$/.test(cur) ? cur : "true" };
      rows.push(c);
    }
  }
  flush();
}

/**
 * A row that only asks you to follow the site ("Follow us", "Follow @DailyMail",
 * "Follow Daily Mail" linking to Facebook). A step in numbered directions
 * ("Follow the river path") is content.
 */
function followRow(li: Element, tx: string, kind: string): boolean {
  if (kind === "ol" || !FOLLOW_ROW.test(tx)) return false;
  if (FOLLOW_WHO.test(tx)) return true;
  // A link to a social network, or a row or link named after one ("li.facebook", alt="Youtube").
  return SOCIAL_NAME.test(tokens(li)) || Array.from(li.querySelectorAll("a")).some((a) => SOCIAL_HOSTS.test(hostOf((a as HTMLAnchorElement).href)) || SOCIAL_NAME.test(`${tokens(a)} ${a.getAttribute("alt") ?? ""} ${a.getAttribute("aria-label") ?? ""}`));
}

function defs(el: Element, out: Out, ctx: Ctx) {
  // Search results as terms (MoinMoin, F1044): one entry per result, its title
  // link over its own snippet and details, never a term without its link.
  if (resultList(el)) {
    let it: Item | null = null;
    for (const c of kids(el)) {
      if (!visible(c)) continue;
      if (c.localName === "dt") {
        if (it) out.item(it);
        const a = c.querySelector("a[href]");
        const title = a ? textIn(a) : textIn(c);
        const rest = a ? clean(textIn(c).replace(title, "")).replace(/^[.\s·]+/, "") : "";
        it = title ? { key: "i:" + refOf(c), title, href: a ? hrefOf(a) : undefined, ref: a ? refOf(a) : undefined, meta: rest ? [rest] : [], keepTitle: true } : null;
      } else if (it && c.localName === "dd") it.text = [it.text, textIn(c)].filter(Boolean).join(" ");
      else if (it && textIn(c)) it.meta.push(textIn(c));
    }
    if (it) out.item(it);
    return;
  }
  let rows: { k: string; v: Inline[] }[] = [];
  let part = 0;
  const flush = () => {
    if (rows.length) out.push({ t: "facts", key: "dl:" + refOf(el) + (part ? ":" + part : ""), rows });
    rows = [];
    part++;
  };
  // A value with a field to fill ("Email [ ]") is walked so the field stays usable; its
  // small buttons ("Change email") stay in place as clickable words.
  // A value that is text of its own (an API entry's paragraphs and code examples,
  // a glossary's definition) is read as blocks under its term, not squeezed into a cell.
  const add = (k: string, dd: Element) => {
    const blocky = !!dd.querySelector("pre, table, dl, ul, ol, blockquote, " + HEADING_SEL) || dd.querySelectorAll("p").length >= 2 || tlen(dd) > 250;
    if (blocky || dd.querySelector("input:not([type=hidden]), select, textarea, [contenteditable=''], [contenteditable=true], [role=textbox], [role=combobox]")) {
      flush();
      if (k) out.push({ t: "p", key: "dt:" + refOf(dd), content: [{ b: k }] });
      walk(dd, out, ctx);
      return;
    }
    rows.push({ k, v: inlineOf(dd, ctx, true) });
  };
  let k = "";
  for (const c of kids(el)) {
    if (!visible(c)) continue;
    if (c.localName === "dt") k = textIn(c);
    else if (c.localName === "dd") add(k, c);
    else if (c.localName === "div") {
      const dt = c.querySelector("dt");
      const dd = c.querySelector("dd");
      if (dt && dd) add(textIn(dt), dd);
    }
  }
  flush();
}

function table(el: HTMLTableElement, out: Out, ctx: Ctx) {
  const rows = Array.from(el.rows).filter((r) => r.cells.length && visible(r));
  // A thread laid out in table rows, one comment per row (Hacker News).
  if (threadRowsInto(rows, out, ctx)) return;
  const hasTh = !!el.querySelector("th");
  const cols = Math.max(0, ...rows.slice(0, 10).map((r) => r.cells.length));
  // One row without headers lays things side by side; it is not data to compare.
  const layout = !hasTh && (cols <= 1 || rows.length <= 1 || !!el.querySelector("table") || !!el.querySelector(BLOCK_SEL.replace("table,", "")) && clean(el.textContent).length > 2000);
  // A data table with a few buttons in it (a version that opens its notes, a
  // preview toggle) is still a table; one with fields is a form laid out in rows.
  let fields = el.querySelector("input:not([type=hidden]), select, textarea, [contenteditable=''], [contenteditable=true], [role=textbox], [role=checkbox], [role=switch], [role=combobox]");
  // A column of row checkboxes (select this order; select all in the header) is the table's own
  // control, not a form: the table stays, each box in its cell.
  const picks = fields && hasTh && cols >= 3 ? pickCells(el, rows) : null;
  if (picks) fields = null;
  if (layout || el.getAttribute("role") === "presentation" || fields) {
    // A listing laid out as table rows (Hacker News: a title row, then its details row) is a list of items.
    if (!fields && !ctx.inArticle && rowListInto(rows, out, ctx)) return;
    // Its caption still says what the rows are ("Orders 1-5 of 12").
    const cap = el.caption ? textIn(el.caption) : "";
    if (cap) out.push({ t: "p", key: "tc:" + refOf(el), content: [cap] });
    // Rows repeat links and buttons on purpose (each file's commit, each row's
    // Delete), so links are told apart within a row only.
    const seen = ctx.seen;
    for (const r of rows) {
      ctx.seen = new Set();
      for (const c of Array.from(r.cells)) walk(c, out, ctx);
    }
    ctx.seen = seen;
    return;
  }
  // Two-column tables without headers, or with a header cell per row
  // ("addr:city | San Francisco"), read best as facts.
  const rowHeads = rows.length > 0 && rows.every((r) => r.cells.length === 2 && r.cells[0].localName === "th" && r.cells[1].localName === "td");
  // A first column of links or buttons (file names to download) is not a column of names: it stays a table.
  const keyControls = rows.some((r) => !!r.cells[0]?.querySelector("a[href], button, [role=button]"));
  if (((!hasTh && cols === 2) || rowHeads) && !keyControls) {
    const facts = rows.map((r) => ({ k: textIn(r.cells[0]), v: r.cells[1] ? inlineOf(r.cells[1], ctx, true) : [] })).filter((f) => f.k || textOf(f.v));
    if (facts.length) out.push({ t: "facts", key: "tb:" + refOf(el), rows: facts });
    return;
  }
  let head: string[] = [];
  let headCells: HTMLTableCellElement[] = [];
  let body = rows;
  const thead = el.tHead;
  if (thead && thead.rows[0]) {
    // With two header rows (platforms over browsers), the last one names the columns.
    headCells = Array.from(thead.rows[thead.rows.length - 1].cells);
    head = headCells.map((c) => textIn(c) || clean(c.getAttribute("aria-label")) || clean(c.querySelector("[title]")?.getAttribute("title")));
    body = rows.filter((r) => r.parentElement !== thead);
  } else if (rows[0] && Array.from(rows[0].cells).every((c) => c.localName === "th")) {
    headCells = Array.from(rows[0].cells);
    head = headCells.map((c) => textIn(c));
    body = rows.slice(1);
  }
  // A header that sorts its column (a button in it, or the cell itself marked with aria-sort) stays
  // something to press, with its sort state.
  let heads: ({ ref?: string; href?: string; sort?: string; checked?: boolean | "mixed" } | null)[] | undefined = headCells.map((c, i) => {
    const box = picks?.get(c);
    if (box) {
      head[i] ||= labelOf(box) || t("selectAll");
      return { ref: refOf(box), checked: checkState(box) };
    }
    const sort = c.getAttribute("aria-sort") || undefined;
    const b = c.querySelector("button, [role=button]");
    const a = c.querySelector("a[href]") as HTMLAnchorElement | null;
    if (b && visible(b)) return { ref: refOf(b), sort };
    if (a && visible(a) && !inPage(a) && (sort || /[?&](sort|order|orderby|dir|direction)=/i.test(a.getAttribute("href") ?? ""))) return { ref: refOf(a), href: hrefOf(a) ?? a.href, sort };
    return sort ? { ref: refOf(c), sort } : null;
  });
  if (!heads.some(Boolean)) heads = undefined;
  // Photos in the table (an infobox's picture) show as pictures before it, not as links named by their alt text.
  const shown = tableImages(el, out, ctx);
  const cell = (c: Element) => {
    const box = picks?.get(c);
    if (box) {
      const part: Extract<Inline, { a: string }> = { a: labelOf(box) || clean(textIn(c.parentElement!)).slice(0, 80), ref: refOf(box), checked: checkState(box) };
      if ((box as HTMLInputElement).disabled || box.getAttribute("aria-disabled") === "true") part.disabled = true;
      return [part];
    }
    const x = inlineOf(c, ctx, true);
    return shown.size ? x.filter((p) => !(typeof p === "object" && "a" in p && p.ref && shown.has(p.ref))) : x;
  };
  let data = body.slice(0, MAX_ROWS).map((r) => Array.from(r.cells).map(cell));
  if (!data.length) return;
  // A column with no header and nothing in it (file icons, checkboxes Sift does not show) is dropped.
  const cols2 = Math.max(head.length, ...data.map((r) => r.length));
  const empty = (c: Inline[] | undefined) => !c || !textOf(c).trim();
  const keep = Array.from({ length: cols2 }, (_, i) => !!head[i] || data.some((r) => !empty(r[i])));
  if (keep.some((k) => !k)) {
    head = head.filter((_, i) => keep[i]);
    heads = heads?.filter((_, i) => keep[i]);
    data = data.map((r) => r.filter((_, i) => keep[i]));
  }
  out.push({ t: "table", key: "tb:" + refOf(el), caption: el.caption ? textIn(el.caption) : undefined, head, rows: data, heads });
  // Say so when a long table is cut, rather than ending silently.
  if (body.length > MAX_ROWS) out.push({ t: "note", key: "tbm:" + refOf(el), text: t("moreRows", { n: body.length - MAX_ROWS }), tone: "info" });
}

const MAX_ROWS = 300;

/** Short marks a cell's value shows for its icon tooltips (MDN: "71" + "No support", "flag", "*" for notes); "" when one is not known. */
const BRIEF: [RegExp, string][] = [
  [/^no support$/i, "no"],
  [/^partial support$/i, "partial"],
  [/^support unknown$/i, "?"],
  [/must explicitly enable/i, "flag"],
  [/vendor prefix/i, "prefix"],
  [/(alternate|different|non-standard) name/i, "alt. name"],
  [/^(see implementation notes|has more compatibility info|footnote)$/i, "*"],
];
function briefMarks(label: string, said: string[]): string {
  const words: string[] = [];
  let star = false;
  for (const s of said) {
    const m = BRIEF.find(([re]) => re.test(s.trim()))?.[1];
    if (!m) return "";
    if (m === "*") star = true;
    else if (!(m === "no" && /^no$/i.test(label)) && !words.includes(m)) words.push(m);
  }
  return [label, words.join(", "), star ? "*" : ""].filter(Boolean).join(" ");
}

/**
 * A data table's column of row checkboxes: every field in the table is a
 * checkbox alone in its cell (no other control, few words), one a row, all in
 * one column. Gives each such cell its checkbox; null for a form laid out in rows.
 */
function pickCells(el: HTMLTableElement, rows: HTMLTableRowElement[]): Map<Element, Element> | null {
  const shown = new Set<Element>(rows);
  const cells = new Map<Element, Element>();
  let col = -1;
  for (const f of Array.from(el.querySelectorAll("input:not([type=hidden]), select, textarea, [contenteditable=''], [contenteditable=true], [role=textbox], [role=checkbox], [role=switch], [role=combobox]"))) {
    if (!f.matches("input[type=checkbox], [role=checkbox]")) return null;
    const c = f.closest("td, th") as HTMLTableCellElement | null;
    const r = c?.parentElement as HTMLTableRowElement | null;
    if (!c || !r || r.closest("table") !== el) return null;
    // A row the page hides is not shown, nor its box.
    if (!shown.has(r)) continue;
    if (cells.has(c) || (col >= 0 && c.cellIndex !== col) || c.querySelector("a[href], button, [role=button], select, textarea") || textIn(c).length > 40) return null;
    col = c.cellIndex;
    cells.set(c, f);
  }
  return cells.size >= 2 ? cells : null;
}

/** A checkbox's state, "mixed" when only some of what it selects is chosen. */
function checkState(box: Element): boolean | "mixed" {
  if (box instanceof HTMLInputElement) return box.indeterminate ? "mixed" : box.checked;
  const a = box.getAttribute("aria-checked");
  return a === "mixed" ? "mixed" : a === "true";
}

/** The cell that indents a reply by its level (Hacker News: td.ind with indent="2"). */
function indentCell(r: Element): Element | null {
  return r.querySelector("td[indent], td.ind");
}

/**
 * A thread laid out as table rows with an indent cell per comment (Hacker
 * News). Each comment becomes an entry with its reply level, its author and
 * time, its whole text (paragraphs, links and code kept) and its reply and
 * vote links.
 */
function threadRowsInto(rows: HTMLTableRowElement[], out: Out, ctx: Ctx): boolean {
  const marked = rows.filter((r) => indentCell(r) && r.querySelector("[class*=comm], [class*=comment]"));
  if (marked.length < 2 || marked.length < rows.length * 0.6) return false;
  for (const r of rows) {
    const cell = indentCell(r);
    if (!cell) {
      for (const c of Array.from(r.cells)) walk(c, out, ctx);
      continue;
    }
    let depth = parseInt(cell.getAttribute("indent") ?? "", 10);
    if (!Number.isFinite(depth)) depth = Math.round(parseInt(cell.querySelector("img")?.getAttribute("width") ?? "0", 10) / 40) || 0;
    const user = r.querySelector("a.hnuser, a[href^='user?'], [class*=author] a, [class*=user] a");
    const age = r.querySelector(".age a, a[href^='item?id=']");
    const text = r.querySelector(".commtext, [class*=comment-text], [class*=commtext]");
    // The text with its paragraphs and code, read on its own (a link alone on its line is not a repeat).
    const sub = new Out();
    const cctx: Ctx = { ...ctx, seen: new Set(), inPost: true, inArticle: false };
    if (text) walk(text, sub, cctx);
    ctx.count = cctx.count;
    const body = sub.done();
    const actions: Action[] = [];
    const reply = Array.from(r.querySelectorAll(".reply a[href], a[href^='reply?']")).find((a) => visible(a));
    if (reply && labelOf(reply)) actions.push(toAction(reply, labelOf(reply)));
    const vote = Array.from(r.querySelectorAll("a[id^='up_'], .votelinks a[href*='how=up']")).find((a) => visible(a) && !a.classList.contains("nosee"));
    if (vote) actions.push(toAction(vote, labelOf(vote) || clean(vote.querySelector("[title]")?.getAttribute("title")) || "upvote"));
    // The comment's own way around the thread: jump to its parent, the next one, the top ("parent | next"),
    // and fold it with its replies ("[–]", then "[3 more]" to open it again).
    for (const a of Array.from(r.querySelectorAll("a"))) {
      const l = textIn(a);
      if (!visible(a) || a === reply || a === vote || a === age || a === user) continue;
      // (Built here rather than by toAction: a thread has hundreds, and none is ever "pressed".)
      if (/^\[[–—-]\]$/.test(l) || /^\[\d+ more\]$/.test(l)) {
        actions.push({ key: "a:" + refOf(a), label: /\d/.test(l) ? l.slice(1, -1) : t("collapse"), ref: refOf(a), kind: "quiet", expanded: !/\d/.test(l) });
      } else if (/^(parent|next|prev|root|context)$/i.test(l) && inPage(a)) {
        actions.push({ key: "a:" + refOf(a), label: l, ref: refOf(a), href: hrefOf(a), kind: "quiet" });
      }
    }
    const who = user ? textIn(user) : "";
    const when = age ? textIn(age) : "";
    if (!who && !when && !body.length) continue;
    out.item({
      key: "i:" + refOf(r), title: when || who, href: age ? hrefOf(age) : undefined, ref: age ? refOf(age) : undefined,
      lead: when ? who || undefined : undefined, meta: [], body: body.length ? body : undefined, depth, actions: actions.length ? actions : undefined,
    });
  }
  return true;
}

/** A post's reply link. */
const REPLY_LINK = /^(reply|responder|répondre|antworten|rispondi)$/i;

/** A link to a person's profile: a short name or handle, to a user's page ("/u/ana", "/@ana", "/profile/ana"). */
function profileLink(a: HTMLAnchorElement): boolean {
  const l = textIn(a);
  if (!l || l.length > 40 || inPage(a)) return false;
  let path = "";
  try {
    path = new URL(a.href).pathname;
  } catch {
    return false;
  }
  return /^\/(u|user|users|profile|profiles|people|member|members|author|authors)\/[^/]+\/?$|^\/@[^/]+\/?$/i.test(path) || (/^@\w/.test(l) && !/\s/.test(l));
}

/** Comment links in a listing's details ("57 comments", "discuss"). */
const COMMENTS_LINK = /^((\d[\d,.]*|no|sin)\s*)?(comments?|discuss|replies|comentarios?|respuestas)$/i;

/**
 * Table rows that repeat as a listing: five or more rows of one class, each
 * with a title link, each followed by rows of details ("94 points by x · 2
 * hours ago · 57 comments"). Each becomes an item; its details are its meta,
 * its comment link an action.
 */
function rowListInto(rows: HTMLTableRowElement[], out: Out, ctx: Ctx): boolean {
  const groups = new Map<string, HTMLTableRowElement[]>();
  for (const r of rows) {
    if (!r.classList.length) continue;
    const k = signature(r);
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  let heads: HTMLTableRowElement[] = [];
  for (const g of groups.values()) if (g.length > heads.length) heads = g;
  if (heads.length < 5) return false;
  // The row's title link: the first real link that is not a source in parentheses ("(example.com)").
  const titleOf = (r: Element) => {
    const text = textIn(r);
    return (Array.from(r.querySelectorAll("a[href]")) as HTMLAnchorElement[]).find((a) => {
      const l = textIn(a);
      if (l.length < 4 || !visible(a) || inPage(a)) return false;
      const at = text.indexOf(l);
      return !(at > 0 && /\(\s?$/.test(text.slice(Math.max(0, at - 2), at)));
    });
  };
  // Rows that are mostly their title (a headline and its source), not posts that only start with a name.
  const listed = heads.filter((r) => {
    const a = titleOf(r);
    const n = a ? textIn(a).length : 0;
    return n >= 15 && textIn(r).length <= n + 120;
  });
  if (listed.length < heads.length * 0.8) return false;
  const isHead = new Set(heads);
  // The index of the last title row seen, so each detail row finds it in one step.
  let lastHead = -10;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isHead.has(r)) {
      // Rows before the first title row (a header), apart from any title, or a pager are walked as they are.
      const detail = lastHead >= i - 2 && !/^(more|next|older|load more|show more|siguiente|más|›|»)$/i.test(textIn(r));
      if (!detail) for (const c of Array.from(r.cells)) walk(c, out, ctx);
      continue;
    }
    lastHead = i;
    const main = titleOf(r);
    if (!main) continue;
    const title = textIn(main);
    const meta: string[] = [];
    // The rest of the title row ("(example.com)"), without its rank ("12.").
    const rest = clean(textIn(r).replace(title, "")).replace(/^\d{1,4}\.\s*/, "");
    if (rest && !isFragment(rest)) meta.push(rest);
    const actions: Action[] = [];
    // The row's vote arrow is something to press.
    const vote = (Array.from(r.querySelectorAll("a[href]")) as Element[]).find((a) => a !== main && voteLink(a));
    if (vote) actions.push(toAction(vote, clean(vote.getAttribute("aria-label") || vote.getAttribute("title") || vote.firstElementChild?.getAttribute("title")) || t("upvote")));
    for (let j = i + 1; j < rows.length && j <= i + 2 && !isHead.has(rows[j]); j++) {
      const d = rows[j];
      const tx = textIn(d);
      if (!tx) continue;
      // A "More" row after the last title is the list's pager, walked on its own.
      if (/^(more|next|older|load more|show more|siguiente|más|›|»)$/i.test(tx)) break;
      // The comment link becomes an action and links that act on the row ("hide", "past") say nothing,
      // so neither is left in the details as dead words.
      const unsaid = new Set<Element>();
      for (const a of Array.from(d.querySelectorAll("a[href]"))) {
        const l = textIn(a);
        if (COMMENTS_LINK.test(l)) {
          if (actions.length < 3) actions.push(toAction(a, l));
          unsaid.add(a);
        } else if (l && actionLabel(l)) unsaid.add(a);
      }
      const said = unsaid.size ? textExcept(d, unsaid) : tx;
      if (said && said.length <= 200) meta.push(said);
    }
    const it: Item = { key: "i:" + refOf(r), title, href: hrefOf(main), ref: refOf(main), meta, actions: actions.length ? actions : undefined };
    if (!repeatCard(it, ctx)) out.item(it);
  }
  return true;
}

/** An element's visible text without the words of some of its links, with their separators tidied. */
function textExcept(el: Element, skip: Set<Element>): string {
  let s = "";
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const own = n.parentElement;
    if (!own || !visible(own)) continue;
    const a = own.closest("a");
    if (a && skip.has(a)) {
      s += " ";
      continue;
    }
    s += n.nodeValue ?? "";
  }
  return clean(s).replace(/([|·•])(\s*[|·•])+/g, "$1").replace(/^[|·•]+\s*|\s*[|·•]+$/g, "");
}

/** Pushes the content photos of a table as image blocks; returns the refs of the links around them. */
function tableImages(el: Element, out: Out, ctx: Ctx): Set<string> {
  const refs = new Set<string>();
  let n = 0;
  for (const img of Array.from(el.querySelectorAll("img")) as HTMLImageElement[]) {
    if (n >= 3 || !visible(img)) continue;
    const im = contentImage(img, { ...ctx, inArticle: true }, 120, 90);
    if (!im) continue;
    const a = img.closest("a[href]") as HTMLAnchorElement | null;
    // Only a link that is just the photo moves with it; a link with words stays in its cell.
    if (a && el.contains(a) && textIn(a)) continue;
    const cap = img.closest("td, th")?.querySelector("figcaption, .infobox-caption, [class*=caption]");
    out.push({ t: "img", key: "img:" + refOf(img), img: im, caption: cap ? textIn(cap) || undefined : undefined, href: a ? a.href : undefined, ref: a ? refOf(a) : undefined });
    if (a) refs.add(refOf(a));
    n++;
  }
  return refs;
}

/**
 * The figure's real photo: not a grey placeholder shown until the lazy photo
 * loads ("image unavailable"), and the largest when there are several.
 */
function figureImage(el: Element): HTMLImageElement | null {
  if (el.localName === "img") return el as HTMLImageElement;
  let imgs = Array.from(el.querySelectorAll("img")) as HTMLImageElement[];
  // An AMP photo the hidden original never scrolled to has its address but no <img> yet (G1's amp-img, F932).
  if (!imgs.length) return el.querySelector("amp-img[src], amp-img[srcset]") as HTMLImageElement | null;
  if (imgs.length <= 1) return imgs[0] ?? null;
  // A grey placeholder (BBC's "image unavailable") is not the photo; the lazy one beside it is (F646).
  const placeholder = (im: HTMLImageElement) => {
    const src = imgSrc(im);
    return !src || LOGO_TOKEN.test(`${tokens(im)} ${src.split("?")[0]}`) || /unavailable|placeholder/i.test(`${im.alt} ${im.getAttribute("aria-label") ?? ""}`);
  };
  const real = imgs.filter((im) => !placeholder(im));
  if (real.length) imgs = real;
  // A slider's photos moved out of its frame (Craigslist's gallery after "next") are not the one shown.
  const fr = el.getBoundingClientRect();
  const framed = imgs.filter((im) => {
    const r = im.getBoundingClientRect();
    return r.width > 0 && r.left < fr.right - 1 && r.right > fr.left + 1 && r.top < fr.bottom - 1 && r.bottom > fr.top + 1;
  });
  if (framed.length) imgs = framed;
  let best: HTMLImageElement | null = null;
  let bestW = -1;
  for (const im of imgs) {
    if (placeholder(im)) continue;
    const w = im.getBoundingClientRect().width || im.naturalWidth;
    if (w > bestW) {
      bestW = w;
      best = im;
    }
  }
  return best ?? imgs[0];
}

function figure(el: Element, out: Out, ctx: Ctx) {
  const img = figureImage(el);
  const media = el.querySelector("video,iframe,audio") ?? deepQuery(el, "video");
  // A poster that loads its player on click (a JW Player facade) is the video, not a photo.
  const fac = media ? null : el.matches(FACADE_SEL) ? el : el.querySelector(FACADE_SEL);
  const lazy = fac && facadeHint(fac) ? facadeBlock(fac, ctx) : null;
  if (media || lazy) {
    const b = lazy ?? portalBlock(media!, ctx);
    if (b) {
      out.push(b);
      // The player stands for the figure: its poster image is not shown again.
      if (!(el.localName === "figure" && el.querySelector("table, pre, blockquote, p"))) {
        const c = el.querySelector("figcaption");
        const tx = c ? textIn(c) : "";
        if (tx) out.push({ t: "p", key: "p:" + refOf(c!), content: [tx], small: true });
        return;
      }
    }
  }
  let cap: Element | null = el.localName === "img" ? null : el.querySelector("figcaption");
  const rich = el.localName === "figure" && !!el.querySelector("table, pre, blockquote, p");
  // A figure that holds a table, code, or a quote: read its content normally.
  // The caption and a link around the photo go with the image block instead.
  if (rich) {
    for (const c of kids(el)) {
      if (c === media || (media && c.contains(media)) || c.localName === "img" || c.localName === "picture") continue;
      if (img && (c === cap || c.contains(img))) continue;
      visit(c, out, ctx);
    }
  }
  const capText = () => (cap ? captionText(cap) : "");
  const looseCaption = () => {
    // No image to hang it on (a chart drawn in SVG, a photo still loading): the caption stays as text.
    const tx = capText();
    if (tx && !(rich && !img)) out.push({ t: "p", key: "p:" + refOf(cap!), content: [tx], small: true });
  };
  // A figure that is itself a button (opens a viewer) stays clickable even when its photo is not kept.
  // The innermost one around the photo is the one the page listens to (La Nación: figure[role=button] in section[role=button]).
  const inner = img?.parentElement?.closest("button, [role=button]");
  const clickable = (el.getAttribute("role") === "button" || el.localName === "button") && !img?.closest("a[href]") ? (inner && el.contains(inner) ? inner : el) : null;
  if (!img) return clickable ? controlInto(clickable, out, ctx) : looseCaption();
  // A player's poster beside its video (the video is shown as a player).
  const box = img.parentElement;
  if (box && !box.querySelector("p, h1, h2, h3, h4, li, figcaption, table") && (box.querySelector("video") || deepQuery(box, "video", 1))) return;
  // Another view of a photo already shown, named the same (a gallery's slides): nothing new to show or press.
  if (clickable && clean(img.alt) && ctx.seen.has("photo:" + clean(img.alt))) return;
  const minW = ctx.inArticle ? 160 : 350;
  const minH = ctx.inArticle ? 100 : 250;
  // A portrait photo (a listing's 337x450 photo) is as big as a landscape one turned on its side.
  const im = contentImage(img, ctx, minW, minH) ?? (ctx.inArticle ? null : contentImage(img, ctx, minH, minW));
  if (!im) return clickable ? controlInto(clickable, out, ctx) : ctx.inArticle ? looseCaption() : undefined;
  // A caption beside the photo's wrapper rather than in a <figcaption> ("p.imageCaption").
  if (!cap || !capText()) {
    cap = siblingCaption(img, el) ?? cap;
    if (cap) ctx.used.add(cap);
  }
  const caption = capText() || undefined;
  // A gallery with its strip of thumbnails: a listing's photos, each one content.
  const thumbs = el.localName === "figure" && !rich ? galleryThumbs(el, img) : [];
  // A photo with no description of its own is named by its thumbnail ("… 2 thumbnail").
  if (!im.alt && thumbs.length) {
    const on = elOf(thumbs.find((a) => a.pressed)?.ref)?.querySelector("img");
    im.alt = clean(on?.getAttribute("alt")).replace(/\s*\b(thumbnail|thumb)$/i, "");
  }
  // Outside articles, images are usually decoration: keep captioned figures and
  // large images with a real description (a product photo, a chart).
  if (!ctx.inArticle && !caption && !thumbs.length && im.alt.split(/\s+/).length < 3) return clickable ? controlInto(clickable, out, ctx) : undefined;
  // The same photo again (a gallery's zoom buttons, all named after the product) is shown once.
  const alt = clean(img.alt);
  const photoKey = "photo:" + (clickable && alt ? alt : photoId(im.src));
  if (ctx.seen.has(photoKey)) return;
  ctx.seen.add(photoKey);
  // A screen reader should not hear the caption twice ("… ruta 5." over "… ruta 5").
  const bare = (x: string) => clean(x).replace(/[\s.。]+$/, "");
  if (caption && bare(im.alt) && bare(caption).includes(bare(im.alt))) im.alt = "";
  const a = img.closest("a[href]") as HTMLAnchorElement | null;
  out.push({
    t: "img", key: "img:" + refOf(img), img: im, caption,
    href: a ? a.href : undefined, ref: a ? refOf(a) : clickable ? refOf(clickable) : undefined,
  });
  // An image block opens only through a link, so a viewer gets its own button: only one the
  // photo says it opens (a real button, a popup, a zoom), not a box a script made focusable (La Nación).
  if (clickable && (opensViewer(clickable) || opensViewer(el))) {
    // Named by its own words, unless those only repeat the photo's description or caption.
    const lab = labelOf(clickable);
    const own = !!lab && lab.length <= 60 && norm(lab) !== norm(alt) && !norm(caption ?? "").includes(norm(lab));
    // A photo that only zooms in place (La Nación's "--zoom" box, made fixed over the page) shows
    // nothing new in Sift, where the photo is already shown in full: no "Open image" for it.
    const real = (x: Element) => x.localName === "button" || x.hasAttribute("aria-haspopup") || x.hasAttribute("aria-controls") || x.hasAttribute("aria-expanded");
    // A gallery's own short words over the photo ("View 3 Images") say what it opens (F1039).
    const capEl = clickable.querySelector("figcaption");
    const rest = own ? "" : clean(capEl ? textIn(clickable).replace(textIn(capEl), " ") : textIn(clickable));
    const count = rest.length <= 30 && GALLERY_COUNT.test(rest) ? rest : "";
    if (own || real(clickable) || real(el)) out.action(toAction(clickable, own ? lab : count || t("openImage")), ctx.formRef);
  }
  for (const a of thumbs) out.action(a, ctx.formRef);
}

/** A gallery's count over its first photo ("View 3 Images", "Ver 12 fotos"). */
const GALLERY_COUNT = /\d+\s+(\p{L}+\s+)?(images?|photos?|pictures?|fotos?|im[aá]genes|imagens|bilder)(?!\p{L})/iu;

/**
 * A gallery's strip of thumbnails (Craigslist's listing photos: a.thumb around
 * a 50 px photo): a button for each photo, the one shown pressed. Pressing one
 * shows that photo in the gallery, as on the page.
 */
function galleryThumbs(el: Element, main: Element): Action[] {
  const thumbs = (Array.from(el.querySelectorAll("a[href], button, [role=button]")) as HTMLElement[]).filter((a) => {
    if (a.contains(main) || tlen(a) > 3 || !visible(a)) return false;
    const im = a.querySelector("img");
    const r = im?.getBoundingClientRect();
    // Small photos, not icons (a share bar's logos).
    if (!im || !r || r.width < 32 || r.height < 32 || r.width > 120 || r.height > 120) return false;
    const href = a instanceof HTMLAnchorElement ? a.href : "";
    return !LOGO_TOKEN.test(`${tokens(im)} ${im.alt} ${imgSrc(im).split("?")[0]}`) && !SOCIAL_NAME.test(`${im.alt} ${a.getAttribute("aria-label") ?? ""}`) && !(href && (SOCIAL_HOSTS.test(hostOf(href)) || shareTarget(a, hrefOf(a))));
  });
  if (thumbs.length < 2) return [];
  return thumbs.slice(0, 40).map((a, i) => {
    const act = toAction(a, `${t("image")} ${i + 1}`);
    // It shows the photo here, not a page of its own.
    delete act.href;
    if (act.pressed === undefined) {
      const chosen = classState(a.querySelector("img")!, SELECTED_CLASS);
      if (chosen !== undefined) act.pressed = chosen;
    }
    return act;
  });
}

/**
 * A photo's address without its size and quality settings ("?w=640&q=75"), which
 * name the same photo at another size. What names the photo stays
 * ("/_next/image?url=/images/flood.png", "image.php?id=12").
 */
function photoId(src: string): string {
  const i = src.indexOf("?");
  if (i < 0) return src;
  const kept = src.slice(i + 1).split("&").filter((p) => p && !/^(w|h|width|height|q|quality|fit|auto|dpr|crop|resize|fm|format|sz|size|scale)=/i.test(p));
  return src.slice(0, i) + (kept.length ? "?" + kept.sort().join("&") : "");
}

/** A clickable photo that says it opens something: a real button, a popup it controls, or a zoom or gallery name. */
function opensViewer(el: Element): boolean {
  if (el.localName === "button" || el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-controls") || el.hasAttribute("aria-expanded")) return true;
  return /zoom|enlarge|expand|gallery|lightbox|fullscreen|full-screen|viewer|ampliar|galer[ií]a|ver (foto|imagen)|abrir imagen|open image/i.test(`${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${tokens(el)}`);
}

/** A big picture a link draws as a CSS background (a map preview), when it has no image of its own. */
function bgPicture(a: Element): Img | null {
  const r = a.getBoundingClientRect();
  if (r.width < 300 || r.height < 150 || a.querySelector("img, picture, video, canvas")) return null;
  const cands = [a, ...Array.from(a.querySelectorAll("div, span")).slice(0, 8)];
  for (const e of cands) {
    const er = e.getBoundingClientRect();
    if (er.width < 300 || er.height < 150) continue;
    const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(e).backgroundImage);
    if (!m || m[1].startsWith("data:") || LOGO_TOKEN.test(m[1].split("?")[0])) continue;
    return { src: m[1], alt: "", w: Math.round(er.width), h: Math.round(er.height) };
  }
  return null;
}

/** Caption text, with the photo credit kept apart from the caption ("… Karina Milei · Fabian Marelli"). */
function captionText(cap: Element): string {
  const parts = Array.from(cap.children).filter((c) => visible(c) && textIn(c));
  if (parts.length >= 2 && parts.length <= 4 && !hasDirectText(cap)) return parts.map((c) => textIn(c)).join(" · ");
  return textIn(cap);
}

/** A caption element right after the photo's wrapper (within a few levels), not a <figcaption>. */
function siblingCaption(img: Element, stop: Element): Element | null {
  // Or the line that says the photo's own description (G1's p.content-media__description, F932).
  const alt = clean(img.getAttribute("alt")).toLowerCase();
  let a: Element | null = img;
  for (let i = 0; a && i < 4; i++, a = a.parentElement) {
    const next = a.nextElementSibling;
    if (next && (/caption|cptn|credit|leyenda|legenda|epigrafe/i.test(tokens(next)) || (alt.length > 20 && textIn(next).toLowerCase() === alt)) && tlen(next) < 600 && visible(next)) return next;
    if (a !== img && a !== stop && tlen(a) > 120) break;
    if (!a.parentElement || a.parentElement === document.body) break;
  }
  return null;
}

function details(el: HTMLDetailsElement, out: Out, ctx: Ctx) {
  const summary = el.querySelector(":scope > summary");
  // A dateline ("Mon 26 Oct 2026 15.51 GMT" over "Last modified on …", The Guardian) is part of the byline,
  // never a section: gone when Sift's byline shows the date, else a small line.
  // Only when nothing else is inside: a body of its own ("Release 2.10", "Tuesday, October 27, 2026" over the
  // meeting's decisions) is a section. A weekday may lead, and "15.51" is a time only next to a date or a zone.
  const st = summary ? textIn(summary) : "";
  const dl = (s: string) => {
    const t = s.replace(/^(last\s+)?(modified|updated|edited|actualizado|modificado)(\s+(on|el))?:?\s*/i, "")
      .replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\.?,?\s+/iu, "");
    return dateLine(/\b(19|20)\d{2}\b/.test(t) ? t.replace(/\b(\d{1,2})\.(\d{2})\b/g, "$1:$2") : t.replace(/\b(\d{1,2})\.(\d{2})(?=\s*([ap]\.?m\b|[A-Z]{2,4}T\b))/g, "$1:$2"));
  };
  let rest = "";
  for (const c of Array.from(el.childNodes)) if (c !== summary) rest += " " + (c.textContent ?? "");
  rest = rest.replace(/\s+/g, " ").trim();
  // A body that is only a time ("10:00 – 13:00 hs" under "Sábado, 7 de noviembre de 2026") is the day's schedule,
  // not a dateline: the body counts as one only when it says it was updated or carries a full date with its year.
  const restDl = !rest || (dl(rest) && (/^(last\s+)?(modified|updated|edited|actualizado|modificado)\b/i.test(rest) || /\b(19|20)\d{2}\b/.test(rest)));
  if (st && dl(st) && restDl && !el.querySelector(":scope > :not(summary) :is(a[href], img, video, iframe, input, button), :scope > :is(a[href], img, video, iframe, input, button)")) {
    // Only the dateline by the byline repeats Sift's byline date; a date further down the story stays.
    if (!ctx.hasDate || !bylineZone(el, ctx, 3)) out.push({ t: "p", key: "p:" + refOf(el), content: [st], small: true });
    return;
  }
  const sub = new Out();
  // Text right inside <details> ("<summary>Q</summary>Answer") is the answer.
  walk(el, sub, ctx, summary);
  const blocks = sub.done();
  // An open list of topic links before the results (argentina.gob.ar's "Filtrar por temas") folds, so the results come first.
  // A summary whose words CSS draws (G1's empty title box with ::after "Ver resumo") is named by them, else by its label;
  // an unnamed one says "Details", never nothing (F933).
  const title = (summary && (textIn(summary) || drawnText(summary) || accName(summary).trim())) || t("details");
  out.push({ t: "section", key: "d:" + refOf(el), title, blocks, collapsed: !el.open || filtersBeforeResults(el) });
}

/** The words CSS draws in a small box (its own and its descendants' ::before and ::after strings). */
function drawnText(el: Element): string {
  const words: string[] = [];
  for (const e of [el, ...Array.from(el.querySelectorAll("*")).slice(0, 30)]) {
    for (const p of ["::before", "::after"]) {
      const m = /^"(.*)"$/.exec(getComputedStyle(e, p).content);
      if (m && /\p{L}/u.test(m[1])) words.push(m[1]);
    }
  }
  return clean(words.join(" "));
}

/** A <details> that is mostly a list of filter links (topics, categories), with a list of results after it in the page. */
function filtersBeforeResults(el: Element): boolean {
  const links = el.querySelectorAll("a[href]");
  if (links.length < 8) return false;
  let lt = 0;
  for (const a of Array.from(links)) lt += tlen(a);
  if (lt < tlen(el) * 0.5) return false;
  for (let a: Element | null = el, i = 0; a && a !== document.body && i < 4; a = a.parentElement, i++) {
    for (let s = a.nextElementSibling, j = 0; s && j < 3; s = s.nextElementSibling, j++) {
      if (resultList(s) || Array.from(s.querySelectorAll("ul, ol")).slice(0, 20).some((l) => resultList(l) || cardList(l))) return true;
    }
  }
  return false;
}

/** A list of three or more entries, each one long link (a card: title and description inside the link). */
function cardList(l: Element): boolean {
  const lis = Array.from(l.children).filter((c) => c.localName === "li");
  if (lis.length < 3) return false;
  const cards = lis.filter((li) => li.querySelectorAll("a[href]").length === 1 && tlen(li.querySelector("a[href]")!) >= 40).length;
  return cards >= 3 && cards >= lis.length * 0.8;
}

// ---------- page-level pieces ----------

const SEARCH_SEL = [
  "input[type=search]", "[role=search] input", "form[role=search] input", "input[role=searchbox]",
  "input[name=q]", "input[name=query]", "input[name=search]", "input[name=s]", "input[name=k]",
  "input[name=field-keywords]", "input[name=search_query]", "input[aria-label*=search i]",
  "input[placeholder*=search i]", "input[aria-label*=buscar i]", "input[placeholder*=buscar i]",
  "input[aria-label*=busc i]", "input[placeholder*=busc i]", "input[role=combobox][type=text]", "input[id*=search i]",
].join(",");
const SEARCH_BUTTON = /search|buscar|busca|suche|recherche|pesquis|cerca|^go$|^ir$|^ok$|submit|enviar/i;
/** Boxes that say they are search on their own; weaker hints (name=s, a combobox) need a header or search landmark. */
const STRONG_SEARCH =
  "input[type=search], input[role=searchbox], [role=search] input, input[name=q], input[name=query], input[name=search], input[name=search_query], input[name=field-keywords], input[aria-label*=search i], input[placeholder*=search i], input[aria-label*=buscar i], input[placeholder*=buscar i], input[aria-label*=busc i], input[placeholder*=busc i]";
const SEARCH_PLACE = "header,#header,[role=banner],nav,[role=search]";

export function findSearch(ctx: Ctx): Field | undefined {
  const cands = (Array.from(document.querySelectorAll(SEARCH_SEL)) as HTMLInputElement[]).filter(
    (i) => !["hidden", "submit", "checkbox", "radio", "button"].includes(i.type) && !i.disabled && (i.matches(STRONG_SEARCH) || !!i.closest(SEARCH_PLACE)),
  );
  // A ghost box kept out of the tab order (an autocomplete's "Search Suggestion" overlay) is not the one people type in.
  const vis = cands.filter((i) => visible(i)).sort((a, b) => +(a.getAttribute("tabindex") === "-1") - +(b.getAttribute("tabindex") === "-1"));
  // A hidden box in the header still searches once its toggle opens it; not one hidden while the
  // panel around it shows other fields in its place (Google Maps' directions).
  const pick = vis.find((i) => i.closest(SEARCH_PLACE)) ?? vis[0] ?? cands.find((i) => (i.closest("header,[role=banner],[role=search]") || !!searchToggle(i)) && !fieldsInstead(i)) ?? lookupBox();
  if (!pick) return undefined;
  const f = toField(pick);
  if (!f) return undefined;
  f.kind = "search";
  // The word "Search" a script keeps in the box until it is focused (MoinMoin's searchFocus) is its hint, not a query (F1046).
  if (/^(search|buscar|busca|suche|recherche|rechercher|pesquisar|cerca)\W{0,3}$/i.test(f.value.trim())) {
    f.placeholder ||= f.value.trim();
    f.value = "";
  }
  // "q" is the field's name, not a label anyone should hear.
  if (!f.label || f.label.length > 40 || f.label.length < 3 || f.label === pick.name) f.label = t("search");
  if (f.placeholder && (f.placeholder.length < 3 || f.placeholder === pick.name)) f.placeholder = undefined;
  // Only the box and its button move to Sift's top bar. The rest of the form
  // (filters, price range) stays in the page content.
  ctx.used.add(pick);
  ctx.searchEl = pick;
  const named = (b: Element) => SEARCH_BUTTON.test(accName(b)) || SEARCH_BUTTON.test(b.id);
  let btn: Element | null = null;
  // The form's own button: one that says search, else its submit button.
  if (pick.form) {
    const own = Array.from(pick.form.querySelectorAll("button, input[type=submit], input[type=image], [role=button]")).filter((b) => b !== pick && visible(b));
    // Not a button that is something else by its role (a date picker's "Calendar" tab, a toggle), though a <button> with no type submits.
    const plain = own.filter((b) => !b.matches("[role=tab], [role=option], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [aria-pressed], [aria-selected]"));
    // Its id counts as a name too, so the role check comes first (Booking's tab id "calendar-searchboxdatepicker-tab-trigger").
    btn = plain.find(named) ?? plain.find((b) => (b as HTMLButtonElement).type === "submit" || b.getAttribute("type") === "image") ?? null;
  }
  // No button in the form, or no form: a nearby button that says search
  // (Google Maps keeps it outside the form). Never just any button nearby.
  for (let scope: Element | null = (pick.form ?? pick).parentElement, i = 0; !btn && scope && i < 3; scope = scope.parentElement, i++) {
    btn = Array.from(scope.querySelectorAll("button, input[type=submit], [role=button]")).find((b) => b !== pick && visible(b) && named(b)) ?? null;
    if (scope.matches(SEARCH_PLACE)) break;
  }
  if (btn) {
    f.submit = refOf(btn);
    ctx.used.add(btn);
    // Its own visible words, not Sift's: an icon button gets Sift's "Search" in the page's language.
    const said = btn instanceof HTMLInputElement ? (btn.type === "submit" ? clean(btn.value) : "") : textIn(btn);
    if (said && said.length <= 30 && /\p{L}/u.test(said)) f.submitLabel = said;
  }
  return f;
}

/**
 * A lone text box at the top of the page whose form's button says it searches
 * (weather.gov's location box: "Go", named btnSearch): the site's own lookup,
 * so it goes to the bar and the page's data comes first (F636).
 */
function lookupBox(): HTMLInputElement | undefined {
  for (const f of Array.from(document.forms).slice(0, 20)) {
    if (f.querySelector("input[type=password], input[type=email], select, textarea")) continue;
    const boxes = (Array.from(f.querySelectorAll("input[type=text], input:not([type])")) as HTMLInputElement[]).filter((i) => visible(i) && !i.disabled);
    if (boxes.length !== 1 || boxes[0].getBoundingClientRect().top + scrollY > 300) continue;
    const btns = Array.from(f.querySelectorAll("button, input[type=submit]")).filter((b) => visible(b));
    if (btns.length === 1 && /search|buscar/i.test(`${btns[0].id} ${btns[0].getAttribute("name") ?? ""}`)) return boxes[0];
  }
  return undefined;
}

/**
 * The icon beside a hidden search box that opens it, outside the page's text
 * (TOI's span data-newga "NavBar-Search-Click" in a header built from plain
 * divs): the box is the site's search though no header tag holds it (F823).
 */
function searchToggle(box: Element): Element | undefined {
  if (box.closest("main, [role=main], article, footer, aside, [role=dialog], dialog")) return undefined;
  const form = (box as HTMLInputElement).form ?? box;
  for (let a = form.parentElement, i = 0; a && a !== document.body && i < 3; a = a.parentElement, i++) {
    for (const el of Array.from(a.querySelectorAll("span, div, i, a, button, [role=button]"))) {
      if (el.contains(box) || el.closest("form") || textIn(el) || !visible(el)) continue;
      const hint = Array.from(el.attributes).filter((at) => /^(id|class|title|aria-label|data-[\w-]+)$/.test(at.name)).map((at) => at.value).join(" ");
      if (/search|buscar|busca/i.test(hint) && (el.matches("a, button, [role=button]") || /click/i.test(hint) || getComputedStyle(el).cursor === "pointer")) return el;
    }
  }
  return undefined;
}

/** Text fields shown in a hidden search box's place, in the panel around it. */
function fieldsInstead(box: Element): boolean {
  let a = box.parentElement;
  for (let i = 0; i < 8 && a && a !== document.body; i++, a = a.parentElement) {
    for (const f of Array.from(a.querySelectorAll("input[type=text], input[type=search], input:not([type])"))) if (f !== box && visible(f) && f.getBoundingClientRect().width > 0) return true;
  }
  return false;
}

/** A header button that opens the site's search (MDN, weather sites) when there is no box yet. */
function searchTrigger(): Action | undefined {
  for (const el of Array.from(document.querySelectorAll("header *, [role=banner] *, nav *"))) {
    const tag = el.localName;
    const isBtn = tag === "button" || el.getAttribute("role") === "button" || tag === "a";
    const isComp = tag.includes("-") && /search/.test(tag);
    if (!isBtn && !isComp) continue;
    if (!visible(el) || el.closest("sift-root")) continue;
    if (isComp) {
      const inner = shadowButton(el);
      if (inner) return toAction(inner, t("search"));
      continue;
    }
    const label = labelOf(el);
    if (SEARCH_WORD.test(label) && label.length < 40) return toAction(el, label);
  }
  return drawerSearch();
}

const SEARCH_WORD = /^(search|buscar|busca|suche|recherche|cerca|pesquisar)\b/i;
const MENU_TOGGLE = /^((open|show|abrir|mostrar|ouvrir) )?((the|el|le) )?(main |site )?(menu|men[uú]|navigation|navegaci[oó]n|sections|secciones)$/i;

/**
 * A search kept in a closed drawer (BBC, Infobae): the site offers it, so Sift
 * does too. A field that only works once its drawer is open (BBC disables it)
 * is reached through the button that opens the drawer; a button that opens the
 * site's search panel is pressed as it is. Either way the box then shows in
 * Sift's top bar.
 */
function drawerSearch(): Action | undefined {
  const field = (Array.from(document.querySelectorAll(STRONG_SEARCH)) as HTMLInputElement[]).find(
    (i) => !["hidden", "submit", "checkbox", "radio", "button"].includes(i.type) && !i.closest("sift-root, main, [role=main], [data-sift-role=main], article, footer") && (i.disabled || !visible(i) || offscreen(i)),
  );
  if (field) {
    // The drawer's own opener: named by aria-controls, else the header's menu button.
    const ids = new Set<string>();
    for (let a: Element | null = field; a; a = a.parentElement) if (a.id) ids.add(a.id);
    const toggles = Array.from(document.querySelectorAll("button, [role=button], [aria-expanded]")).filter((b) => !b.closest("sift-root") && visible(b) && !offscreen(b));
    const opener =
      toggles.find((b) => (b.getAttribute("aria-controls") ?? "").split(/\s+/).some((id) => ids.has(id))) ??
      toggles.find((b) => !!b.closest("header, [role=banner], nav") && b.getAttribute("aria-expanded") === "false" && MENU_TOGGLE.test(labelOf(b))) ??
      toggles.find((b) => !!b.closest("header, [role=banner]") && MENU_TOGGLE.test(labelOf(b)));
    if (opener) return toAction(opener, t("search"));
  }
  // A search button in the closed drawer opens the site's search panel by itself (Infobae).
  for (const el of Array.from(document.querySelectorAll("header button, [role=banner] button, nav button, header [role=button], nav [role=button]"))) {
    if (el.closest("sift-root, main, [role=main], [data-sift-role=main], article, footer")) continue;
    const label = clean(el.getAttribute("aria-label")) || clean(el.textContent);
    if (SEARCH_WORD.test(label) && label.length < 40 && el.getAttribute("type") !== "submit") return toAction(el, label);
  }
  return undefined;
}

/** Laid out outside the window (an off-canvas drawer). */
function offscreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.right <= 0 || r.left >= innerWidth;
}

/** A link to the site's home page. */
function homeHref(href: string): boolean {
  try {
    const u = new URL(href, location.href);
    return u.host === location.host && u.pathname.replace(/\/+$/, "") === "" && !u.search;
  } catch {
    return false;
  }
}

export function findNav(ctx: Ctx): Action[] {
  const roots = Array.from(document.querySelectorAll("header, nav, [role=navigation], [role=banner]")).filter(
    (n) => !n.closest("footer,[role=contentinfo],article,[role=dialog]"),
  );
  const visibleLinks: Action[] = [];
  const hiddenLinks: Action[] = [];
  const seen = new Set<string>();
  let homeLogo: Action | null = null;
  for (const r of roots) {
    for (const a of Array.from(r.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
      const label = textIn(a) || clean(a.textContent) || accName(a);
      if (!label || label.length > 60 || !usefulControl(a, label)) continue;
      // A logo or icon named for what it is ("Logo link") says nothing in a menu.
      if (!textIn(a) && LOGO_NAME.test(label)) continue;
      // Stories teased in the header (The Guardian's highlights, each card under its cover link) are not places in the site.
      if (coverLink(a)) continue;
      const href = hrefOf(a);
      // Nor is a call to subscribe or donate ("Print subscriptions").
      if (!href || seen.has(href) || /^((print|digital) )?subscriptions?$|^(subscribe|suscr[ií]b|suscripci[oó]n|donat|don[aá]r?\b|support us|hacete socio)/i.test(label) || APPEAL_URL.test(href)) continue;
      // The logo's link home ("The Guardian - Back to home"): the menu's own entry for the home page ("News") stands for it, if there is one.
      if ((a.querySelector("svg, img")?.getBoundingClientRect().width ?? 0) >= 60 && homeHref(href)) {
        homeLogo ??= { key: "n:" + refOf(a), label, ref: refOf(a), href };
        continue;
      }
      seen.add(href);
      // Links you can see on the page come first; mega-menu entries after.
      (visible(a) ? visibleLinks : hiddenLinks).push({ key: "n:" + refOf(a), label, ref: refOf(a), href });
    }
  }
  if (homeLogo && !seen.has(homeLogo.href!)) visibleLinks.unshift(homeLogo);
  return [...visibleLinks, ...hiddenLinks].slice(0, 150);
}

/** Account and cart controls the top bar keeps, in English, Spanish and Portuguese (G1's "Entrar com Conta Globo", F926). */
const TOP_LABEL =
  /\b(cart|basket|bag|carrito|cesta|bolsa|sign ?in|log ?in|sign ?up|register|create account|account|my account|orders|iniciar sesi[oó]n|ingres(a|ar)|reg[ií]strate|registrarse|crear cuenta|mi cuenta|cuenta|pedidos|notifications|registrarme|entrar|fazer login|cadastr(e-se|ar)|criar conta|minha conta|conta|carrinho|sacola)\b/i;

/** An icon-only account or profile button, by its coded name or its classes. */
const ACCOUNT_ICON = /(^|[\s_-])(my ?account|account|avatar|profile|user)(?=$|[\s_-])/i;
/** A status page's "Subscribe to updates" (Statuspage): a button that opens the ways to follow it, not a paid appeal. */
const UPDATES_LABEL = /\b(subscribe|sign up|suscr[ií]b\w*)\b.*\b(updates|alerts|notifications|actualizaciones|alertas|notificaciones)\b/i;

export function findTop(): Action[] {
  const roots = Array.from(document.querySelectorAll("header, [role=banner], nav")).filter((n) => !n.closest("footer,article"));
  // A site header built from plain boxes (Infobae's div#siteheader.site-header) at the top of the page.
  for (const n of Array.from(document.querySelectorAll("div[id*=header i], div[class*=header i], div[class*=masthead i]")).slice(0, 200)) {
    // TOI's div.header-container counts too (F823).
    if (roots.some((r) => r.contains(n)) || !(CHROME_TOKEN.test(tokens(n)) || /(^|\s)(site-?)?header(-?(container|wrapper|wrap))?(\s|$)/i.test(tokens(n))) || n.closest("main, [role=main], article, footer")) continue;
    // At the top of the page, or pinned at the top of the window when the page is scrolled.
    const r = n.getBoundingClientRect();
    if (r.height > 0 && Math.min(r.top + scrollY, r.top) < 300) roots.push(n);
  }
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const r of roots) {
    for (const el of Array.from(r.querySelectorAll("a[href],button,span,div"))) {
      // A plain span a script makes clickable ("Sign In" on TOI, no role or link): one with no boxes inside, that says it signs in (F823).
      if ((el.localName === "span" || el.localName === "div") && (el.firstElementChild || !TOP_LABEL.test(el.textContent ?? "") || (el.textContent ?? "").length > 30 || el.closest("a[href],button,[role=button]") || (getComputedStyle(el).cursor !== "pointer" && !/(^|[\s_-])(log-?in|sign-?in)($|[\s_-])/i.test(tokens(el))))) continue;
      if (!visible(el)) continue;
      // What it says decides ("Fork" that leads to a login page is not "Sign in"); an icon goes by its name and address.
      const vis = textIn(el);
      const named = accName(el);
      // An account icon named only in code ("myAccount", class account-button or avatar) is said in the page's language (F727).
      const coded = !vis && (!named || /^[a-z]+([A-Z][a-z\d]*)+$|^[a-z]+[_-][a-z][\w-]*$/.test(named)) && ACCOUNT_ICON.test(`${named.replace(/([a-z])([A-Z])/g, "$1 $2")} ${tokens(el)}`);
      const label = vis || (coded ? t("account") : named);
      const probe = vis ? `${vis} ${el.id}` : `${label} ${coded ? "account" : ""} ${el.getAttribute("href") ?? ""} ${el.id}`;
      const updates = UPDATES_LABEL.test(label) && (el.hasAttribute("aria-haspopup") || el.matches("button, [role=button]"));
      if (!label || label.length > 50 || (!TOP_LABEL.test(probe) && !updates)) continue;
      // A closed slide-in panel sits beside the window: its copy of "Sign in" is not on screen.
      const box = el.getBoundingClientRect();
      if (box.left >= innerWidth || box.right <= 0) continue;
      // "INICIAR SESION" and "Iniciar sesión" are one action.
      const k = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(toAction(el, label));
      if (out.length >= 4) return withPicker(out, roots);
    }
  }
  return withPicker(out, roots);
}

/** A site-wide picker: the place a forecast is for ("Montreal"), the page's language ("English (US)"). */
const PICKER = /(^|[\s_-])(location|locale|language|lang|region|country|city|area)[\s_-]*(picker|switcher|selector|select|chooser|trigger|toggle|menu|button)($|[\s_-])/i;

/**
 * The header's location or language picker leads the top bar: it changes
 * what the whole site shows, and the site's menu that holds it is dropped.
 */
function withPicker(top: Action[], roots: Element[]): Action[] {
  for (const r of roots) {
    const els = r.getElementsByTagName("*");
    for (let i = 0; i < els.length && i < 4000; i++) {
      const el = els[i];
      const tag = el.localName;
      let btn: Element | null = null;
      if (tag.includes("-") && PICKER.test(tag.replace(/^[a-z]+-/, "-"))) btn = shadowOf(el)?.querySelector("button, [role=button]") ?? el.querySelector("button");
      else if ((tag === "button" || el.getAttribute("role") === "button") && (PICKER.test(tokens(el)) || (!!el.parentElement && (PICKER.test(tokens(el.parentElement)) || (!!el.parentElement.parentElement && PICKER.test(tokens(el.parentElement.parentElement))))))) btn = el;
      if (!btn || !visible(btn)) continue;
      const label = textIn(btn) || accName(btn);
      if (!label || label.length > 40 || top.some((a) => a.ref === refOf(btn!))) continue;
      return [toAction(btn, label), ...top].slice(0, 5);
    }
  }
  return top;
}

/** The first node recorded after the last action, and the URL then. */
let armFirst: Element | undefined;
let armUrl = "";
/** The positioned parts the page view showed in the last generic extraction, and in the one before the last action. */
let lastShown = new WeakSet<Element>();
let armShown = new WeakSet<Element>();
/** The small fixed bars the walk dropped, in the last extraction and in the one before the last action. */
let lastBars = new WeakSet<Element>();
let armBars = new WeakSet<Element>();
/** The page view before the last action, and the elements that hold what it showed (worked out when first asked). */
let armView: { visited?: WeakSet<Element>; blocks?: Block[]; dialog: Element | null } = { dialog: null };
let armHolds: WeakSet<Element> | null = null;
/** The popup found last time, which stays one while the user acts inside it. */
let shownPop: Element | null = null;
/** The last popup found that holds a field to fill in. */
let lastPop: Element | null = null;
/** The popup found since the last action, which stays while the page shows it. */
let heldPop: { el: Element; arm: number } | null = null;

/**
 * A popup the page opened after the user's last action, found by layout rather
 * than ARIA: the outermost positioned (absolute or fixed) element around a
 * recently added or changed node, popup-sized, with text in it.
 */
function findPopup(ctx: Ctx): { el: Element; actionable: boolean } | null {
  let best: Element | null = null;
  const vw = innerWidth;
  const vh = innerHeight;
  const recent = recentNodes();
  // After an action that navigated (a search that loaded results), what appeared is the new page, not a popup.
  // A new page also empties the list: that is not a new action to arm for (Google Maps' route choice).
  if (recent.length && recent[0] !== armFirst) {
    armFirst = recent[0];
    armUrl = location.href;
    armShown = lastShown;
    armBars = lastBars;
    armView = shownPrev;
    armHolds = null;
  } else if (recent.length && location.href !== armUrl) return null;
  const touched = new Set(recent);
  // A part that appeared itself (added, or shown by its own class or style) beats a
  // bar that only holds the button that opened it (Craigslist's toolbar around "relevance").
  const fresh = (e: Element) => {
    for (let a: Element | null = e; a && a !== document.body; a = a.parentElement) if (touched.has(a)) return true;
    return false;
  };
  let bestFresh = false;
  const acted = recentNodes(true);
  for (const n of recent) {
    if (n.closest("sift-root") || !visible(n) || ctx.drop?.(n)) continue;
    let root: Element | null = null;
    let el: Element | null = n;
    /** Something the page view showed before holds the changed node, below `el`. */
    let below = false;
    for (let i = 0; el && el !== document.body && el !== document.documentElement && i < 12; i++, el = el.parentElement) {
      // The box around a field the user entered from the page view is the page's, and so is all
      // around it: only a part inside it can be a popup (a list under Google Maps' directions fields).
      if (holdsEntered(el)) break;
      const was = below;
      below ||= shownBefore(el);
      const pos = getComputedStyle(el).position;
      if (pos !== "fixed" && pos !== "absolute") continue;
      // Only something the page view showed changed, in a part that did not change itself (a date
      // in a picker open since the page loaded, Craigslist's fixed results toolbar): no popup opened.
      if (was && !touched.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 80 && r.height >= 24 && r.width * r.height < vw * vh * 0.85) root = el;
      else if (r.width * r.height >= vw * vh * 0.85 && (fresh(el) || (!!lastPop && el.contains(lastPop)))) {
        // A backdrop over the whole window that just went up (Craigslist's price filter), or holds the
        // popup being filled in: the box it holds is the popup.
        for (let c: Element | null = n; c && c !== el; c = c.parentElement) {
          const cr = c.getBoundingClientRect();
          if (cr.width >= 80 && cr.height >= 24 && cr.width * cr.height < vw * vh * 0.85) root = c;
        }
        // The backdrop itself was what went up: the box inside it.
        if (n === el)
          root =
            Array.from(el.children).find((c) => {
              const cr = c.getBoundingClientRect();
              return cr.width >= 80 && cr.height >= 24 && cr.width * cr.height < vw * vh * 0.85 && tlen(c) > 1;
            }) ?? root;
      }
      // A layer over the whole window that the action itself opened (Infobae's sign-in, backdrop and all).
      else if (pos === "fixed" && touched.has(el) && !ctx.visited?.has(el) && !el.querySelector("main, [role=main], [data-sift-role=main], h1, article")) root = el;
    }
    // A fixed layer inside a transparent part (Allbirds' AI chips, at opacity 0 until the page is scrolled) does not show.
    if (!root || !visible(root) || tlen(root) < 2 || (getComputedStyle(root).position === "fixed" && !root.checkVisibility({ opacityProperty: true })) || !popupLike(root, touched, ctx)) continue;
    // A player the page view already shows is not a popup, though its state classes churn and Sift lifts it
    // over its place with a fixed position (Infobae's JW Player after the article's audio played).
    // (It can miss from one pass, while the player swaps in its ad, so Sift's own portals count too.)
    if (portalElements().some((p) => holds(p, root!)) || ctx.portals?.some((p) => holds(p, root!) || holds(root!, p))) continue;
    // A part the page view showed before the action is page layout that changed around it (Google Maps'
    // directions box, when a route is chosen below it), not something the action opened.
    if (armShown.has(root) && root !== shownPop) continue;
    // So is a box that was on screen before it (Google's account bar, a filter chip bar whose chips
    // the page view showed), though the page changes inside it as it settles (F870).
    if ((armBars.has(root) || shownAtArm(root)) && root !== shownPop) continue;
    // Only entering a field (no click or key since) opens what shows beside it: its suggestions, its calendar.
    // A box elsewhere that changed meanwhile is the page settling (Google's account bar filling in under load) (F870).
    if (root !== shownPop && !acted.some((a) => root!.contains(a) || a.contains(root!)) && farFromField(root)) continue;
    if (best && best.contains(root)) continue;
    const f = fresh(root);
    if (!best || root.contains(best) || (f && !bestFresh) || (f === bestFresh && tlen(root) > tlen(best))) {
      best = root;
      bestFresh = f;
    }
  }
  // A popup with a field the user is filling in (Craigslist's price range) stays while the page
  // shows it: typing there changes nothing else on the page.
  if (!best && lastPop?.isConnected && visible(lastPop) && location.href === armUrl && !!lastPop.querySelector(FILL_SEL) && !holdsEntered(lastPop)) best = lastPop;
  // So does any popup until the next action, though the page keeps changing around it: while
  // YouTube loads comments, the nodes of its "Sign in" prompt drop out of the recent ones.
  const held = heldPop?.el;
  if (!best && held && heldPop!.arm === armCount() && held.isConnected && visible(held) && tlen(held) >= 2 && location.href === armUrl && !holdsEntered(held)) best = held;
  heldPop = best ? { el: best, arm: armCount() } : null;
  lastPop = best && best.querySelector(FILL_SEL) ? best : null;
  shownPop = best;
  if (!best || isAd(best) || ctx.drop?.(best)) return null;
  const text = textIn(best);
  // A popup that only mentions cookies or a newsletter is a banner; one with a field to fill
  // (the sign-up form the user just opened) is what they asked for.
  if (!text || (NOISE_TEXT.test(text.slice(0, 300)) && !(best.querySelector(FILL_SEL) && recentNodes(true).some((n) => best!.contains(n) || n.contains(best!))))) return null;
  const actionable = !!best.querySelector(`a[href], button, [role=button], ${FOCUS_LINK}, [role=menuitem], [role=option], input, select, textarea`) || !!plainSuggestions(best);
  return { el: best, actionable };
}

/**
 * The rows of a suggestion list with no roles, links or buttons (jQuery
 * Autocomplete's .autocomplete-suggestion on weather.gov): a positioned box
 * right under or over the field the user is typing in, its rows alike and most
 * of them naming what was typed. The page picks a row on its click, or on Enter
 * after its field's arrow keys.
 */
function plainSuggestions(el: Element): Element[] | null {
  const f = enteredField();
  if (!(f instanceof HTMLInputElement) || !/^(text|search)$/.test(f.type) || el.contains(f) || f.closest("sift-root")) return null;
  const typed = norm(f.value);
  if (!typed || el.matches("[role]") || el.querySelector(`a[href], button, [role=button], ${FOCUS_LINK}, [role=menuitem], [role=option], [role=listbox], [role=grid], [role=row], [role=link], input, select, textarea, img, video`)) return null;
  const a = f.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  if (!a.width || !b.width || b.left >= a.right || b.right <= a.left) return null;
  if (!((b.top >= a.top - 4 && b.top - a.bottom < 60) || (b.bottom <= a.bottom + 4 && a.top - b.bottom < 60))) return null;
  // Through wrappers to the rows; a lone row is one too ("<strong>Sa</strong>lem, OR").
  const ownText = (e: Element) => Array.from(e.childNodes).some((c) => c.nodeType === 3 && !!c.textContent?.trim());
  let box = el;
  while (box.children.length === 1 && box.children[0].children.length && !ownText(box.children[0])) box = box.children[0];
  const rows = Array.from(box.children).filter((c) => visible(c) && tlen(c) > 0);
  if (!rows.length || rows.length > 30 || rows.some((r) => r.localName !== rows[0].localName || r.children.length > 6)) return null;
  // The same class on every row, but for the one the page highlights.
  const base = (r: Element) => Array.from(r.classList).filter((c) => !SELECTED_CLASS.test(c)).sort().join(" ");
  if (rows.some((r) => base(r) !== base(rows[0]))) return null;
  const word = typed.split(" ")[0];
  return rows.filter((r) => norm(textIn(r)).includes(word)).length * 2 >= rows.length ? rows : null;
}

/**
 * A positioned element is a popup the user opened, not page layout that holds
 * a changed node: never a landmark (a fixed site header), a bar pinned across
 * the top or bottom, a full-height side panel, the search box's suggestions,
 * or a large part of the page Sift already shows. A part that did not appear
 * itself (added, or its own class or style switched) must also be small.
 */
function popupLike(root: Element, touched: Set<Element>, ctx: Ctx): boolean {
  if (root.matches("header, nav, footer, main, [role=banner], [role=navigation], [role=contentinfo], [role=main], [data-sift-role=main], [role=search]")) return false;
  if (ctx.searchEl && (root.contains(ctx.searchEl) || suggestionsOf(ctx.searchEl, root))) return false;
  // A checkout's pay bar that went up with the last step is part of the page, which shows it.
  // So is the bar of actions for the rows the user just selected.
  if (/fixed|sticky/.test(getComputedStyle(root).position) && (payBar(root) || bulkBar(root) || saveBar(root))) return false;
  // Nor the box around a field the user entered from the page view (Google Maps' directions form).
  if (holdsEntered(root)) return false;
  const vw = innerWidth;
  const vh = innerHeight;
  const r = root.getBoundingClientRect();
  const area = r.width * r.height;
  // A fixed masthead under an ad slot (Infobae's, at top 96) is a bar too.
  const bar = r.width >= vw * 0.9 && r.height < vh * 0.3 && (r.top <= 2 || r.bottom >= vh - 2 || (r.top < vh * 0.3 && getComputedStyle(root).position === "fixed"));
  const panel = r.height >= vh * 0.75 && (r.left <= 2 || r.right >= vw - 2);
  // A big part whose headings the page view already shows (a side panel holding the place details).
  if ((area > vw * vh * 0.25 || panel) && (ctx.visited?.has(root) || (ctx.articleEl && root.contains(ctx.articleEl)) || Array.from(root.querySelectorAll("h1, h2")).some((h) => ctx.visited?.has(h)))) return false;
  let fresh = touched.has(root);
  // The whole page shown again (Infobae's app, once its search panel closes) opened no bar in it (F645).
  const page = (m: Element) => bar && !!m.querySelector("main, [role=main], [data-sift-role=main], h1, article");
  if (!fresh) for (const m of touched) if (m !== document.body && m !== document.documentElement && m !== root && m.contains(root) && !page(m)) { fresh = true; break; }
  // A part of the site's header that only changed inside (Fox's clock, swapped every few seconds
  // in its logo box), with nothing to use in what changed, is the header ticking, not a popup (F831).
  if (!fresh && root.closest("header, [role=banner]")) {
    const ctl = "a[href], button, [role=button], input, select, textarea, [role=menuitem], [role=option]";
    if (!Array.from(touched).some((m) => root.contains(m) && (m.matches(ctl) || !!m.querySelector(ctl)))) return false;
  }
  return fresh || (!bar && !panel && area < vw * vh * 0.35);
}

/** `root` is nowhere beside the page field the user last entered from Sift's page view (under, over or on it). */
function farFromField(root: Element): boolean {
  const f = enteredField();
  if (!f) return false;
  const a = f.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  if (!a.width || !a.height) return false;
  return Math.max(0, b.left - a.right, a.left - b.right) > 40 || Math.max(0, b.top - a.bottom, a.top - b.bottom) > 80;
}

/** `root` holds the page field the user last entered from Sift's page view: that field's own box or panel. */
function holdsEntered(root: Element): boolean {
  const f = enteredField();
  return !!f && root.contains(f);
}

/**
 * The panel an expanded button says it opened as a dialog (aria-haspopup=dialog)
 * when the panel has no dialog role: the box it names, or a positioned box
 * beside the button with something to use in it.
 */
function openedPanel(ctx: Ctx): Element | null {
  for (const b of Array.from(document.querySelectorAll("[aria-haspopup=dialog][aria-expanded=true]"))) {
    if (b.closest("sift-root") || !visible(b)) continue;
    const id = (b.getAttribute("aria-controls") ?? "").split(/\s+/)[0];
    const named = id ? document.getElementById(id) : null;
    if (named) {
      if (visible(named) && !named.matches(DIALOG_SEL) && !ctx.drop?.(named)) return named;
      continue;
    }
    let a: Element | null = b.parentElement;
    for (let i = 0; i < 3 && a && a !== document.body; i++, a = a.parentElement) {
      for (const c of Array.from(a.children)) {
        if (c.contains(b) || !visible(c) || ctx.drop?.(c)) continue;
        const pos = getComputedStyle(c).position;
        if ((pos === "absolute" || pos === "fixed") && c.querySelector("a[href], button, input, [role=button]")) return c;
      }
    }
  }
  return null;
}

/**
 * A row of emoji reactions named only by their counts (Fox's hedgehog-reactions:
 * 👍 84, 🔥 25, "+ 4"): engagement that posts a reaction, like a share bar (F648).
 */
function reactionBar(el: Element): boolean {
  const root = shadowOf(el) ?? el;
  const btns = Array.from(root.querySelectorAll("button, [role=button]"));
  if (btns.length < 2) return false;
  let emoji = 0;
  for (const b of btns) {
    // Counts and signs only ("87", "+ 4"): a button with words is a control of its own.
    if (/\p{L}{2}/u.test(b.textContent ?? "")) return false;
    if (Array.from(b.querySelectorAll("img")).some((im) => /\p{Extended_Pictographic}/u.test(im.alt))) emoji++;
  }
  return emoji >= 2;
}

/** A sign-in or sign-up button with an account elsewhere ("Continue with Google", "Sign in with Apple", "Iniciar sesión con Google"). */
const SIGN_IN_WITH =
  /^(continue|sign (in|up)|log ?in|login|register|join|connect|get started) (with|using|via)\b|\bsingle sign-on\b|^(continuar|contin[uú]a|iniciar sesi[oó]n|inici[aá] sesi[oó]n|ingres(ar|[aá])|acceder|entrar|reg[ií]str(arse|ate)) con\b/i;

/**
 * A box named only "social" (social-login, kc-social-providers) that holds a way to sign in with another account:
 * those buttons are how some people sign in at all. A social box with share or follow links is still noise.
 */
function socialSignIn(el: Element, tk: string): boolean {
  if (NOISE_TOKEN.test(tk.replace(/social/gi, ""))) return false;
  return Array.from(el.querySelectorAll("button, [role=button], a[href], input[type=submit], input[type=button]")).some((b) => SIGN_IN_WITH.test(accName(b).trim()));
}

/** A path that names one story: a date ("/2026/10/25/", "2026-10-22"), a long slug, or a long numeric id. */
const STORY_PATH = /\/(19|20)\d\d[/-]\d\d?[/-]\d\d?(\/|$|-)|\/[^/?#]*\p{L}+(?:[-_]\p{L}+){3,}[^/?#]*|\/\d{6,}(\/|$|[-_.])/u;

/**
 * A box classed only "promo" that holds a story of its own (NPR wraps every headline in
 * "bucketwrap promocard > article.c-promo-card"): its linked headlines lead to stories, so it is
 * a story card, not a promo (F738). One that sells (a sign-up, the app) is still a promo.
 */
function promoStory(el: Element, tk: string): boolean {
  if (!/promo/i.test(tk) || NOISE_TOKEN.test(tk.replace(/promo(tion)?/gi, ""))) return false;
  const heads = new Map<string, string>();
  for (const h of Array.from(el.querySelectorAll(LINKED_HEADING))) {
    const a = (h.localName === "a" ? h : h.querySelector("a[href]") ?? h.closest("a[href]")) as HTMLAnchorElement | null;
    if (!a?.href || !visible(h)) continue;
    if (!heads.has(a.href)) heads.set(a.href, textIn(h));
    if (heads.size > 3) return false;
  }
  if (!heads.size) return false;
  for (const [href, title] of heads) {
    let path = "";
    try {
      path = new URL(href).pathname;
    } catch {
      return false;
    }
    if (title.split(/\s+/).length < 3 || !STORY_PATH.test(path) || AD_HOSTS.test(hostOf(href)) || promoCard(title, href)) return false;
  }
  return true;
}

/**
 * A box classed only "recommended" that holds most of a front page's story links in its main region is the
 * headline feed itself (G1's "bstn-fd bstn-fd-recommended", F925), not a side box of suggestions.
 */
function mainFeed(el: Element, tk: string, ctx: Ctx): boolean {
  if (ctx.inArticle || ctx.articleEl || !/recommend/i.test(tk) || NOISE_TOKEN.test(tk.replace(/recommend(ed|ations)?/gi, ""))) return false;
  // Only on a front page: the site's home or a section's ("/", "/economia/"), never a product's or a story's.
  if (!/^\/([^/.]+\/?)?$/.test(location.pathname)) return false;
  const m = el.closest("main, [role=main], [data-sift-role=main]");
  if (!m || m === el) return false;
  const stories = (r: Element) => {
    const s = new Set<string>();
    for (const a of Array.from(r.querySelectorAll("a[href]"))) {
      const h = (a as HTMLAnchorElement).href;
      let path = "";
      try {
        path = new URL(h).pathname;
      } catch {
        continue;
      }
      if (STORY_PATH.test(path) && !AD_HOSTS.test(hostOf(h))) s.add(h.split("#")[0]);
    }
    return s.size;
  };
  const n = stories(el);
  return n >= 8 && n * 2 >= stories(m);
}

/** Whether a listbox or popup belongs to a search field (its aria-controls, or inside the same combobox box). */
function suggestionsOf(field: Element, pop: Element): boolean {
  const ids = `${field.getAttribute("aria-controls") ?? ""} ${field.getAttribute("aria-owns") ?? ""}`.split(/\s+/).filter(Boolean);
  if (pop.id && ids.includes(pop.id)) return true;
  if (ids.some((id) => pop.querySelector("#" + CSS.escape(id)))) return true;
  const box = field.parentElement?.parentElement?.parentElement;
  return !!box && box.contains(pop);
}

const DIALOG_SEL = "dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]";
/** Fields people type into (not the checkboxes of a cookie banner's settings). */
const FILL_SEL = "input[type=email], input[type=password], input[type=text], input[type=search], input[type=tel], input:not([type]), textarea";

/**
 * What the last extraction showed: its positioned parts and headings
 * (ctx.visited), the page view's blocks, and the dialog. The one before the
 * current extraction tells a popup the user's action opened from a part of the
 * page that only changed inside.
 */
let shownLast: { visited?: WeakSet<Element>; blocks?: Block[]; dialog: Element | null } = { dialog: null };
let shownPrev = shownLast;
/** Elements that hold something the previous page view showed, worked out when first asked. */
let holdsShown: WeakSet<Element> | null = null;

/** The previous extraction's page view showed this part (not as its dialog). */
function shownBefore(el: Element): boolean {
  const d = shownPrev.dialog;
  if (d && (d === el || d.contains(el) || el.contains(d))) return false;
  if (shownPrev.visited?.has(el)) return true;
  if (!holdsShown) {
    holdsShown = new WeakSet();
    const refs = new Set<string>();
    const collect = (x: unknown) => {
      if (Array.isArray(x)) for (const v of x) collect(v);
      else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) k === "ref" && typeof v === "string" ? refs.add(v) : typeof v === "object" && collect(v);
    };
    collect(shownPrev.blocks ?? []);
    for (const r of refs) for (let a = elOf(r); a && a !== document.body && !holdsShown.has(a); a = a.parentElement) holdsShown.add(a);
  }
  return holdsShown.has(el);
}

/** The page view from before the user's last action showed something in this part (not as its dialog). */
function shownAtArm(el: Element): boolean {
  const d = armView.dialog;
  if (d && (d === el || d.contains(el) || el.contains(d))) return false;
  if (!armHolds) {
    armHolds = new WeakSet();
    const refs = new Set<string>();
    const collect = (x: unknown) => {
      if (Array.isArray(x)) for (const v of x) collect(v);
      else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) k === "ref" && typeof v === "string" ? refs.add(v) : typeof v === "object" && collect(v);
    };
    collect(armView.blocks ?? []);
    for (const r of refs) for (let a = elOf(r); a && a !== document.body && !armHolds.has(a); a = a.parentElement) armHolds.add(a);
  }
  return armHolds.has(el);
}

/** `blocks`: the page view's blocks, when the page is the generic extractor's. */
export function findDialog(ctx: Ctx, blocks?: Block[]): Dialog | undefined {
  shownPrev = shownLast;
  holdsShown = null;
  const d = dialogIn(ctx);
  shownLast = { visited: ctx.visited, blocks, dialog: elOf(d?.ref) };
  return d;
}

function dialogIn(ctx: Ctx): Dialog | undefined {
  const all = Array.from(document.querySelectorAll(DIALOG_SEL));
  const layers = (ctx.layers ?? []).filter((l) => l.isConnected && !all.some((d) => d.contains(l) || l.contains(d)));
  all.push(...layers);
  // Web components keep their modal in a shadow root (MDN's search: mdn-search-modal > dialog),
  // and their open dropdown too (MDN's language switcher: its button says expanded, and which panel).
  const els = document.getElementsByTagName("*");
  const opened: Element[] = [];
  const openedBy = new Map<Element, Element>();
  for (let i = 0; i < els.length; i++) {
    const n = els[i].localName;
    if (n.indexOf("-") < 0) continue;
    if (/dialog|modal|popup|search|overlay|drawer|sheet/.test(n)) {
      const sr = shadowOf(els[i]);
      if (sr) all.push(...Array.from(sr.querySelectorAll(DIALOG_SEL)));
    } else if (/switch|picker|menu|dropdown|select|chooser/.test(n)) {
      const sr = shadowOf(els[i]);
      const b = sr?.querySelector("[aria-expanded=true][aria-controls]");
      const panel = b && sr!.getElementById(b.getAttribute("aria-controls")!.split(/\s+/)[0]);
      if (panel && visible(panel)) {
        opened.push(panel);
        openedBy.set(panel, b!);
      }
    }
  }
  // A consent platform's box without a dialog role counts too, on a page that shows nothing until it is answered.
  const cmp = new Set<Element>();
  // Or on a readable page, once the reader pressed Play on a video the page holds back until it is answered (F826).
  const asked = consentAsked && !ctx.bare;
  if (asked) {
    // The wall found (Sourcepoint's box may carry the dialog role itself): its frame's title says what it is.
    const up = consentWallUp();
    if (up && !all.some((d) => d !== up && (d.contains(up) || up.contains(d)))) {
      cmp.add(up);
      if (!all.includes(up)) all.push(up);
    }
  } else if (ctx.bare) {
    for (const w of Array.from(document.body.querySelectorAll(CMP_SEL))) {
      let p = w.parentElement;
      while (p && p !== document.body && !p.matches(CMP_SEL)) p = p.parentElement;
      if ((p && p !== document.body) || tlen(w) > 3000 || w.querySelector("main, [role=main], h1") || all.some((d) => d.contains(w) || w.contains(d))) continue;
      cmp.add(w);
      all.push(w);
    }
  }
  // A panel the site keeps inert (Slickstream's search on pinchofyum.com: a full-window, see-through shell) is closed:
  // nobody can use it, so the user did not open it. Sift's own shield marks what it makes inert.
  const shut = (d: Element) => {
    if (d.getAttribute("aria-hidden") === "true" && getComputedStyle(d).pointerEvents === "none") return true;
    for (let a: Element | null = d; a && a !== document.documentElement; a = parentOrHost(a)) if (a.hasAttribute("inert") && !a.hasAttribute("data-sift-inert")) return true;
    return false;
  };
  const cands = all.filter((d) => visible(d) && !d.closest("sift-root") && !ctx.drop?.(d) && !shut(d) && (textIn(d).length > 0 || !!d.querySelector("input, textarea") || (layers.includes(d) && !!d.querySelector("img, video")) || (cmp.has(d) && !!d.querySelector("iframe"))));
  let recent: Element[] | undefined;
  for (let i = cands.length - 1; i >= 0; i--) {
    const d = cands[i];
    const r = d.getBoundingClientRect();
    if (r.width < 120 || r.height < 60) continue;
    const text = cmp.has(d) ? cmpText(d) : textIn(d);
    // Cookie and newsletter prompts the page put up on its own are noise; a sign-in form,
    // or a dialog the user's last action opened (the newsletter form behind "Subscribe"), is not.
    // A consent wall over a page that shows nothing until it is answered is the way in: it stays, with its own choices.
    const wall = (!!ctx.bare || asked) && consentWall(d, text);
    if (cmp.has(d) && (!wall || !d.querySelector("button, [role=button], a[href], iframe"))) continue;
    if (NOISE_TEXT.test(text.slice(0, 600)) && !wall && !d.querySelector("input[type=password]") && !(recent ??= recentNodes(true)).some((n) => openedWith(n, d))) continue;
    // So is a sign-in, discount or app promo with its own way out and nothing to fill in (Booking's "Sign in, save money"):
    // the page works without answering it.
    if (!wall && marketingModal(d, text) && !(recent ??= recentNodes(true)).some((n) => openedWith(n, d))) continue;
    const sub = new Out();
    // A dialog has its own visit budget: a huge page must not leave it empty.
    const dctx: Ctx = { ...ctx, used: new WeakSet(), seen: new Set(), cards: undefined, portals: undefined, inArticle: true, inDialog: true, articleEl: null, count: 0, cut: { noted: false } };
    const closeEl = Array.from(d.querySelectorAll("button,[role=button]")).find((b) =>
      /^(close|cerrar|dismiss|cancel|cancelar|×|✕|x)$/i.test(accName(b)) || (layers.includes(d) && CLOSE_NAME.test(accName(b))),
    );
    // A layer's "Close zoom modal" is the sheet's own Close, not a second one in it.
    if (closeEl && layers.includes(d)) dctx.used.add(closeEl);
    walk(d, sub, dctx);
    const blocks = cutNote(sub.done(), dctx);
    if (!blocks.length) continue;
    if (wall) rejectFirst(blocks);
    // Asked for by Play, or by a click the wall swallowed: it says why it shows (F826, F1034).
    if (wall && asked) blocks.unshift({ t: "p", key: "consent-why:" + refOf(d), content: [t(consentWhy)] });
    const titleEl = d.querySelector("h1,h2,h3,[role=heading]");
    const title =
      clean(d.getAttribute("aria-label")) || (d.getAttribute("aria-labelledby") ? accName(d) : "") || (titleEl ? textIn(titleEl) : "") ||
      // A consent box without a heading is named by its first short line ("Your privacy choices"), or by its frame's title.
      (wall && firstLine(d).length <= 80 ? firstLine(d) : "") || (wall ? clean(d.querySelector("iframe")?.title) : "");
    // The page's description of an alert (aria-describedby): the warning or the consequence, said with its name.
    const root = d.getRootNode() as Document | ShadowRoot;
    const desc = (d.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((id) => root.getElementById?.(id)).filter((e): e is HTMLElement => !!e).map((e) => textIn(e)).join(" ");
    return {
      key: "dlg:" + refOf(d),
      ref: refOf(d),
      title: title.slice(0, 120),
      blocks,
      close: closeEl ? toAction(closeEl, accName(closeEl)) : undefined,
      // (One the reader asked for on a readable page can be put away unanswered.)
      blocking: !closeEl && !(wall && asked) && (wall || blocksPage(d)) ? true : undefined,
      role: d.getAttribute("role") === "alertdialog" ? "alertdialog" : undefined,
      desc: desc.slice(0, 400) || undefined,
    };
  }
  // A panel a button says it opened as a dialog, with no role of its own (weather.com's location picker).
  const panel = openedPanel(ctx);
  if (panel) {
    const sub = new Out();
    walk(panel, sub, { ...ctx, used: new WeakSet(), seen: new Set(), cards: undefined, portals: undefined, inArticle: true, inDialog: true, articleEl: null, count: 0 });
    const blocks = sub.done();
    if (blocks.length) return { key: "pop:" + refOf(panel), ref: refOf(panel), title: labelOf(panel.ownerDocument.querySelector("[aria-haspopup=dialog][aria-expanded=true]")!).slice(0, 80), blocks };
  }
  // Popups without ARIA roles that the user's last action opened; a notice with a button (Undo) is not one.
  const pop = findPopup(ctx);
  if (pop && pop.actionable && !actionToast(pop.el)) {
    // A list of plain rows under the field the user types in: one choice per row, which its click picks.
    const rows = plainSuggestions(pop.el);
    if (rows) {
      const actions = rows.map((r) => toAction(r, textIn(r).slice(0, 200)));
      return { key: "pop:" + refOf(pop.el), ref: refOf(pop.el), title: "", blocks: [{ t: "actions", key: "ps:" + refOf(pop.el), actions }], arrows: true };
    }
    const sub = new Out();
    // A shown modal marked aria-hidden (Infobae's sign-in) is still what the user opened.
    const shownHidden = pop.el.getAttribute("aria-hidden") === "true" || undefined;
    const pctx: Ctx = { ...ctx, used: new WeakSet(), seen: new Set(), cards: undefined, portals: undefined, inArticle: true, inDialog: true, articleEl: null, count: 0, cut: { noted: false }, shownHidden };
    walk(pop.el, sub, pctx);
    const blocks = cutNote(sub.done(), pctx);
    if (blocks.length) {
      const titleEl = pop.el.querySelector("h1,h2,h3,[role=heading]");
      // Its own close button, as for a dialog: closing it in Sift closes it on the page (Infobae's sign-in ignores Escape).
      const closeEl = Array.from(pop.el.querySelectorAll("button,[role=button]")).find((b) => visible(b) && /^(close|cerrar|dismiss|×|✕|x)$/i.test(accName(b)));
      return { key: "pop:" + refOf(pop.el), ref: refOf(pop.el), title: titleEl ? textIn(titleEl).slice(0, 120) : "", blocks, close: closeEl ? toAction(closeEl, accName(closeEl)) : undefined };
    }
  }
  // Open menus and listboxes (popups the user just opened through Sift).
  const menus = Array.from(document.querySelectorAll("[role=menu], [role=listbox]")).filter((m) => {
    if (!visible(m) || m.closest("sift-root")) return false;
    // The search box's own suggestions: a sheet over them would take the focus from typing.
    if (ctx.searchEl && suggestionsOf(ctx.searchEl, m)) return false;
    const pos = getComputedStyle(m).position;
    const host = m.closest("[style*=position]") ?? m;
    return pos === "absolute" || pos === "fixed" || getComputedStyle(host).position === "fixed";
  });
  const menu = menus[menus.length - 1] ?? opened[opened.length - 1];
  if (menu) {
    const all = Array.from(menu.querySelectorAll("[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],a[href],button")).filter(
      (o) => visible(o),
    );
    // An option that holds its own plain button (HN Search's sort list) is one choice: the option, which carries the state.
    const opts = all.filter((o) => !(o.matches("a[href], button") && !o.hasAttribute("role") && all.some((p) => p !== o && p.hasAttribute("role") && p.contains(o))));
    const actions = opts.map((o) => toAction(o)).filter((a) => a.label);
    for (const [i, o] of opts.entries()) {
      const sel = o.getAttribute("aria-checked") ?? o.getAttribute("aria-selected");
      if (actions[i] && (sel === "true" || sel === "false")) actions[i].pressed = sel === "true";
    }
    const by = openedBy.get(menu);
    const title = by && !menu.hasAttribute("aria-label") && !menu.hasAttribute("aria-labelledby") ? labelOf(by) : accName(menu);
    if (actions.length) return { key: "menu:" + refOf(menu), ref: refOf(menu), title: title.slice(0, 80), blocks: [{ t: "actions", key: "ma:" + refOf(menu), actions }] };
  }
  return undefined;
}

/**
 * What a marketing modal offers: a discount or savings for signing in, or the app.
 * "Save" counts only as money ("save money", "save 10%", "save up to"): "sign in to save your changes" stores work.
 */
const MARKETING =
  /\d+\s?%\s?(off|or more|discount)|\b(sign in|log in|sign up|register)\b.{0,80}\b(save (money|up to|[$£€\d])|(savings|discounts?|deals?|offers?|rewards?|prices?)\b)|\b(save (money|up to|[$£€\d])|(savings|discounts?|deals?|offers?|rewards?)\b).{0,80}\b(sign in|log in|sign up|register)\b|get the app|download (the|our) app|open (it )?in the app/i;
/** An account notice, never an offer: the session ended and the user must sign in again to keep working. */
const SESSION_NOTICE =
  /\bsession (has |was )?(expired|timed out|ended)|\b(signed|logged) (you )?out\b|\b(sign|log) ?in again\b|\bre-?(authenticate|login|log in|sign in)\b|sesi[oó]n (ha )?(expirado|caducado|vencido|finalizado)|(vuelve|volv[eé]) a iniciar sesi[oó]n|inici[aá] sesi[oó]n de nuevo/i;

/** A promo modal the page lets you close ("Dismiss sign-in info.", "No thanks", ×) with no field to fill in. */
function marketingModal(d: Element, text: string): boolean {
  if (d.querySelector("input:not([type=hidden]), textarea, select")) return false;
  const said = `${clean(d.getAttribute("aria-label"))} ${text.slice(0, 600)}`;
  if (SESSION_NOTICE.test(said)) return false;
  if (!MARKETING.test(said) && !promoText(said)) return false;
  return Array.from(d.querySelectorAll("button, [role=button]")).some((b) => visible(b) && /^(close|dismiss|cerrar|no,? thanks|no gracias|not now|ahora no|×|✕|x)(?=$|[\s.,:;!])/i.test(accName(b)));
}

/**
 * A node the user's last action touched opened this dialog: the dialog itself
 * or a part of it appeared or changed, or a wrapper not much bigger than it did.
 * A class switched on <body> or <html> (or an app root) holds every dialog and says nothing about one.
 */
function openedWith(n: Element, d: Element): boolean {
  if (n === d || d.contains(n)) return true;
  return n !== document.body && n !== document.documentElement && n.contains(d) && tlen(n) <= tlen(d) + 200;
}

/** Boxes that consent platforms put up, with or without a dialog role (OneTrust, Didomi, Quantcast, TrustArc). */
const CMP_SEL = "[id*=consent i], [class*=consent i], [id*=cookie i], [class*=cookie i], [id^=onetrust], [id^=didomi], [class*=qc-cmp], [id*=truste], [class*=truste]";
/** Sourcepoint's message box: only a frame (the Guardian's "It's your choice"). */
const CMP_FRAME_SEL = "[id^=sp_message_container]";
/** A consent box's words, or its frame's title when the words are inside the frame. */
const cmpText = (w: Element) => textIn(w) || Array.from(w.querySelectorAll("iframe")).map((f) => f.title).join(" ");

/**
 * The reader pressed Play on a video the page holds back until its consent wall is answered
 * (the Guardian's YouTube players behind Sourcepoint's wall, F826): Sift shows that wall then,
 * reject first, and says why. Never by itself: a page that reads without an answer needs none.
 */
let consentAsked = false;
/** What the reader did that the wall held back: Play, or any click (F1034). */
let consentWhy: "consentFirst" | "consentClick" = "consentFirst";
export function askConsent(on: boolean, why: "play" | "click" = "play") {
  consentAsked = on;
  consentWhy = why === "click" ? "consentClick" : "consentFirst";
}

/** A consent prompt over most of the window, which the page shows over its content (a cookie wall). */
export function consentWallUp(): Element | null {
  for (const w of Array.from(document.body.querySelectorAll(`${CMP_SEL}, ${CMP_FRAME_SEL}`))) {
    if (w.closest("sift-root") || getComputedStyle(w).position !== "fixed" || !visible(w)) continue;
    const r = w.getBoundingClientRect();
    if (r.width * r.height >= innerWidth * innerHeight * 0.5 && consentWall(w, cmpText(w))) return w;
  }
  return null;
}

const CONSENT_TEXT = /\bcookies?\b|consent|privacy|privacidad|personal data|datos personales|partners|socios|accept all|aceptar todo/i;
/** The choice that shares the least: reject, or necessary cookies only. */
const REJECT_LABEL =
  /^(reject|decline|refuse|deny|disagree)( all| cookies| all cookies| optional cookies| and close)?$|^(do not|don't) (accept|agree)$|^continue without (accepting|agreeing)\b|\b(necessary|essential|required|strictly necessary) (cookies )?only\b|\bonly (the )?(necessary|essential|required)( cookies)?\b|^rechazar( todo| todas| todas las cookies| cookies)?$|^no aceptar$|^continuar sin aceptar\b|\bsolo (las |cookies )?(necesarias|esenciales)\b/i;

/**
 * A consent prompt that walls the page off: about cookies or personal data,
 * and modal (it says so, it covers most of the window, or the page behind it
 * cannot scroll).
 */
function consentWall(d: Element, text: string): boolean {
  if (!CONSENT_TEXT.test(text.slice(0, 800))) return false;
  if (d.getAttribute("aria-modal") === "true" || (d.localName === "dialog" && d.matches(":modal"))) return true;
  for (let e: Element | null = d, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
    const r = e.getBoundingClientRect();
    if (r.width * r.height >= innerWidth * innerHeight * 0.5) return true;
  }
  const locked = (e: Element) => /hidden|clip/.test(getComputedStyle(e).overflowY);
  return locked(document.body) || locked(document.documentElement);
}

/** The reject or "necessary only" choice leads a consent prompt's buttons; accepting is never chosen for the user. */
function rejectFirst(blocks: Block[]) {
  for (const b of blocks) {
    if (b.t === "actions" || b.t === "form") {
      const no = b.actions.filter((a) => REJECT_LABEL.test(a.label.trim()));
      if (no.length) b.actions = [...no, ...b.actions.filter((a) => !no.includes(a))];
    } else if (b.t === "section" || b.t === "article") rejectFirst(b.blocks);
  }
}

const PERSON = /^(\p{Lu}[\p{L}'’.-]+)( (\p{Lu}[\p{L}'’.-]+|de|da|del|di|du|van|von|la|le|y|e)){1,3}$/u;

/**
 * The people a byline or contributor block names, each once. The first box
 * with a name is the byline; its own contributor boxes add the others (BBC:
 * contributor-0 "Ione Wells", contributor-1 "Hafsa Khalil"), never a role or a place.
 */
function bylineName(scope: ParentNode): string {
  const names: string[] = [];
  let root: Element | null = null;
  for (const box of Array.from(scope.querySelectorAll("[data-testid*=byline i], [data-testid*=contributor i], [class*=byline i], [class*=contributor i], [class*=author i]")).slice(0, 12)) {
    if (box.closest("blockquote, figure, [class*=comment i]")) continue;
    // "authority-control" (Wikipedia's library ids box) is not an author.
    if (!/byline|contributor|author(?!i[tsz])/i.test(`${box.getAttribute("data-testid") ?? ""} ${box.getAttribute("class") ?? ""}`)) continue;
    if (root && !root.contains(box)) break;
    if (root && /role|location|title|job|position|bio|desc/i.test(`${box.getAttribute("data-testid") ?? ""} ${box.getAttribute("class") ?? ""}`)) continue;
    const tw = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(), i = 0; n && i < 20; n = tw.nextNode(), i++) {
      const s = clean(n.nodeValue).replace(/^(by|por|de|von|par)\s+/i, "");
      if (s.length <= 40 && PERSON.test(s) && n.parentElement && visible(n.parentElement)) {
        if (!names.includes(s)) names.push(s);
        root ??= box;
        break;
      }
    }
  }
  return nameList(names);
}

/** Names joined as the page's language joins them ("Ione Wells and Hafsa Khalil"). */
function nameList(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  try {
    return new Intl.ListFormat(document.documentElement.lang || navigator.language, { type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

/**
 * The datePublished of the page's article in its JSON-LD (an Article, NewsArticle or BlogPosting). A plain
 * Article with no byline name counts only for a story: a wiki page's is the day it was created (Wikipedia, F942).
 */
function ldDate(named = true): string {
  const find = (o: unknown, d = 0): string => {
    if (!o || typeof o !== "object" || d > 4) return "";
    if (Array.isArray(o)) {
      for (const x of o) {
        const v = find(x, d + 1);
        if (v) return v;
      }
      return "";
    }
    const r = o as Record<string, unknown>;
    const type = String(r["@type"] ?? "");
    if ((named ? /(Article|BlogPosting)$/ : /(NewsArticle|BlogPosting)$/).test(type) && typeof r.datePublished === "string") {
      // Never a date the page does not show (GOV.UK's guides carry their 2012 first-publish date, F957):
      // the page shows this date, or shows none and this is a news story's or a post's own date.
      const seen = pageShowsDate(r.datePublished);
      return seen === "this" || (seen === "none" && /(NewsArticle|BlogPosting)$/.test(type)) ? r.datePublished : "";
    }
    return find(r["@graph"], d + 1);
  };
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 12)) {
    if (!/datePublished/.test(s.textContent ?? "")) continue;
    try {
      const v = find(JSON.parse(s.textContent ?? ""));
      if (v) return v;
    } catch {}
  }
  return "";
}

/**
 * Whether the page's text shows this date ("Oct 26, 2026", "26.10.2026", "2026-10-26"), some other year, or no year at all (outside its footer).
 * With `dayMonth`, a day and month shown without the year ("Oct 26", "26 de octubre") counts as this date too.
 */
function pageShowsDate(iso: string, dayMonth = false): "this" | "other" | "none" {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso);
  if (!m) return "other";
  const [, y, mo, dd] = m;
  const d = String(+dd);
  const mm = String(+mo);
  const re = new RegExp(`\\b0?${d}\\b\\D{0,20}${y}|\\b0?${d}\\D{1,3}0?${mm}\\D{1,3}${y}|${y}\\D{1,4}0?${mm}\\D{1,4}0?${d}(?!\\d)`);
  let dm: RegExp | null = null;
  if (dayMonth) {
    const names = new Set<string>();
    const at = new Date(+y, +mo - 1, +dd, 12);
    for (const l of [document.documentElement.lang || navigator.language, "en"]) {
      for (const month of ["long", "short"] as const) {
        try {
          const n = new Intl.DateTimeFormat(l, { month }).format(at).replace(/\.$/, "");
          if (/^\p{L}{3,}$/u.test(n)) names.add(n.toLowerCase());
        } catch {}
      }
    }
    if (names.size) {
      const ms = Array.from(names).join("|");
      dm = new RegExp(`\\b0?${d}\\.?\\s+(de\\s+)?(${ms})\\b|\\b(${ms})\\.?\\s+0?${d}\\b`, "iu");
    }
  }
  let other = false;
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const s = n.nodeValue ?? "";
    if (!/(19|20)\d\d/.test(s)) continue;
    const p = n.parentElement;
    if (!p || /^(script|style|noscript|template)$/.test(p.localName) || p.closest("footer, [role=contentinfo]")) continue;
    // A date split over spans ("<span>Oct 26</span>, <span>2026</span>") reads whole in its box.
    const box = p.parentElement && (p.parentElement.textContent?.length ?? 0) < 200 ? p.parentElement : p;
    if (re.test(s) || re.test(box.textContent ?? "")) return "this";
    if (/\b(19|20)\d\d\b/.test(s)) other = true;
  }
  if (dm) {
    const tw2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw2.nextNode(); n; n = tw2.nextNode()) {
      const p = n.parentElement;
      if (!p || /^(script|style|noscript|template)$/.test(p.localName) || p.closest("footer, [role=contentinfo]")) continue;
      if (dm.test(n.nodeValue ?? "")) return "this";
    }
  }
  return other ? "other" : "none";
}

/** "By Name · 24 Oct 2026" for articles, from page metadata and the visible byline. */
export function byline(articleEl: Element | null, h1: Element | null = null): string {
  const meta = (sel: string) => clean(document.querySelector(sel)?.getAttribute("content"));
  let author = meta('meta[name="author"]') || meta('meta[property="article:author"]');
  if (/^https?:/.test(author)) author = "";
  if (!author) {
    let scope: Element | Document = articleEl?.parentElement?.parentElement ?? document;
    // The title and its byline in a box beside the text's (TOI: div.inl71 beside div.bBzri, F832).
    for (let i = 0; h1 && scope instanceof Element && !scope.contains(h1) && scope.parentElement && scope.parentElement !== document.body && i < 6; i++) scope = scope.parentElement;
    const sel =
      '[rel=author], .byline a[href*="autor"], .byline a[href*="author"], a.author, .author-name, [itemprop=author] [itemprop=name], [data-testid*=byline] [data-testid*=name], [data-component=byline-block] span, .byline__name, .author__name';
    const a = scope.querySelector(sel);
    if (a) author = textIn(a);
    // Every author once: the others the same byline links ("Tom Phillips in São Paulo and Tiago Rogero in Brasília").
    if (a && author && a.matches("[rel=author], a")) {
      const box = a.closest("address, [class*=byline i], [data-gu-name=byline], [data-component*=byline i], [data-testid*=byline i]");
      const more = box ? Array.from(box.querySelectorAll(sel)).filter((x) => x.localName === a.localName && x.getAttribute("rel") === a.getAttribute("rel")).map((x) => textIn(x)) : [];
      if (more.length > 1 && more.length <= 6) author = nameList(more.filter((n, i) => n && more.indexOf(n) === i));
    }
    // A byline block that names its contributor in plain text ("James Waterhouse" over "Paris Correspondent").
    if (!author) author = bylineName(scope);
    // A link to the author's page by the title, with no byline class (The Independent: address > a[href^="/author/"]).
    if (!author) {
      // Before the story's second paragraph (a standfirst may come first).
      const first = articleEl ? Array.from(articleEl.querySelectorAll("p")).filter((p) => tlen(p) > 80)[1] : null;
      // The story's header may sit outside the text's box, in the same <article> or <main>.
      const wide = articleEl?.closest("article, main, [role=main]") ?? scope;
      const h1 = wide.querySelector("h1");
      for (const l of Array.from(wide.querySelectorAll('a[href*="/author/"], a[href*="/authors/"], a[href*="/autor/"], a[href*="/autores/"]')).slice(0, 20)) {
        const s = textIn(l).replace(/^(by|por|de|von|par)\s+/i, "");
        if (first && !(l.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
        if (h1 && !(h1.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (s.length <= 40 && PERSON.test(s) && visible(l) && !l.closest("blockquote, figure, nav, aside, [class*=comment i]")) {
          author = s;
          break;
        }
      }
    }
  }
  let when = meta('meta[property="article:published_time"]') || meta('meta[name="date"]') || meta('meta[itemprop="datePublished"]');
  // Never a date the page does not show (F1047): a service page's 2021 first-publish date in its meta tags, on a page updated since.
  if (when && pageShowsDate(when, true) !== "this") when = "";
  if (!when) {
    const tEl = (articleEl ?? document).querySelector("time[datetime]") ?? document.querySelector("header time[datetime], article time[datetime]");
    when = tEl?.getAttribute("datetime") ?? "";
  }
  // The story's own structured data (TOI has no meta date and no <time>, F832).
  if (!when) when = ldDate(!!author);
  let date = "";
  if (when) {
    const d = new Date(when);
    if (!isNaN(+d)) {
      const l = document.documentElement.lang || navigator.language;
      try {
        date = new Intl.DateTimeFormat(l, { dateStyle: "medium", timeStyle: Date.now() - +d < 2 * 864e5 ? "short" : undefined }).format(d);
      } catch {
        date = d.toDateString();
      }
    }
  }
  return [author.slice(0, 80), date].filter(Boolean).join(" · ");
}

/**
 * A page modal that blocks the page: a modal <dialog>, or a layer over most of the window
 * that holds it or lies under it (a backdrop). aria-modal alone does not: a sign-up nag
 * with the page usable around it can be ignored on the original, so Sift offers Close.
 */
function blocksPage(d: Element): boolean {
  if (d.localName === "dialog" && d.matches(":modal")) return true;
  const covers = (e: Element) => {
    const cs = getComputedStyle(e);
    if (cs.position !== "fixed" || cs.pointerEvents === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width * r.height >= innerWidth * innerHeight * 0.85;
  };
  for (let e: Element | null = d, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
    if (covers(e)) return true;
    // An empty layer beside it over the whole window: its backdrop.
    const sibs = e.parentElement ? Array.from(e.parentElement.children) : [];
    if (sibs.length <= 200 && sibs.some((s) => s !== e && covers(s) && tlen(s) < 2 && visible(s) && !s.querySelector("main, [role=main], h1, img, video"))) return true;
  }
  return false;
}

const LIVE_SEL = "[role=status], [role=alert], [aria-live=polite], [aria-live=assertive]";
/** A focusable span or div that acts as a link (Gmail's toast "Undo"): an action, like a button. Kept in step in findPopup and toastButtons. */
const FOCUS_LINK = "[role=link][tabindex]:not([tabindex^='-'])";

/** The buttons of a notice the page shows without blocking it (a toast's Undo): a small live region with one or two of them. */
function toastButtons(el: Element): Element[] | null {
  if (el.matches(DIALOG_SEL) || el.closest(DIALOG_SEL) || el.querySelector("input, select, textarea, [contenteditable]")) return null;
  const live = el.matches(LIVE_SEL) || !!el.querySelector(LIVE_SEL) || (() => {
    const l = el.parentElement?.closest(LIVE_SEL);
    return !!l && tlen(l) <= 300;
  })();
  if (!live || tlen(el) > 300) return null;
  const btns = Array.from(el.querySelectorAll(`button, [role=button], a[href], ${FOCUS_LINK}`)).filter((b) => visible(b));
  return btns.length >= 1 && btns.length <= 2 ? btns : null;
}
const actionToast = (el: Element) => !!toastButtons(el);

/**
 * Popups to announce rather than show as a dialog: text-only toasts ("Saved"),
 * and notices with a button or two (a toast's Undo), whose buttons Sift shows
 * with the notice. `said` is all of it, as the page's live region says it.
 */
export function findToast(): { text: string; said: string; actions: Action[]; ref: string } | null {
  // A second look without the page's context (no search box): what it finds must not become
  // the popup being filled in (Google Maps' search panel, which holds the search box).
  const keep = lastPop;
  const held = heldPop;
  const pop = findPopup(newCtx());
  lastPop = keep;
  heldPop = held;
  if (!pop) return null;
  // A part of a page modal dialog (MDN's compat settings, in shadow roots): the user answers it directly, on top of Sift.
  for (let n: Element | null = pop.el; n; n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)) if (n.matches(":modal")) return null;
  const said = textIn(pop.el).slice(0, 200);
  const ref = refOf(pop.el);
  if (!pop.actionable) return said ? { text: said, said, actions: [], ref } : null;
  const btns = toastButtons(pop.el);
  if (!btns) return null;
  let text = said;
  for (const b of btns) text = text.replace(textIn(b), " ");
  return { text: clean(text) || said, said, actions: btns.map((b) => toAction(b)), ref };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The page's og:title, unless an app went to another page in place and left the first page's
 * (GitHub's repo title on a folder page): its og:url still names another address.
 */
function ogTitle(): string {
  const og = clean(document.querySelector('meta[property="og:title"]')?.getAttribute("content"));
  const ou = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
  if (!og || !ou) return og;
  try {
    const path = (u: string) => new URL(u, location.href).pathname.replace(/\/+$/, "");
    const first = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.name;
    if (first && path(first) !== path(location.href) && path(ou) !== path(location.href)) return "";
  } catch {
    /* not an address */
  }
  return og;
}

/** The page's <title> without the site name ("Story | Site" reads "Story"). */
function docTitle(site: string): string {
  const og = ogTitle();
  const dt = clean(document.title);
  // An app that keeps a generic og:title ("Google Maps") while its <title> names the place open now.
  const raw = og && !(dt.length > og.length && dt.includes(og)) ? og : dt || og;
  const parts = raw.split(/\s+[|\-–—·•]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return raw;
  const s = norm(site).replace(/\s(com|org|net|ar|co|uk)$/g, "");
  // The site's words in any order ("Debian Wiki" on wiki.debian.org, F1046).
  const sw = new Set(s.split(" "));
  // The last part that names the host is the site's tagline ("Pan - Wikipedia, la enciclopedia libre"
  // on es.wikipedia.org, "Pão – Wikipédia, a enciclopédia livre"), not the article (F1072).
  const host = location.hostname.split(".").filter((l) => l.length >= 4 && !/^(www\d?|com|org|net|info)$/.test(l)).pop() ?? "";
  const fold = (p: string) => norm(p).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const kept = parts.filter((p, i) => {
    const n = norm(p);
    if (host && i === parts.length - 1 && fold(p).split(" ").includes(host)) return false;
    return !(s && (n === s || s.includes(n) || n.includes(s) || n.split(" ").every((w) => sw.has(w))));
  });
  const pool = kept.length ? kept : parts;
  return pool.slice().sort((a, b) => b.length - a.length)[0];
}

/**
 * The page's own title: the visible h1 that best matches the page title, not a
 * headline inside a story card or a heading inside an answer or comment.
 */
export function titleH1(articleEl: Element | null = null): Element | null {
  const dt = docTitle(siteName());
  // A short h1 counts when it is the <title>'s article part ("Pan", "Pão": F1072); else it is a logo or a mark.
  const named = (h: Element) => textIn(h).length > 3 || (textIn(h).length > 0 && norm(textIn(h)) === norm(dt));
  const h1s = Array.from(document.querySelectorAll("h1")).filter((h) => visible(h) && named(h) && !h.closest("sift-root") && !inSweepstakes(h));
  if (!h1s.length) return null;
  const ref = new Set(norm(dt).split(" ").filter((w) => w.length > 2));
  let best: Element | null = null;
  let bestScore = 0;
  for (const h of h1s) {
    // A headline that links to another page is a story card, not this page's title.
    const a = h.closest("a[href]") ?? h.querySelector("a[href]");
    if (a && !inPage(a) && (a as HTMLAnchorElement).href.split("#")[0] !== location.href.split("#")[0]) continue;
    const words = norm(textIn(h)).split(" ").filter((w) => w.length > 2);
    if (!words.length) continue;
    // Headlines and their short <title> versions share most of the shorter one's words.
    const hits = words.filter((w) => ref.has(w)).length;
    const hit = hits / Math.max(1, Math.min(words.length, ref.size));
    if (hit > bestScore) {
      bestScore = hit;
      best = h;
    }
  }
  if (best && bestScore >= 0.5) return best;
  // Near ancestors only: a page-level class like "comments_on" on <html> says nothing about one heading.
  const inPost = (h: Element) => {
    for (let a: Element | null = h, i = 0; a && a !== document.body && i < 10; a = a.parentElement, i++) if (/answer|comment/i.test(tokens(a))) return true;
    return false;
  };
  const plain = h1s.filter((h) => !h.closest("a[href]") && !inPost(h));
  // No good match: the h1 that names the page's address ("SourcesList" on wiki.debian.org/SourcesList), never a later section's (F1046).
  let seg = "";
  try {
    seg = norm(decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_+]+/g, " "));
  } catch {}
  const bySeg = seg.length > 2 ? plain.find((h) => norm(textIn(h)) === seg) : undefined;
  if (bySeg) return bySeg;
  // On an article page, the last h1 before (or inside) its body;
  // otherwise the first plain h1.
  if (articleEl) {
    let last: Element | null = null;
    for (const h of plain) if (h.compareDocumentPosition(articleEl) & Node.DOCUMENT_POSITION_FOLLOWING || articleEl.contains(h)) last = h;
    if (last) return last;
  }
  // Several alike, none naming the page (Google Maps' route choices): they head its entries, and the page is its <title>.
  // The first has a twin: it heads one entry, not the page (a transit route's h1 beside them differs:
  // Google Maps' "Best travel modes"). Classes compare as sets: one may end with a space.
  const cls = (e: Element | null) => (e?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).sort().join(" ");
  const alike = (h: Element) => !!cls(h) && cls(h) === cls(plain[0]) && cls(h.parentElement) === cls(plain[0].parentElement);
  if (plain.length > 1 && plain.slice(1).some(alike)) return null;
  return plain[0] ?? null;
}

export function pageTitle(): string {
  const h1 = titleH1();
  if (h1) return headingText(h1).slice(0, 200);
  const site = siteName();
  if (location.pathname === "/" || location.pathname === "") return site;
  return docTitle(site).slice(0, 200);
}

export function siteName(): string {
  // On the home page a short plain <title> ("Hacker News") is the site's name.
  const home = location.pathname === "/" || location.pathname === "";
  const dt = clean(document.title);
  return (
    clean(document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")) ||
    clean(document.querySelector('meta[name="application-name"]')?.getAttribute("content")) ||
    (home && dt.length >= 2 && dt.length <= 40 && !/\s[|\-–—·•:]\s/.test(dt) ? dt : "") ||
    homeLinkName() ||
    location.hostname.replace(/^www\./, "")
  );
}

/** The words of the link to the site's home page ("Hacker News" on every page of the site), if it has words. */
function homeLinkName(): string {
  const links = Array.from(document.querySelectorAll('a[href="/"], a[href="./"], a[href="news"], a[href="index.html"]')).slice(0, 6);
  for (const a of links) {
    const t = textIn(a);
    if (t.length >= 2 && t.length <= 30 && !/^(home|inicio|start|accueil|startseite|top|news)$/i.test(t) && !a.closest("footer, article")) return t;
  }
  return "";
}

/** Every visible main region, outermost only, in page order. */
function visibleMains(): Element[] {
  // [data-sift-role=main]: Sift's shield demotes a role=main that holds a portal (shield.ts); it is still the main region.
  const all = Array.from(document.querySelectorAll("main, [role=main], [data-sift-role=main]")).filter((m) => visible(m) && !m.closest("sift-root"));
  return all.filter((m) => !all.some((o) => o !== m && o.contains(m)));
}

/**
 * Of several main regions open side by side (Google Maps' results and the
 * place one of them opened), the one the page is about: the one the page
 * title names, else the first.
 */
function primaryMain(mains: Element[]): Element {
  if (mains.length < 2) return mains[0];
  const title = norm(document.title);
  let best = mains[0];
  let bestLen = 0;
  for (const m of mains) {
    const h1 = m.querySelector("h1");
    const n = norm(clean(m.getAttribute("aria-label")) || (h1 ? textIn(h1) : ""));
    if (n.length >= 3 && n.length > bestLen && (" " + title + " ").includes(" " + n + " ")) {
      best = m;
      bestLen = n.length;
    }
  }
  return best;
}

export function mainRoot(ctx: Ctx | null = null): Element {
  const body = document.body;
  const mains = visibleMains();
  if (!mains.length) return body;
  const main = primaryMain(mains);
  const all = tlen(body) || 1;
  const mt = mains.reduce((n, m) => n + tlen(m), 0);
  if (mt > all * 0.25 || main.querySelector("video, article, h1")) return main;
  // An app's side panel with its fields drawn over it (Google Maps' directions) is the page, not the rail beside it.
  if (mainCompanions(main, ctx).length) return main;
  return body;
}

/** A button that filters or sorts a list of results ("All filters", "Sort by"). */
const FILTER_LABEL = /^((all |more )?filters?|sort( by)?|(todos los )?filtros|m[aá]s filtros|ordenar( por)?)$/i;

/**
 * Parts of an app drawn over its main region but kept outside it in the DOM:
 * Google Maps' directions header (start and destination fields, travel modes)
 * over its side panel, and the filter chips over the map for its results.
 * Each is a positioned box outside every landmark that holds a field over the
 * main region's column, or a filter button beside it.
 */
function mainCompanions(main: Element, ctx: Ctx | null): Element[] {
  const mr = main.getBoundingClientRect();
  if (mr.width < 100 || mr.height < 100) return [];
  const out: Element[] = [];
  // Text fields and ARIA mode switches; checkboxes alone (a cookie banner's choices) bring no panel along.
  const cands = document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]), select, textarea, [role=radio], [role=combobox], button");
  for (let i = 0; i < cands.length && i < 3000; i++) {
    const c = cands[i];
    if (main.contains(c) || ctx?.used.has(c) || out.some((o) => o.contains(c))) continue;
    const field = c.localName !== "button";
    if (!field && !FILTER_LABEL.test(textIn(c) || clean(c.getAttribute("aria-label")))) continue;
    if (c.closest("sift-root, header, nav, footer, aside, form[role=search], [role=search], [role=banner], [role=navigation], [role=contentinfo], [role=complementary], dialog, [role=dialog], [aria-modal=true]") || !visible(c)) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || r.bottom < mr.top - 120 || r.top > mr.bottom) continue;
    const x = r.left + r.width / 2;
    if (field && (x < mr.left || x > mr.right)) continue;
    // The largest part around it that does not hold the main region, drawn over the page.
    let top: Element = c;
    let positioned = false;
    while (top.parentElement && top.parentElement !== document.body && !top.parentElement.contains(main)) {
      top = top.parentElement;
      if (!positioned && /absolute|fixed/.test(getComputedStyle(top).position)) positioned = true;
    }
    if (!positioned || !top.parentElement || top.parentElement === document.body || tlen(top) > 2000 || out.includes(top)) continue;
    // The site's search box went to Sift's top bar; its panel is not part of the page.
    if (ctx?.searchEl && top.contains(ctx.searchEl) && field) continue;
    out.push(top);
  }
  return out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * What is read with the main region: panels drawn over it (before it), and
 * other main regions open beside it (after it).
 */
function besideMain(root: Element, ctx: Ctx): { before: Element[]; after: Element[] } {
  if (root === document.body) return { before: [], after: [] };
  const before = mainCompanions(root, ctx);
  const after = visibleMains().filter((m) => m !== root && !m.contains(root) && !root.contains(m));
  // A sign-in box's own notes after its <main> (La Nación's "Buscar con DNI" and terms notice, beside
  // Auth0's widget) are part of it, up to the site's footer (F650).
  if (root.querySelector("input[type=password], input[type=email], input[autocomplete~=username]")) {
    const notes: Element[] = [];
    let n: Element = root;
    scan: for (let i = 0; i < 3 && n.parentElement && n.parentElement !== document.body; i++, n = n.parentElement) {
      for (let s = n.nextElementSibling; s; s = s.nextElementSibling) {
        if (s.matches("footer, header, nav, aside, [role=contentinfo], [role=banner], [role=navigation], [role=complementary]") || CHROME_TOKEN.test(tokens(s))) break scan;
        if (visible(s) && tlen(s) >= 2 && tlen(s) <= 600 && !after.some((m) => m.contains(s) || s.contains(m))) notes.push(s);
      }
    }
    after.unshift(...notes);
  }
  // A checkout's order summary beside the main region (its items and total) is read after it.
  for (const a of Array.from(document.querySelectorAll("aside, [role=complementary]"))) {
    if (root.contains(a) || a.contains(root) || after.some((m) => m.contains(a)) || a.closest("sift-root, header, footer, nav, [role=banner], [role=contentinfo], [role=navigation]")) continue;
    if (visible(a) && !NOISE_TOKEN.test(tokens(a)) && orderSummary(a)) after.push(a);
  }
  // So is a bar pinned to the window with the total and the pay button (a basket's "Go to payment").
  for (const b of payBarsOutside(root)) if (!after.some((m) => m.contains(b))) after.push(b);
  return { before, after };
}

/**
 * The bar took a lookup box from the page's content (weather.gov's location form): what is left of its
 * box (a help link, "Your local forecast office is …") and the small boxes of links on its row (a news
 * ticker) are the site's tools, not the page's data, so they are read after it (F636).
 */
function lookupLeftovers(root: Element, ctx: Ctx): Element[] {
  const form = ctx.searchEl?.closest("form");
  // A form in a table's cell (Hacker News' footer row on a short item page) stays with its table, which reads it in place.
  if (!form || !root.contains(form) || form === root || form.closest("header, nav, [role=banner], [role=navigation], [role=search], td, th")) return [];
  const fields = (e: Element) => Array.from(e.querySelectorAll("input:not([type=hidden]), select, textarea")).filter((f) => visible(f) && f.getAttribute("type") !== "submit" && f.getAttribute("type") !== "button");
  let box: Element = form;
  while (box.parentElement && box.parentElement !== root && tlen(box.parentElement) <= 300 && fields(box.parentElement).length === 1) box = box.parentElement;
  const top = box.getBoundingClientRect().top;
  if (!box.parentElement || fields(box).length !== 1 || top + scrollY > 400 || (ctx.titleEl && box.contains(ctx.titleEl))) return [];
  const out = tlen(box) > 0 ? [box] : [];
  for (const s of Array.from(box.parentElement.children)) {
    if (s === box || !visible(s) || SKIP.has(s.localName) || Math.abs(s.getBoundingClientRect().top - top) > 40) continue;
    const n = tlen(s);
    const linked = Array.from(s.querySelectorAll("a[href]")).reduce((m, a) => m + textIn(a).length, 0);
    if (n && n <= 300 && linked && textIn(s).length - linked <= 30 && !fields(s).length && !s.querySelector("h1") && !(ctx.titleEl && s.contains(ctx.titleEl))) out.push(s);
  }
  return out;
}

function ancestorsOf(el: Element): Element[] {
  const out: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) out.push(n);
  return out;
}

/**
 * For an article page, the smallest element holding both its title and body.
 * Everything outside it (site nav, rails, promos) is dropped.
 */
function articleScope(root: Element, articleEl: Element, h1: Element | null): Element {
  if (!h1) return root;
  const mine = new Set(ancestorsOf(articleEl));
  let lca: Element | null = h1;
  while (lca && !mine.has(lca)) lca = lca.parentElement;
  if (!lca || lca === document.body || lca === document.documentElement || !root.contains(lca)) return root;
  // Only rails and furniture are left out: a part beside the story with something
  // to fill in, or a section of its own text (a recipe's method, a pricing table,
  // the ticket form beside an event), keeps the scope that wide.
  let scope: Element = lca;
  for (let a: Element = lca; a !== root && a.parentElement; a = a.parentElement) {
    const p: Element = a.parentElement;
    if (Array.from(p.children).some((c) => c !== a && contentBeside(c))) scope = p;
    if (p === root) break;
  }
  return scope;
}

/** A part beside the story that is content, not a rail: a form to fill in, or a headed section of its own text. */
function contentBeside(c: Element): boolean {
  if (SKIP.has(c.localName) || /^(nav|aside|footer|header)$/.test(c.localName) || /^(navigation|complementary|contentinfo|banner|search)$/.test(c.getAttribute("role") ?? "")) return false;
  const len = tlen(c);
  if (len < 40 || !visible(c) || isAd(c)) return false;
  const tk = tokens(c);
  if (NOISE_TOKEN.test(tk) || CHROME_TOKEN.test(tk) || COMMENTS_TOKEN.test(tk)) return false;
  const links = Array.from(c.querySelectorAll("a")).reduce((n, a) => n + tlen(a), 0);
  if (links > len * 0.5) return false;
  const head = textPrefix(c, 400);
  if (NOISE_TEXT.test(head) || promoText(head)) return false;
  const fields = Array.from(c.querySelectorAll("input:not([type=hidden]):not([type=search]), select, textarea")).some((f) => visible(f) && !f.matches(SEARCH_SEL) && !/mail/i.test(`${f.getAttribute("type") ?? ""} ${f.getAttribute("name") ?? ""}`));
  return fields || (!!c.querySelector("h2, h3") && len - links >= 80) || len - links >= 300;
}

/** Big video players sitting just before the article scope (lead videos). */
function leadMedia(root: Element, scope: Element, ctx: Ctx): Block[] {
  if (scope === root) return [];
  const out: Block[] = [];
  for (const m of Array.from(root.querySelectorAll("video, iframe"))) {
    if (scope.contains(m) || !(m.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (!visible(m) || isAd(m) || m.closest(".video-ads-container, [class*=ad-container]")) continue;
    const r = m.getBoundingClientRect();
    if (r.width < 300 || r.height < 160) continue;
    const b = portalBlock(m, ctx);
    if (b) out.push(b);
    if (out.length >= 1) break;
  }
  return out;
}

/** Maps and app surfaces outside the part of the page Sift walked (Google Maps' map beside its panel). */
function outsideSurfaces(scope: Element, ctx: Ctx): Block[] {
  const out: Block[] = [];
  const taken: Element[] = [];
  for (const el of Array.from(document.querySelectorAll(SURFACE_SEL))) {
    if (scope.contains(el) || el.contains(scope) || el.closest("sift-root") || !visible(el) || isAd(el) || !surfaceOnly(el)) continue;
    // A "find our store" map in the footer or a rail is not the page's tool.
    if (el.closest("footer, aside, [role=contentinfo], [role=complementary]")) continue;
    if (taken.some((t2) => t2.contains(el) || el.contains(t2))) continue;
    const b = surfaceBlock(el, "", ctx);
    if (!b) continue;
    const f = uncoveredFocus(el, scope);
    if (f && b.t === "portal") b.focus = f;
    out.push(b);
    const c = overlayControls(el, ctx);
    if (c) out.push(c);
    taken.push(el);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * A surface laid out under the page's own panel (Google Maps' map under its
 * side panel): the page fits routes and results to the part the panel leaves
 * uncovered. Its middle, as fractions of the surface's size; Sift's box
 * centers there.
 */
function uncoveredFocus(el: Element, scope: Element): [number, number] | undefined {
  // A surface Sift already lifts into its view has moved; its parent still holds the original place.
  const s = (el.hasAttribute("data-sift-portal") && el.parentElement ? el.parentElement : el).getBoundingClientRect();
  const area = s.width * s.height;
  const over = (r: DOMRect) => Math.max(0, Math.min(r.right, s.right) - Math.max(r.left, s.left)) * Math.max(0, Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top));
  // The panel: the biggest box around the walked part that is not the surface's container
  // (with a place opened beside the results, the box that holds both: Google Maps).
  let p: DOMRect | null = null;
  for (let a: Element | null = scope; a && !a.contains(el); a = a.parentElement) {
    const r = a.getBoundingClientRect();
    if (over(r) < area * 0.8 && (!p || over(r) > over(p))) p = r;
  }
  if (!p || over(p) < area * 0.1) return undefined;
  // The biggest strip of the surface beside the panel.
  let best = 0;
  let f: [number, number] | undefined;
  for (const [l, t, r, b] of [
    [s.left, s.top, p.left, s.bottom],
    [p.right, s.top, s.right, s.bottom],
    [s.left, s.top, s.right, p.top],
    [s.left, p.bottom, s.right, s.bottom],
  ]) {
    const a = Math.max(0, r - l) * Math.max(0, b - t);
    if (a <= best) continue;
    best = a;
    f = [Math.round(((l + r) / 2 - s.left) / s.width * 100) / 100, Math.round(((t + b) / 2 - s.top) / s.height * 100) / 100];
  }
  return f;
}

/** What map controls say: zoom, my location, layers, Street View, compass, full screen. */
const MAP_CONTROL =
  /zoom|location|layers?|street ?view|compass|north|bearing|rotate|tilt|full ?screen|map type|satellite|terrain|globe|pegman|my position|ubicaci[oó]n|acercar|alejar|capas|pantalla completa/i;

/**
 * Buttons drawn over a map but outside its element (zoom, my location,
 * layers), offered next to it so people without a scroll wheel can use them.
 */
function overlayControls(el: Element, ctx: Ctx): Block | null {
  // A surface Sift already lifts into its view has moved; its parent still holds the original place.
  const r = (el.hasAttribute("data-sift-portal") && el.parentElement ? el.parentElement : el).getBoundingClientRect();
  const acts: Action[] = [];
  for (const b of Array.from(document.querySelectorAll("button, [role=button]"))) {
    if (el.contains(b) || ctx.used.has(b) || b.closest("sift-root")) continue;
    const br = b.getBoundingClientRect();
    const x = br.left + br.width / 2;
    const y = br.top + br.height / 2;
    if (!br.width || x < r.left || x > r.right || y < r.top || y > r.bottom || br.width * br.height > r.width * r.height * 0.05) continue;
    if (!visible(b)) continue;
    // Map controls sit in small clusters; a button inside a panel of text is that panel's.
    let cluster = true;
    for (let a = b.parentElement, i = 0; a && i < 4; a = a.parentElement, i++) if (tlen(a) > 150) cluster = false;
    if (!cluster) continue;
    const label = labelOf(b);
    if (!label || label.length > 40 || !MAP_CONTROL.test(label) || !usefulControl(b, label)) continue;
    if (acts.some((a) => a.label === label)) continue;
    ctx.used.add(b);
    acts.push(toAction(b, label));
    if (acts.length >= 12) break;
  }
  return acts.length ? { t: "actions", key: "sc:" + refOf(el), actions: acts } : null;
}

function hasRichBlocks(blocks: Block[]): boolean {
  return blocks.some((b) => b.t === "items" || b.t === "table" || b.t === "form" || b.t === "portal" || b.t === "facts" || ((b.t === "section" || b.t === "article") && hasRichBlocks(b.blocks)));
}

/**
 * The story's own copy of the page title (an h1 repeated as an h2 inside it)
 * is said once: Sift shows the title itself, or keeps the first h1 block.
 */
function dropTitleRepeat(blocks: Block[], title: string) {
  const n = norm(title);
  if (!n) return;
  // The UI shows the title unless one of the first top-level blocks is that h1.
  const top = blocks.slice(0, 6).find((b) => b.t === "h" && b.level === 1 && b.text === title);
  const walkB = (bs: Block[]) => {
    for (let i = 0; i < bs.length && i < 12; i++) {
      const b = bs[i];
      if (b.t === "h" && b !== top && norm(b.text) === n) {
        bs.splice(i, 1);
        i--;
      } else if (b.t === "article") walkB(b.blocks);
    }
  };
  walkB(blocks);
}

/**
 * The section link over a story's title ("Mundo" above the headline): the
 * story's own section, which the site menu has. Only a lone link to a parent
 * of this page's address.
 */
function dropKicker(blocks: Block[]) {
  const h = blocks.findIndex((b) => b.t === "h" && b.level === 1);
  const at = h > 0 ? h - 1 : h < 0 && blocks[1]?.t === "article" ? 0 : -1;
  const b = blocks[at];
  if (!b || b.t !== "ul" || b.items.length !== 1 || b.items[0].length !== 1) return;
  const x = b.items[0][0];
  if (typeof x !== "object" || !("a" in x) || !x.href || x.a.length > 30) return;
  try {
    const u = new URL(x.href, document.baseURI);
    const path = u.pathname.replace(/\/+$/, "");
    if (u.host === location.host && path.length > 1 && location.pathname.startsWith(path + "/") && location.pathname.length > path.length + 1) blocks.splice(at, 1);
  } catch {
    // Not a URL.
  }
}

/**
 * A heading with nothing under it (its list was dropped as noise): "Más enlaces"
 * over nothing. Decided from the blocks as the walk made them, so one removal
 * never empties the heading before it. Headings that are themselves the content
 * (a name over a role, a run of times in a schedule) stay: the page shows nothing
 * under them either.
 */
function dropEmptyHeadings(bs: Block[]) {
  const orig = bs.slice();
  for (let i = orig.length - 1; i >= 0; i--) {
    const b = orig[i];
    if (b.t === "article" || b.t === "section") dropEmptyHeadings(b.blocks);
    if (b.t !== "h" || b.level === 1) continue;
    const next = orig[i + 1];
    const prev = orig[i - 1];
    // A section's label over its stories' linked headlines of the same rank (La Nación's "Selección del Editor"
    // over "A Fondo ¿Dónde está Nanci?…") names their section: the headlines go one rank down (F76).
    if (!b.href && b.level < 6 && next?.t === "h" && next.level === b.level && next.href) {
      const sec = b.key.startsWith("h:") ? elOf(b.key.slice(2))?.closest("section") : null;
      for (let j = i + 1; sec && j < orig.length; j++) {
        const o = orig[j];
        const oe = elOf(o.key.slice(o.key.indexOf(":") + 1));
        if (!oe || !sec.contains(oe) || (o.t === "h" && o.level <= b.level && !o.href)) break;
        if (o.t === "h" && o.level === b.level) o.level = b.level + 1;
      }
      if (next.level > b.level) continue;
    }
    // Something under it: text, a list, or a deeper heading.
    if (next && !(next.t === "h" && next.level <= b.level)) continue;
    // A heading that shows only a logo (La Nación's "Ln Juegos" over a module that shows nothing) names nothing here.
    const el = b.key.startsWith("h:") ? elOf(b.key.slice(2)) : null;
    if (next && el && !textIn(el) && el.querySelector("img")) {
      bs.splice(bs.indexOf(b), 1);
      continue;
    }
    if (b.href) continue;
    const dropped = droppedUnder(b);
    // Before another heading of its rank, it is empty only when the page shows something under it that Sift left out,
    // or its section holds nothing else (a rail still loading); at the end, also when it follows text rather than a heading.
    if (dropped || (!next && prev?.t !== "h")) bs.splice(bs.indexOf(b), 1);
  }
}

/**
 * The page shows text under a heading block, before the next heading, that the
 * walk left out; or the heading is all its section holds.
 */
function droppedUnder(b: Extract<Block, { t: "h" }>): boolean {
  const h = b.key.startsWith("h:") ? elOf(b.key.slice(2)) : null;
  if (!h) return false;
  const sec = h.parentElement?.closest("section, article, aside");
  if (sec && textIn(sec).length <= textIn(h).length + 5 && !sec.querySelector("img, picture, video, iframe, canvas, input, select, textarea")) return true;
  const scope = h.parentElement?.closest("article, main, [role=main], section, body") ?? document.body;
  let last: Node = h;
  while (last.lastChild) last = last.lastChild;
  const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  tw.currentNode = last;
  let n = 0;
  for (let t = tw.nextNode(), i = 0; t && i < 400; t = tw.nextNode(), i++) {
    const p = t.parentElement;
    if (!p) continue;
    if (p.closest(HEADING_SEL)) return false;
    if (SKIP.has(p.localName) || !visible(p)) continue;
    n += clean(t.nodeValue).length;
    if (n >= 20) return true;
  }
  return false;
}

/**
 * A file view (GitHub's blob): the controls and facts stacked between the file's
 * title and its code (copy path, last commit, history, raw, download) fold into
 * one closed section, so the code starts on the first screen.
 */
function foldFileTools(blocks: Block[]) {
  const i = blocks.findIndex((b) => b.t === "pre" && b.text.split("\n").length >= 40);
  if (i < 0) return;
  const small = (b: Block) =>
    b.t === "actions" ||
    (b.t === "ul" && b.items.length <= 3 && b.items.every((it) => it.length === 1 && typeof it[0] === "object" && "a" in it[0])) ||
    (b.t === "p" && textOf(b.content).length <= 80);
  let j = i;
  while (j > 0 && small(blocks[j - 1])) j--;
  const h = blocks[j - 1];
  if (i - j < 5 || !h || h.t !== "h" || h.level !== 1) return;
  const run = blocks.slice(j, i);
  // Only a file view's toolbar: a row of controls or links, or a commit, size or line count. A how-to's short
  // steps before its script ("First, log in as root.") stay in the open.
  const ps = run.filter((b) => b.t === "p").map((b) => textOf((b as { content: Inline[] }).content).trim());
  if (ps.filter((s) => /[.!?:]$/.test(s) && s.split(/\s+/).length >= 3).length >= 3) return;
  if (!run.some((b) => b.t === "actions" || b.t === "ul") && !ps.some((s) => /\b[0-9a-f]{7,40}\b|\b\d[\d,]*\s+lines\b|\b\d+(\.\d+)?\s?(B|KB|MB|bytes)\b/i.test(s))) return;
  blocks.splice(j, i - j, { t: "section", key: "tools:" + run[0].key, title: t("details"), blocks: run, collapsed: true });
}

/**
 * A route's panel drawn left of its map comes first in the page (OpenStreetMap's directions: the fields, then
 * the summary and the long list of steps, then the map). The map goes up with the route's summary, before the
 * fields, so both show on the first screen; the steps follow the fields (F964).
 */
function routeFirst(blocks: Block[]) {
  const pi = blocks.findIndex((b) => b.t === "portal" && b.tool);
  if (pi < 2) return;
  let ti = -1;
  for (let i = pi - 1; i >= 0 && i >= pi - 5; i--) {
    const b = blocks[i];
    if (b.t === "table" && b.rows.length >= 6) {
      ti = i;
      break;
    }
    // Only its downloads and credits sit between the list and the map.
    if (!(b.t === "p" || b.t === "actions" || (b.t === "ul" && b.items.length <= 3))) return;
  }
  const fi = blocks.findIndex((b) => b.t === "form");
  if (ti < 0 || fi < 0 || fi > ti) return;
  const tb = blocks[ti] as Extract<Block, { t: "table" }>;
  // Only a route planner: its summary gives a distance or a time, its fields are where from and where to,
  // or its rows are turns. A checkout's card frame or a café's map after its hours never moves (F1031).
  const form = blocks[fi] as Extract<Block, { t: "form" }>;
  if (/pay|card|checkout|tarjeta|pago|zahl|paiement/i.test((blocks[pi] as Extract<Block, { t: "portal" }>).label)) return;
  const summed = /\d\s?(km|mi|m|ft|min|h)\b|\b\d{1,2}:\d\d\b/i.test(tb.head.join(" ")) && /distan|time|tiempo|tempo|zeit|dur/i.test(tb.head.join(" "));
  const places = form.fields.filter((f) => /^(from|to|start|origin|destination|desde|hasta|origen|destino|von|nach|départ|arrivée|partida|chegada)\b/i.test(f.label)).length >= 2;
  const turns = tb.rows.filter((r) => /\b(turn|left|right|continue|slight|keep|merge|roundabout|exit|arrive|gire|doble|izquierda|derecha|contin[uú]e|siga|rotonda|tournez|gauche|droite|links|rechts|abbiegen)\b/i.test(r.map(textOf).join(" "))).length >= tb.rows.length / 2;
  if (!summed && !places && !turns) return;
  const lead: Block[] = [];
  // The list's heading ("Directions") and its one-cell head row ("Distance: 1.7km. Time: 0:22.") are the route's summary.
  const hi = blocks[ti - 1]?.t === "h" && ti - 1 > fi ? ti - 1 : -1;
  if (hi >= 0) lead.push(blocks[hi]);
  const one = tb.head.filter(Boolean);
  const at = tb.head.findIndex(Boolean);
  if (one.length === 1 && tb.rows.some((r) => r.length >= 2) && !tb.heads?.[at]) {
    lead.push({ t: "p", key: "sum:" + tb.key, content: [one[0]] });
    tb.head = [];
    tb.heads = undefined;
  }
  // The panels drawn beside the map (its Map Layers) go with it, so a layer choice shows on the map just above (F1071).
  let pe = pi + 1;
  while (pe < blocks.length && sideBlocks.has(blocks[pe])) pe++;
  const map = blocks.splice(pi, pe - pi);
  if (hi >= 0) blocks.splice(hi, 1);
  blocks.splice(fi, 0, ...lead, ...map);
}

function demoteExtraH1(blocks: Block[], title: string) {
  for (const b of blocks) {
    if (b.t === "h" && b.level === 1 && b.text !== title) b.level = 2;
    else if (b.t === "section" || b.t === "article") demoteExtraH1(b.blocks, title);
  }
}

/**
 * Headings never skip levels going down: an h6 "MIDTERMS LATEST" right under an
 * h2 reads as an h3. Each source level keeps the level it got under its parent,
 * so five sibling h3 reviews under an h1 are all h2, not one h2 over four h3s.
 */
function normalizeLevels(blocks: Block[], base = 1, open: [number, number][] = []) {
  for (const b of blocks) {
    if (b.t === "h") {
      // The headings still open above this one: those of a higher rank in the source.
      while (open.length && open[open.length - 1][0] >= b.level) open.pop();
      const src = b.level;
      b.level = Math.min(src, (open.length ? open[open.length - 1][1] : base) + 1);
      open.push([src, b.level]);
    } else if (b.t === "article") normalizeLevels(b.blocks, base, open);
    else if (b.t === "section") normalizeLevels(b.blocks, b.level ?? 2);
  }
}

function walkPage(ctx: Ctx, root: Element, scope: Element, beside: { before: Element[]; after: Element[] } = { before: [], after: [] }): Block[] {
  const out = new Out();
  for (const b of leadMedia(root, scope, ctx)) out.push(b);
  for (const b of outsideSurfaces(scope, ctx)) out.push(b);
  if (scope !== root) {
    visit(scope, out, ctx);
    // The readers' comments beside the story (WordPress: article + div#comments) follow it, folded.
    for (const c of commentsBeside(root, scope)) visit(c, out, ctx);
  } else {
    for (const e of beside.before) visit(e, out, ctx);
    walk(root, out, ctx);
    for (const e of beside.after) walk(e, out, ctx);
  }
  return cutNote(out.done(), ctx);
}

/** Comment areas after the story's scope, beside it or beside a box around it, up to the root. */
function commentsBeside(root: Element, scope: Element): Element[] {
  const out: Element[] = [];
  for (let a: Element = scope; a !== root && a.parentElement; a = a.parentElement) {
    for (let s = a.nextElementSibling; s; s = s.nextElementSibling) {
      if (!SKIP.has(s.localName) && visible(s) && (COMMENTS_TOKEN.test(tokens(s)) || commentList(s))) out.push(s);
    }
    if (a.parentElement === root) break;
  }
  return out;
}

export function extractGeneric(): Page {
  const ctx = newCtx({ visited: new WeakSet(), bars: new WeakSet() });
  const search = findSearch(ctx);
  const top = findTop();
  // A menu entry that repeats a top-bar action ("Sign in") is said once, in the bar.
  const nav = findNav(ctx).filter((n) => !top.some((a) => a.ref === n.ref || (!!a.href && a.href === n.href)));
  if (!search) {
    const trig = searchTrigger();
    if (trig && !top.some((a) => a.ref === trig.ref)) top.unshift(trig);
  }
  topBar = top;
  const root = mainRoot(ctx);
  // A panel a button opened as a dialog shows in Sift's sheet, not also in the page.
  const panel = openedPanel(ctx);
  if (panel) ctx.used.add(panel);
  ctx.articleEl = findArticle(root);
  const h1 = titleH1(ctx.articleEl);
  ctx.titleEl = h1;
  const by = ctx.articleEl ? byline(ctx.articleEl, h1) : "";
  ctx.hasByline = !!by && /\p{L}{2,}.*·/u.test(by);
  if (ctx.hasByline) ctx.byName = by.split(" · ")[0];
  ctx.hasDate = /\d/.test(by);
  const scope = ctx.articleEl ? articleScope(root, ctx.articleEl, h1) : root;
  const beside = besideMain(root, ctx);
  const late = scope === root ? lookupLeftovers(root, ctx) : [];
  for (const e of late) ctx.used.add(e);
  beside.after.push(...late);
  let blocks = walkPage(ctx, root, scope, beside);
  // Pages that are mostly navigation (portals, language pickers): keep their navs
  // as content. Lists, tables, forms and players are content already.
  if (blocksText(blocks).length < 200 && !hasRichBlocks(blocks)) {
    // A fresh pass: only the search box and its button stay taken, so players found in pass one come back.
    const used = new WeakSet<Element>();
    if (ctx.searchEl) used.add(ctx.searchEl);
    for (const e of late) used.add(e);
    const sb = elOf(search?.submit);
    if (sb) used.add(sb);
    const again = walkPage({ ...newCtx(), articleEl: ctx.articleEl, used, keepAllNav: true, visited: ctx.visited, searchEl: ctx.searchEl, hasByline: ctx.hasByline, byName: ctx.byName, hasDate: ctx.hasDate, titleEl: h1 }, root, scope, beside);
    if (blocksText(again).length > blocksText(blocks).length) blocks = again;
  }
  const title = h1 ? headingText(h1).slice(0, 200) : pageTitle();
  dropTitleRepeat(blocks, title);
  demoteExtraH1(blocks, title);
  normalizeLevels(blocks);
  dropLinklessTwins(blocks);
  dropKicker(blocks);
  dropEmptyHeadings(blocks);
  foldFileTools(blocks);
  routeFirst(blocks);
  ctx.bare = blocksText(blocks).length < 200 && !hasRichBlocks(blocks);
  if (by) {
    const i = blocks.findIndex((b) => b.t === "h" && b.level === 1);
    blocks.splice(i >= 0 ? i + 1 : 0, 0, { t: "p", key: "byline", content: [by], small: true });
  }
  const dialog = findDialog(ctx, blocks);
  // Popups are told from page layout by what the page view showed before the user's action (see findPopup).
  if (ctx.visited) lastShown = ctx.visited;
  lastBars = ctx.bars ?? new WeakSet();
  return {
    url: location.href,
    title,
    site: siteName(),
    lang: lang(),
    search,
    nav,
    top,
    blocks,
    dialog,
    source: "generic",
  };
}
