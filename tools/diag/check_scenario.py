#!/usr/bin/env python3
"""
Regression checks for the scenario data, pinned to the defects this project
actually hit.

Design note: general rules over the whole archive are tempting but they do not
hold.  I first asserted "entry size >= header dword@8" for every page; that
flags 163 of 201 pages, including pages that have always worked, so the header
field is not a general page-length contract.  A raw 0x5c scan likewise reports
non-instruction bytes inside text on almost every page.

So the checks below are explicit per-page contracts.  They are narrow on
purpose: each one is a fact that was established by measurement, and each one
fails if that fact stops being true.

C1  page 69: every near-call operand must stay inside the page.
    It shipped with 213 of 244 operands pointing past the end because the ALD
    entry declared 4489 bytes while the header declared 4733; the page tail was
    still in the file, just outside the declared page.  patch_page69.py sets
    the entry size to 4733.

C2  page 69: the entry size must equal the header length (4733).
    This is the invariant the patch establishes, and it is what makes C1 hold.

C3  page 7: the last text run reaches the page end with no terminator, which is
    why the engine must handle a run that ends exactly at the boundary.

usage:
  check_scenario.py [ald]
  exit status: 0 = all contracts hold
"""
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _paths import ald_or_die, sa_backup  # noqa: E402

PAGE69_MIN_TARGET = 4100      # page 69's near calls live in this window, which
PAGE69_MAX_TARGET = 4799      # is above any 0x5c byte that occurs as text data


def read_index(data):
    ofssize = (data[0] | data[1] << 8 | data[2] << 16) << 8
    linksize = ((data[3] | data[4] << 8 | data[5] << 16) << 8) - ofssize
    if ofssize <= 0 or linksize <= 0 or ofssize + linksize > len(data):
        raise SystemExit('not an ALD file')
    return data[ofssize:ofssize + linksize], data[:ofssize], linksize // 3


def page(data, n):
    link, otbl, count = read_index(data)
    if n >= count or link[n * 3] == 0:
        raise SystemExit(f'page {n} is not present')
    idx = link[n * 3 + 1] | link[n * 3 + 2] << 8
    off = (otbl[idx * 3] | otbl[idx * 3 + 1] << 8 | otbl[idx * 3 + 2] << 16) << 8
    ptr = struct.unpack_from('<I', data, off)[0]
    size = struct.unpack_from('<I', data, off + 4)[0]
    return size, data[off + ptr:off + ptr + size]


def header_length(body):
    return struct.unpack_from('<I', body, 8)[0] if len(body) >= 12 else 0


def page69_targets(body):
    return [(j, struct.unpack_from('<I', body, j + 1)[0])
            for j in range(32, len(body) - 4)
            if body[j] == 0x5c
            and PAGE69_MIN_TARGET <= struct.unpack_from('<I', body, j + 1)[0] <= PAGE69_MAX_TARGET]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    path = ald_or_die(args[0] if args else None)
    data = path.read_bytes()
    failures = []

    size69, body69 = page(data, 69)
    targets = page69_targets(body69)
    outside = [(j, t) for j, t in targets if t >= len(body69)]
    print(f'{path}')
    print(f'  page 69: entry size={size69} body={len(body69)} header={header_length(body69)}')
    print(f'  page 69: {len(targets)} near-call operands in the 0x{ PAGE69_MIN_TARGET:x}-0x{PAGE69_MAX_TARGET:x} window')

    # C1
    if outside:
        failures.append('C1')
        print(f'  C1 FAIL: {len(outside)} near-call operand(s) point past the page')
        for j, t in outside[:6]:
            print(f'    @{j} -> {t} (page ends at {len(body69)})')
    else:
        print('  C1 ok: every near-call operand stays inside the page')

    # C2
    hdr = header_length(body69)
    if size69 != hdr:
        failures.append('C2')
        print(f'  C2 FAIL: entry size {size69} != header length {hdr}')
    else:
        print(f'  C2 ok: entry size matches the header length ({hdr})')

    # C3 (informational: documents why the engine needs a page-end path)
    size7, body7 = page(data, 7)
    last = body7[-1] if body7 else 0
    if last == 0x20 or last >= 0x80:
        print(f'  C3 ok: page 7 ends inside a text run (last byte 0x{last:02x}), '
              f'so a run reaches the page boundary with no terminator')
    else:
        print(f'  C3 note: page 7 no longer ends inside a text run (last byte 0x{last:02x}); '
              f'the engine page-end path is now only required for C1/C2 data')

    backup = sa_backup()
    if backup:
        print(f'  untouched backup: {backup.name}')

    if failures:
        print(f'  RESULT: FAIL ({" ".join(failures)})')
        return 1
    print('  RESULT: all contracts hold')
    return 0


if __name__ == '__main__':
    sys.exit(main())
