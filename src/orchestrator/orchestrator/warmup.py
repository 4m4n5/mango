from __future__ import annotations

import logging
import os

from orchestrator.config import OrchestratorSettings

logger = logging.getLogger(__name__)


def warmup_voice_stack(settings: OrchestratorSettings) -> None:
    if os.environ.get("MANGO_SKIP_WARMUP") == "1":
        return
    if settings.tts_enabled:
        from orchestrator.audio.piper_tts import warmup_piper

        logger.info("warming voice stack (piper)")
        warmup_piper(settings)
    else:
        logger.info("skipping piper warmup because tts_enabled=false")
    if settings.stt_provider.lower() == "local":
        from orchestrator.audio.whisper_stt import warmup_whisper

        logger.info("warming local whisper")
        warmup_whisper(settings)
    if os.environ.get("MANGO_VOICE_TOOLS", "") != "0" and settings.voice_tools_enabled:
        try:
            from orchestrator.tools import catalog as catalog_tools

            manifest = catalog_tools.fetch_tool_manifest(settings)
            tool_count = len(manifest.get("tools", []))
            logger.info("voice tools manifest ready (%s tools)", tool_count)
        except Exception as exc:
            logger.warning("voice tools manifest warmup failed: %s", exc)
    logger.info("voice stack warm")
