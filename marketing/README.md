# Mango marketing assets

## Instagram launch carousel

The canonical copy, alt text, capture requirements, caption, and claim gate are
in [`../docs/INSTAGRAM_LAUNCH_CAROUSEL.md`](../docs/INSTAGRAM_LAUNCH_CAROUSEL.md).

Render:

```bash
python3 marketing/instagram_carousel.py
python3 marketing/audit_instagram_carousel.py
```

Outputs:

```text
marketing/out/instagram-carousel/
├── card-01-product.png
├── …
├── card-08-contact.png
├── contact-sheet.png
├── manifest.json
└── audit.json
```

The renderer expects reviewed raw inputs in:

```text
~/.cache/mango-marketing/raw/
```

Raw device captures remain outside the repository because they can contain
account-specific history or runtime-only source details. The generated manifest
records input hashes, dimensions, evidence class, substitutions, and publication
blockers without embedding private source URLs.

Render selected cards:

```bash
python3 marketing/instagram_carousel.py --only 01-product,06-librarian
```

Use a separate output directory for experiments:

```bash
python3 marketing/instagram_carousel.py \
  --out ~/.cache/mango-marketing/review/variant-a
```

## Publication rule

The PNGs are composed creative, not independent claim approval. Check
`manifest.json` and the pre-publish list in the canonical brief before posting.
In particular:

- Slide 4 uses a real verified pre-play stream ladder and makes no
  advancing-video claim.
- Slide 7's `ad-free, without Premium.` claim remains blocked pending technical
  substantiation and an explicit platform/legal decision.
- Slide 8 needs a photograph of the actual Pi enclosure and controller.
