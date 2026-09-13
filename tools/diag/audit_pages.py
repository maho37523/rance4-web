#!/usr/bin/env python3
"""
Static control-flow audit of the Chinese SA.ALD.

Motivation: page 7's deadlock came from a text run that reached the page end
without a terminator.  Page 69 has a near-call to address 4666 in a 4489-byte
page, which cannot succeed either.  This tool walks every page from its entry
point along the statically decidable control-flow edges and reports every jump
or call target that falls outside the page, so the engine-side and data-side
share one numbered list of offenders.

Decoding rules come from the engine:
  * scenario.c  sl_getc / sl_getw / sl_getaddr
  * cali.c      expression grammar (0x7f terminator)
  * cmd_check.c per-opcode argument order

Anything not confidently decoded advances one byte and is marked "?"; the walk
only reports a target when the target byte was reached with a full decode, so a
mis-decode cannot manufacture an out-of-range reference silently.
"""
import struct
import sys
import os
from collections import defaultdict


def load_ald(path):
    data = open(path, 'rb').read()
    ofssize = (data[0] | data[1] << 8 | data[2] << 16) << 8
    linksize = ((data[3] | data[4] << 8 | data[5] << 16) << 8) - ofssize
    link = data[ofssize:ofssize + linksize]
    otbl = data[:ofssize]

    def page(n):
        idx = link[n * 3 + 1] | link[n * 3 + 2] << 8
        off = (otbl[idx * 3] | otbl[idx * 3 + 1] << 8 | otbl[idx * 3 + 2] << 16) << 8
        ptr = struct.unpack_from('<I', data, off)[0]
        size = struct.unpack_from('<I', data, off + 4)[0]
        return data[off + ptr:off + ptr + size]

    return page, len(link) // 3


# opcode -> argument signature for the commands that can move the PC or that we
# must skip to stay aligned.  e = cali expression, a = dword address,
# v = variable ref, n = single byte, s = string to 0x3a.
SIG = {
    0x40: 'a',        # @ GOTO
    0x5c: 'a',        # \ CALL / RET
    0x7b: 'ea',       # { IF expr GOTO addr
    0x7d: '',         # } endif
    0x25: 'e',        # % pagecall
    0x26: 'e',        # & pagejump
    0x24: 'a',        # $ menuitem
    0x5d: '',         # ] menu
    0x23: 'ae',       # # datatable
    0x3c: 'for',      # < for
    0x3e: 'a',        # > loopend
    0x21: 've',       # ! let
    0x10: 've', 0x11: 've', 0x12: 've', 0x13: 've',
    0x14: 've', 0x15: 've', 0x16: 've', 0x17: 've',
    0x59: 'ee',       # Y
    0x5a: 'ee',       # Z
    0x00: '',         # NOP
}


class Walker:
    def __init__(self, d):
        self.d = d
        self.n = len(d)
        self.bad = []          # (page, pc, kind, target)
        self.visited = set()
        self.undecoded = 0

    def cali(self, i):
        start = i
        while i < self.n:
            c = self.d[i]; i += 1
            if c == 0x7f:
                return i, True
            if c & 0x80:
                # variable reference
                if c == 0xc0:
                    if i >= self.n:
                        return i, False
                    c1 = self.d[i]; i += 1
                    if c1 == 1:
                        if i + 1 >= self.n:
                            return i, False
                        i += 2
                        i, ok = self.cali(i)
                        if not ok:
                            return i, False
                    elif c1 < 0x40:
                        return i, False
                # 0x80..0xbf and 0xc1..0xff are one byte
            elif c in (0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e):
                pass
            elif c & 0x40:
                pass
            else:
                if i >= self.n:
                    return i, False
                i += 1
        return i, False

    def var(self, i):
        if i >= self.n:
            return i, False
        c0 = self.d[i]; i += 1
        if (c0 & 0x40) == 0:
            return i, True
        if i >= self.n:
            return i, False
        c1 = self.d[i]; i += 1
        if c0 == 0xc0 and c1 == 1:
            if i + 1 >= self.n:
                return i, False
            i += 2
            return self.cali(i)
        if c0 == 0xc0 and c1 < 0x40:
            return i, False
        return i, True

    def dword(self, i):
        if i + 4 > self.n:
            return None, i
        return struct.unpack_from('<I', self.d, i)[0], i + 4

    def walk(self, page, start, is_far_call):
        stack = [start]
        while stack:
            pc = stack.pop()
            while 0 <= pc < self.n:
                if pc in self.visited:
                    break
                self.visited.add(pc)
                d = self.d
                c = d[pc]
                nxt = pc + 1
                if c == 0x00 or c == 0x20 or c >= 0x80:
                    # text run: consume lead bytes like message() does
                    if c == 0x20:
                        pc += 1
                        continue
                    if c >= 0x81 and c <= 0xfe:
                        if nxt < self.n and 0x40 <= d[nxt] <= 0xfe and d[nxt] != 0x7f:
                            pc += 2
                        else:
                            pc += 1
                    else:
                        pc += 1
                    continue
                sig = SIG.get(c)
                if sig is None:
                    self.undecoded += 1
                    pc += 1
                    continue
                i = nxt
                ok = True
                targets = []
                if sig == '':
                    pass
                elif sig == 'a':
                    t, i = self.dword(i)
                    if t is None:
                        ok = False
                    else:
                        targets.append(('GOTO/CALL', t))
                elif sig == 'e':
                    i, ok = self.cali(i)
                elif sig == 'ae':
                    t, i = self.dword(i)
                    i, ok = self.cali(i)
                elif sig == 'ea':
                    i, ok = self.cali(i)
                    t, i = self.dword(i)
                    if t is None:
                        ok = False
                    else:
                        targets.append(('IF->', t))
                elif sig == 've':
                    i, ok = self.var(i)
                    if ok:
                        i, ok = self.cali(i)
                elif sig == 'ee':
                    i, ok = self.cali(i)
                    if ok:
                        i, ok = self.cali(i)
                elif sig == 'for':
                    if i < self.n:
                        k = d[i]; i += 1
                        if k != 1:
                            i += 2
                        t, i = self.dword(i)
                        i, ok = self.var(i)
                        if ok:
                            i, ok = self.cali(i)
                        if ok:
                            i, ok = self.cali(i)
                        if ok:
                            i, ok = self.cali(i)
                if not ok:
                    self.undecoded += 1
                    pc += 1
                    continue
                for kind, t in targets:
                    if not (0 <= t < self.n):
                        self.bad.append((page, pc, kind, t))
                # A near-call target is walked as a separate entry.
                if c == 0x5c and targets:
                    t = targets[0][1]
                    if 0 <= t < self.n:
                        stack.append(t)
                    pc = i
                    continue
                if c == 0x40 and targets:       # unconditional goto
                    t = targets[0][1]
                    pc = t if 0 <= t < self.n else i
                    continue
                if c == 0x7b and targets:       # conditional
                    t = targets[0][1]
                    pc = i
                    continue
                pc = i


def main():
    from _paths import ald_or_die
    path = ald_or_die(sys.argv[1] if len(sys.argv) > 1 else None)
    page_of, npages = load_ald(path)
    total_bad = 0
    pages_bad = []
    for n in range(npages):
        d = page_of(n)
        if not d:
            continue
        entry = struct.unpack_from('<I', d, 4)[0] if len(d) >= 8 else 0
        if entry >= len(d):
            entry = 32
        w = Walker(d)
        w.walk(n, entry, False)
        if w.bad:
            pages_bad.append((n, len(d), w.bad, w.undecoded, len(w.visited)))
            total_bad += len(w.bad)
    print(f'{os.path.basename(path)}: {npages} pages, {len(pages_bad)} pages with out-of-page targets, {total_bad} refs')
    for n, size, bad, und, vis in pages_bad:
        kinds = defaultdict(list)
        for page, pc, kind, t in bad:
            kinds[kind].append((pc, t))
        desc = ', '.join(f'{k} @{pcs[0][0]}->{pcs[0][1]}' + (f' (+{len(pcs)-1})' if len(pcs) > 1 else '')
                         for k, pcs in kinds.items())
        print(f'  page {n:<4} size={size:<7} visited={vis:<6} undecoded={und:<5} {desc}')


if __name__ == '__main__':
    main()
