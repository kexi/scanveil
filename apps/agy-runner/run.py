# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "google-antigravity==0.1.4",
#   "pydantic==2.12.5",
# ]
# ///
from __future__ import annotations

import asyncio

from scanveil_agy_runner.__main__ import main

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
