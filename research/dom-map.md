# Sift DOM map (captured 2026-10-24)

## How this was captured

- Google Chrome 151.0.7922.71, `--headless=new`, one instance only, throwaway profile `/tmp/claude-1001/sift-dom-profile` (deleted afterward), viewport 1280x900, `--lang=en-US`.
- Headless Chrome's default user agent contained `HeadlessChrome/151`, so I launched with `--user-agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'`. Nothing else was done to hide automation.
- Driven over CDP (port 9333) with `puppeteer-core` from this repo. Per page: `goto` (domcontentloaded), wait 7-9 s, scroll 3 x 800 px with 1.2 s pauses, scroll back to top, save `document.documentElement.outerHTML`.
- Every selector below was run with `querySelectorAll` in the live page. The counts were then re-run on the saved snapshot with BeautifulSoup. Counts are snapshot counts unless marked "live".
- Datacenter IP geolocated to the US: Amazon delivers to "Savannah 31419", Daily Mail redirects to the US edition, Infobae redirects to `/america/`.

| Page | Loaded | lang | Elements | Item selector | Items |
|---|---|---|---|---|---|
| [youtube-home.html](snapshots/youtube-home.html) | real, but empty feed | en | 2,002 | `ytd-rich-item-renderer` | 0 |
| [youtube-home-warm.html](snapshots/youtube-home-warm.html) (extra) | real, feed after history | en | 4,145 (live) | `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer` | 21 (+10 Shorts) |
| [youtube-search.html](snapshots/youtube-search.html) | real | en | 8,614 | `ytd-search ytd-video-renderer` | 19 (+20 Shorts) |
| [youtube-watch.html](snapshots/youtube-watch.html) | real, video played | en | 11,462 | `#secondary yt-lockup-view-model` / `ytd-comments#comments ytd-comment-thread-renderer` | 40 / 20 |
| [youtube-watch-chapters.html](snapshots/youtube-watch-chapters.html) (extra) | real DOM, player said "Video unavailable" | en | 11,812 | chapters panel `ytd-macro-markers-list-item-renderer` | 10 |
| [amazon-search.html](snapshots/amazon-search.html) | real | en-us | 10,247 | `div.s-main-slot > div[data-component-type="s-search-result"][data-asin]` | 16 (+1 sponsored card) |
| [amazon-product-blocked.html](snapshots/amazon-product-blocked.html) | **blocked** (AI-agent notice) | en-us | 35 | n/a | n/a |
| amazon-cart | **not attempted** (see Amazon section) | | | | |
| [dailymail-home.html](snapshots/dailymail-home.html) | real (US edition) | none (meta Content-Language `en`) | 5,186 | `#content .article` | 99 (95 visible) |
| [dailymail-article.html](snapshots/dailymail-article.html) | real, full text | none (meta `en`) | 3,455 | `#js-article-text [itemprop="articleBody"] > p.mol-para-with-font` | 31 |
| [dailymail-article-video.html](snapshots/dailymail-article-video.html) (extra) | real, hero video | none (meta `en`) | 3,613 | same paragraph selector | 23 |
| [infobae-home.html](snapshots/infobae-home.html) | real (`/america/`) | es | 1,869 | `a.story-card-ctn, a.headline-link, a.video-card` | 106 (81 + 15 + 10) |
| [infobae-article.html](snapshots/infobae-article.html) | real | es | 1,381 | `article div.body-article > p.paragraph` | 17 |
| [infobae-article-byline.html](snapshots/infobae-article-byline.html) (extra) | real, has author | es | 1,020 | same | 17 |

---

## YouTube (all pages)

General traps:
- Polymer with shady DOM (`<!--css-build:shady-->`). No real shadow roots on any YouTube page.
- Many hidden duplicate copies. Always scope to the active page element (`ytd-search`, `ytd-browse[page-subtype="home"]`, `ytd-watch-flexy`) and on watch pages to `ytd-watch-metadata`.
- The snapshot HTML is large (1-3 MB) mostly because of inline `ytInitialData` JSON, not elements.
- `ytd-app > #video-preview ytd-video-preview` holds a second hidden `ytd-player` (hover preview) on every page.

### Search box (masthead, same on every YouTube page)
- Form: `yt-searchbox form.ytSearchboxComponentSearchForm[action="/results"]`
- Input: `yt-searchbox input.ytSearchboxComponentInput[name="search_query"]` (placeholder "Search", no aria-label). Old `ytd-searchbox` and `#search-form` no longer exist (0).
- Submit: `yt-searchbox button.ytSearchboxComponentSearchButton[aria-label="Search"]`. A second `button[aria-label="Search"]` is `#search-button-narrow #button` (hidden at 1280 px). Voice: `button[aria-label="Search with your voice"]`.
- Suggestions dropdown: `.ytSearchboxComponentSuggestionsContainer`.
- Sign in: `ytd-masthead a[aria-label="Sign in"]`. Guide toggle: `#guide-button` (2 copies).

### 1. youtube-home (cold)
- Real page, lang `en`, 2,002 elements. No consent screen.
- No feed. `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer` contains one `ytd-rich-section-renderer > ytd-feed-nudge-renderer` with "Try searching to get started / Start watching videos to help us build a feed of videos you'll love." 0 items, 0 chips.
- This is YouTube's logged-out, no-history home. An adapter should treat `ytd-feed-nudge-renderer` as "empty feed" and surface the search box.
- iframes: 2 (passive `accounts.google.com/ServiceLogin`, `about:blank`).

### 1b. youtube-home-warm (extra capture, same session after one search and two watch pages)
- Items: `ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer` = 21, each containing `yt-lockup-view-model` (21).
- Shorts: 2 x `ytd-rich-section-renderer > #content > ytd-rich-shelf-renderer` titled "Shorts"; items `ytd-rich-section-renderer ytm-shorts-lockup-view-model-v2` = 10 (fields as in Shorts on search below).
- Chips: `ytd-feed-filter-chip-bar-renderer yt-chip-cloud-chip-renderer` = 21 ("All", "Music", "Gaming", ...).
- Infinite scroll: `ytd-rich-grid-renderer > #contents > ytd-continuation-item-renderer` (1).
- Ads: none served (`ytd-ad-slot-renderer` = 0).

#### `yt-lockup-view-model` fields (home feed and watch-page sidebar use the same component)
- Video id: class `content-id-<videoId>` on the inner `.ytLockupViewModelHost` div. Playlists show `content-id-PL...`.
- Title + link: `a.ytLockupMetadataViewModelTitle` (text and `href`). Full title also in `yt-lockup-metadata-view-model h3[title]` and its `aria-label`.
- Thumbnail: `yt-thumbnail-view-model img` (gets `src` and class `ytCoreImageLoaded` only once near the viewport; derive from the id when empty, see search).
- Duration: `yt-thumbnail-view-model badge-shape` text ("3:34"); spelled out in `badge-shape[aria-label]` ("2 hours, 18 minutes, 34 seconds"). Extra badges ("New") are additional `badge-shape`s. Playlists show "25 videos".
- Channel and metadata: `yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow`. Row 1 = channel name(s), row 2 = views and age. Each part is `span.ytContentMetadataViewModelMetadataText`, with the long form in `aria-label` ("2.8 million views", "2 months ago"). The separator is an empty `span.ytContentMetadataViewModelDelimiter`, so `textContent` of a row runs together ("2.8M2mo ago"). Join the parts yourself.
- Channel link: `a[href^="/@"], a[href^="/channel/"]` (avatar link). Missing on multi-artist items ("Shakira | and 2 more").
- Avatar: `.ytLockupMetadataViewModelAvatar img`.
- Item menu: `button[aria-label="More actions"]`.

### 2. youtube-search (`how to bake sourdough`)
- Real page, lang `en`, 8,614 elements.
- Items: `ytd-search ytd-video-renderer` = 19. 15 are direct (`ytd-item-section-renderer > #contents > ytd-video-renderer`), 4 sit in a `ytd-shelf-renderer` titled "People also watched".
- Section children order: `ytd-video-renderer` x5, `ytd-shelf-renderer`, `grid-shelf-view-model` (Shorts) ..., then `ytd-continuation-item-renderer`.

Fields inside `ytd-video-renderer` (all have attribute `is-search`):
- Title: `a#video-title` `title` attribute (full title). Its `aria-label` appends the duration ("... 11 minutes, 53 seconds").
- Link: `a#video-title[href]` = `/watch?v=<id>&pp=...` (strip `pp`). `ytd-thumbnail a#thumbnail` has the same href.
- Thumbnail: `ytd-thumbnail img`. **Lazy**: only 9 of 19 have `src` in the snapshot. Unloaded ones are a bare `<img>` with no `data-src` or other URL. Build it from the id: `https://i.ytimg.com/vi/<id>/hqdefault.jpg` or `.../hq720.jpg` (both returned 200).
- Channel: each item has **two** `ytd-channel-name#channel-name`. The one in `#metadata ytd-video-meta-block` is hidden at this width. Use `#channel-info ytd-channel-name #text a` (text "Natashas Kitchen", href `/@Natashaskitchen`) = 19. Verified tick: `ytd-channel-name badge-shape[aria-label="Verified"]` (also duplicated).
- Views / age: `#metadata-line span.inline-metadata-item` (2 per item: "3.4M", "2y ago"). The view count has no "views" word here.
- Duration: `ytd-thumbnail-overlay-time-status-renderer badge-shape` text "11:53", aria-label "11 minutes, 53 seconds" (19). A hidden duplicate sits in `#time-status #text`.
- Description snippet: `.metadata-snippet-container-one-line` holds two copies: `.metadata-snippet-text` and `a.metadata-snippet-timestamp .metadata-snippet-text-navigation`. Only one is visible per item (which one varies). Pick the visible one (`checkVisibility()`).
- Badges: `#badges badge-shape[aria-label]` ("4K", "Closed captions"). Inline "New"/"LIVE" badges live in `#metadata-line ytd-badge-supported-renderer` (has `hidden` when unused).
- Inline chapters: `#expandable-metadata ytd-expandable-metadata-renderer ytd-macro-markers-list-item-renderer` (each with a visible and a hidden copy of `a#endpoint`).
- Item menu: `#menu button[aria-label="Action menu"]`.

Shorts on search (`grid-shelf-view-model`, 3 shelves: "Shorts", "Bake Sourdough Bread✨", "Shorts"; title `grid-shelf-view-model yt-section-header-view-model h2`):
- Item: `ytm-shorts-lockup-view-model-v2` (20) wrapping `ytm-shorts-lockup-view-model`.
- Link + title: `a.shortsLockupViewModelHostEndpoint[href^="/shorts/"][title]` (the thumbnail link is a second, `aria-hidden` copy without `title`).
- Views: `.shortsLockupViewModelHostMetadataSubhead` ("3.7M views").
- Thumbnail: `yt-thumbnail-view-model img` (only 5 of 20 loaded; derive from id as above).

Ads: **none served** for this query, nor for a test query "vpn". I scanned for any tag name containing ad/promo/sponsor/pyv/sparkles and for leaf text "Sponsored"/"Ad": nothing. I could not verify ad selectors. From earlier YouTube builds (unverified today): `ytd-ad-slot-renderer`, `ytd-in-feed-ad-layout-renderer`, and a "Sponsored" `badge-shape`.

Controls:
- Type chips: `ytd-search-header-renderer yt-chip-cloud-renderer yt-chip-cloud-chip-renderer` (6: All, Shorts, Unwatched, Videos, Recently uploaded, Live). Click target `chip-shape button[role="tab"]` with `aria-selected`. Selected host has `[selected]`.
- Filters: `ytd-search-header-renderer #filter-button button[aria-label="Search filters"]` (text "Filters"). Opens `ytd-popup-container tp-yt-paper-dialog ytd-search-filter-options-dialog-renderer` with `ytd-search-filter-group-renderer` groups: Type, Duration, Upload date, Features, **Prioritize** (Relevance / Popularity). There is no "Sort by" any more; Prioritize replaces it. Each option is `ytd-search-filter-renderer a[href]`, a plain URL with an `sp=` param (e.g. Popularity = `&sp=CAM%253D`). Close: `#close-button`.
- Pagination: infinite scroll. `ytd-search ytd-section-list-renderer > #contents > ytd-continuation-item-renderer`. Scrolling it into view appended a second `ytd-item-section-renderer` within 4 s (live: 19 -> 22 videos). Query across all item sections, not the first.
- iframes: 1 (`about:blank`).

### 3. youtube-watch (`dQw4w9WgXcQ`)
- Real page, lang `en`, 11,462 elements. Video played (currentTime ~42 s, `blob:` src). No pre-roll ad.

Player hierarchy (from `<video>` up):
`video.video-stream.html5-main-video` < `div.html5-video-container` < `div#movie_player.html5-video-player` < `div#container` < `ytd-player#ytd-player` < `div#player-container` < `div#player-container-inner` < `div#player-container-outer` < `div#player` < `div#primary-inner` < `div#primary` < `div#columns` < `ytd-watch-flexy` < `ytd-page-manager#page-manager` < `div#content` < `ytd-app` < `body`.
- Use `ytd-watch-flexy #movie_player video.html5-main-video` (bare `ytd-player` matches 2; the second is the hidden hover preview).
- Player controls (inside `#movie_player`): `.ytp-play-button` (aria-label "Pause (k)" / "Play (k)"), `.ytp-next-button`, `.ytp-mute-button`, `.ytp-volume-slider`, `.ytp-time-current` / `.ytp-time-duration`, `.ytp-progress-bar[aria-label="Seek slider"]`, `.ytp-subtitles-button`, `.ytp-settings-button`, `.ytp-size-button` (Theater), `.ytp-fullscreen-button`. `.ytp-miniplayer-button` is gone.
- Ad markers not present this time: `.ytp-ad-module`, `.video-ads`, `.ytp-ad-player-overlay`, `.ytp-skip-ad-button`, `.ytp-ad-skip-button-modern` = 0; `#player-ads` empty. (Unverified: `#movie_player.ad-showing` during an ad.)
- Player error overlay: `#movie_player .ytp-error` (see chapters capture).

Metadata (scope everything to `ytd-watch-flexy ytd-watch-metadata`; a hidden legacy `ytd-video-primary-info-renderer` under `#info-contents` duplicates like/dislike and `#top-level-buttons-computed`):
- Title: `ytd-watch-metadata #title h1` (text in inner `yt-formatted-string`). Bare `h1` also matches a hidden h1 inside the structured description.
- Channel: `ytd-watch-metadata #owner ytd-channel-name a` ("Rick Astley", `/channel/UCuAXFkgsw1L7xaCfnd5JJOw`). Subscribers: `#owner-sub-count` ("4.55M subscribers").
- Subscribe: `ytd-watch-metadata #subscribe-button ytd-subscribe-button-renderer #subscribe-button-shape button` (aria-label "Subscribe to Rick Astley.", text "Subscribe"). `#subscribe-button button` matches 2; the second is the notification bell `ytd-subscription-notification-toggle-button-renderer-next` (only shown after subscribing). Logged out, clicking opens a sign-in prompt (not tested).
- Like: `ytd-watch-metadata segmented-like-dislike-button-view-model like-button-view-model button` (aria-label "like this video along with 19,494,091 other people", `aria-pressed`, text "19M"). Dislike: `dislike-button-view-model button[aria-label="Dislike this video"]`.
- Other actions: `ytd-watch-metadata #top-level-buttons-computed` children: `yt-button-view-model` (Share), `ytd-download-button-renderer` (Download), `yt-button-view-model` (Save to playlist). Overflow: `button[aria-label="More actions"]`.
- Views and date: **text is only reliable in aria-label**. `ytd-watch-info-text #view-count[aria-label]` = "1.8B views", `#date-text[aria-label]` = "16y ago". The visible number is a `yt-animated-rolling-number` made of digit columns 0-9, so `innerText` returns "1\n2\n3\n4..." garbage. Exact values: `ytd-watch-info-text tp-yt-paper-tooltip` text = "1,829,912,254 views • Oct 25, 2009 • #RickAstley ...". The visible `#info` shows only hashtag links.
- Description: `ytd-watch-metadata #description-inline-expander` (`ytd-text-inline-expander`). Collapsed text: `#attributed-snippet-text` (truncated). `#expanded` is **empty until** you click `tp-yt-paper-button#expand` ("more"); then it holds the full text (2,376 chars). Collapse: `#collapse` ("Show less"). The full text is also already in the DOM, hidden, at `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"] ytd-expandable-video-description-body-renderer` (2,403 chars incl. whitespace), no click needed.
- Related (sidebar): `#secondary ytd-watch-next-secondary-results-renderer yt-lockup-view-model` = 40, all visible. Fields as in the lockup section above. 33 of 40 hrefs carry `&list=RD<id>&start_radio=1` (Mix radio links); strip them for a plain video link. One playlist lockup (`content-id-PL...`, badge "25 videos", "View full playlist"). Last thumbnails are lazy (no `src`). Continuation at the end of `#items`.
- Comments: `ytd-comments#comments` (a second, hidden `ytd-comments` sits in the comments engagement panel). Comments **render only when the section nears the viewport**; I scrolled 2,400 px before saving.
  - Header: `ytd-comments-header-renderer #count` ("2,460,432 Comments"), sort `#sort-menu`.
  - Threads: `ytd-comments#comments ytd-item-section-renderer#sections #contents > ytd-comment-thread-renderer` = 20; continuation `ytd-continuation-item-renderer` after them.
  - In `ytd-comment-view-model#comment`: author `#author-text` (text "@candycake9531", href), time `#published-time-text a` ("6 years ago", permalink `&lc=`), text `#content-text` (a `yt-attributed-string`), likes `#vote-count-middle` ("292K"), like button `#like-button button[aria-label]`, replies `ytd-comment-replies-renderer` button ("714 replies"), avatar `#author-thumbnail img`, pinned `#pinned-comment-badge`, creator heart `#creator-heart-button`.
- Hidden engagement panels always present: `PAmodern_transcript_view`, `engagement-panel-comments-section`, `engagement-panel-ads`, `PAsearch_preview`, `engagement-panel-structured-description`, `engagement-panel-searchable-transcript` (all `visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"`).
- iframes: 1.

### 3b. youtube-watch-chapters (extra: `4gEoh3sk2AE`, a video with 10 chapters)
- Full chapter list: `ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-macro-markers-description-chapters"] ytd-macro-markers-list-item-renderer` = 10 (hidden panel, in DOM without clicking).
  - Per chapter: `a#endpoint[href]` (`/watch?v=<id>&t=60s`), `h3[title]` (title; a hidden duplicate `h3` and a hidden duplicate `#details` block follow), `#time` ("0:00"), `img#img` (lazy, no src).
- Description carousel copy: `ytd-watch-metadata ytd-horizontal-card-list-renderer ytd-macro-markers-list-item-renderer` = 8 (truncated, header "Chapters / View all", hidden until the description expands).
- Current chapter in player: `#movie_player .ytp-chapter-title-content` (2 matches; take the first) inside `button.ytp-chapter-title`.
- **Player failed here**: `#movie_player .ytp-error` = "Video unavailable". The player API's `playabilityStatus` was `UNPLAYABLE` / "This content isn't available.", while `ytInitialPlayerResponse` said `OK`. Likely YouTube refusing the stream to this headless datacenter session on the second video. All metadata, chapters, comments, and related DOM still rendered.

---

## Amazon

### 4. amazon-search (`wireless headphones`)
- Real page, no captcha. lang `en-us`, 10,247 elements. "1-16 of over 50,000 results". Delivering to Savannah 31419.
- Organic items: `div.s-main-slot > div[data-component-type="s-search-result"][data-asin]` = 16 (`role="listitem"`, ASIN in `data-asin`).
- `div[data-asin]:not([data-asin=""])` over-counts (68): carousel cards and ATC sub-blocks also carry `data-asin`.
- `div.s-main-slot` also has 17 zero-height empty `div.s-result-item` placeholders (no `data-asin`). Skip them.

Main-slot children in order: AdHolder banner, "Results" header, 3 organic, "Today's deals" carousel (sponsored), "Recently bought and rated" carousel, "More results", 7 organic, video ad, 1 sponsored product card, "More results", 6 organic, "Picks from Amazon Influencers" carousel, "Related searches", "Brands related to your search" (AdHolder), "Need help?", AdHolder.

Fields (organic card):
- Title: `[data-cy="title-recipe"] a h2` (text in `h2 > span`; same in `h2[aria-label]`). The title is split: the rest of the long name is in `[data-cy="title-recipe"] .title-differentiators` (aria-label too).
- Brand: no separate brand line on this query; the brand is the start of the title ("soundcore by Anker ...", "Sony WH-CH520 ..."). I did not see the `h2.a-size-mini` brand line some categories show.
- Link: `[data-cy="title-recipe"] a:has(h2)` (16) -> relative `/<slug>/dp/<ASIN>/ref=sr_1_N?...`.
- Image: `[data-cy="image-container"] img.s-image` (real `src` plus `srcset` 1x-3x; `data-image-latency="s-product-image"`; alt = title). No lazy placeholders seen. 20 `img.s-image` across 16 cards, so take the first.
- Price: `[data-cy="price-recipe"] .a-price:not(.a-text-price) .a-offscreen` ("$20.98") = 14 of 16. The other 2 (Sony) say "Click to see price" with no price node. List price: `.a-price.a-text-price .a-offscreen` ("$199.99").
- Rating: `[data-cy="reviews-block"] .a-icon-alt` ("4.5 out of 5 stars") = 16; visible number in `span[aria-hidden="true"]` "4.5"; trigger `a[aria-label="4.5 out of 5 stars, rating details"]`.
- Review count: `[data-cy="reviews-block"] a[href*="customerReviews"]`, read its `aria-label` ("531 ratings") = 16.
- Bought: `[data-cy="reviews-block"] .a-row.a-size-base .a-color-secondary` ("1K+ bought in past month") = 15.
- Delivery: `[data-cy="delivery-recipe"]` innerText ("Join Prime to get FREE delivery Tomorrow, Oct 25 Or Non-members get ...") = 16.
- Badges: `[data-component-type="s-status-badge-component"]` ("Overall Pick"; `data-component-props` has `"badgeType":"amazons-choice"`) = 1. Deals: `.a-badge` with `[data-a-badge-type="deal"]` ("Limited time deal").
- Add to cart (in card): `[data-cy="add-to-cart"] input.a-button-input[name="submit.addToCart"][aria-label="Add to cart"]` = 10 of 16 (others need options). It submits `form[action^="/cart/add-to-cart"]` with hidden `items[0.base][asin]`, `items[0.base][offerListingId]`, `items[0.base][quantity]`, `anti-csrftoken-a2z`, `clientName=EUIC_AddToCart_Search`. Not clicked.

Sponsored / ad detection:
- Sponsored single product card: `div.s-main-slot > div.s-result-item:has(.puis-sponsored-label-text):not(.AdHolder):not(:has([data-component-type="s-searchgrid-carousel"]))` = 1. It has **empty `data-asin` and no `data-component-type`**, so the organic selector misses it. ASIN is in an inner `[data-csa-c-asin]`. Label `span.puis-sponsored-label-text` "Sponsored". Every link goes to `https://aax-us-east-retail-direct.amazon.com/x/c/...` (ad redirect). Rating uses `[data-cy="reviews-ratings-slot"]` instead of `reviews-block`.
- Sponsored carousel cards: `a.puis-sponsored-label-text` inside `[data-component-type="s-searchgrid-carousel"]` ("Today's deals").
- Banners: `div.s-main-slot > .AdHolder` = 3 (top brand banner with inner `[data-csa-c-owner="sponsor"]`, "Brands related to your search", bottom).
- The video ad block (`data-cel-widget="search_result_26"`, "Wireless earbuds by TAGRY ... Sponsored") has **no** AdHolder class or label element; only its text says "Sponsored".
- Practical rule: treat as ad if the item or an ancestor has `.AdHolder`, contains `.puis-sponsored-label-text` or `[data-csa-c-owner="sponsor"]`, links to `aax-*.amazon.com` or `/sspa/click`, or has leaf text "Sponsored".
- Ad iframes: `iframe[id^="ape_Search_auto-"]` = 3 (left rail and bottom), plus `iframe#DAsis` (amazon-adsystem). 5 iframes total.

Controls:
- Search: `form#nav-search-bar-form[action="/s/ref=nb_sb_noss"][method=get]`, input `#twotabsearchtextbox[name="field-keywords"]` (placeholder "Search Amazon"), submit `input#nav-search-submit-button[type=submit]`, department `select#searchDropdownBox[name="url"]`.
- Sort: **native** `select#s-result-sort-select[name="s"]` in a form posting to `/s`; options `relevanceblender` (Featured), `price-asc-rank`, `price-desc-rank`, `review-rank`, `date-desc-rank`, `exact-aware-popularity-rank` (Best Sellers). It is skinned by an AUI dropdown button `#a-autoid-0-announce` ("Sort by:Featured", `data-action="a-dropdown-button"`). Set the select value and dispatch `change`, or navigate with `&s=<value>`.
- Filters: `#s-refinements`. Groups have `p_*` ids: `#primeRefinements` (p_76), `#deliveryRefinements` (p_90), `#brandsRefinements` (p_123), `#priceRefinements` (p_36), `p_n_deal_type`, `#reviewsRefinements` (p_72), plus feature groups (Wireless Technology, Noise Control, Connectivity, Color, ...). Group titles: `[id$="-title"]`. Each option: `li[id^="p_"] a.s-navigation-item[href]` with `aria-label="Apply Sony filter to narrow results"`; the checkbox is decorative (`aria-hidden`). Price: range inputs `#p_36/range-slider_slider-item_lower-bound-slider` / `..._upper-bound-slider` plus hidden `low-price` / `high-price`, and preset links ("Up to $30", ...).
- Pagination: `.s-pagination-strip`: next `a.s-pagination-next[href]` (aria-label "Go to next page, page 2"), pages `a.s-pagination-button[aria-label^="Go to page"]`, current `span.s-pagination-selected`, disabled `span.s-pagination-disabled`. Plain links with `&page=N`.
- Header cart: `#nav-cart`, count `#nav-cart-count`. Location: `#glow-ingress-line2`.
- Keyboard-shortcut help text sits at the top of `body` (screen-reader block), so `body.innerText` starts with "Skip to / Main content / ... shift + alt + C".

### 5. amazon-product: BLOCKED
- URL: `https://www.amazon.com/dp/B0C3HCD34R` (soundcore by Anker Q20i, picked from the search results: has a price, Add to Cart, and color variants).
- Amazon returned a 35-element interstitial instead of the product page: an alert box `h4` "Continued access by an unauthorized AI agent violates Amazon's Conditions of Use, to which our customers have agreed." and one button `a.a-button-text[role=button][href="https://www.amazon.com/"]` "Continue", plus Conditions of Use / Privacy links. Saved as [amazon-product-blocked.html](snapshots/amazon-product-blocked.html).
- I did **not** click Continue. The notice names automated AI agents and says continued access breaks their terms. Going past it is a call for you, not me. I made no further Amazon requests after this.
- So there are **no verified selectors** for the product page (price box, Add to Cart, Buy Now, quantity, variants).

### 6. amazon-cart: NOT ATTEMPTED
- Same reason: adding to cart and loading `/gp/cart/view.html` would mean continuing past the notice. No Add to Cart click was made anywhere.
- Ways forward, your choice: save the product and cart pages by hand from your own normal browser (File > Save Page As, or DevTools "Copy outerHTML" of `<html>`) into `snapshots/`, and I can map them from the files.

---

## Daily Mail

### 7a. dailymail-home
- `https://www.dailymail.co.uk/` redirected to `https://www.dailymail.com/ushome/index.html` (US edition). No consent banner (US IP). An edition notice "You're viewing the US edition ... Okay" sits in the header.
- `<html>` has **no `lang`**; `<meta http-equiv="Content-Language" content="en">`. 5,186 elements. Server-rendered; no shadow DOM.
- Items: `#content .article` = 99 (95 visible). By class: `.article-tri-headline` 24, `.article-large` 1, `.article-small` 74. Most carry `data-track-module` (`ushome-desktop-ap-single_default` 66, `...double_article_headline` 21, `...triple_article_headline`, `...single_width_big_pic`, `...double_article_headline_video_preview` 2).
- 4 items are hidden: `.article.xp-commerce-article-hidden`. 8 items have no `data-track-module` and link to `/buyline/...`: these are Buyline shopping (affiliate) posts. Treat `#content .article:has(a[href*="/buyline/"])` as sponsored-like.

Fields per `.article`:
- Title + link: `h2 a` (99; 89 also have `itemprop="url"`, so don't require it). Text may start with an empty marker `span.is-paywalled` (90 items; `data-content-propensity="1"` on some): marks possibly paywalled ("DailyMail+") stories. Not a visible label.
- Image: `.articletext img` (real `src`, native `loading="lazy"`, no `data-src`). Video-preview items add `data-video`, `data-film`, `data-fps`, `data-frame-*` (hover sprite).
- Teaser: `.articletext > div > a` text.
- Section and date: `li.article-icon-links__pubInfo[data-channel][data-pub-date]` (91), e.g. `data-channel="News"`, `data-pub-date="2026-10-24T06:35:08+0100"`; link `a.article-icon-links__topChannel`.
- Comments: `a.comments-link` (99).
- No author on the home page.

Right column ("puffs"):
- `.beta .puff` boxes: "DON'T MISS" (x2), "Showbiz extra", "TOP US SPORTS STORIES". Items `.puff li` = 158, but **13 of them are ad slots** (`li` containing an `ad-slot` element; every li is `<li is="ad-marker-li">`). Use `.puff li:has(a[href*="/article-"])` = 145. Each: `a > img + span.pufftext > strong` (title).

Ads and noise:
- `ad-slot` custom elements (14 on home), `.adHolder` (`#billBoard`, `#leader_lower_middle`, `#sky-left`, `#sky-right`; all empty, 1 px tall in headless), label `span.mol-ads-label`. `<html>` class lists every ad slot (`molads_*_on/off`).
- iframes: 3 (a midterms nav-bar module, `#transFrame`, one blank).

Controls:
- Search: `form[action="/home/search.html"]` with `input[name="query"]` (placeholder "Enter your search"), `button[type=submit]`, plus `input[name="channel"]` / `input[name="page"]` used as params.
- No "load more" or pagination control found; the 99 items were present after a 2,400 px scroll. I did not test deeper scrolling here.

### 7b. dailymail-article
- URL: `/news/article-16234901/US-intelligence-memo-Iran-plots-assassinations.html`. Real page, full text (no paywall cut). No lang attribute (meta `en`). 3,455 elements.
- Container: `#js-article-text` (`div.article-text.wide.heading-tag-switch`).
- Title: `#js-article-text h1` (`h1.article-page-headline`). Bare `h1` also matches a visible channel header "News" outside the article.
- Summary bullets: `#js-article-text > ul.mol-bullets-with-font li` (outside the body).
- Byline: `#js-article-text p.author-section.byline-plain a.author` ("STEPHEN M. LEPORE, US SENIOR REPORTER", `/profile-473/stephen-lepore.html`). No `itemprop="author"`.
- Date: `#js-article-text .article-timestamp-published time[datetime]` (`2026-10-24T06:35:08+0100`, text "PUBLISHED: 01:35 EDT, 24 October 2026"); `.article-timestamp-updated time[datetime]`; wrapper `p.byline-section`. Also `meta[property="article:published_time"]`.
- Body: `#js-article-text [itemprop="articleBody"]`. Paragraphs: `[itemprop="articleBody"] > p.mol-para-with-font` = 31. Inline links: `span[data-track-module="internal-body-link"] > a`.
- Images: `[itemprop="articleBody"] > div.artSplitter.mol-img-group` (6) -> `.mol-img .image-wrap img` (real `src`, `loading="lazy"`, class `blkBorder img-share`) + `p.imageCaption`. One group can have class `mol-hidden-cap` with an empty caption. Gallery button inside `.image-wrap`: `button[class^="openGalleryButton-"]` ("+6 View gallery"), hashed class.
- Body child order: `p` x8, newsletter div, image groups x2, TRENDING div, `p` x8, images x2, `p` x8, images x2, `p` x7.

Noise inside the body (exclude):
- Newsletter sign-up: `[itemprop="articleBody"] > div[data-mol-fe-xpmodule-newsletter-sign-up]` (hashed classes inside; contains its own `<p>` and a logo `<img>`).
- Trending box: `.mol-fe-related-replace[data-track-module="related-replace"]` ("TRENDING", `a.related-replace-article` links), wrapped in a class-less `div`.
- Poll (in the video article): `[itemprop="articleBody"] > div.floatRHS [data-mol-fe-xpmodule-polls]`.
- Why it matters: `[itemprop="articleBody"] p` = 40 but real paragraphs are 31; the other 9 are newsletter text and image captions. Use the `> p.mol-para-with-font` child selector.

Noise after the body (inside `#js-article-text`): `.articleTopicsRow` (topics), `ad-slot` elements (21 on this page: `before_article`, `after_article`, `under_article`, `smart_feed`, `sticky_banner`, `mpu_top`, `mpu_puff_N`...), Taboola `#taboola-top-carousel-thumbnails`, `#taboola-below-article-thumbnails`, `#taboola-below-main-column` (empty in headless), `#most-watched-videos-lazy-container` (empty until scrolled), `.mol-fe-new-bar-js`, comments `#reader-comments` ("33 comments", sort Newest/Oldest/Best rated/Worst rated). Right column `.beta .puff li` = 254.

### 7c. dailymail-article-video (extra)
- URL: `/news/article-16233447/new-jersey-mayor-matthew-bianchini-attack-resident-town-meeting.html`, 3,613 elements, 23 paragraphs.
- The video is a **hero above `#js-article-text`**, not inside the body: `div.vjs-video-container > div.video-js#vjs_video_3[data-opts] > video` (video.js, `poster` attr, `preload="none"`). Wrapper divs use hashed CSS-module classes (`hero--T6skX`, `player--RMHxP`), so anchor on `.vjs-video-container`.
- `.vjs-video-container .video-js video` = 3: two extra `<video>` tags sit in `.video-ads-container` (video ads). The main one is the direct child: `.video-js > video` (checked by parent chain).

---

## Infobae

### 8a. infobae-home
- `https://www.infobae.com/` redirected to `https://www.infobae.com/america/`. lang `es`. 1,869 elements. Arc XP / Fusion site (`#fusion-app`, `data-fusion-component`). No consent wall.
- Items, three kinds (union `a.story-card-ctn, a.headline-link, a.video-card` = 106; 5 hrefs repeat):
  - `a.story-card-ctn` = 81: the whole card is one link. Title `h2.story-card-hl` (81). Author `.story-card-author-name` (47 of 81). Image `img.story-card-img` inside `picture` with `<source srcset media>` per breakpoint; `img[src]` is real (first `loading="eager"`, rest native lazy). `.story-card-details-ctn` is usually empty. No dates on cards.
  - `a.headline-link` = 15: text-only headlines (12 are `a.headline-link.feed-column-card` in "feed column" boxes, heading `.feed-column-heading`). Title is the text and also `aria-label`. Note `h2.story-card-hl` also has classes `headline-link headline`, so keep the `a` tag in the selector.
  - `a.video-card` = 10 (in `.video-card-container`): JW Player poster `img` (`cdn.jwplayer.com/v2/media/<id>/poster.jpg`, srcset), text holds section, title, duration; href `/video/...`.
- Layout wrappers: `.three-elements-chain`, `.default-chain-ctn`, `.feed-column-container`.
- Ads: `.ad-wrapper.dfpAd` (7), label `p.ad-shell-label` "PUBLICIDAD", inner div id like `infobae/america/home/top_banner_970x80`, attrs `data-ad-slot`, `data-ad-type`. None filled in headless. Also `.sticky-navbar-ad-container`.
- Search: there is **no input in the initial DOM**. `.queryly_searchicon_img button` ("Buscar en todo el sitio", inside `label[for="queryly_toggle"]`) loads a third-party Queryly overlay: `input#queryly_query[type=search][placeholder="Buscar Infobae ..."]`, `input#queryly_suggest`, results in `.queryly_overlay`. Client-rendered, no form.
- Pagination: none. A 25 x 900 px scroll added no cards (live: 81 -> 81).
- iframes: 9, all hidden tracking (sensic, criteo, recaptcha, permutive, doubleclick).

### 8b. infobae-article
- URL: `/america/mundo/2026/10/24/un-incendio-destruyo-el-nido-del-aguila-el-antiguo-refugio-de-montana-de-adolf-hitler-en-alemania/`. lang `es`. 1,381 elements.
- Page skeleton: `section.article-section-new` > `header.header-wrapper-new`, `article`, `aside.right-rail-new`.
- **The header is outside `<article>`**: `.article-header` (div.article-header.article-header-new) holds section `.article-section-tag` ("MUNDO"), a Google "Agregar Infobae en" follow button, `h1.article-headline`, `h2.article-subheadline` (deck), and `.byline`.
- Byline: `.article-header .byline`. This article: `.byline.no-author` (only a "Seguir" Google follow link). Authored article ([infobae-article-byline.html](snapshots/infobae-article-byline.html)): `.article-header .byline.has-author a.author-name` ("Fausto Urriste" -> `/autor/fausto-urriste/`), photo `img.byline-author-image`, text "Por Fausto Urriste Seguir" (drop "Seguir").
- Date: `article div.body-article .sharebar-container span.sharebar-article-date` ("24 Oct, 2026 12:01 a. m."; the next span "Actualizado: 24 Oct, 2026 02:12 a. m. EST"). Machine date: `meta[property="article:published_time"]` = `2026-10-24T04:01:31.591Z`. Trap: `p.date-info` in the masthead is today's date, not the article date.
- JSON-LD present: `NewsArticle`, `VideoObject`, `BreadcrumbList`, `NewsMediaOrganization` (good fallback for title, author, dates).
- Body: `article div.body-article`. Paragraphs: `article div.body-article > p.paragraph` = 17 (`data-paragraph-number`). Subheads: `div.body-article > h2` (with slug ids).
- Images: `div.body-article > div.visual__image` -> `picture > source[srcset]...` + `img.global-image` (real `src`, `loading="lazy"`, `alt`) + `figcaption.article-figcaption-img` (5 of 5).
- Lead video: `div.body-article > div.jwplayer-ctn` -> `div.jwplayer#<ID>-custom_embed0` (JW Player, state classes like `jw-state-idle`); its `<video>` has no src until play. It contains `google-cast-launcher` with an **open shadow root**, the only shadow DOM on any page captured.
- Body order: `ai-tools`, `jwplayer-ctn`, `sharebar-container`, `p`, marfeel, `p`, ad, `p`, marfeel, `p`, image, `p`, marfeel, ad, `p`, image, `p` x2, ad, image, `p`, `h2`, image, `p`, ad, `p` x2, `ad-lazy-placeholder`, image, `p` x5, `second-saved-buttons`, `article-tags-container`.

Noise inside the body (exclude):
- `div.ai-tools` ("Escuchar / Puntos clave / Resumen").
- `div.sharebar-container` (date plus share buttons; read the date first).
- `div.marfeel-recommender` (3; "Te puede interesar:" related link, 165 px).
- `div.ad-wrapper.dfpAd` (4: `.inline`, `.inline_2`, `.ad_1`, `.ad_2`; label "PUBLICIDAD", ~290 px) and `div.ad-lazy-placeholder` (250 px).
- `div.second-saved-buttons` ("Compartir nota:").
- `div.article-tags-container`: `.marfeel-seguir-leyendo` ("Seguir leyendo", 3 related links) and "Temas Relacionados" tags `a[href^="/tag/"]` (7 including "Últimas noticias América").
- After the body, inside `<article>`: `.default-chain-ctn` (ad) and `.feed-list-wrapper` ("Últimas Noticias"). Sidebar `aside.right-rail-new` (most read).
- iframes: 13 (ads and tracking).

---

## Cross-site notes for adapters
- Text only in aria-label: YouTube durations, watch-page views and date, lockup view/age long forms; Amazon star rating (`.a-icon-alt`), review count, full title (`h2[aria-label]`); Infobae text-only headline links.
- Duplicate hidden copies: YouTube channel name (2 per search item), snippet text (2), chapter endpoints, legacy watch metadata, second `ytd-player`, second `ytd-comments`; Amazon `data-asin` on nested nodes; Daily Mail ad-slot `li`s inside puff lists.
- Render-after-scroll: YouTube comments, YouTube thumbnails (no URL until visible), YouTube search continuation, Daily Mail most-watched and Taboola blocks. Daily Mail, Amazon search, and Infobae images have real `src` from the start.
- iframes carry no content worth extracting on any page (ads, tracking, passive sign-in).
- Shadow DOM: none, except the JW Player cast button on Infobae.
