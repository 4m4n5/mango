# Contributing

Mango is a single-maintainer public alpha. Small, evidence-bounded changes
are welcome. Read [docs/PRODUCT.md](docs/PRODUCT.md),
[docs/PUBLIC_CLAIMS.md](docs/PUBLIC_CLAIMS.md), and
[docs/TESTING.md](docs/TESTING.md) before opening a pull request.

## Development

```bash
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build && npm test
cd ../companion && npm ci && npm run build
bash scripts/mac-gate-pr.sh
```

Public branch is `main`. Do not rsync to a Pi. After review, deploy with
`scripts/pi-deploy.sh`.

## Pull requests

Open against `main`. Use the PR template. Include:

- what changed and why
- local-pass commands and results
- Pi-gated SHA only if you actually deployed that revision
- couch-observed notes only if a human watched the TV

Mac or CI green does not certify picture, audio, or controller feel.

## Rules

- Do not commit secrets, runtime databases, household playlists, or
  generated marketing binaries
- Do not change the locked pad map without an issue and maintainer approval
- Do not put current SHA or “Pi serves” claims outside `docs/STATUS.md`
- Keep playback ownership in `mpv-play.sh` and the Lua HUD
- Keep public wording inside [docs/PUBLIC_CLAIMS.md](docs/PUBLIC_CLAIMS.md)
- Prefer a failing test that names the contract you are fixing

## Issues

Use the GitHub issue forms. Never attach API keys, OAuth tokens, debrid
URLs, or private playlists.

## Conduct and security

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Vulnerabilities go to
[SECURITY.md](SECURITY.md), not public issues.
