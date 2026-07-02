import type {
  ReliabilityAction,
  ReliabilityComponent,
  ReliabilityFacts,
  ReliabilityLevel,
  ReliabilityState,
} from './types.js';

const PROOF_STALE_MS = 36 * 60 * 60 * 1000;

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

  const controllerStatus: ReliabilityLevel = facts.controller.ok || facts.controller.fallback ? 'green' : 'red';
  components.push(component(
    'controller',
    'Controller',
    controllerStatus,
    controllerStatus === 'green' ? 'input owner is ready' : 'controller unavailable',
    facts.controller.reason || undefined,
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
  if (facts.last_proof) {
    const ageMs = facts.generated_at - facts.last_proof.generated_at;
    if (ageMs > PROOF_STALE_MS) {
      proofStatus = 'yellow';
      proofSummary = 'last nightly proof is stale';
    } else if (facts.last_proof.status === 'red') {
      proofStatus = 'yellow';
      proofSummary = 'last nightly proof failed; current state decides couch availability';
    } else {
      proofStatus = facts.last_proof.status;
      proofSummary = `last proof was ${facts.last_proof.status}`;
    }
  }
  components.push(component('proof', 'Last Nightly Proof', proofStatus, proofSummary));

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
