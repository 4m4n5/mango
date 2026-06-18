from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)


@contextmanager
def voice_stage(name: str):
    if os.environ.get("MANGO_VOICE_TIMING") != "1":
        yield
        return
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info("voice_timing %s=%.0fms", name, elapsed_ms)
