#!/usr/bin/env python3
"""
Focused System 3.5 disassembler for the ranceking investigation.

Only the commands relevant to the title-menu loop (page 1 / 5 / 7 / 11) are
decoded.  Argument grammars are taken from the engine sources:

  * scenario.c : sl_getaddr (dword), sl_getw (word), sl_getc
  * cali.c     : getCaliValue / getCaliVariable expression grammar
  * cmd_check.c, cmdy.c, cmdi.c : per-opcode argument order

Usage:
  dis_page.py <ald> <page> [start] [end]
  dis_page.py --str <ald> <page> [start] [end]   (dump text runs as GBK)
"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))


def le24(b, i):
    return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)


def le16(b, i):
    return b[i] | (b[i + 1] << 8)


def le32(b, i):
    return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)


def load_page(ald, page):
    data = open(ald, "rb").read()
    ofssize = le24(data, 0) << 8
    linksize = (le24(data, 3) << 8) - ofssize
    link = data[ofssize:ofssize + linksize]
    otbl = data[:ofssize]
    entry_off = le24(otbl, le16(link, page * 3 + 1) * 3) << 8
    ptr = le32(data, entry_off)
    size = le32(data, entry_off + 4)
    return data[entry_off + ptr:entry_off + ptr + size]


OPS = {0x74: "&", 0x75: "|", 0x76: "^", 0x77: "*", 0x78: "/", 0x79: "+",
       0x7a: "-", 0x7b: "==", 0x7c: "<", 0x7d: ">", 0x7e: "!="}


class Dis:
    def __init__(self, d):
        self.d = d
        self.n = len(d)

    def var(self, i):
        c0 = self.d[i]; i += 1
        if (c0 & 0x40) == 0:
            return f"v{c0 & 0x3f}", i
        c1 = self.d[i]; i += 1
        return f"v{(c1 & 0x3f) << 8 | self.d[i] if False else c0:02x}{c1:02x}", i

    def cali(self, i):
        toks = []
        while i < self.n:
            c0 = self.d[i]; i += 1
            if c0 == 0x7f:
                break
            if c0 & 0x80:
                toks.append(f"V[{c0:02x}]"); i += 1
            elif c0 in OPS:
                toks.append(OPS[c0])
            elif c0 & 0x40:
                toks.append(str(c0 & 0x3f))
            else:
                c1 = self.d[i]; i += 1
                toks.append(str((c0 << 8) | c1))
        return " ".join(toks), i

    def val(self, i):
        """A single cali expression (used by Y)."""
        c0 = self.d[i]
        if c0 == 0x7f:
            return "<empty>", i + 1
        return self.cali(i)


def yfmt(v):
    return v


def main():
    ald = sys.argv[1]
    page = int(sys.argv[2])
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    end = int(sys.argv[4]) if len(sys.argv) > 4 else None
    d = load_page(ald, page)
    if end is None:
        end = len(d)
    dis = Dis(d)
    i = start
    while i < min(end, len(d)):
        p = i
        c = d[i]
        try:
            if c == 0x00:
                i += 1; print(f"{p:5d} 0x{p:04x}: NOP / text-terminator")
            elif c == 0x20 or c >= 0x80:
                j = i
                while j < len(d) and (d[j] == 0x20 or d[j] >= 0x80):
                    j += 1
                raw = d[i:j]
                try:
                    txt = raw.decode("gbk")
                except Exception:
                    txt = repr(raw)
                print(f"{p:5d} 0x{p:04x}: TEXT {txt!r}  (ends 0x{d[j]:02x} @ {j})")
                i = j
            elif c in (0x21, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17):
                v, i = dis.var(i + 1)
                if d[i] == 0x7f:
                    i += 1
                e, i = dis.cali(i)
                print(f"{p:5d} 0x{p:04x}: LET({c:02x}) {v} := {e}")
            elif c == 0x40:
                a = le32(d, i + 1); print(f"{p:5d} 0x{p:04x}: @ GOTO {a}"); i += 5
            elif c == 0x5c:
                a = le32(d, i + 1)
                print(f"{p:5d} 0x{p:04x}: {'RET' if a == 0 else f'CALL {a}'}")
                i += 5
            elif c == 0x7b:
                e, j = dis.cali(i + 1)
                a = le32(d, j)
                print(f"{p:5d} 0x{p:04x}: {{ IF ({e}) GOTO {a}")
                i = j + 4
            elif c == 0x7d:
                print(f"{p:5d} 0x{p:04x}: }} ENDIF"); i += 1
            elif c == 0x25:
                e, i = dis.cali(i + 1); print(f"{p:5d} 0x{p:04x}: % PAGECALL/RET ({e})")
            elif c == 0x26:
                e, i = dis.cali(i + 1); print(f"{p:5d} 0x{p:04x}: & PAGEJMP ({e})")
            elif c == 0x24:
                a = le32(d, i + 1); print(f"{p:5d} 0x{p:04x}: $ MENUITEM {a}"); i += 5
            elif c == 0x5d:
                print(f"{p:5d} 0x{p:04x}: ] MENU"); i += 1
            elif c == 0x23:
                a = le32(d, i + 1); e, i = dis.cali(i + 5)
                print(f"{p:5d} 0x{p:04x}: # DATATBL {a} ({e})")
            elif c == 0x3c:
                k = d[i + 1]; j = i + 2 + (0 if k == 1 else 2)
                a = le32(d, j); j += 4
                v, j = dis.var(j)
                e1, j = dis.cali(j); e2, j = dis.cali(j); e3, j = dis.cali(j)
                print(f"{p:5d} 0x{p:04x}: < FOR kind={k} exit={a} var={v} ({e1}) ({e2}) ({e3})")
                i = j
            elif c == 0x3e:
                a = le32(d, i + 1); print(f"{p:5d} 0x{p:04x}: > LOOPEND {a}"); i += 5
            elif c == 0x59:  # Y
                v1, j = dis.val(i + 1)
                v2, j = dis.val(j)
                print(f"{p:5d} 0x{p:04x}: Y {v1} , {v2}")
                i = j
            elif c == 0x5a:  # Z
                v1, j = dis.val(i + 1)
                v2, j = dis.val(j)
                print(f"{p:5d} 0x{p:04x}: Z {v1} , {v2}")
                i = j
            elif 0x41 <= c <= 0x5a:
                print(f"{p:5d} 0x{p:04x}: {chr(c)}{chr(d[i+1])}"); i += 2
            elif c == 0x2f:
                print(f"{p:5d} 0x{p:04x}: / {d[i+1]:02x} ..."); i += 2
            else:
                print(f"{p:5d} 0x{p:04x}: ?? 0x{c:02x}"); i += 1
        except Exception as e:
            print(f"{p:5d} 0x{p:04x}: <error {e}>")
            i = p + 1


if __name__ == "__main__":
    main()
