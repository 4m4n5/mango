from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager

from orchestrator.voice_log import active_turn_timer

logger = logging.getLogger(__name__)


@contextmanager
def voice_stage(name: str):
    timing_enabled = os.environ.get("MANGO_VOICE_TIMING") == "1"
    timer = active_turn_timer()
    if not timing_enabled and timer is None:
        yield
        return
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        if timer is not None:
            timer.mark(name, elapsed_ms)
        if timing_enabled:
            logger.info("voice_timing %s=%.0fms", name, elapsed_ms)
