"""Locate the game data and the scenario archives used by these tools.

The games live in `games/` beside the application checkout, so nothing here
hard-codes a user-specific path.  Override with the GAMES_DIR environment
variable when the data lives elsewhere.

The Chinese release uses a non-ASCII filename; rather than hard-code it, the
helpers below discover it by suffix so an encoding slip cannot silently point
at the wrong file.
"""
import os
import sys
from pathlib import Path

DIAG_DIR = Path(__file__).resolve().parent
# .../app/tools/diag -> .../app -> .../<project>
APP_DIR = DIAG_DIR.parents[1]
PROJECT_DIR = APP_DIR.parent
GAMES_DIR = Path(os.environ.get('GAMES_DIR', PROJECT_DIR / 'games'))
RANCEKING_DIR = GAMES_DIR / 'RANCE KING'


def _find(directory, suffix, exclude=()):
    if not directory.is_dir():
        return None
    hits = sorted(p for p in directory.iterdir()
                  if p.name.endswith(suffix) and not any(x in p.name for x in exclude))
    return hits[0] if hits else None


def sa_ald(path=None):
    """The Chinese SA.ALD shipped/patched for the public build."""
    if path:
        p = Path(path)
        return p if p.exists() else None
    return _find(RANCEKING_DIR, 'SA.ALD', exclude=('.orig-backup',))


def sa_backup():
    """The untouched original kept by patch_page69.py."""
    return _find(RANCEKING_DIR, 'SA.ALD.orig-backup')


def ja_ald():
    """Japanese SA.ALD extracted from the official freeware archive."""
    return _find(DIAG_DIR / 'ja', 'SA.ALD')


def ald_or_die(path=None):
    p = sa_ald(path)
    if p is None:
        sys.exit(
            f'Chinese SA.ALD not found under {RANCEKING_DIR}\n'
            f'Set GAMES_DIR to the folder holding the game directories '
            f'(currently {GAMES_DIR}).'
        )
    return p
