# Round 8 findings: ext11

Each was reproduced by a skeptic. F8xx are new in round 8; older ids are findings a round 8 recheck found not fully fixed. The suspected cause and fix are leads, not orders.

## F834 (high, regression): A <details> whose summary looks like a date or 'Word N.NN' loses all its content ('Release 2.10', 'Python 3.12', 'Tuesday, October 27, 2026', '2026-10-20')

Found by: R1-extractor. Where: src/content/extract/generic.ts:5420 (details(), the dateline rule added in round 7)

Evidence: Fixture /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8/fx/versiondetails.html: before the round 7 fixes, 'section: Release 2.10' showed 3 changes and 'section: Python 3.12' showed its paragraph. Now these are only 'p(small): Release 2.10' and 'p(small): Python 3.12' with no content. 'Release 2.9 (beta)' is unaffected. fx/datedetails.html (council minutes per date): before, 3 sections with their decisions. Now only 'p(small): Tuesday, October 27, 2026', 'p(small): 2026-10-20', 'p(small): 13 Oct 2026', and every decision and the minutes PDF link are gone. The real extension (9468, the same files served from 127.0.0.1:8868) shows the same: plain lines, no content.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8 && bun run.ts now.js,r6.js $PWD/fx/versiondetails.html 1 --as http://docs.fixture.test/releases ; bun run.ts now.js,r6.js $PWD/fx/datedetails.html 1 --as http://town.fixture.test/minutes   (now.js = current src, r6.js = tree before the round 7 fixes)

Suspected cause: The rule strips the summary's first word (any 2-9 letters: 'Release', 'Python', 'Tuesday,'). It rewrites any 'd.dd' as a time ('2.10' becomes '2:10'), then asks dateLine. A match returns before walk(), so the body is never read. Nothing checks that the body is only a 'Last modified …' line, as in The Guardian case it was made for.

Skeptic: Reproduced, and it is a regression. I built my own harness bundle from the current src (sk8/mine.js) and compared it with r6.js. versiondetails.html now gives only 'p(small): Release 2.10' and 'p(small): Python 3.12', with no list items or paragraph. r6 shows both as sections with their content. 'Release 2.9 (beta)' is still a section. datedetails.html now gives three small date lines and nothing else. The open first meeting's 3 items and the minutes PDF link are gone. r6 shows all three sections with their content. The real extension (port 9468, files served from 127.0.0.1:8869) shows the same: the summaries are plain lines with no content and no PDF link. The original shows the open details' list. Code at generic.ts:5415-5424 matches the suspected cause. The rule strips any 2-9 letter first word and rewrites 'd.dd' as 'd:dd'. On a dateLine match it returns before walk(), so the body is never read.

Skeptic's fix lead: In details() (generic.ts ~5419), treat the summary as a dateline only when the body adds nothing beyond a date line. For example, require that the details' text minus the summary is empty or itself a short dateLine / 'Last modified|updated' line. Otherwise walk() the body as a section. Also narrow the stripped prefix to weekday names, and rewrite d.dd as a time only when a date or a time zone or am/pm goes with it.

## F835 (medium, regression): foldFileTools hides a how-to's steps in a closed 'Details' section when 5 or more short paragraphs sit between the h1 and a long code block

Found by: R1-extractor. Where: src/content/extract/generic.ts:6885-6897 (foldFileTools, called at 6995)

Evidence: Fixture /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8/fx/shortsteps.html: an h1 'Back up your server every night', 6 short instruction paragraphs ('First, log in as root.', 'Then install rsync…', 'Copy the script below to /usr/local/bin/backup.', …), then a 61-line script. Now: 'h1 …' then 'section: Details (collapsed)' holding all 6 steps, then the code. Before the round 7 fixes, the steps showed in the open. In the real extension the outline is 'H1 Back up your server every night / H2 Details', and the steps are only behind that fold.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8 && bun run.ts now.js,r6.js $PWD/fx/shortsteps.html 1 --as http://ops.fixture.test/backup

Suspected cause: 'small' accepts any p of 80 characters or less, so short sentences of a story or tutorial count as file tools. Nothing asks for a sign of a file view: actions, a commit or path line, or Raw/History links.

Skeptic: Reproduced, and it is a regression. Current bundle on shortsteps.html: 'h1 …', then 'section: Details (collapsed)' holding all 6 instruction paragraphs, then the pre. r6.js shows the 6 paragraphs in the open. The real extension shows the same: the outline is 'H1 Back up your server every night / H2 Details', the steps are hidden behind the closed fold, and the code follows. Code at generic.ts:6885-6897 confirms it. Any p of 80 characters or less counts as 'small'. Five or more such blocks between an h1 and a pre of 40+ lines get folded, with no check for file-view signs. It needs every block between the h1 and the code to be short, so it is narrower than the claim suggests. But it hides a page's main instructions, so medium holds.

Skeptic's fix lead: In foldFileTools (generic.ts ~6888), require file-view evidence before folding. For example, the run must hold at least one 'actions' block or link list (Raw/History/Copy path/Blame), or a commit/path-like line. Do not fold a run that is only sentence paragraphs (p blocks ending in . ! ?).

## F836 (medium, regression): kickerHeading renames a comment after a reply's author, and links it to that person's profile

Found by: R1-extractor. Where: src/content/extract/generic.ts:2537-2556 (kickerHeading; the hs.find at 2552), used by toItem at 2562

Evidence: Fixture /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8/fx/nested-comments.html: 5 comments, each li with an avatar link, h3>a author (user0…user4) and text, plus 2 nested replies by maria_lopez with the same markup. Before the round 7 fixes: '* user0 ->/u/user0 | 2 hours ago · maria_lopez :: Comment 0 says…'. Now each of the 5 comments is '* maria_lopez ->/u/maria_lopez | user0 · 2 hours ago :: Comment 0 says…'. The real extension shows the same: [link] maria_lopez over each comment, and the real author is only a small link under it. (The replies' own text is missing in both builds: a separate, older loss.)

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8 && bun run.ts now.js,r6.js $PWD/fx/nested-comments.html 1 --as http://news.fixture.test/comments

Suspected cause: It counts links over the whole card, nested sub-entries included. Any later heading of the same or higher level whose link occurs at least twice, and more often than the first heading's link, wins. A short linked author name is taken for a kicker, and a reply author who appears twice outranks it.

Skeptic: Reproduced, and it is a regression. On nested-comments.html the current bundle names every comment 'maria_lopez ->/u/maria_lopez', and the real author 'user0' etc. drops into the meta. r6 names them user0-user4. The fixture is contrived (the same replier twice under every comment), so I built a natural thread variant: 4 top comments with h4>a authors, where one thread (dana) has two replies by 'ed'. The current bundle shows dana's comment as '* ed ->/u/ed | dana · Finally. My kids can ride…'. r6 keeps 'dana'. The real extension (9468) shows the same rename on both fixtures: 'maria_lopez' over each comment, and 'ed' over dana's. Code at generic.ts:2537-2556 confirms it. The link counts cover the whole card, nested replies included. hs can pick a reply's heading whose link appears more often than the top author's link. Any thread where one replier posts twice triggers it, and the comment is then credited to the wrong person.

Skeptic's fix lead: In kickerHeading (generic.ts ~2546-2555), ignore nested sub-entries. Skip headings in hs, and anchors in the count map, whose nearest li/article/[role=listitem]/[role=article]/[role=comment] ancestor is not el itself. Then a reply's author can never outrank the card's own heading.

## F837 (medium): Gmail pages the adapter hands to the generic extractor (Settings) show a floating compose twice: as a form in the page and as a modal sheet that makes the page inert

Found by: R1-extractor. Where: src/content/adapters/gmail.ts:330 (g = extractGeneric()), with generic.ts:7001 (findDialog(ctx, blocks) without the adapter's dropDialog)

Evidence: Fixture /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8/fx/gmail-settings-compose.html: a settings view (no tr.zA rows; table rows with text), so list() returns null and the source is gmail-generic. It has the 500x400 floating compose from r7dlg8-gmail-saveclose. Harness: 'DIALOG: New Message' holding the compose form (Save & close, Send), and also 'h2: New Message' + 'form(New Message): To/Subject/Message Body, Send, Discard draft, Save & close' at the top of the page. Real extension (meta sift-test-url mail.google.com): the page view has the compose form, and a .sheet role=dialog aria-modal=true holds a second copy with main inert. The settings and the in-page draft cannot be used while it is open, which is what dlg8 meant to stop.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8 && bun run.ts now.js $PWD/fx/gmail-settings-compose.html 1 --as 'https://mail.google.com/mail/u/0/#settings/general'

Suspected cause: dropDialog is passed only in extract/index.ts when the adapter's page has no dialog. In the gmail-generic path, extractGeneric() already sets page.dialog through findDialog(newCtx()) with no drop. composeDialog() then returns undefined for a floating box and does not clear it, while composeForm adds the page copy.

Skeptic: Reproduced, not a regression. The harness with the URL as mail.google.com/#settings/general gives source=gmail-generic. It shows 'DIALOG: New Message' holding the compose form, and also 'h2: New Message' plus 'form(New Message)' at the top of the page blocks. Real extension (9468, fixture served from 127.0.0.1:8869, meta sift-test-url is mail.google.com): the page view has the compose form. The shadow root also has a div.sheet role=dialog aria-modal=true with a second copy, and header.bar, the skip button and main are inert. So the settings cannot be used while a draft is open. Code confirms it. gmail.ts:330 calls extractGeneric(), and its findDialog(ctx, blocks) runs without the adapter's drop. composeDialog() returns undefined for a floating box and does not clear it. index.ts only fills p.dialog when it is unset ('??='), so dropDialog never applies on this path.

Skeptic's fix lead: In gmail.ts extract(), after 'const g = extractGeneric()' (~line 330), clear a floating compose found by the generic pass. For example: 'const de = elOf(g.dialog?.ref); if (de && gmail.dropDialog?.(de)) g.dialog = undefined;'. Or let extractGeneric take a drop option that is passed into its findDialog call (generic.ts ~7001).

## F838 (medium): WordPress comments lose their authors and dates: footer.comment-meta is dropped as the story's own footer

Found by: R1-extractor. Where: src/content/extract/generic.ts:442-443 (pageFooter, used by isChrome at 459)

Evidence: Live https://wp-themes.com/twentytwentyone/?p=1 (stock Twenty Twenty-One markup) in the real extension: Sift's text has both comments ('Hi, this is a comment.' and 'Need a comment with a real Gravatar.') but neither 'A WordPress Commenter' nor 'Joseph Scott', which the original shows. The harness on the same page and on the fixtures core-wpcomments.html and scratchpad fx/wp-nested.html shows the same: the comment paragraphs and Reply links stay, and every author name and date is missing. This is the same before and after round 7.

Repro: cd /tmp/claude-1001/-home-nico/aac11194-acaf-4dad-a334-0620115b1898/scratchpad/r8 && bun run.ts now.js 'https://wp-themes.com/twentytwentyone/?p=1' 1 --wait 2500 | sed -n '/omment/,$p'

Suspected cause: In wp_list_comments' HTML5 markup, the author (b.fn) and date sit in footer.comment-meta inside article.comment-body. pageFooter finds that article as the closest ancestor. It returns true ('a story's own footer') because the footer holds no field, so isChrome drops it as page chrome.

Skeptic: Reproduced, not a regression. Live https://wp-themes.com/twentytwentyone/?p=1, current harness bundle: '2 comments', then both comment paragraphs, with no 'A WordPress Commenter', 'Joseph Scott' or dates. Real extension (9468): the Sift main text lacks both names and 'June 4, 2008'. The original page's visible body.innerText has 'Joseph Scott'. The fetched markup is stock wp_list_comments HTML5: li > article.comment-body > footer.comment-meta (b.fn > a author, time link). Control test: the same saved HTML with footer.comment-meta changed to div.comment-meta brings back the author link and date link for both comments in the current bundle. That isolates the footer drop. Code at generic.ts:433-445 confirms it. pageFooter finds article.comment-body as the closest ancestor and returns true because the footer holds no CONTROL_SEL element, so isChrome drops it. I did not separately rerun the scratchpad wp-nested.html fixture; the core-wpcomments fixture also shows only comment text and Reply links.

Skeptic's fix lead: In pageFooter (generic.ts ~442), keep a footer that is a comment's meta. For example, return false when p (the article) is itself a comment entry (p.closest('li.comment, [id^=comment-], .comment-body') or a COMMENT-token class on p or its li), or when the footer holds an author or time marker ('.comment-author, .fn, .vcard, time').
