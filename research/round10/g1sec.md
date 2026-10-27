# Round 10 findings: g1sec

Noted by the round 9 g1x13 fixer (research/round9 fix notes) and not yet fixed.

## F1001 (medium): Globo G1 section fronts (/economia/ and the like) show almost nothing in Sift

Evidence (g1x13 notes): on https://g1.globo.com/economia/, Sift shows only H1 'Economia' and the currency ticker repeated 3 times; the section's headlines and feed are missing. This was already so on the round 9 base build. The fixer's unverified guess: the live-updating ticker is taken as a popup or as the page view. The home feed fix (mainFeed) applies only to the front page path.

Policy: a section front shows its headlines and feed like the home page does (compare every headline link on the original with Sift's), and a live ticker shows once, compactly, or goes as noise.
