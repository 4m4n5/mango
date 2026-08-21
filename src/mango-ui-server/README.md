# Mango UI server

Small stdlib Python boundary on `127.0.0.1:3000`. It serves the built Chromium
launcher and coordinates local launcher, pad, voice, activity, and catalog
traffic. It does not own catalog/library/playback policy.

```bash
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
```

## Route groups

| Route | Ownership |
|-------|-----------|
| `/` | Static launcher build and embedded voice HUD |
| `/api/info`, `/api/health` | UI-server identity and stack health summary |
| `/api/catalog/*` | JSON proxy to loopback catalog-service `:3020`; preserves HTTP status and bounded timeouts |
| `/api/pad/session`, `/api/pad/heartbeat`, `/api/pad/nav`, `/api/pad/ack` | Revisioned single-owner pad navigation queue |
| `/api/voice/command`, `/api/voice/commands`, `/api/voice/state`, `/api/voice/ack` | Ordered orchestrator-to-launcher command/ack channel |
| `/api/activity/touch`, `/api/perf` | Local couch-activity and performance telemetry |
| `/api/playback/stop` | Local stop/cancel boundary for the foreground player |
| `/api/launch/launcher` | Debounced return to the Mango launcher |
| `/overlay/*` | `410`; the legacy overlay is not part of the native stack |

Mutation/control routes enforce localhost. The normal service bind is loopback;
do not expose this server as a general LAN control API. The phone companion has
its own HTTPS capability proxy and must not be given this full surface.

## Runtime

On the Pi, `scripts/mango-stack.sh` and
`scripts/m1-foundation/ui/start-mango-ui.sh` manage the service. The pad router
remains the sole input owner; the UI server only serializes browser navigation
and acknowledgements.

See [architecture](../../docs/ARCHITECTURE.md),
[operations](../../docs/OPERATIONS.md), and [Search](../../docs/features/search-and-librarian.md).
