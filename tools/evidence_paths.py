"""Locations for historical inputs and newly generated evidence."""
import os
from pathlib import Path

HISTORICAL = Path(__file__).resolve().parent / 'fixtures' / 'historical'


def output_directory(tool):
    return Path(os.environ.get('EVIDENCE_DIR') or
                Path('/home/michael/OpenBot/Shared/farm-evidence') / tool).expanduser().resolve()
