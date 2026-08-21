# Deployed-state screenshots

Screenshots of mango **as it actually renders on the Pi**, captured on the TV and
committed so the work Mac — which has no Pi access — can see what shipped.

This is the only place in the repo where binary images are tracked. `.verify-shots/`
and `tools/ux-harness/shots/` are gitignored on purpose, and local harness renders
should stay that way: a Mac render is a prediction, not evidence.

## Rules

**Fixed filenames, no timestamps.** The capture script
(`scripts/m1-foundation/gate/capture-tv.sh`) appends a UTC timestamp, so renaming to
the fixed names below is required. Otherwise every deploy adds new blobs forever
instead of replacing the previous one.

**One file per surface, not per attempt.** If a shot is wrong, retake it and
overwrite. Do not commit `-v2`, `-fixed`, or `-final` variants.

**Full resolution, 1920x1080.** Do not crop or scale — the point is to see the
real thing, including safe-area margins. If the set exceeds ~8 MB total, strip
metadata and drop to 8-bit rather than scaling:

```bash
convert in.png -strip -depth 8 out.png
```

**Capture the focused state.** A screenshot with nothing focused hides the single
most important thing about a 10-foot UI. Every shot below should have a visible
focus ring unless the name says otherwise.

## Expected set

| File | What it must show |
|------|-------------------|
| `home-movies.png` | Movies tab, a poster focused mid-rail, label revealed |
| `home-series.png` | TV Shows tab, same |
| `home-scrolled.png` | Scrolled to the apps rail — the bottom fade must be gone |
| `detail-movie.png` | Movie detail, long stream ladder, first stream focused |
| `detail-movie-mid.png` | Same, scrolled into the middle of the ladder — this is the edge-fade evidence |
| `detail-movie-end.png` | Scrolled to the last stream, which must be fully solid |
| `detail-short-ladder.png` | A title with only 2-3 streams — there must be no fade at all |
| `detail-series.png` | Series detail, episode list, an episode focused |
| `search.png` | Search with a query typed and results showing |

Add others only if a defect needs evidence; name them `defect-<what>.png` and say
in the commit message what is wrong in each.
