import type {
  RailGrowthNight,
  ReliabilityAction,
  ReliabilityComponent,
  ReliabilityFacts,
  ReliabilityLevel,
  ReliabilityState,
  StarvingRail,
} from './types.js';

const PROOF_STALE_MS = 36 * 60 * 60 * 1000;

/**
 * Walk nightly grow-refresh history chronologically and track, per rail, how
 * many consecutive nights running up to the latest recorded night it missed
 * its grow target. A met night resets the streak to zero for that rail.
 */
export function computeStarvingRails(history: RailGrowthNight[]): StarvingRail[] {
  const sorted = [...history].sort((left, right) => left.generated_at - right.generated_at);
  const perRail = new Map<string, { misses: number; last_yield: number; grow_target: number; last_checked_at: number }>();
  for (const night of sorted) {
    for (const rail of night.rails) {
      perRail.set(rail.rail_id, {
        misses: rail.grow_target_met ? 0 : (perRail.get(rail.rail_id)?.misses ?? 0) + 1,
        last_yield: rail.new_to_rail_verified,
        grow_target: rail.grow_target,
        last_checked_at: night.generated_at,
      });
    }
  }
  return Array.from(perRail.entries())
    .filter(([, info]) => info.misses > 0)
    .map(([rail_id, info]) => ({
      rail_id,
      nights_missed: info.misses,
      last_yield: info.last_yield,
      grow_target: info.grow_target,
      last_checked_at: info.last_checked_at,
    }))
    .sort((left, right) => right.nights_missed - left.nights_missed || left.rail_id.localeCompare(right.rail_id));
}

type PlayabilityRefreshFailure = {
  failed: boolean;
  reason: string;
};

/**
 * The last nightly proof's metadata carries playability_rc/playability_ok/
 * failure_category (when the caller supplies them — see
 * scripts/m6-ship/reliability-proof.sh). Historically this was recorded but
 * never consulted here, so a failed nightly grow could leave the couch-facing
 * state green. This never escalates past yellow: a stuck grow starves the
 * library, but it is not a couch-down event.
 */
function playabilityRefreshFailure(metadata: Record<string, unknown> | undefined): PlayabilityRefreshFailure {
  if (!metadata) return { failed: false, reason: '' };
  const rc = metadata.playability_rc;
  const rcFailed = typeof rc === 'number' && Number.isFinite(rc) && rc !== 0;
  const okFailed = metadata.playability_ok === false;
  const category = metadata.failure_category;
  const categoryFailed = typeof category === 'string' && category.length > 0;
  if (!rcFailed && !okFailed && !categoryFailed) {
    return { failed: false, reason: '' };
  }
  const parts: string[] = [];
  if (rcFailed) parts.push(`playability_rc=${rc}`);
  if (okFailed) parts.push('playability ok=false');
  if (categoryFailed) parts.push(`failure_category=${String(category)}`);
  return { failed: true, reason: parts.join(', ') };
}

function worst(left: ReliabilityLevel, right: ReliabilityLevel): ReliabilityLevel {
  if (left === 'red' || right === 'red') return 'red';
  if (left === 'yellow' || right === 'yellow') return 'yellow';
  return 'green';
}

function component(
  id: string,
  label: string,
  status: ReliabilityLevel,
  summary: string,
  detail?: string,
): ReliabilityComponent {
  return { id, label, status, summary, ...(detail ? { detail } : {}) };
}

export function evaluateReliability(facts: ReliabilityFacts): ReliabilityState {
  const components: ReliabilityComponent[] = [];

  const stackProblems: string[] = [];
  if (!facts.launcher.ok) stackProblems.push('launcher');
  if (!facts.launcher.browser) stackProblems.push('browser');
  if (!facts.launcher.openbox) stackProblems.push('openbox');
  if (facts.processes.launcher_browsers > 1) stackProblems.push('duplicate browser');
  if (facts.processes.stremio > 0) stackProblems.push('fallback Stremio running');
  if (facts.processes.kodi > 0) stackProblems.push('fallback Kodi running');
  const stackStatus: ReliabilityLevel = !facts.launcher.ok || !facts.launcher.browser || !facts.launcher.openbox
    ? 'red'
    : stackProblems.length > 0
      ? 'yellow'
      : 'green';
  components.push(component(
    'stack',
    'Stack',
    stackStatus,
    stackStatus === 'green' ? 'launcher surface is clean' : stackProblems.join(', '),
  ));

  const controllerState = facts.controller.link_state || '';
  const controllerStatus: ReliabilityLevel = controllerState === 'needs_re-pair' || controllerState === 'needs_repair'
    ? 'red'
    : facts.controller.ok || facts.controller.fallback ? 'green' : 'red';
  const controllerSummary = controllerState === 'needs_re-pair'
    ? 'controller pairing record is missing; explicit re-pair required'
    : controllerStatus === 'red'
      ? 'controller link needs repair'
    : controllerState === 'ready'
      ? 'controller is ready'
      : controllerState === 'connected_waiting_for_input'
        ? 'controller connected; waiting for Linux input'
        : controllerState === 'connecting' || controllerState === 'fast_retry'
        ? 'controller is connecting'
        : controllerState === 'off' || controllerState === 'maintenance_retry'
          ? 'controller is off; ready to reconnect'
          : 'input owner is ready';
  components.push(component(
    'controller',
    'Controller',
    controllerStatus,
    controllerSummary,
    facts.controller.last_error || facts.controller.reason || undefined,
  ));

  const catalogRed = !facts.catalog.ok || facts.catalog.core !== 'ready' || !facts.catalog.rails_ready;
  components.push(component(
    'catalog',
    'Catalog',
    catalogRed ? 'red' : 'green',
    catalogRed ? 'catalog rails are unavailable' : 'catalog rails are ready',
    `core=${facts.catalog.core} rss=${facts.catalog.rss_mb ?? 'unknown'}MB`,
  ));

  const liveStatus: ReliabilityLevel = facts.catalog.live_ready
    ? 'green'
    : facts.catalog.live_stale_fallback
      ? 'yellow'
      : 'red';
  components.push(component(
    'live',
    'Live',
    liveStatus,
    liveStatus === 'green'
      ? 'live rails ready'
      : liveStatus === 'yellow'
        ? 'using stale live fallback'
        : 'live rails unavailable',
  ));

  const libraryStatus: ReliabilityLevel = !facts.playability.ok || facts.playability.verified_total < 9
    ? 'red'
    : facts.playability.thin_rails.length > 0
      ? 'yellow'
      : 'green';
  components.push(component(
    'library',
    'Movies/TV Library',
    libraryStatus,
    libraryStatus === 'green'
      ? `${facts.playability.verified_total} verified titles across ${facts.playability.rail_count} rails`
      : libraryStatus === 'yellow'
        ? `${facts.playability.thin_rails.length} thin rails need growth`
        : 'verified movie/TV pool is not displayable',
    facts.playability.error,
  ));

  const youtubeStatus: ReliabilityLevel = !facts.youtube.enabled
    ? 'yellow'
    : facts.youtube.configured && facts.youtube.videos > 0
      ? facts.youtube.failed_phases.length > 0 || facts.youtube.last_error ? 'yellow' : 'green'
      : 'yellow';
  components.push(component(
    'youtube',
    'YouTube',
    youtubeStatus,
    !facts.youtube.enabled
      ? 'native YouTube disabled'
      : facts.youtube.videos > 0
        ? `${facts.youtube.videos} cached videos, ${facts.youtube.rail_count} cached rails`
        : 'YouTube cache is empty or unconfigured',
    facts.youtube.failed_phases.length > 0 ? `failed phases: ${facts.youtube.failed_phases.join(', ')}` : facts.youtube.last_error ?? undefined,
  ));

  const voiceStatus: ReliabilityLevel = !facts.voice.expected ? 'green' : facts.voice.ok ? 'green' : 'yellow';
  components.push(component(
    'voice',
    'Voice',
    voiceStatus,
    !facts.voice.expected ? 'voice disabled' : facts.voice.ok ? 'voice health is ready' : 'voice expected but not healthy',
  ));

  const maintenanceStatus: ReliabilityLevel = facts.maintenance.stale_locks.length > 0
    ? 'red'
    : facts.maintenance.busy || facts.processes.indexer > 0 || facts.processes.orphan_debug > 0
      ? 'yellow'
      : 'green';
  components.push(component(
    'maintenance',
    'Maintenance',
    maintenanceStatus,
    maintenanceStatus === 'green'
      ? 'no stale locks or stray maintenance processes'
      : maintenanceStatus === 'yellow'
        ? 'maintenance is running or cleanup is pending'
        : 'stale locks block maintenance',
    facts.maintenance.stale_locks.join(', ') || undefined,
  ));

  let proofStatus: ReliabilityLevel = 'yellow';
  let proofSummary = 'no nightly proof recorded yet';
  let proofDetail: string | undefined;
  if (facts.last_proof) {
    const ageMs = facts.generated_at - facts.last_proof.generated_at;
    const playabilityFailure = playabilityRefreshFailure(facts.last_proof.metadata);
    if (ageMs > PROOF_STALE_MS) {
      proofStatus = 'yellow';
      proofSummary = 'last nightly proof is stale';
    } else if (facts.last_proof.status === 'red') {
      proofStatus = 'yellow';
      proofSummary = 'last nightly proof failed; current state decides couch availability';
    } else if (playabilityFailure.failed) {
      proofStatus = 'yellow';
      proofSummary = 'last nightly playability refresh had a problem; library growth may be stalled';
      proofDetail = playabilityFailure.reason;
    } else {
      proofStatus = facts.last_proof.status;
      proofSummary = `last proof was ${facts.last_proof.status}`;
    }
  }
  components.push(component('proof', 'Last Nightly Proof', proofStatus, proofSummary, proofDetail));

  const starvingRails = computeStarvingRails(facts.rail_growth.history)
    .filter((rail) => rail.nights_missed >= facts.rail_growth.threshold_nights);
  const railGrowthStatus: ReliabilityLevel = starvingRails.length > 0 ? 'yellow' : 'green';
  components.push(component(
    'rail_growth',
    'Rail Growth',
    railGrowthStatus,
    railGrowthStatus === 'green'
      ? 'active rails are meeting their nightly grow targets'
      : `${starvingRails.length} rail(s) missed grow target for ${facts.rail_growth.threshold_nights}+ nights`,
    starvingRails.length > 0
      ? starvingRails
        .map((rail) => `${rail.rail_id}: missed ${rail.nights_missed}n (last +${rail.last_yield}/${rail.grow_target})`)
        .join('; ')
      : undefined,
  ));

  let status: ReliabilityLevel = 'green';
  for (const entry of components) {
    if (entry.id === 'proof' && entry.status === 'red') {
      status = worst(status, 'yellow');
    } else {
      status = worst(status, entry.status);
    }
  }

  const idleReason = facts.idle.idle ? undefined : `active recently from ${facts.idle.source}`;
  const actions: ReliabilityAction[] = [
    {
      id: 'repair',
      label: 'Repair now',
      enabled: facts.idle.idle,
      destructive: false,
      requires_idle: true,
      ...(idleReason ? { reason: idleReason } : {}),
    },
    {
      id: 'controller_repair',
      label: 'Repair controller',
      enabled: facts.idle.idle,
      destructive: false,
      requires_idle: true,
      ...(idleReason ? { reason: idleReason } : {}),
    },
    {
      id: 'proof',
      label: 'Run proof now',
      enabled: true,
      destructive: false,
      requires_idle: false,
    },
    {
      id: 'stack_restart',
      label: 'Restart stack',
      enabled: facts.idle.idle,
      destructive: true,
      requires_idle: true,
      ...(idleReason ? { reason: idleReason } : {}),
    },
    {
      id: 'refresh',
      label: 'Run refresh',
      enabled: facts.idle.idle,
      destructive: false,
      requires_idle: true,
      ...(idleReason ? { reason: idleReason } : {}),
    },
  ];

  const summary = status === 'green'
    ? 'Mango is ready for couch use.'
    : status === 'yellow'
      ? 'Mango is usable, but reliability needs attention.'
      : 'Mango is not ready for couch use.';

  return {
    ok: status !== 'red',
    status,
    generated_at: facts.generated_at,
    generated_at_iso: new Date(facts.generated_at).toISOString(),
    commit: facts.commit,
    summary,
    quiet_badge: status !== 'green',
    couch_message: status === 'red' ? summary : null,
    idle: facts.idle,
    components,
    actions,
    last_proof: facts.last_proof,
  };
}
