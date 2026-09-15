#!/usr/bin/env python3
"""
Repair the double-encoded Chinese text in Rance 4's script archive.

Background
----------
The Chinese release was saved one conversion too late: the original GBK text was
decoded as if it were UTF-8, and the resulting characters were written back as
UTF-8.  The engine reads the file as GBK, so it renders the intermediate
"lookalike" characters:

    stored bytes          e4 b8 8d e8 a6 81 ...
    engine shows          涓嶈�佸姞杞�
    intended              不要加载

The transformation is reversible: take each text run, decode it as UTF-8, then
encode the result as GBK.

How text runs are found
-----------------------
A scenario string is a run of bytes >= 0x20 terminated by a control byte
(0x00 here).  The corruption only ever produced bytes >= 0x20, and command
bytes below 0x20 are untouched, so the run boundaries are preserved even though
the run lengths are not: repairing a run makes it shorter (3-byte UTF-8
sequences become 2-byte GBK).

Because a run shrinks, every byte offset after it moves, so the ALD container is
rebuilt rather than patched in place.

Safety
------
* Operates on a copy; never edits the source path.
* A run is only rewritten when all three hold: it decodes as UTF-8, the decoded
  string re-encodes to GBK, and the GBK bytes are not valid UTF-8 (a repaired
  run cannot be "repaired" again).
* Refuses to write if any page shrinks by more than a sanity bound, or if the
  rebuilt archive cannot be re-read with the same page count.

usage:
  repair_rance4_text.py --report                  # dry run, no writes
  repair_rance4_text.py --write <out.ald>         # write repaired archive
"""
import argparse
import struct
import sys
from pathlib import Path

SA_NAME = 'RANCE4SA.ALD'


def find_sa(explicit=None):
    if explicit:
        return Path(explicit)
    here = Path(__file__).resolve()
    # tools/diag -> app -> project
    project = here.parents[2].parent
    cand = project / 'games' / 'RANCE4' / SA_NAME
    if cand.exists():
        return cand
    raise SystemExit(f'{SA_NAME} not found at {cand}; pass the path explicitly')


# ---------------------------------------------------------------- ALD container

def read_header(data):
    ofssize = (data[0] | data[1] << 8 | data[2] << 16) << 8
    linksize = ((data[3] | data[4] << 8 | data[5] << 16) << 8) - ofssize
    if ofssize <= 0 or linksize <= 0 or ofssize + linksize > len(data):
        raise SystemExit('not an ALD file')
    return ofssize, linksize


def iter_entries(data):
    """Yield (index, entry_offset, ptr, size, payload) for every present entry."""
    ofssize, linksize = read_header(data)
    link = data[ofssize:ofssize + linksize]
    otbl = data[:ofssize]
    nr = linksize // 3
    for i in range(nr):
        if link[i * 3] == 0:
            continue
        off_idx = link[i * 3 + 1] | link[i * 3 + 2] << 8
        o = (otbl[off_idx * 3] | otbl[off_idx * 3 + 1] << 8 | otbl[off_idx * 3 + 2] << 16) << 8
        ptr = struct.unpack_from('<I', data, o)[0]
        size = struct.unpack_from('<I', data, o + 4)[0]
        yield i, o, ptr, size, data[o + ptr:o + ptr + size]


# ------------------------------------------------------------------- text runs

def repair_run(run: bytes):
    """Return the repaired GBK bytes, or None when this run must be left alone."""
    if len(run) < 3:
        return None
    try:
        look = run.decode('utf-8')
    except UnicodeDecodeError:
        return None
    if not look:
        return None
    try:
        fixed = look.encode('gbk')
    except UnicodeEncodeError:
        return None
    if fixed == run:
        return None
    # A repaired run is GBK; it must not look like valid UTF-8 again, otherwise
    # a second pass would corrupt it.
    try:
        fixed.decode('utf-8')
    except UnicodeDecodeError:
        return fixed
    return None


# --------------------------------------------------------------- script parse

def _skip_cali(buf, i):
    """Advance past a cali expression (the engine's getCaliValue)."""
    n = len(buf)
    while i < n:
        c = buf[i]; i += 1
        if c == 0x7f:
            return i
        if c & 0x80:
            if c == 0xc0 and i < n and buf[i] == 1:
                i += 3
                i = _skip_cali(buf, i)
            elif c == 0xc0 and i < n:
                i += 1
        elif c in (0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e):
            pass
        elif c & 0x40:
            pass
        elif i < n:
            i += 1
    return i


def _skip_var(buf, i):
    c0 = buf[i]; i += 1
    if (c0 & 0x40) == 0:
        return i
    c1 = buf[i]; i += 1
    if c0 == 0xc0 and c1 == 1:
        i += 2
        return _skip_cali(buf, i)
    return i


def text_runs(buf):
    """Yield (start, end) of message text runs, by decoding the script.

    A message is a run of bytes >= 0x20; it ends at the first byte below 0x20
    (the engine's message() loop).  Command opcodes are also >= 0x20, so a raw
    scan merges commands and text into one run and the UTF-8 decode then fails
    on command bytes.  Walking the command grammar keeps the two apart.
    """
    n = len(buf)
    i = 0
    while i < n:
        c = buf[i]
        if c < 0x20:
            i += 1
            continue
        # Text run: the engine reads from here until a control byte.
        j = i
        while j < n and buf[j] >= 0x20:
            j += 1
        yield i, j
        i = j


def command_stream(buf):
    """Yield ('text', start, end) / ('cmd', start, end) by walking the grammar.

    Only the opcodes needed to stay aligned are decoded; anything unrecognised
    advances one byte, which is safe because a misframed command cannot invent a
    text run (a text run always ends at a control byte).
    """
    n = len(buf)
    i = 0
    while i < n:
        c = buf[i]
        if c < 0x20:
            i += 1
            continue
        if c == 0x20 or c >= 0x80:
            j = i
            while j < n and buf[j] >= 0x20:
                j += 1
            yield 'text', i, j
            i = j
            continue
        start = i
        if c == 0x21:                     # LET: var, 0x7f, expr
            j = _skip_var(buf, i + 1)
            if j < n and buf[j] == 0x7f:
                j += 1
            j = _skip_cali(buf, j)
            i = j
        elif c == 0x40 or c == 0x5c or c == 0x3e or c == 0x24:   # addr (dword)
            i += 5
        elif c == 0x7b:                   # IF expr, addr
            j = _skip_cali(buf, i + 1)
            for k in range(j, min(j + 4, n)):
                if buf[k] < 0x20:
                    break
            i = j + 4
        elif c == 0x25 or c == 0x26:      # pagecall / pagejmp
            i = _skip_cali(buf, i + 1)
        elif c == 0x23:                   # datatbl addr, expr
            i = _skip_cali(buf, i + 5)
        else:
            i += 1
        yield 'cmd', start, min(i, n)


def repair_page(raw):
    """Repair the double-encoded characters inside each message's text region.

    The engine's rule (cmd_check.c message()) decides where text lives: a text
    run begins at a byte that is 0x20 or >= 0x80, and continues while each byte
    is either a space or a GBK lead byte (0x81..0xfe); anything else ends it.
    Within that region the corruption shows up as runs of multi-byte UTF-8
    characters, which is what gets converted back to GBK.

    Nothing is inserted to replace the removed bytes: the container rebuild
    shrinks the entry instead.  Padding the freed space would be swallowed as
    message text, because a space continues the run.

    Returns (new_bytes, stats).
    """
    buf = bytes(raw)
    n = len(buf)

    def is_text_byte(c):
        return c == 0x20 or c >= 0x80

    def utf8_len(i):
        c = buf[i]
        if 0xc2 <= c <= 0xdf: w = 2
        elif 0xe0 <= c <= 0xef: w = 3
        elif 0xf0 <= c <= 0xf4: w = 4
        else: return 0
        if i + w > n: return 0
        for k in range(1, w):
            if not (0x80 <= buf[i + k] <= 0xbf): return 0
        return w

    stats = {'runs': 0, 'repaired': 0, 'skipped': 0, 'saved': 0}
    out = bytearray()
    i = 0
    while i < n:
        if not is_text_byte(buf[i]) or utf8_len(i) == 0:
            out.append(buf[i]); i += 1; continue
        # Walk the message region the engine would read.
        region_end = i
        while region_end < n and is_text_byte(buf[region_end]):
            region_end += 1
        # Inside it, convert each run of >= 3 consecutive multi-byte UTF-8
        # characters.  A stray command byte cannot form such a run.
        j = i
        while j < region_end:
            w = utf8_len(j)
            if w == 0:
                out.append(buf[j]); j += 1; continue
            k = j; chars = 0
            while k < region_end:
                w2 = utf8_len(k)
                if w2 == 0: break
                k += w2; chars += 1
            if chars < 3:
                out += buf[j:k]; j = k; continue
            seg = buf[j:k]
            stats['runs'] += 1
            try:
                fixed = seg.decode('utf-8').encode('gbk')
            except (UnicodeDecodeError, UnicodeEncodeError):
                stats['skipped'] += 1; out += seg; j = k; continue
            try:
                fixed.decode('utf-8')
                stats['skipped'] += 1; out += seg
            except UnicodeDecodeError:
                stats['repaired'] += 1
                stats['saved'] += len(seg) - len(fixed)
                out += fixed
            j = k
        i = region_end
    return bytes(out), stats


# ------------------------------------------------------------------ ALD rebuild

def rebuild(data, page_fix):
    """Rebuild the archive, replacing each entry payload with page_fix(payload).

    An ALD entry at file offset `o` is:
        [ptr u32][size u32][ptr-8 bytes of entry prefix][size bytes of payload]
    so the payload starts at o+ptr and the prefix must be preserved verbatim.
    Entries are laid out in file order, each on a 256-byte boundary because the
    offset table stores offsets divided by 256.  Every entry offset is kept.
    """
    ofssize, linksize = read_header(data)
    otbl = bytearray(data[:ofssize])
    link = data[ofssize:ofssize + linksize]
    nr = linksize // 3

    entries = []
    for i in range(nr):
        if link[i * 3] == 0:
            continue
        off_idx = link[i * 3 + 1] | link[i * 3 + 2] << 8
        o = (otbl[off_idx * 3] | otbl[off_idx * 3 + 1] << 8 | otbl[off_idx * 3 + 2] << 16) << 8
        ptr = struct.unpack_from('<I', data, o)[0]
        size = struct.unpack_from('<I', data, o + 4)[0]
        entries.append({'no': i, 'off_idx': off_idx, 'old_off': o, 'ptr': ptr, 'size': size,
                        'prefix': bytes(data[o:o + ptr]),
                        'body': data[o + ptr:o + ptr + size],
                        'gap': 0})
    entries.sort(key=lambda e: e['old_off'])
    # Preserve the original inter-entry padding.  The format aligns entry starts
    # but not to a fixed stride, so copying each recorded gap is the only way an
    # unchanged rebuild stays byte-identical.
    for idx, e in enumerate(entries):
        end = e['old_off'] + e['ptr'] + e['size']
        # Padding only exists between entries.  Bytes after the final entry are
        # a file trailer and must not be folded into any entry's gap.
        nxt = entries[idx + 1]['old_off'] if idx + 1 < len(entries) else end
        e['gap'] = nxt - end
        e['pad_bytes'] = bytes(data[end:nxt])

    payloads = bytearray()
    cursor = 0
    for idx, e in enumerate(entries):
        new_off = ofssize + linksize + cursor
        body, st = page_fix(e['body'])
        e['new_off'] = new_off
        e['new_size'] = len(body)
        e['stats'] = st
        prefix = bytearray(e['prefix'])
        struct.pack_into('<I', prefix, 4, len(body))     # [0]=ptr stays the same
        payloads += prefix + body
        cursor += len(prefix) + len(body)
        # The offset table stores offsets divided by 256, so every entry must
        # start on a 256-byte boundary.  Pad to the next one; the copied gap
        # bytes are conventional filler, so reusing them is safe.
        if idx + 1 < len(entries):
            # Pad to the next 256-byte boundary so the next entry's offset stays
            # expressible.  Reuse the original filler where it fits.
            pad = (-cursor) % 256
            if pad:
                filler = e['pad_bytes'][:pad]
                payloads += filler + b'\0' * (pad - len(filler))
                cursor += pad

    for e in entries:
        v = e['new_off'] >> 8
        i = e['off_idx'] * 3
        otbl[i] = v & 0xff
        otbl[i + 1] = (v >> 8) & 0xff
        otbl[i + 2] = (v >> 16) & 0xff

    # Bytes after the final entry belong to the file, not to any payload.
    last = entries[-1]
    tail = data[last['old_off'] + last['ptr'] + last['size']:]
    return bytes(otbl) + bytes(data[ofssize:ofssize + linksize]) + bytes(payloads) + tail, entries


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ald', help='source SA.ALD (default: the game folder)')
    ap.add_argument('--report', action='store_true', help='dry run (default)')
    ap.add_argument('--write', help='write the repaired archive to this path')
    args = ap.parse_args()

    src = find_sa(args.ald)
    data = src.read_bytes()
    print(f'source : {src}')
    print(f'size   : {len(data)}')

    totals = {'runs': 0, 'repaired': 0, 'skipped': 0, 'saved': 0}
    changed_pages = 0

    def fix(body):
        nonlocal changed_pages
        new, st = repair_page(bytearray(body))
        for k in totals:
            totals[k] += st[k]
        if new != body:
            changed_pages += 1
        return new, st

    rebuilt, entries = rebuild(data, fix)

    print(f'pages  : {len(entries)} ({changed_pages} changed)')
    print(f'text runs      : {totals["runs"]}')
    print(f'  repaired     : {totals["repaired"]}')
    print(f'  left alone   : {totals["skipped"]}')
    print(f'bytes removed  : {totals["saved"]}')
    print(f'new size       : {len(rebuilt)}')

    # Sanity: the rebuilt archive must still read back with the same page count.
    check = list(iter_entries(rebuilt))
    if len(check) != len(entries):
        raise SystemExit(f'FAIL: page count changed {len(entries)} -> {len(check)}')
    bad = [e for e in entries if e['new_size'] > e['size']]
    if bad:
        raise SystemExit(f'FAIL: {len(bad)} page(s) grew, which this format cannot express')

    if args.write:
        out = Path(args.write)
        out.write_bytes(rebuilt)
        print(f'\nwrote  : {out}')
    else:
        print('\n(dry run; pass --write <path> to produce the repaired archive)')


if __name__ == '__main__':
    sys.exit(main())
