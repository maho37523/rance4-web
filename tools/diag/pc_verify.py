#!/usr/bin/env python3
"""
Round 9 step 1: nail the PC convention.

Question from round 8:
  engine reports P7MSG start=350, but the analyst computed the page-buffer
  index as 350-8=342.  Which one indexes sl_sco?

Answer we are testing (H_PC):
  sl_sco == dfile->data == file[entryOff + ptr]  (dri.c)
  sl_index == index into that exact array            (scenario.c)
  therefore sl_sco[i] == file[entryOff + ptr + i] with NO offset.

Method (read-only, no browser):
  1. For each SA.ALD candidate, locate entry #7 the same way dri.c does.
  2. Extract sl_sco = file[entryOff+ptr : entryOff+ptr+size].
  3. Compare that slice byte-for-byte with the p7.bin the previous rounds
     used, and with the raw bytes the engine reported in its trace window.
  4. Report the three candidate byte layouts around index 320..680.

Also diff the three SA.ALD variants we have to see exactly which bytes the
translation/patch changed.
"""
import struct
import sys
import hashlib
import os

PAGE = 7


def le24(b, i):
    return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)


def le16(b, i):
    return b[i] | (b[i + 1] << 8)


def le32(b, i):
    return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)


def locate(path, page):
    """Replicate dri.c read_index()/dri_getdata() exactly."""
    data = open(path, "rb").read()
    hdr = data[0:6]
    ofssize = le24(hdr, 0) << 8
    linksize = (le24(hdr, 3) << 8) - ofssize
    if ofssize <= 0 or linksize <= 0 or ofssize + linksize > len(data):
        raise SystemExit(f"{path}: not an ALD")
    nr_files = linksize // 3
    link = data[ofssize:ofssize + linksize]
    otbl = data[:ofssize]
    vol = link[page * 3]
    off_idx = le16(link, page * 3 + 1)
    entry_off = le24(otbl, off_idx * 3) << 8
    ptr = le32(data, entry_off)
    size = le32(data, entry_off + 4)
    start = entry_off + ptr
    return {
        "path": path,
        "sha256": hashlib.sha256(data).hexdigest(),
        "filesize": len(data),
        "ofssize": ofssize,
        "linksize": linksize,
        "nr_files": nr_files,
        "volume": vol,
        "off_idx": off_idx,
        "entry_off": entry_off,
        "ptr": ptr,
        "size": size,
        "start": start,
        "sco": data[start:start + size],
        "raw": data,
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    diag = os.path.dirname(here)
    from _paths import ald_or_die
    production = str(ald_or_die())

    candidates = [production,
                  "/tmp/SA-fixed-1034.ald",
                  "/tmp/SA-v4.ald",
                  "/tmp/SA-fondly.ald"]

    infos = {}
    for p in candidates:
        if os.path.exists(p):
            infos[p] = locate(p, PAGE)
        else:
            print(f"[skip missing] {p}")

    ref = infos.get(production)
    if ref is None:
        raise SystemExit("production SA.ALD not readable")

    print("=== entry #7 location, computed exactly like dri.c ===")
    for p, i in infos.items():
        print(f"{os.path.basename(p):<24} sha256={i['sha256'][:16]} "
              f"size={i['filesize']} entryOff={i['entry_off']} ptr={i['ptr']} "
              f"size={i['size']} sl_sco@file={i['start']}")
    print()

    # Does the slice match the p7.bin previous rounds used?
    print("=== does file[entryOff+ptr ..] match the p7.bin used in earlier rounds? ===")
    for name in ("pages/p7.bin", "pages_engine/p7.bin", "pages2/p7.bin"):
        f = os.path.join(diag, name)
        if not os.path.exists(f):
            continue
        b = open(f, "rb").read()
        for p, i in infos.items():
            same = b == i["sco"]
            # also try to find where this blob actually lives in the file
            pos = i["raw"].find(b) if len(b) < 4096 else -1
            print(f"  {name:<22} vs {os.path.basename(p):<20} "
                  f"equal={same} first_found_at={pos}")
    print()

    # The engine's trace window (from /tmp/cf-diag/ring.txt) -- page 7.
    # Each entry is  pc:hex6  (6 bytes from sl_sco[pc]).
    trace = {
        345: "59417f407fb0",
        350: "a4a2a4a4a4a6",
        380: "52a4bfa4c1a4",
        481: "59417f407fa5",
        617: "59417f407fb0",
        622: "b0b39894b5ee",
        650: "52b5c1d95ccd",
        651: "b5c1d95ccdf5",
        654: "5ccdf5989484",
    }
    print("=== engine trace bytes vs production sl_sco (no offset) vs +-8 ===")
    print(f"{'pc':>5} {'engine':<14} {'sco[pc]':<14} {'sco[pc-8]':<14} match")
    for pc, eng in trace.items():
        got = ref["sco"][pc:pc + 6].hex()
        lo = ref["sco"][pc - 8:pc - 8 + 6].hex() if pc >= 8 else ""
        mark = "OK(no offset)" if got == eng else ("OK(offset -8)" if lo == eng else "MISMATCH")
        print(f"{pc:>5} {eng:<14} {got:<14} {lo:<14} {mark}")
    print()

    # Layout of the interesting region.
    print("=== production sl_sco[320:700] ===")
    s = ref["sco"]
    for base in range(320, 700, 32):
        print(f"  {base:4d}: {s[base:base + 32].hex(' ')}")
    print()

    # Diff the variants (only bytes inside the page matter for this question).
    print("=== page-7 byte diffs vs production ===")
    for p, i in infos.items():
        if p == production:
            continue
        diffs = [k for k in range(min(len(i["sco"]), len(ref["sco"])))
                 if i["sco"][k] != ref["sco"][k]]
        print(f"{os.path.basename(p)}: {len(diffs)} differing bytes in page 7 -> {diffs[:40]}")
        for k in diffs[:40]:
            print(f"    idx {k}: prod=0x{ref['sco'][k]:02x} other=0x{i['sco'][k]:02x} "
                  f"(prod file off 0x{ref['start'] + k:x})")
    print()

    # Which entries of page 7 carry the 59 41 7f 40 7f 5c pattern?
    print("=== occurrences of 'Y'-shaped '59 41 7f 40 7f' and of '5c 00 00 00 00' ===")
    pat_y = bytes.fromhex("59417f407f")
    pat_ret = bytes.fromhex("5c00000000")
    i = 0
    while True:
        j = s.find(pat_y, i)
        if j < 0:
            break
        after = s[j + 5:j + 10].hex()
        print(f"  Y  @ {j:4d} next5={after} {'RET' if after.startswith('5c') else 'NO-RET'}")
        i = j + 1
    i = 0
    while True:
        j = s.find(pat_ret, i)
        if j < 0:
            break
        print(f"  RET@ {j:4d}")
        i = j + 1


if __name__ == "__main__":
    main()
