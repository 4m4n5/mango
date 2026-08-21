# Contributing

Mango is a single-maintainer alpha. Small, evidence-bounded changes are
welcome. Please read [docs/TESTING.md](docs/TESTING.md) before opening a PR.

## Development

```bash
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build && npm test
cd ../companion && npm ci && npm run build
bash scripts/mac-gate-pr.sh
```

Do not rsync to a Pi. Push `feat/native-experience` and deploy with
`scripts/pi-deploy.sh`.

## Evidence

PRs must say which evidence they have:

- Local-pass: which tests ran
- Pi-gated: exact SHA, if any
- Couch-observed: only if a human watched the TV

Mac results never certify picture, audio, or controller feel.

## Rules

- Do not commit secrets, runtime databases, or household playlists
- Do not change the locked pad map without an issue and maintainer approval
- Do not put current SHA or “Pi serves” claims outside `docs/STATUS.md`
- Keep playback ownership in `mpv-play.sh` and the Lua HUD

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports go to
[SECURITY.md](SECURITY.md), not public issues.
