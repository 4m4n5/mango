#!/usr/bin/env python3
"""Library Grower SLA assessment for ops reports (PR6)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover - Pi has PyYAML via catalog scripts
    yaml = None  # type: ignore[assignment]

DEFAULT_DISPLAY_LIMIT = 9
DEFAULT_GROW_PER_PASS = 20
SPARSE_MULTIPLIER = 2
PROGRAM_PASS_RATE = 0.80
GROW_EVENT_KINDS = frozenset({"playability_growth", "playability_maintenance"})


@dataclass(frozen=True)
class RailPlayabilityConfig:
    display_limit: int = DEFAULT_DISPLAY_LIMIT
    grow_per_pass: int = DEFAULT_GROW_PER_PASS


@dataclass(frozen=True)
class RailSlaAssessment:
    rail_id: str
    label: str
    verified_before: int
    grow_target: int
    probe_verified: int
    grow_target_met: bool
    sparse_tier: bool
    exhausted: bool
    compose_escalated: bool
    compose_fallback_level: int | None
    status: str  # ok | warn | skip
    reason: str | None


@dataclass(frozen=True)
class GrowSlaSummary:
    rails: list[RailSlaAssessment]
    browse_rail_count: int
    met_count: int
    warn_count: int
    program_pass: bool
    program_pass_rate: float
    compose_escalated_rails: list[str]
    exhausted_below_target: list[str]


def resolve_grow_target(
    playability: RailPlayabilityConfig,
    verified_before: int,
) -> int:
    base = playability.grow_per_pass
    if verified_before < playability.display_limit:
        return base * SPARSE_MULTIPLIER
    return base


def catalog_playability_path() -> Path:
    env = os.environ.get("MANGO_CATALOG_YAML")
    if env:
        return Path(env)
    return Path("/etc/mango/catalog.yaml")


def ai_catalogs_dir() -> Path:
    return Path(os.environ.get("MANGO_AI_CATALOGS_DIR", "/etc/mango/ai-catalogs"))


def _iter_ai_slot_paths(ai_dir: Path) -> list[Path]:
    if not ai_dir.is_dir():
        return []
    paths: set[Path] = set()
    for pattern in ("*.json", "*.yaml", "*.yml"):
        paths.update(ai_dir.glob(pattern))
    slots_dir = ai_dir / "slots"
    if slots_dir.is_dir():
        for pattern in ("*.json", "*.yaml", "*.yml"):
            paths.update(slots_dir.glob(pattern))
    return sorted(paths)


def _read_ai_slot_file(slot_path: Path) -> dict[str, Any] | None:
    try:
        raw = slot_path.read_text(encoding="utf-8")
        if slot_path.suffix in {".yaml", ".yml"}:
            if yaml is None:
                return None
            data = yaml.safe_load(raw)
        else:
            import json

            data = json.loads(raw)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _ai_slot_configs(ai_dir: Path) -> dict[str, RailPlayabilityConfig]:
    configs: dict[str, RailPlayabilityConfig] = {}
    for slot_path in _iter_ai_slot_paths(ai_dir):
        slot = _read_ai_slot_file(slot_path)
        if not slot or slot.get("enabled") is False:
            continue
        slot_id = str(slot.get("slot_id") or slot_path.stem)
        rail_id = f"ai-{slot_id}"
        play = slot.get("playability") or {}
        configs[rail_id] = RailPlayabilityConfig(
            display_limit=int(play.get("display_limit") or DEFAULT_DISPLAY_LIMIT),
            grow_per_pass=int(play.get("grow_per_pass") or DEFAULT_GROW_PER_PASS),
        )
    return configs


def load_catalog_playability(path: Path | None = None) -> dict[str, RailPlayabilityConfig]:
    catalog_path = path or catalog_playability_path()
    if not catalog_path.exists() or yaml is None:
        return {}

    data = yaml.safe_load(catalog_path.read_text(encoding="utf-8")) or {}
    configs: dict[str, RailPlayabilityConfig] = {}

    for rail in data.get("rails") or []:
        if rail.get("enabled") is False:
            continue
        if rail.get("type") not in {"addon_catalog", "composite_list"}:
            continue
        play = rail.get("playability") or {}
        configs[str(rail["id"])] = RailPlayabilityConfig(
            display_limit=int(play.get("display_limit") or DEFAULT_DISPLAY_LIMIT),
            grow_per_pass=int(play.get("grow_per_pass") or DEFAULT_GROW_PER_PASS),
        )

    configs.update(_ai_slot_configs(ai_catalogs_dir()))

    return configs


def list_grow_rail_ids(path: Path | None = None) -> list[str]:
    """Grow-pass rail ids: yaml browse rails in catalog order, then ai-* slots."""
    catalog_path = path or catalog_playability_path()
    browse: list[str] = []
    if catalog_path.exists() and yaml is not None:
        data = yaml.safe_load(catalog_path.read_text(encoding="utf-8")) or {}
        for rail in data.get("rails") or []:
            if rail.get("enabled") is False:
                continue
            if rail.get("type") not in {"addon_catalog", "composite_list"}:
                continue
            browse.append(str(rail["id"]))

    ai: list[str] = []
    for rail_id in sorted(load_catalog_playability(catalog_path)):
        if rail_id.startswith("ai-"):
            ai.append(rail_id)
    return browse + ai


def _verified_before(row: dict[str, Any]) -> int:
    if row.get("verified_before") is not None:
        return int(row["verified_before"])
    before = row.get("before")
    if isinstance(before, dict) and before.get("verified_pool") is not None:
        return int(before["verified_pool"])
    return 0


def _fresh_verified(row: dict[str, Any]) -> int:
    if row.get("fresh_verified") is not None:
        return int(row["fresh_verified"])
    if row.get("probe_verified") is not None:
        return int(row["probe_verified"])
    if row.get("verified_added") is not None:
        return int(row["verified_added"])
    return 0


def _probe_verified(row: dict[str, Any]) -> int:
    return _fresh_verified(row)


def normalize_grow_rail_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "rail_id": row.get("rail_id"),
        "label": row.get("label") or row.get("rail_id") or "-",
        "verified_before": _verified_before(row),
        "grow_target": row.get("grow_target"),
        "fresh_verified": _fresh_verified(row),
        "probe_verified": _probe_verified(row),
        "pool_growth": row.get("pool_growth"),
        "linked_existing": row.get("linked_existing"),
        "grow_target_met": row.get("grow_target_met"),
        "exhausted": bool(row.get("exhausted")),
        "compose_escalated": bool(row.get("compose_escalated")),
        "compose_fallback_level": row.get("compose_fallback_level"),
    }


def assess_rail_sla(
    row: dict[str, Any],
    catalog: dict[str, RailPlayabilityConfig] | None = None,
) -> RailSlaAssessment | None:
    rail_id = row.get("rail_id")
    if not rail_id:
        return None

    catalog = catalog or {}
    cfg = catalog.get(str(rail_id), RailPlayabilityConfig())
    verified_before = _verified_before(row)
    grow_target_raw = row.get("grow_target")
    grow_target = (
        int(grow_target_raw)
        if grow_target_raw is not None
        else resolve_grow_target(cfg, verified_before)
    )
    probe_verified = _probe_verified(row)
    grow_target_met = row.get("grow_target_met")
    if grow_target_met is None:
        grow_target_met = probe_verified >= grow_target
    else:
        grow_target_met = bool(grow_target_met)

    sparse_tier = verified_before < cfg.display_limit
    exhausted = bool(row.get("exhausted"))
    compose_escalated = bool(row.get("compose_escalated"))
    compose_fallback_level = row.get("compose_fallback_level")
    fallback_level = int(compose_fallback_level) if compose_fallback_level is not None else None

    if grow_target_met:
        return RailSlaAssessment(
            rail_id=str(rail_id),
            label=str(row.get("label") or rail_id),
            verified_before=verified_before,
            grow_target=grow_target,
            probe_verified=probe_verified,
            grow_target_met=True,
            sparse_tier=sparse_tier,
            exhausted=exhausted,
            compose_escalated=compose_escalated,
            compose_fallback_level=fallback_level,
            status="ok",
            reason=None,
        )

    if exhausted:
        reason = "catalog exhausted below target"
        if compose_escalated:
            reason += f" (compose fallback {fallback_level})"
    else:
        reason = f"+{probe_verified}/{grow_target} probe-verified (wall or attempt limit)"

    return RailSlaAssessment(
        rail_id=str(rail_id),
        label=str(row.get("label") or rail_id),
        verified_before=verified_before,
        grow_target=grow_target,
        probe_verified=probe_verified,
        grow_target_met=False,
        sparse_tier=sparse_tier,
        exhausted=exhausted,
        compose_escalated=compose_escalated,
        compose_fallback_level=fallback_level,
        status="warn",
        reason=reason,
    )


def _grow_rail_rows_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    mode = payload.get("mode")
    if mode not in (None, "grow"):
        return []
    rails = payload.get("rails")
    if not isinstance(rails, list):
        return []
    return [row for row in rails if isinstance(row, dict) and row.get("rail_id")]


def _merge_grow_rows(into: dict[str, dict[str, Any]], payload: dict[str, Any]) -> None:
    for row in _grow_rail_rows_from_payload(payload):
        rid = str(row["rail_id"])
        into[rid] = normalize_grow_rail_row(row)


def collect_grow_rail_rows(
    events: list[dict[str, Any]],
    reports: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Latest grow-phase row per rail from ops events and run reports."""
    by_rail: dict[str, dict[str, Any]] = {}

    for event in events:
        kind = event.get("kind")
        if kind not in GROW_EVENT_KINDS:
            continue
        payload = event.get("payload")
        if isinstance(payload, dict):
            _merge_grow_rows(by_rail, payload)

    for report in reports or []:
        if report.get("kind") not in GROW_EVENT_KINDS:
            continue
        if isinstance(report, dict):
            _merge_grow_rows(by_rail, report)
            result = report.get("result")
            if isinstance(result, dict):
                _merge_grow_rows(by_rail, result)

    return list(by_rail.values())


def summarize_grow_sla(
    events: list[dict[str, Any]],
    reports: list[dict[str, Any]] | None = None,
    *,
    catalog: dict[str, RailPlayabilityConfig] | None = None,
) -> GrowSlaSummary | None:
    rows = collect_grow_rail_rows(events, reports)
    if not rows:
        return None

    if catalog is None:
        catalog = load_catalog_playability()

    assessments: list[RailSlaAssessment] = []
    for row in rows:
        assessment = assess_rail_sla(row, catalog)
        if assessment:
            assessments.append(assessment)

    assessments.sort(key=lambda item: item.rail_id)
    browse_count = len(assessments)
    met_count = sum(1 for item in assessments if item.grow_target_met)
    warn_count = browse_count - met_count
    pass_rate = met_count / browse_count if browse_count else 0.0

    return GrowSlaSummary(
        rails=assessments,
        browse_rail_count=browse_count,
        met_count=met_count,
        warn_count=warn_count,
        program_pass=pass_rate >= PROGRAM_PASS_RATE,
        program_pass_rate=pass_rate,
        compose_escalated_rails=[
            item.rail_id for item in assessments if item.compose_escalated
        ],
        exhausted_below_target=[
            item.rail_id
            for item in assessments
            if item.exhausted and not item.grow_target_met
        ],
    )


def format_grow_sla_section(summary: GrowSlaSummary) -> str:
    pct = int(round(summary.program_pass_rate * 100))
    verdict = "PASS" if summary.program_pass else "WARN"
    lines = [
        f"Program: {summary.met_count}/{summary.browse_rail_count} rails met grow target "
        f"({pct}%) — {verdict} (≥{int(PROGRAM_PASS_RATE * 100)}%)",
        "",
        f"  {'rail':28} {'tgt':>4} {'probe':>5} {'met':>4} {'sparse':>6} {'exh':>4}  notes",
        "  " + "-" * 72,
    ]

    for rail in summary.rails:
        notes = rail.reason or ""
        if rail.compose_escalated and not notes:
            notes = f"compose fallback {rail.compose_fallback_level}"
        lines.append(
            f"  {rail.rail_id[:28]:28} {rail.grow_target:4d} {rail.probe_verified:5d} "
            f"{'yes' if rail.grow_target_met else 'no':>4} "
            f"{'yes' if rail.sparse_tier else 'no':>6} "
            f"{'yes' if rail.exhausted else 'no':>4}  {notes}",
        )

    if summary.compose_escalated_rails:
        lines.append("")
        lines.append(
            "Compose escalation: "
            + ", ".join(summary.compose_escalated_rails),
        )

    warnings = [rail for rail in summary.rails if rail.status == "warn"]
    if warnings:
        lines.append("")
        lines.append(f"Shortfalls ({len(warnings)}):")
        for rail in warnings:
            lines.append(f"  - {rail.rail_id}: {rail.reason}")

    return "\n".join(lines) + "\n"
