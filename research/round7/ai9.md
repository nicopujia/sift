# Round 7 findings: ai9

Each was reproduced by a skeptic. F7xx are new in round 7; older ids are findings a round 7 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F725 (high): Headline lines claim a teaser's answer is not given when the article gives it

Found by: T2-news. Where: Guardian home (theguardian.com/international); La Nación 'Más leídas de Automovilismo' on any Automovilismo article

Evidence: Guardian original: 'Should we tip on takeout? We weighed all angles and the answer is …'. Sift load 1: 'Should people tip on takeaway? The writer weighs the angles but does not give the answer'. Load 2: 'Whether people should tip on takeaway remains unanswered'. The article does answer: 'The bottom line: tipping for takeout doesn't make sense as a custom. It should be resisted unless it's entrenched'. It also has two authors, not 'the writer'. La Nación original: 'Franco Colapinto largará 21º en el Gran Premio de Estados Unidos de Fórmula 1: cuánto puede remontar'. Sift: '…; no se indica cuánto puede remontar'. That article answers it: '…de la 15ª posición a la 10ª, es posible puntuar'. Pairs: /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/t2/guardian-home-pairs.txt.

Repro: SIFT_PORT=9462 SIFT_TAB=T2-news bun scripts/act.ts goto:https://www.theguardian.com/international wait:15000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("a")].find(a=>/takeaway|takeout/i.test(a.innerText)).innerText'. Also goto:https://www.lanacion.com.ar/deportes/automovilismo/el-video-revelador-sobre-el-toque-que-dejo-afuera-a-franco-colapinto-del-gran-premio-de-los-estados-nid26102026/ wait:15000 'eval:[...document.querySelector("sift-root").shadowRoot.querySelectorAll("a")].find(a=>/remontar/.test(a.innerText)).innerText'.

Suspected cause: The one-line rewrite sees only the teaser. When a curiosity-gap headline ends in '…' or 'cuánto…', the model turns it into a statement that the answer is missing.

Skeptic: Confirmed. Guardian international: the original teaser is 'Should we tip on takeaway? We weighed all angles and the answer is …'. Sift's line is 'Whether people should tip on takeaway remains unanswered'. The article does answer: 'The bottom line: tipping for takeout doesn't make sense as a custom. It should be resisted unless it's entrenched…'. Its byline is 'Ward Farnsworth and Saul Levmore'. La Nación: the original is '…Fórmula 1: cuánto puede remontar'. Sift's line is '…Fórmula 1; no se indica cuánto puede remontar'. Both lines tell the reader something false about the article. The headline prompt rule in src/background/index.ts line 98 ('keep its own words, made plain, and not as a question') pushes the model to turn a curiosity gap into a claim that the answer is missing.

Skeptic's fix lead: In the headline prompt in src/background/index.ts (around lines 97-98), add a rule. The answer to a question or teaser headline is in the story, so never say it is missing, unknown, unanswered or 'no se indica'. Keep the topic as a plain phrase instead ('Tipping on takeaway: the authors weigh the case'; 'Colapinto largará 21º en Austin: cuánto puede remontar').
