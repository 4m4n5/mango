# Search and librarian

## Search

Unified launcher Search covers Mango library, YouTube cache, and optional
Live. Progressive phases fail independently. Search never autoplays and is
not a chatbot.

The catalog-service builds a pre-normalized index at boot and yields the
event loop while warming. `/search/state` returns immediately with
`rebuilding: true` instead of blocking the UI. Couch queries score
pre-normalized strings.

The launcher yields to pad input while painting result rails. Focus must
remain movable while results load.

Quota and restoration details stay in catalog-service Search tests. Current
Pi proof belongs in [STATUS.md](../STATUS.md).

## Phone librarian

The companion PWA (`:3001`) and orchestrator (`:8765` / `:8766`) accept text
or push-to-talk. Tools search and open Detail on the TV. The controller
still confirms play.

Current contract: no TTS, no wake word, no proactive push, no voice
autoplay. Replies are text on the phone and a HUD mirror on the TV.

Keys live in `$HOME/.config/mango/voice.env`. TLS for the phone is
operator-issued (`setup-mkcert.sh`). Trusted-LAN development is the current
boundary; per-device pairing is not an appliance feature yet.

## AI catalogs

Operators may create a small number of named rails. Suggest-and-confirm
before creating. AI catalog seeds cannot establish YouTube recommendation
provenance.
