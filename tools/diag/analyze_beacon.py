#!/usr/bin/env python3
"""
Parse the beacon log produced by the instrumented build.

Every posted line carries the whole 160-event history, so the log is
quadratic in size.  The engine's *current* state is always the LAST record of
the LAST line, and the useful control-flow stream is the sequence of last
records, with consecutive duplicates removed.

usage:
  analyze_beacon.py <log> [--from-frame N] [--page P] [--limit N]
                    [--markers] [--dump-keys]
"""
import re
import sys
import os
from collections import Counter

REC = re.compile(r'(\d+):(\d+):(\d+):(\d+):(-?\d+):(\w+)>(-?\d+)')


def parse(path, max_bytes=None):
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        if max_bytes and size > max_bytes:
            f.seek(size - max_bytes)
            f.readline()
        data = f.read().decode('utf-8', 'replace')
    states = []          # newest record of each line, consecutive dedup
    markers = []         # whole line head + its newest record
    for line in data.splitlines():
        if not line.strip():
            continue
        head, _, ring = line.partition('|')
        tag = head.split()[0] if head.split() else '?'
        fm = re.search(r'f=(\d+)', head)
        frame = int(fm.group(1)) if fm else -1
        recs = REC.findall(ring)
        last = recs[-1] if recs else None
        if last:
            t = (frame, tag, int(last[0]), int(last[1]), int(last[2]), int(last[3]), last[5], int(last[6]))
            if not states or states[-1][2:] != t[2:]:
                states.append(t)
        if tag not in ('SEQ', 'SEQ7', 'JUMP', 'JUMP7', 'TICK'):
            markers.append((frame, tag, head))
    return states, markers


def main():
    path = sys.argv[1]
    args = sys.argv[2:]
    def opt(name, default=None):
        if name in args:
            return args[args.index(name) + 1]
        return default
    from_frame = int(opt('--from-frame', '-1'))
    only_page = opt('--page')
    only_page = int(only_page) if only_page is not None else None
    limit = int(opt('--limit', '200'))
    max_bytes = int(opt('--tail-bytes', str(400 * 1024 * 1024)))

    states, markers = parse(path, max_bytes)
    print(f'# {path}: {len(states)} distinct states, {len(markers)} marker lines')

    if '--dump-keys' in args:
        print('== marker tags ==')
        for k, v in Counter(m[1] for m in markers).most_common():
            print(f'  {k}: {v}')
        return

    if '--markers' in args:
        seen = set()
        for frame, tag, head in markers:
            key = (tag, head.split('|')[0])
            if key in seen:
                continue
            seen.add(key)
            print(f'f={frame} {head[:200]}')
        return

    shown = 0
    for t in states:
        frame, tag, rframe, page, pc, op, kind, dst = t
        if frame < from_frame:
            continue
        if only_page is not None and page != only_page:
            continue
        print(f'f={frame:<7} {tag:<9} pc={pc:<6} op={op:<4} {kind}>{dst}')
        shown += 1
        if shown >= limit:
            break


if __name__ == '__main__':
    main()
