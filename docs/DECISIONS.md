# Implementation decisions

Locked during pre-code QA (2026-06-15). Do not revisit without updating this file.

| Decision | Choice |
|----------|--------|
| LLM provider | **Configurable** — Anthropic + OpenAI adapters in `config.yaml` |
| Stremio install | **fragarray/stremio-rpi5** `.deb` first; stremio-web fallback |
| Companion HTTPS | **mkcert** self-signed cert on Pi; trust once on phone |
| Launcher / overlay / companion UI | **Vite + vanilla TypeScript** |
| Stretch features | **After Core** passes all 10 success criteria |
| Network | **WiFi + Ethernet**; prefer Ethernet when plugged |
| TV navigation | **USB gamepad only** (no FLIRC) |
| Display stack | **X11 + Openbox** (`raspi-config` — not Wayland) |
| Phone role | Mic (PTT) + backup remote |
| Build order | Phase 0 manual bring-up → launcher → voice → media tools |

## Implications

- **Phase 0** must complete on real Pi before `src/` work.
- **Phase 2** includes mkcert setup in `scripts/` before companion mic works on phone.
- **orchestrator/llm/** implements `provider: anthropic | openai` switch.
- **Stretch** (TMDB, recap, Kodi subtitles) starts only after Core checklist green.
