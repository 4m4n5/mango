# Mango orchestrator

Optional FastAPI hub for the phone librarian and bounded local AI helpers. It
accepts text or push-to-talk, runs the tool loop, and dispatches navigation to
the TV; it never starts playback directly. See
[`docs/features/search-and-librarian.md`](../../docs/features/search-and-librarian.md) and
[`docs/features/search-and-librarian.md`](../../docs/features/search-and-librarian.md).

```bash
source "${HOME}/.config/mango/voice.env"
bash scripts/m5-voice/stack/start-orchestrator.sh
```

Use the wrapper for the product runtime: it ensures the venv and resolves
config. When `MANGO_ORCH_TLS=1` and the generated certificate files are present,
it maps them to explicit arguments and starts the TLS companion listener on
`:8765` plus the loopback launcher listener on `:8766`. Invoking
`python -m orchestrator.main` with only
`MANGO_ORCH_TLS=1` does not provide those certificate arguments and will not
start the second listener.

## Interfaces

| Interface | Client and contract |
|-----------|---------------------|
| `GET /health` on `:8765` | Health, connection and voice-busy state |
| WSS `/ws` on `:8765` | HTTPS companion: `chat_send`, PTT, numbered-pick and status/chat events |
| WS `/ws` on `:8766` | Loopback launcher HUD connection |
| `POST /search/expand` | Loopback-only bounded query expansion for unified Search |
| `POST /recommendations/story-dna` | Loopback-only serialized `story-dna-v1` content teacher |

The StoryDNA request contains stable title identity and content evidence only.
The teacher must not receive or infer household ratings, Saved/watch events,
profile state, companion memory, or conversations; it annotates known titles
and never recommends or ranks them. Catalog-service owns the deterministic
Story Graph, generations, rollout flags, and attribution.

## Librarian pipeline

```text
text chat ───────────────────────────────┐
phone PTT → Deepgram STT ───────────────┼→ serialized agent/tool turn
numbered pick → validated prior options ┘    → launcher command + acknowledgement
```

The module paths below are relative to the `src/orchestrator/orchestrator/`
Python package.

| Module | Role |
|--------|------|
| `main.py` | Connection/PTT/text locks, lifecycle, local helper routes |
| `audio/deepgram_stt.py` | `nova-3` multilingual transcription with detect fallback |
| `llm/agent.py` | Bounded tool loop; explicit picks may open Detail |
| `llm/open_intent.py` | Bare-title/Hinglish intent classification |
| `recommendation_enrich.py` | Strict current StoryDNA request, schema, provenance, and teacher boundary |
| `tools/catalog.py` | Catalog-service `/voice/*` client |
| `tools/launcher_dispatch.py` | Ordered TV command dispatch |
| `tools/voice_nav.py` | Ordinal, sequel and franchise disambiguation |

Vague discovery asks clarify or return choices. A successful open lands on
Detail and tells the viewer to press **B**; the librarian does not autoplay.

## Runtime

`scripts/mango-stack.sh` starts the orchestrator when `MANGO_VOICE=1`.
`config/voice.env.example` deliberately sets `MANGO_TTS_DISABLED=1`; text replies
are the supported path until TV audio/ducking is physically accepted. Keep API
keys outside Git and run:

```bash
bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh
bash scripts/m5-voice/stack/verify-voice-ready.sh
```

Tool-loop kill switch: `orchestrator.voice_tools_enabled` or
`MANGO_VOICE_TOOLS=0`. STT configuration merge:
`scripts/m5-voice/ai/sync-hinglish-stt-config.py`.
