from __future__ import annotations

import asyncio
import json
import os
import sys

from .runner import RunnerError, run_payload


async def main() -> int:
    source = os.environ.get("SCANVEIL_AGY_PAYLOAD_JSON") or os.environ.get("SCAN_REQUEST_JSON")
    has_source = source is not None and len(source) > 0
    if not has_source:
        print(
            json.dumps(
                {
                    "message": "missing_payload",
                    "severity": "ERROR",
                    "reason": "SCANVEIL_AGY_PAYLOAD_JSON or SCAN_REQUEST_JSON is required",
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 1

    try:
        payload = json.loads(source)
        findings = await run_payload(payload)
    except RunnerError as error:
        print(
            json.dumps(
                {
                    "message": "agy_runner_failed",
                    "severity": "ERROR",
                    "reason": str(error),
                },
                separators=(",", ":"),
            ),
            file=sys.stderr,
        )
        return 1

    print(json.dumps(findings, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
