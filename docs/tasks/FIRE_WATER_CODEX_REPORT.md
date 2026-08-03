# Fire & Water ratings / For You implementation report

**Date:** 2026-08-02
**Branch:** `feat/native-experience`
**Starting tip:** `450581c24536c6e2a4d5d662dde7b10ea7404470`
**Pi/TV:** not accessed; all target-device claims are **DEFERRED**.

## Delivered

### S1 — durable state and seed safety

- Library migration 4 with current ratings, append-only events, one-time prompt
  state, import ledger, versioned features/taste, and recommendation snapshots.
- One pre-migration SQLite online backup; no DB/cache/history deletion.
- Canonical source-independent movie/show identity and integer half-steps 0–10.
- Revision conflicts, idempotent manifests, couch-over-seed precedence, and
  strict rejection of unresolved rows, raw captions, source URLs, invalid
  increments, weak match evidence, and conflicting duplicates.
- CLI: `npm run ratings:seed -- <dry-run|validate|import> manifest.json`.

### S2 — API and 10-foot interaction

- `GET/PUT/DELETE /library/ratings` and prompt dismissal API.
- Detail Rate/Edit Rating action, compact Fire/Water chips, and one-time return
  invitation; absent on Live and YouTube.
- Safe-area bottom sheet with explicit slider adjustment, half-step values,
  disabled-until-confirmed Save, X clear confirmation, Y cancellation,
  persistent error state, and optimistic revisions.
- Visual match to the supplied household reference: five native flame/wave
  emoji, saturated fill, grayscale remainder, and clipped half marks.
- Existing B/Y/X ownership and D-pad stack preserved.

### S3 — deterministic personalized rail

- Dependency-light independent Fire/Water prediction, cosine KNN, confidence
  weights, Bayesian shrinkage, low-confidence fallback, TV movie-transfer decay,
  high-axis qualification, and high-high balance bonus.
- Verified-only candidate corpus with hard eligibility filters and Saved/watch
  fallback behavior.
- Stable 8 close / 3 adjacent / 1 exploration selection, 75/25 MMR, cluster
  cap, duplicate removal, 40-item last-good reserve, atomic revisions,
  eligibility-filtered loading, and ordinary card payloads only.
- Rail order: Continue → Saved → For You → AI catalogs → curated discovery.

### S4 — background/flags

- Immediate rerank after rating without rolling back the rating on failure.
- Companion nightly refresh after existing optional LLM/gardener work.
- Foreground-playback and playability-lock deferral.
- `MANGO_FIRE_WATER_RATINGS`, `MANGO_FOR_YOU`, and
  `MANGO_RECOMMENDATIONS_AI` reversible flags.
- Local diagnostics expose only counts/revisions/age, never title-level ratings
  or predictions.

## Seed evidence and blocker

Read-only Sheet1 audit found 56 non-empty rows and 54 clean half-step pairs.
Two rows require explicit human disposition: `The idea of you` has no scores;
`La Cocina` has ranges on both axes. No stable IDs exist in the sheet.

The importer and review contract are complete, but no deployable approved seed
manifest was fabricated. Stable-ID reconciliation, explicit approval/exclusion
of all 56 rows, derived private tags/hashes, dry-run, and double import are
**DEFERRED** to the home workflow. Until then, couch-created ratings can train
For You, while seed-based warm start remains intentionally inactive.

## Local evidence

Passed after the final source changes:

```text
catalog-service full suite: 748 pass, 0 fail
launcher TypeScript + Vite production build: pass (28 modules)
M6.5 UX smoke: pass (49 launcher tests, 20 pad/context tests)
  - 2 expected off-Pi warnings: launcher HTTP and mango-tv-pad not running
seed CLI dry-run: pass against a strict excluded-row fixture
seed CLI validation: pass against the same fixture
git diff --check: pass
```

The full catalog suite and UX smoke need localhost/Unix-socket access; their
final runs used normal host permissions after restricted-sandbox attempts hit
`EPERM`. The Mac `gate-lite` target gate remains **DEFERRED** because its pad,
launcher-health, memory, and display-mode checks require the Pi runtime. It was
not relabeled as a local pass.

## Privacy audit

- Rating API/public rail payloads contain no raw captions, predictions, reasons,
  URLs, tokens, or credentials.
- The seed validator rejects raw caption and sheet URL keys.
- Internal snapshot scores stay in `library.db` and do not cross the launcher
  rail interface.
- No YouTube auth/quota files or resolver credentials were touched.

## Deferred target proof

- Approved seed reconciliation/import and idempotence.
- Migration backup existence and rating persistence across Pi restart.
- Rating mutation p95 <150ms and cached rail assembly <25ms p95.
- AI-disabled, AI-failure, network-offline, and restart last-good proof.
- 1920×1080 screenshots of all rating states and both rails.
- Target-TV emoji/font rendering, half-fill seam, 5% safe area, 4px focus
  contrast, and 3 m readability.
- AI-enriched feature coverage, bounded discovery-query expansion, and model
  evaluation against the approved reconciled seed. The deterministic
  metadata-only ranker and last-good rail remain functional with AI disabled.
- Verified playability of every visible recommendation, 4K playback regression,
  and explicit human relevance/diversity/semantics verdicts.

Home deploy and acceptance commands:

```bash
git switch feat/native-experience
git pull --ff-only
bash scripts/pi-deploy.sh --fast --gate
bash scripts/pi-exec-gate.sh
```

Then follow [../FIRE_WATER_RATINGS.md](../FIRE_WATER_RATINGS.md) and the FW1–FW13
section in [../COUCH_TEST.md](../COUCH_TEST.md).
