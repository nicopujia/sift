# T2-news: cluttered news sites (2026-10-24)

Tester T2. Shots and outlines: `research/shots/T2-*.png|.txt`.
Harness note: `SIFT_TAB=3` picks `browser.pages()[3]`, and that order shifts when other testers open or close tabs. My first article read landed on another tester's YouTube tab. I pinned my own tab by CDP target id (scratchpad `t2-lib.ts`, same idea as T1's `t1lib.ts`).
Model calls were watched on the extension service worker with CDP `Network` (scratchpad `t2-swwatch.ts`).

## Blocker: no Short version can appear right now

- Every condense request returns HTTP 402 from OpenRouter, on both models:
  `qwen/qwen3.8-27b` and `google/gemini-3.5-flash-lite`.
- Body: "This request requires more credits, or fewer max_tokens. You requested up to 1791 tokens, but can only afford 239."
- Line rewrites still work only because the lines fallback `openai/gpt-6-luna` fits the small `max_tokens`.
- The user sees nothing: no "Shortening…", no error, no notice. `noKey` in `i18n.ts` is never used. A 402 sets `store.aiOff` for the page.
- So "Short version within ~10 s" and "covers the whole article" could only be checked on the request side:
  - BBC article: request at 2.0 s, 7,458 chars, title to last paragraph (plus byline, related links, tags).
  - La Nación article: request at 2.0 s, 10,493 chars, whole article (plus raw tweet text and "Conforme a").
  - Infobae article: 4,447 chars, whole article plus tag list and "Últimas Noticias" sidebar.
  - Daily Mail article (snapshot): 6,131 chars, whole article.

## Daily Mail (snapshots)

Home (`T2-dm-home`, first content 2,681 ms on a local file)
- Top of page is noise turned into fake headlines by the model:
  - edition popup "You're viewing the US edition … Okay" → `[link] The US edition homepage is open; the menu can switch to the UK, AU or IE edition` + buttons `US Edition`, `Okay`.
  - channel bar → `[link] Crime Desk is listed under Home, Showbiz, News, Sports, Politics and Royals` + `Home · Showbiz · News …`.
  - `[link] Latest Headlines video` / `Video`, `Last updated: … · Login`.
- Rewrites describe the headline instead of the news:
  - "'Wiles gave the kill order': Brutal inside story of Zacharia's firing…" → "The headline claims Wiles ordered Zacharia's firing … but gives no further details".
  - "Secret list to replace Susie Wiles leaks: FIVE names drafted for top job" → "The headline says a leaked list names five potential replacements…".
  - Promos rewritten as items: "Get more from DC Insider HERE" → "The headline invites readers to get more from DC Insider"; "Which midterm races should YOU be watching? Enter your zip code here"; "VISIT OUR BRILLIANT ROYALS CHANNEL"; "DEEP DIVE: Explore the collection" → "A feature invites readers to explore a collection".
- About 45 headlines are never sent for rewriting and stay clickbait, e.g. `EXCLUSIVEInsiders dare to say the unthinkable about Taylor Swift: Has the facade finally cracked?…` (also glued).
- Leaks: OUR SHOPPING PICKS deals (HexClad, hearing aid, fragrance) as normal items with meta `Comment`; `p: Shorts` + `[button] Navigate right` with the Shorts items missing; games promo `Relink / Play now Explore Games> · Find the imposters…`; six `Follow Daily Mail / Subscribe Daily Mail / Follow @DailyMail` items.
- Duplicates: carousel clones shown back to back (`Halle appears with her fiancé…` twice, same URL); 15 URLs appear 2-3 times.
- Structure: `H6 MIDTERMS LATEST`, `H6 THE ROYALS` right under H1 (axe heading-order); section labels as paragraphs (`p: Shorts`, `p: Showbiz`, `p: OUR SHOPPING PICKS`); "Tearful Simone Biles … NFL star husband Biles opens up to fans" (headline and sub glued).

Article (`T2-dm-article`)
- Title, byline (`Stephen M. Lepore · Oct 24, 2026, 5:35 AM`) once. Good.
- All article photos dropped (8 images, 634 px, loaded) but their captions stay as body paragraphs: "…Marco Rubio (pictured), suggests…", "Clayton (pictured) said…", and the first two captions repeat the first two paragraphs.
- `[button] +6 View gallery` kept; lone `Iran` tag link and `Comments` at the end.
- No Short version (402, see blocker).

Article with video (`T2-dm-video`)
- Lead video shown twice: `[img] Hero video poster` + caption, then the portal with the same frame.
- H1 repeated as H2.
- Player internals leaked: `play video`, `video progress bar`, `LIVE`, `Current Time 0:00`, `Video Quality 1024p…`, and the caption-settings form (10 empty selects, `Defaults`, `Done`). In this snapshot `vjs-hidden` is display:block because video.js CSS is missing, so this may be snapshot-only.
- Sift's Play did not start the video (it clicks the page's play button, which has no script in the snapshot); `video.play()` from the console works. Snapshot-limited, not confirmed live.

## BBC (live)

Home (`T2-bbc-home`, 1,104 ms)
- Fixed: meta now `2 hrs ago Europe`; Most watched has no stray rank numbers.
- H1 is now `Breaking news, video and the latest top stories from the U.S. and around the world` (prefix gone, still a tagline, not "BBC News").
- Still no search control (BBC header has `button[data-testid=search-input-search-button]`), not in the Menu either.
- Headline click in Sift opens the article. Works.

Article (`T2-bbc-article`, cj62yv5k0w4yo)
- Title twice: `H1` and the article's own `H2` with the same text.
- Date twice: Sift byline `24 Oct 2026, 06:19` (no author), then the site's `2 hours ago` / `Sean Seddon`.
- Whole article is now one article block (condense input covers all of it).

Article with lead video (`T2-bbc-video-article`, ck1wv9p0p9e3o)
- Portal now shows the player poster with "Contains upsetting scenes." Better than before.
- Sift's `Play` does not play: page throws `TypeError: Cannot read properties of null (reading 'history')` at `ToucanPlayer.js` `Uc` (a video-event handler that reads `this.mediaItem.history`). The `<video>` stays `readyState 0`, no src, while Sift's button flips to `Pause`. Cause: `media("play")` falls back to `v.play()` on the SMP player's empty video because `info.play` is not found.
- The original's own play overlay plays fine (t = 5.4 s after 8 s).
- Sift also shows a duplicate poster `[img]` and a separate `[button] Play video`. Clicking that one starts the video for real (unmuted, volume 0.7, t = 20 s) but the portal and media bar disappear: Sift shows only `Skip to content`, `Menu`, `Sift`. Sound with no visible video and no pause.
- Media bar time shows `0:00 /` (no duration).
- Portal label is just "Video": the "Contains upsetting scenes." warning is not in any text a screen reader gets.
- Tab order: after the Sift switch, focus goes into the page (`1:13 Contains upsetting scenes.`).
- At 400 px wide: `Add as preferred on Google` promo leaks; the Sift switch covers body text.

## La Nación (live)

Home (`T2-ln-home`)
- Fixed: H1 `LA NACION`; meta `Política Por Federico González del Solar`; lead story deck merged into the first line; Bolsonaro line keeps the news.
- Rewrites still lose meaning:
  - "Absuelto. Milei denunció un plan golpista, acusó a periodistas y advirtió: "Los hijos de puta se tienen que quemar en la hoguera"" → "Milei denunció un plan golpista, acusó a periodistas y dijo que deben quemarlos en la hoguera" (drops "Absuelto", turns a quote into Sift's own claim).
  - "Relato en crisis. Javier Milei contra los muertos del día 20" → "Un análisis sobre Javier Milei y las muertes del día 20".
  - "El artículo informa cuánto rating tuvo…", "…; el artículo informa cuánto consume…" (filler).
- Leaks: section sub-menus as link lists (`Inteligencia Artificial / Criptomonedas / Bitcoin / Robótica`, `Dólar Hoy / Índices / Campo / Negocios / Emprendedores / Propiedades / FAL`, `Vida Sana / Nutrición / Fitness…`, `Remates / Agricultura…`, `Aprendé en la cocina / Cociná facil / Menú semanal / todas las recetas`); sponsored `CONTENT LAB` items as news; newsletter `Recetas, menús y consejos para cocinar / SUSCRIBITE gratis`; `El mundo necesita más música / Escuchá + música`; `Ln Juegos / Rompecabezas / … Jugar`.
- `H3 Lo más visto` is followed by `Que Sale`, `Futuria` and a nav list, not the most-viewed stories.
- Selección del Editor video still large, no title.

Article (`T2-ln-article`, Bullrich, 1,237 ms first content; was 7,105 ms)
- Fixed: spaces next to bold (`esperaba, Patricia Bullrich`); condense request is now sent.
- Photos lost: the site uses `figure role="button"`; Sift renders a bordered button with the caption text and no image. Clicking it does nothing visible. Caption and credit glued: `Javier Milei, Patricia Bullrich y Karina Milei Fabian Marelli`, `Milei, en España Captura de video`.
- Still open: date twice (`Matías Moreno · 23 oct 2026, 22:01` and `23 de octubre de 2026`), `Agregar LA NACION en` (now a button), `Conforme a`, `Más leídas de Política`, `Más enlaces`, `Sumate a la conversación / Para comentar las notas, necesitás suscribirte / Iniciar sesión Suscribirte`.
- Tweet is raw fallback text with a `pic.twitter.com/3oaNZ5rzET` link; the spot the story is about is not shown.
- Sift labels are Spanish (`Ir al contenido`, `Menú`, `Reproducir`, `Área interactiva…`). Good.

## Infobae (live)

Home (`T2-ib-home`)
- A Spanish headline is rewritten in Galician: "Irán analiza atacar cables submarinos si Estados Unidos e Israel vuelven a bombardear el país" → `Irán estuda atacar cables submarinos se Estados Unidos e Israel volven bombardear o país`. The request carried `"lang":"gl"` from `detectLang()` (`chrome.i18n.detectLanguage` per title) although the page is `lang="es"`.
- All section headings become `[link] INFOBAE` (10 times): the anchors are `<a aria-label="INFOBAE"><h2>Elecciones en Brasil</h2></a>`, and Sift uses the aria-label instead of the visible heading.
- Stray fragment: `Por Pedro Pablo Peñaloza · | Desde Caracas`.
- Filler: `…; el artículo repasa su historia, ganadores y dotación`.

Articles (`T2-ib-article`, `T2-ib-article2`)
- `Puntos clave` opens but shows only `Ir al párrafo 2 del artículo`, `… 5 …`, `… 7 …`, `… 9 …`. The key-point text is inside each button's `span.ai-keypoints-text`; Sift uses the aria-label. `Resumen` works.
- `Seguir` (follow) link leaks; `Mundo` breadcrumb above the H1.
- Each photo is `[img]` with alt equal to the caption plus the caption paragraph (screen readers hear it twice).
- No author in Sift's byline (`24 oct 2026, 7:06`).
- Lead video (Nido del Águila) is a working portal; clicking its play button plays it inside Sift. It has no Sift media bar (treated as "interactive area").

## Confirmed fixed from site-sweep.md

- BBC home: glued `1 hr agoEurope` → `2 hrs ago Europe`.
- BBC home: Most watched rank numbers as separate paragraphs → gone.
- BBC home: `BBC News - ` prefix removed from H1 (H1 is still the tagline).
- BBC article: Short version input was a middle chunk → condense input now covers the whole article.
- BBC article: lead video was only a dead `Play video` button → now a portal with poster and media bar (but Play still fails, see above).
- BBC article: author missing → author visible (as the site's line, not in Sift's byline).
- La Nación home: H1 was the lead story → `LA NACION`.
- La Nación home: `PolíticaPor` → `Política Por`.
- La Nación home: Bolsonaro and lead-story rewrites now keep the news.
- La Nación article: `esperaba,Patricia` etc. → spaces kept.
- La Nación article: first content 7,105 ms → 1,237 ms.
- La Nación article: no condense request ever → request sent at ~2 s.
- La Nación article: `INICIAR SESIÓNSUSCRIBIRTE` → `Iniciar sesión Suscribirte` (block still leaks).
