#!/usr/bin/env python3
"""
Page 69 audit: prove that the broken near-call targets all fall in the gap
between the translated page length and the header's original body length.

usage: page69_audit.py [ald] [page]
"""
import struct
import sys


def page_of(path, n):
    data = open(path, 'rb').read()
    ofssize = (data[0] | data[1] << 8 | data[2] << 16) << 8
    linksize = ((data[3] | data[4] << 8 | data[5] << 16) << 8) - ofssize
    link = data[ofssize:ofssize + linksize]
    otbl = data[:ofssize]
    idx = link[n * 3 + 1] | link[n * 3 + 2] << 8
    off = (otbl[idx * 3] | otbl[idx * 3 + 1] << 8 | otbl[idx * 3 + 2] << 16) << 8
    ptr = struct.unpack_from('<I', data, off)[0]
    size = struct.unpack_from('<I', data, off + 4)[0]
    return data[off + ptr:off + ptr + size]


def main():
    from _paths import ald_or_die
    path = ald_or_die(sys.argv[1] if len(sys.argv) > 1 else None)
    page = int(sys.argv[2]) if len(sys.argv) > 2 else 69
    p = page_of(path, page)
    n = len(p)
    entry = struct.unpack_from('<I', p, 4)[0]
    original = struct.unpack_from('<I', p, 8)[0]
    print(f'page {page}: len={n} entry={entry} dword@8(original body len)={original}')
    print(f'  missing tail bytes = {original - n}')
    limit = min(original, n - 5)
    targets = [struct.unpack_from('<I', p, j + 1)[0] for j in range(32, limit) if p[j] == 0x5c]
    # Ignore operands that are obviously not addresses (decoded from text/data).
    targets = [t for t in targets if 0 < t < 1 << 20]
    inpage = sorted(set(t for t in targets if t < n))
    outpage = sorted(set(t for t in targets if t >= n))
    print(f'  0x5c call operands: {len(targets)} total, targets in-page={inpage}')
    print(f'  out-of-page targets ({len(outpage)}): {outpage}')
    gap = [t for t in outpage if t <= original]
    print(f'  of those, inside the missing tail ({n}..{original}]: {gap}')
    if not outpage:
        print('  => no out-of-page call operands: the page is self-contained.')
    elif gap and len(gap) == len(outpage):
        print('  => every broken target lies in the truncated tail: the page tail was cut off.')
        print(f'  => repairing this page needs {original - n} bytes currently outside the')
        print(f'     declared page (set the ALD entry size to {original}).')
    else:
        print('  => some broken targets are beyond the original length; not a simple truncation.')


if __name__ == '__main__':
    main()
