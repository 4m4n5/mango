# Marketing

Mango's public claims live in [docs/PUBLIC_CLAIMS.md](../docs/PUBLIC_CLAIMS.md).
Locked social copy lives in [docs/LAUNCH_CAROUSEL.md](../docs/LAUNCH_CAROUSEL.md).
The Instagram/LinkedIn renderer and audit live in this directory. Generated
PNGs stay in `marketing/out/` and are gitignored.

```bash
python3 marketing/instagram_carousel.py
python3 marketing/audit_instagram_carousel.py
```

Raw captures belong in `~/.cache/mango-marketing/raw/`, never in Git.
Do not publish a carousel unless `audit.json` reports `publication_ready: true`.
