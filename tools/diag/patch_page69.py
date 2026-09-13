#!/usr/bin/env python3
"""
Repair page 69 of the Chinese SA.ALD by restoring the tail that the translation
left as an orphan.

Measured facts (see FINDINGS.md section 5):
  * page 69's ALD entry declares size 4489, but the bytes that follow it in the
    file (up to the next page's entry) begin with exactly the LET/%48 table rows
    that are missing from the page;
  * every one of the page's 244 near-call operands is (Japanese value + 244) and
    213 of them therefore fall outside the declared 4489 bytes;
  * the page header's dword@8 already says 4733 = 4489 + 244.

So the page content is present but its declared length is 244 bytes short.
This script rewrites the ALD entry's size (offset+4) and the page header's
dword@8 to 4733, leaving every other byte untouched.

usage: patch_page69.py <src.ald> <dst.ald> [--size N]
"""
import struct
import sys


def locate(data, n):
    ofssize = (data[0] | data[1] << 8 | data[2] << 16) << 8
    linksize = ((data[3] | data[4] << 8 | data[5] << 16) << 8) - ofssize
    link = data[ofssize:ofssize + linksize]
    otbl = data[:ofssize]
    idx = link[n * 3 + 1] | link[n * 3 + 2] << 8
    off = (otbl[idx * 3] | otbl[idx * 3 + 1] << 8 | otbl[idx * 3 + 2] << 16) << 8
    return off


def main():
    src, dst = sys.argv[1], sys.argv[2]
    size = 4733
    if '--size' in sys.argv:
        size = int(sys.argv[sys.argv.index('--size') + 1])
    data = bytearray(open(src, 'rb').read())
    page = 69
    off = locate(data, page)
    ptr = struct.unpack_from('<I', data, off)[0]
    old = struct.unpack_from('<I', data, off + 4)[0]
    start = off + ptr

    # refuse if the enlarged page would run into the next page's entry
    nxt = locate(data, page + 1)
    if start + size > nxt:
        raise SystemExit(f'refusing: page body {start}+{size} would overlap next entry {nxt}')
    # the bytes we are claiming must look like the missing table rows
    tail = bytes(data[start + old:start + size])
    if tail[:5] != bytes.fromhex('7f254 87f'.replace(' ', '')):
        print('warning: tail does not start with the expected "%48" row fragment')

    struct.pack_into('<I', data, off + 4, size)      # ALD entry size
    struct.pack_into('<I', data, start + 8, size)    # page header dword@8
    open(dst, 'wb').write(data)
    print(f'page {page}: size {old} -> {size} (entry {off}, body {start})')
    print(f'  wrote {dst}; file size unchanged: {len(data)}')


if __name__ == '__main__':
    main()
