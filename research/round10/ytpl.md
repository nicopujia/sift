# Round 10 findings: ytpl

These come from round 9's done checks (research/round9/w1.json, T1-youtube "YouTube playlist watch" keyboard check). They were noted but not yet fixed.

## F1000 (medium): YouTube playlist watch: no Next or Previous in Sift's media bar, and YouTube's letter shortcuts do nothing while focus is in Sift

Evidence (round 9 done check): on a playlist watch page (watch?v=dQw4w9WgXcQ&list=PL...), Sift's media bar has Pause, Back 10s, Ahead 10s, Mute, Captions and Full screen, but no Next or Previous. With focus in Sift, k, j, l, m, c and Shift+N do nothing. On the original, k pauses, j and l seek 10 s, m mutes, c toggles captions and Shift+N goes to the next item. Next is only reachable through the playlist section's items.

Policy: on a playlist or Mix, Sift's media bar offers Previous and Next that act as the original's buttons do. YouTube's single-letter shortcuts (k, j, l, m, c, f, Shift+N, Shift+P) work while focus is on Sift's media bar or player portal, by replaying them to the page's player, but never while the reader is typing in a field.
