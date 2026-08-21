# Security policy

## Supported versions

Mango is an alpha self-hosted project on `main`. Only the latest published
source on that branch receives security fixes. There is no long-term support
channel yet.

## Reporting a vulnerability

Do **not** open a public GitHub issue for a suspected vulnerability.

Email the maintainer through the address listed on the GitHub profile for
[`4m4n5/mango`](https://github.com/4m4n5/mango), and include:

- affected revision (`git rev-parse HEAD`)
- component (catalog-service, launcher, companion, pad, deploy, docs)
- impact and reproduction notes that do not include live secrets

Please allow 14 days before any public disclosure. The maintainer will
acknowledge the report and describe the intended fix or mitigation.

## Secrets and runtime data

Never commit:

- `.env`, `*.key`, OAuth clients, YouTube API JSON, Stremio credentials
- runtime SQLite databases, caches, AIOStreams/AIOMetadata userData
- UX-harness fixtures that contain debrid or playback URLs
- household viewing history, companion journals, or live playlists

Use the `*.example` files and `/etc/mango` or `$HOME/.config/mango` on the
device. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## History note

This repository was public before the license and sanitization pass. Git
history is not rewritten. Treat any credential that ever appeared in a
public commit as disclosed: revoke and rotate it, then keep replacements
out of Git.

Historical scanners have reported unverified credential-shaped strings in
retired docs, setup scripts, and test fixtures. Operators should rotate
YouTube, GitHub, GCP, and any playlist-host credentials that were used
with this repository before the cleanup.
