#!/usr/bin/env python3
"""Report which characters a font can actually draw, and what a game data file needs.

Written because the shell never loaded the Chinese font on the Rance 4 code path,
and "the text looks wrong" is impossible to settle by reading layout code.  A
font either has a glyph for a codepoint or it does not, and both the font table
and the scenario bytes are on disk here.

The TrueType/OpenType `cmap` table is parsed directly: there is no fontTools or
fontconfig on the reference machine, and the formats that matter here (4 and 12)
are small enough to read by hand.

Usage:
    python3 tools/diag/font_coverage.py dist/fonts/MTLc3m.ttf
    python3 tools/diag/font_coverage.py --needed ../games/RANCE4/RANCE4SA.ALD \\
        dist/fonts/MTLc3m.ttf dist/games/rance4/SourceHanSansCN-Normal.otf

Exit status is 0 when at least one font covers everything `--needed` asks for.
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

CJK_RANGES = (
    (0x3000, 0x303F),   # CJK symbols and punctuation
    (0x3040, 0x30FF),   # kana
    (0x4E00, 0x9FFF),   # CJK unified ideographs
    (0xFF00, 0xFFEF),   # halfwidth and fullwidth forms
)


def _cmap_subtable_offsets(data: bytes) -> list[tuple[int, int]]:
    """Return (platformID, subtableOffset) for every cmap subtable."""
    if len(data) < 12:
        raise ValueError("not a font: file is too short")
    num_tables = struct.unpack_from(">H", data, 4)[0]
    cmap_offset = None
    for i in range(num_tables):
        entry = 12 + i * 16
        if entry + 16 > len(data):
            raise ValueError("truncated table directory")
        tag = data[entry:entry + 4]
        offset = struct.unpack_from(">I", data, entry + 8)[0]
        if tag == b"cmap":
            cmap_offset = offset
            break
    if cmap_offset is None:
        raise ValueError("font has no cmap table (bitmap-only font?)")
    num_subtables = struct.unpack_from(">H", data, cmap_offset + 2)[0]
    subtables = []
    for i in range(num_subtables):
        record = cmap_offset + 4 + i * 8
        platform = struct.unpack_from(">H", data, record)[0]
        offset = struct.unpack_from(">I", data, record + 4)[0]
        subtables.append((platform, cmap_offset + offset))
    return subtables


def _parse_format4(data: bytes, offset: int) -> set[int]:
    length = struct.unpack_from(">H", data, offset + 2)[0]
    seg_count = struct.unpack_from(">H", data, offset + 6)[0] // 2
    end_base = offset + 14
    start_base = end_base + seg_count * 2 + 2
    delta_base = start_base + seg_count * 2
    range_base = delta_base + seg_count * 2
    covered: set[int] = set()
    for i in range(seg_count):
        end = struct.unpack_from(">H", data, end_base + i * 2)[0]
        start = struct.unpack_from(">H", data, start_base + i * 2)[0]
        delta = struct.unpack_from(">h", data, delta_base + i * 2)[0]
        range_offset = struct.unpack_from(">H", data, range_base + i * 2)[0]
        if start > end:
            continue
        for code in range(start, min(end, 0xFFFF) + 1):
            if code == 0xFFFF:
                continue
            if range_offset == 0:
                glyph = (code + delta) & 0xFFFF
            else:
                glyph_index_at = range_base + i * 2 + range_offset + (code - start) * 2
                if glyph_index_at + 2 > offset + length:
                    continue
                glyph = struct.unpack_from(">H", data, glyph_index_at)[0]
                if glyph:
                    glyph = (glyph + delta) & 0xFFFF
            if glyph:
                covered.add(code)
    return covered


def _parse_format12(data: bytes, offset: int) -> set[int]:
    num_groups = struct.unpack_from(">I", data, offset + 12)[0]
    covered: set[int] = set()
    for i in range(num_groups):
        group = offset + 16 + i * 12
        start, end, glyph = struct.unpack_from(">III", data, group)
        if glyph == 0 and start == end:
            continue
        covered.update(range(start, end + 1))
    return covered


def font_coverage(path: Path) -> set[int]:
    """Every codepoint with a non-zero glyph id in the font's best cmap."""
    data = path.read_bytes()
    best: set[int] = set()
    for platform, offset in _cmap_subtable_offsets(data):
        fmt = struct.unpack_from(">H", data, offset)[0]
        try:
            if fmt == 4:
                covered = _parse_format4(data, offset)
            elif fmt == 12:
                covered = _parse_format12(data, offset)
            elif fmt == 6:
                first = struct.unpack_from(">H", data, offset + 6)[0]
                count = struct.unpack_from(">H", data, offset + 8)[0]
                covered = {first + i for i in range(count)
                           if struct.unpack_from(">H", data, offset + 10 + i * 2)[0]}
            elif fmt == 0:
                covered = {b for b, g in enumerate(data[offset + 6:offset + 262]) if g}
            else:
                continue
        except (struct.error, IndexError):
            continue
        # Prefer the widest coverage; platform ordering varies between fonts.
        if len(covered) > len(best):
            best = covered
    return best


def cjk_characters(path: Path) -> set[int]:
    """Distinct CJK codepoints appearing in a UTF-8 file, ignoring stray bytes."""
    text = path.read_bytes().decode("utf-8", errors="ignore")
    return {ord(ch) for ch in text if any(lo <= ord(ch) <= hi for lo, hi in CJK_RANGES)}


def coverage_of(characters: set[int], covered: set[int]) -> tuple[int, list[int]]:
    missing = sorted(characters - covered)
    return len(characters) - len(missing), missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("fonts", nargs="+", type=Path)
    parser.add_argument("--needed", type=Path, action="append", default=[],
                        help="UTF-8 data file whose CJK characters must be drawable (repeatable)")
    parser.add_argument("--show", type=int, default=12, help="how many missing characters to print")
    args = parser.parse_args()

    needed: set[int] = set()
    for source in args.needed:
        found = cjk_characters(source)
        needed |= found
        print(f"needed: {source.name} -> {len(found)} distinct CJK codepoints")
    if needed:
        print(f"needed (union): {len(needed)} codepoints")
    print()

    all_covered = False
    for font in args.fonts:
        try:
            covered = font_coverage(font)
        except (OSError, ValueError) as error:
            print(f"{font}: ERROR {error}")
            continue
        cjk_covered = {c for c in covered if any(lo <= c <= hi for lo, hi in CJK_RANGES)}
        line = f"{font}: {len(covered)} codepoints, {len(cjk_covered)} in CJK ranges"
        if needed:
            have, missing = coverage_of(needed, covered)
            percent = have / len(needed) * 100 if needed else 100.0
            line += f" | covers {have}/{len(needed)} needed ({percent:.1f}%)"
            if missing:
                sample = "".join(chr(c) for c in missing[:args.show])
                line += f" | missing e.g. {sample}"
            else:
                all_covered = True
        print(line)

    if needed and not all_covered:
        print("\nno supplied font covers every needed character", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
