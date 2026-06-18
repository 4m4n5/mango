from __future__ import annotations

import logging
import os

from orchestrator.audio.piper_tts import warmup_piper
from orchestrator.config import OrchestratorSettings

logger = logging.getLogger(__name__)


def warmup_voice_stack(settings: OrchestratorSettings) -> None:
    if os.environ.get("MANGO_SKIP_WARMUP") == "1":
        return
    logger.info("warming voice stack (piper)")
    warmup_piper(settings)
    if settings.stt_provider.lower() == "local":
        from orchestrator.audio.whisper_stt import warmup_whisper

        logger.info("warming local whisper")
        warmup_whisper(settings)
    logger.info("voice stack warm")
