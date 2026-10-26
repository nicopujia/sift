#!/usr/bin/env python3
"""Daily Sift usage from Caddy's access log for sift.pujia.ar.

Each install sends one anonymous /e request per finished day of use, with plain
counters: page (pages shown in Sift), toOriginal, toSift, action, loadMore,
aiLines, aiCondense, error, msTotal/msCount (time to first Sift view).
`i` is a random id made fresh for each day's report, only so a retried report
is counted once; it does not link one day to another, so "installs" means
installs used that day. The log keeps no IP, browser, or country (see the
sift.pujia.ar block in the Caddyfile).

Usage: python3 scripts/stats.py [days]   (default 14)
"""
import glob, gzip, json, sys
from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import parse_qs, urlsplit

LOG = '/home/linuxbrew/.linuxbrew/var/log/sift-access*.log*'
days = int(sys.argv[1]) if len(sys.argv) > 1 else 14
since = (date.today() - timedelta(days=days)).isoformat()

def lines():
    for f in sorted(glob.glob(LOG)):
        op = gzip.open if f.endswith('.gz') else open
        with op(f, 'rt', errors='replace') as fh:
            yield from fh

per_day = defaultdict(lambda: {'installs': set(), 'sum': defaultdict(int)})
seen = set()
for line in lines():
    try:
        uri = json.loads(line).get('request', {}).get('uri', '')
    except ValueError:
        continue
    if not uri.startswith('/e?'):
        continue
    q = {k: v[0] for k, v in parse_qs(urlsplit(uri).query).items()}
    d, i = q.get('d', ''), q.get('i', '')
    if not d or d < since or i in ('', 'test', 'deploy-check') or (d, i) in seen:
        continue
    seen.add((d, i))
    day = per_day[d]
    day['installs'].add(i)
    for k, v in q.items():
        if k not in ('d', 'i', 'v') and v.lstrip('-').isdigit():
            day['sum'][k] += int(v)

cols = ['page', 'toOriginal', 'action', 'aiLines', 'aiCondense', 'error']
print(f"{'day':10}  installs  " + '  '.join(f'{c:>10}' for c in cols) + '  first-view')
for d in sorted(per_day):
    s = per_day[d]['sum']
    ms = f"{s['msTotal'] // s['msCount']} ms" if s.get('msCount') else '-'
    print(f"{d:10}  {len(per_day[d]['installs']):8}  " + '  '.join(f'{s.get(c, 0):>10}' for c in cols) + f'  {ms:>10}')
if not per_day:
    print('(no events yet)')
