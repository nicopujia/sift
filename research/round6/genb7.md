# Round 6 findings: genb7

Each was reproduced by a skeptic. F6xx are new in round 6; older ids are findings a round 6 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F632 (high): weather.gov location suggestions cannot be picked; ArrowDown+Enter gives a different place than on the original

Found by: T4-generic. Where: https://forecast.weather.gov/MapClick.php?lat=37.7749&lon=-122.4194 (location field)

Evidence: Typing 'Springfield' into Sift's field makes the original show 10 clickable suggestions (div.autocomplete-suggestion). Sift shows them as one yellow notice banner of run-together text ('Springfield, IL, USA Springfield, MA, USA Springfield, MO, USA …') with no links or buttons. ArrowDown x3 in Sift selects nothing (.autocomplete-selected is null, value stays 'Springfield'), and Enter opens Springfield, IL (lat=39.7994&lon=-89.6436). On the original with Sift off, the same keys select 'Springfield, MO, USA' and Enter opens lat=37.2155&lon=-93.2924. Typing a full 'Seattle, WA' and pressing Go does work. Shots: /home/nico/projects/sift-test-4/research/shots/r6t4-nws-springfield.png, /home/nico/projects/sift-test-4/research/shots/r6t4-nws-typing.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts 'goto:https://forecast.weather.gov/MapClick.php?lat=37.7749&lon=-122.4194' wait:9000 'type:input[name=inputstring]=>Springfield' wait:4000 shot:x press:ArrowDown press:ArrowDown press:ArrowDown "eval:document.querySelector('.autocomplete-selected')?.textContent" press:Enter wait:9000 url. Gives null and lat=39.7994 (IL). With Sift off, the same keys give 'Springfield, MO, USA' and lat=37.2155.

Suspected cause: The suggestion box is an absolutely positioned body-level div with no role and no links (jQuery autocomplete). Sift classifies it as a notice/toast and renders its text. Arrow keys typed in Sift's field are not replayed in a way the plugin's keydown handler sees.

Skeptic: Reproduced twice. Typing 'Springfield' into Sift's location field makes the original show 10 div.autocomplete-suggestion. Sift renders them as one p.notice.warn (also a role=status line) of run-together text with 0 links or buttons (research/shots/skeptic-nws-spring.png). After ArrowDown x3 (and x2 on the second run), .autocomplete-selected is null and the value stays 'Springfield'. Enter then opens lat=39.7994&lon=-89.6436 (Springfield, IL). With Sift off, the same keys select 'Springfield, MO, USA' and Enter opens lat=37.2155&lon=-93.2924. Sift's own suggestion handling (suggestKey in src/content/index.ts) only works with a '.sheet.suggest'. This jQuery list is never recognized as a suggestion list, so ArrowDown never reaches the page's keydown handler, and no suggestion can be picked.

Skeptic's fix lead: In src/content/extract/generic.ts, treat a body-level, absolutely positioned box that appears right under the focused field, whose rows start with the typed text (jQuery Autocomplete's .autocomplete-suggestions), as that field's suggestion list. suggestionsOf() and the popup and notice rules should give it a '.sheet.suggest' with one clickable row per suggestion, not a notice. Also, when no suggest sheet exists, let ArrowUp and ArrowDown from Sift's field be replayed as keydown on the page field (src/content/index.ts onSiftKey/suggestKey, src/content/proxy.ts).

## F633 (medium): Stack Overflow: 'Show 8 more comments' on the question jumps the view past all the new comments

Found by: T4-generic. Where: https://stackoverflow.com/questions/927358/how-do-i-undo-the-most-recent-local-commits-in-git (question's comments, inside the closed 'Comments' fold)

Evidence: Before the click, Sift's scrollTop is 1435 with the button at y=427. 2 s after the click, scrollTop is 3047: the view jumps 1612 px. Focus moves to the answers' 'Sorted by' select at y=423, and the 13 comments sit at y=-2033…231, all above the view except the last two. The reader lands below the comments and must scroll back up to find the 8 new ones. In the original, the new comments appear below the old ones where the link was. For the answers' newer 'Show all comments' control, the view stays put and focus goes to 'Collapse comments'. Shot: /home/nico/projects/sift-test-4/research/shots/r6t4-so-more8-after.png

Repro: Load the URL with Sift on and wait 12 s. Open the question's 'Comments' summary (h2 'Comments' inside a closed details). Click 'Show 8 more comments' and read Sift's host scrollTop and shadowRoot.activeElement before and 2 s after. Gives 1435 → 3047, with activeElement the 'Highest score (default)…' select.

Suspected cause: When the clicked control is removed, focus falls to the next focusable control. Sift then keeps that control at the clicked spot, which scrolls past the inserted comments.

Skeptic: Reproduced twice in a row. I opened the question's closed 'Comments' fold and clicked 'Show 8 more comments'. Before: Sift's scrollTop was 1479, the button at y=383, and 5 comments at y=-466…340. 1.5 s after: scrollTop was 3091 (a jump of 1612 px), focus was on the 'Highest score (default)…' select at y=379, and the 13 comments sat at y=-2078…186, so only the last two were in view (research/shots/skeptic-so-after.png). With Sift off, the same click on the question's 'Show 8 more' link kept scrollY at 323, and the new comments appear in place below the old ones (research/shots/skeptic-so-orig-after.png). Cause in the code: refocus() in src/content/index.ts walks spot.near (the next controls first) and calls tryFocus(now, true) with scroll=true. That puts the next control, the sort select after all the comments, into view.

Skeptic's fix lead: In src/content/index.ts refocus(), when the removed control was a load-more or expand control and new content now sits in its place, focus the first new entry (or the previous control) with preventScroll, and keep the view's scroll anchor. Do not scroll to the next control in spot.near.

## F634 (medium): Discourse thread: End moves one screen per press instead of going to the last post

Found by: T4-generic. Where: https://users.rust-lang.org/t/is-ai-actually-getting-that-good/143208

Evidence: In Sift, each End press moves the original down one screen. scrollY goes 813, 1626, 2439, 3252, and the authors go 'zugzwanged,Anlis,Schard,simonbuchan' → 'simonbuchan,khimru,farnz,ZiCog,jjpe'. After 6 presses Sift is still at mid-thread (burumdev). On the original with Sift off, 1 End press goes to scrollY 9085, URL /143208/25, showing the last posts 'khimru,MOCKBA'. A keyboard user needs about 15 presses to reach the newest reply in this 20-post thread. Shot: /home/nico/projects/sift-test-4/research/shots/r6t4-discourse-orig-end.png

Repro: SIFT_PORT=9464 SIFT_TAB=T4-generic bun scripts/act.ts goto:https://users.rust-lang.org/t/is-ai-actually-getting-that-good/143208 wait:9000 press:End wait:3000 "eval:[scrollY,location.pathname]" gives [813,'/t/…/143208']. With Sift off, the same steps give [9085,'/t/…/143208/25'].

Suspected cause: The round 5 F500 fix makes Sift step through a thread that unloads posts one screen at a time with stepWith(), and End is handled the same way. End could jump the original to its last post instead.

Skeptic: Reproduced. In Sift, each End press moves the original down exactly one screen: scrollY 813, 1626, 2439, 3252, 4065… and the URL goes /2, /3, /4, /5, /7… It took 14 presses to reach the end (scrollY 10593, /18). With Sift off, one End press gives scrollY 10593, /18, with the last posts khimru, jumpnbrownweasel, notriddle and MOCKBA in view. Cause in the code: edgeScroll() in src/content/index.ts jumps the original to its start for Home (se.scrollTop = 0), but End only calls stepWith(), which moves one innerHeight at a time. Medium: a keyboard user cannot get to the end of a thread in one press.

Skeptic's fix lead: In src/content/index.ts edgeScroll(), treat End like Home. When key === 'End' and cloakedPosts(), set se.scrollTop = se.scrollHeight and dispatch a scroll event, then put Sift's view at its end once the last posts are extracted.

## F637 (medium): Booking destination suggestions in Sift lag 1.5-3 s behind the original and show the previous list under the new text

Found by: T4-generic. Where: https://www.booking.com/ (destination field)

Evidence: I typed into Sift's field and polled every 500 ms. 'Cordoba': the original listed Córdoba results at 1963 ms, while Sift still showed 'San Carlos de Bariloche | Mendoza 2 adults' until 4013 ms and updated at 4795 ms. 'Salta': the original updated by 1256 ms, Sift by 3066 ms. During the gap, a click on Sift's first suggestion would pick the stale destination. Earlier, 4 s after typing 'Bariloche', Sift still showed the default list (Mendoza, Niagara Falls, Toronto…) while the original had Bariloche results. Shot: /home/nico/projects/sift-test-4/research/shots/r6t4-booking-typing2.png. The machine is busy, but the original was measured at the same time in the same tab.

Repro: Load https://www.booking.com/ in Sift, wait 12 s, then run bun /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/sugg-lag.ts Cordoba with SIFT_PORT=9464 SIFT_TAB=T4-generic. The script clears Sift's search field, types the word, and every 500 ms prints Sift's suggestion buttons next to the original's [data-testid=autocomplete-result].

Suspected cause: Re-extraction after the suggestion list's mutations is debounced or queued behind a slow full extract. The list under a focused field could be refreshed first.

Skeptic: Reproduced with the agent's script, 3 words, while the machine was less loaded (load average about 4.5 on 6 cores). The original showed new results at 1421, 1269 and 1293 ms. Sift showed them at 2429, 2780 and 2301 ms. Until then, Sift still showed the old 'San Carlos de Bariloche | Mendoza' list. So Sift was about 1.0 to 1.5 s behind, not the 1.5 to 3 s claimed, but the lag is real and the same every time. During it, a click on Sift's first suggestion would pick a destination the original no longer offers. Cause in the code: the input path in src/content/index.ts runs schedule(0) 300 ms after the last keystroke, which is before the network answer arrives. The list's later mutations then go through the routine idle path of schedule(): up to 800 ms, or lastDur*9, plus a requestIdleCallback with a timeout of 600 ms.

Skeptic's fix lead: In src/content/index.ts, while a field with a suggestion list has focus and was typed in within the last ~3 s, schedule mutations promptly (schedule(0) or a delay under 100 ms) instead of through the idle backoff in schedule(). Or keep the typedRun fast path active until the list changes.
