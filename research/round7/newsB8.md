# Round 7 findings: newsB8

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F726 (high): The Independent sign-in page shows no form in Sift

Found by: T2-news. Where: https://www.independent.co.uk/login?regSourceMethod=Nav+register+CTA (reached from Sift's 'Log in')

Evidence: Sift shows only 'H1 Log in' and 'p: Nothing to show yet.', 2 of 2 loads, after waiting 19 s and 20 s (/home/nico/projects/sift-test-2/research/shots/r7t2-indy-login2.png). The original shows Email address, Password, SUBMIT, 'Forgotten your password?', REGISTER and 'SIGN IN WITH GOOGLE' (/home/nico/projects/sift-test-2/research/shots/r7t2-indy-login-orig.png). The form's ancestry is form#login-form < div < div#standalone-login-form < div#LoginDropdownButtonInside. Nothing was submitted.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts 'goto:https://www.independent.co.uk/login?regSourceMethod=Nav+register+CTA' wait:20000 outline 'eval:[...document.querySelectorAll("#login-form input")].map(i=>i.type+" "+i.getBoundingClientRect().width)'

Suspected cause: The 'Dropdown' token in the container id (#LoginDropdownButtonInside) makes the open, standalone form look like a closed dropdown or popup, so it is dropped.

Skeptic: Confirmed, high, 2 of 2 loads at 15 to 20 s. Sift shows only 'H1 Log in' and 'Nothing to show yet.'. The original shows Email address, Password, SUBMIT, Forgotten your password?, REGISTER and SIGN IN WITH GOOGLE (shot research/shots/skeptic-indy-login-orig.png). Each input is 308 px wide. The suspected cause is wrong: renaming #LoginDropdownButtonInside to #LoginBox changed nothing. The real cause: main#main-content has 189 of the body's 798 characters, under 25 percent, and holds no h1, article or video. So mainRoot() falls back to body, and the body pass yields no blocks. Prepending an <h1> to <main> made mainRoot pick main, and the full form appeared at once.

Skeptic's fix lead: In mainRoot() in src/content/extract/generic.ts, also keep the main region when it holds a sign-in or other form with a password, email or username field. One way is to add `|| main.querySelector("form input[type=password], form input[type=email]")` to the `mt > all * 0.25 || …` test. Separately, find out why the body pass drops this form.

## F727 (high): Infobae at 200% zoom: no way to sign in from Sift

Found by: T2-news. Where: https://www.infobae.com/america/ and Infobae articles, 640x450 at device scale 2 (a 1280x900 window at 200%)

Evidence: Sift's header has only 'Menú' and 'Buscar en todo el sitio' (/home/nico/projects/sift-test-2/research/shots/r7t2-ib-article-z200.png). No Sift button or link matches /sesi|registr|ingres/, and the Menú dialog has none ('no sign-in in menu'). The original at the same size shows an account avatar, button.account-button--mobile (aria-label 'myAccount'). Clicking it opens a panel with REGISTRARME and INICIAR SESIÓN (/home/nico/projects/sift-test-2/research/shots/r7t2-ib-z200-orig-avatar.png). At 1280 px, Sift shows REGISTRARME and INICIAR SESION, and the sign-in dialog works.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/t2/zact.ts 640 450 2 goto:https://www.infobae.com/america/ wait:12000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("button,a")].map(b=>b.innerText).filter(t=>/sesi|registr/i.test(t))' click:Menú wait:1500 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("[role=dialog] a,[role=dialog] button")].map(x=>x.innerText).filter(t=>/sesi|registr/i.test(t))'. Both give empty lists, while 'eval:document.querySelector("button.account-button--mobile").getBoundingClientRect().width' is non-zero.

Suspected cause: At narrow widths the site's sign-in is an icon-only button with an English aria-label ('myAccount'). Sift drops it, and keeps nothing else that leads to sign-in.

Skeptic: Confirmed, 2 of 2 loads at 640x450 CSS px, scale 2. Sift's buttons and links have nothing matching /sesi|registr|ingres|myAccount/. Its header holds only 'Menú' and 'Buscar en todo el sitio'. The Menú dialog's 16 entries have no sign-in. The original shows button.account-button--mobile (aria-label 'myAccount', 32x32). With Sift off, clicking it opened a panel with REGISTRARME and INICIAR SESIÓN (shot research/shots/skeptic-ib-z200-orig.png). At this zoom a Sift user cannot reach sign-in.

Skeptic's fix lead: In generic.ts, keep an icon-only account button in the header (aria-label myAccount, account, profile or user, or a class with account or avatar) as an action named in the page's language ('Cuenta', or t('account')). Do this instead of dropping it as an icon. Its click should then open the site's panel, which Sift already handles as a dialog.

## F728 (medium): La Nación search results appear later in Sift than in the original

Found by: T2-news. Where: https://www.lanacion.com.ar/buscador/?query=Milei (1280 px)

Evidence: In 6 of 6 runs, Sift showed the first result after the original rendered its first result h3. Original vs Sift: 10536/12280, 7092/7762, 3057/3642, 4744/6605, 3860/4778, 1177/1789 ms. Sift was 0.6 to 1.9 s later; medians 3860 vs 4778 ms in the second set. Until then Sift shows 'Todavía no hay nada para mostrar.' The La Nación home and article had equal timings.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/t2/fp2.ts "https://www.lanacion.com.ar/buscador/?query=Milei" "h3" "Javier Milei" 3

Suspected cause: After results load on the client, re-extraction waits for mutations to settle (debounce) before it renders.

Skeptic: Confirmed, medium, 4 of 4 runs with the reporter's fp2.ts on /buscador/?query=Milei. Original first h3 versus Sift showing 'Javier Milei': 1889/2584, 1442/2368, 1925/2412 and 1184/2165 ms. Sift is 0.5 to 1.0 s later, and shows 'Nothing to show yet' meanwhile. The first h3 is the results' 'Javier Milei' heading. schedule() in index.ts waits up to 800 ms, or lastDur*9, plus a requestIdleCallback of up to 600 ms, even when the view is still empty.

Skeptic's fix lead: In schedule() in src/content/index.ts, run soon (about 60 ms, no requestIdleCallback) while the current view has no blocks (page.blocks empty or partial). Use the same short delay when a mutation adds the main region's first content.

## F732 (medium): The Independent: the site's 'Ask The Independent' AI widget sits in the Short version with an unlabelled field

Found by: T2-news. Where: https://www.independent.co.uk/news/world/americas/jair-bolsonaro-flavio-lula-brazil-election-b3073236.html

Evidence: Between 'Show full text' and the article text, the Short version shows a bare text field, 'Ask The Independent anything', two suggested questions, 'Ask The Independent' and the widget's own summary paragraph ('Incumbent leftist president … While Lula secured a majority o…'). The field is <label class="field"><span></span><input type=text></label> with no name. axe on Sift's view once it has loaded: 1 critical violation, 'label'. scripts/a11y.ts reports 0 only because it runs at 7 s, before the widget appears. Tab order includes 'SIFT <input>' with no name.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.independent.co.uk/news/world/americas/jair-bolsonaro-flavio-lula-brazil-election-b3073236.html wait:25000 outline; then SIFT_PORT=9462 SIFT_TAB=T2-news bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/t2/axenow.ts

Suspected cause: 

Skeptic: Confirmed, medium. After 25 s the Short version shows, between 'Show full text' and the article: a bare [input:text], 'Ask The Independent anything', two suggested questions as plain paragraphs (not buttons), 'Ask The Independent' and the widget's summary paragraph. The field renders as <label class="field"><span></span><input type=text></label>. axe on Sift's view: 1 critical 'label' violation. The source is div#deeper-dive-container > div#dd-widget. Its 'placeholder' is a div (dd-widget-input-placeholder), not an attribute, so the field gets no name. The site's AI widget is noise above the story, and its field has no name.

Skeptic's fix lead: In src/content/extract/generic.ts, treat a site AI Q&A widget as noise: a container whose id or class has deeper-dive or dd-widget, or that holds an 'Ask <site> anything' field and canned questions. Also, in toField, name a field by a visible placeholder-like element drawn over it when it has no label, placeholder or aria-label.

## F733 (medium): Infobae: closing the search panel throws focus to a mid-page section heading

Found by: T2-news. Where: https://www.infobae.com/america/ (1280 px)

Evidence: After 'Buscar en todo el sitio' then 'Cerrar', Sift's focus lands on H2 'Elecciones en Brasil' (top 377) and the view scrolls down to it. This happened 3 of 3 times: mouse click with no query, mouse click after typing 'milei', and Enter on the focused Cerrar. Escape instead puts focus on 'Menú', not on the opener. Shots: /home/nico/projects/sift-test-2/research/shots/r7t2-ib-after-cerrar.png, /home/nico/projects/sift-test-2/research/shots/r7t2-ib-cerrar-kbd.png.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.infobae.com/america/ wait:9000 'click:Buscar en todo el sitio' wait:3000 'click:Cerrar' wait:3000 'eval:(()=>{const a=document.querySelector("sift-root").shadowRoot.activeElement;return a.localName+" "+a.innerText})()'. This gives 'h2 Elecciones en Brasil'.

Suspected cause: 

Skeptic: Confirmed, medium, 2 of 2 loads at 1280 px. After 'Buscar en todo el sitio' (focus goes to the input) and 'Cerrar', Sift's active element is 'h2 Elecciones en Brasil' at top 421, and the view scrolled by 569 px. With Escape, focus went to 'Menú', not to the opener. In the original, opening the menu or search panel with the icon and closing it with the X left focus on the hamburger span[aria-label=Menu], with scrollY 0. So Sift's focus move and scroll do not come from the page.

Skeptic's fix lead: In src/content/index.ts, use the focus-return logic (`opener`, around lines 226 and 2539): when a page panel opened from a Sift control closes, return focus to that control, found by its label if a re-render replaced it. Do not follow page focus, or fall to the next focusable heading, and do not scroll.
