"""Post-PTT companion light reflection — async, non-blocking."""

from __future__ import annotations

import asyncio
import logging

from orchestrator.config import OrchestratorSettings
from orchestrator.tools import catalog as catalog_tools

logger = logging.getLogger(__name__)


async def reflect_after_turn(
    settings: OrchestratorSettings,
    *,
    transcript: str,
    reply: str,
    tools_used: list[str] | None = None,
) -> None:
    try:
        await asyncio.to_thread(
            catalog_tools.tool_companion_reflect,
            settings,
            transcript=transcript,
            reply=reply,
            tools_used=tools_used or [],
        )
    except Exception:
        logger.debug("companion light reflect failed", exc_info=True)
