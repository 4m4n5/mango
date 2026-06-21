import { applyCompanionGardener, type GardenerResult } from './gardener.js';
import { applyFamiliarityStage, readProfile, writeProfile } from './profile.js';
import { listJournalEvents } from './journal.js';
import { writeCompiledNotes } from './compile-notes.js';
import { appendJournalEvent } from './journal.js';

export type NightlyPhase = 'rule' | 'gardener';

export type NightlyOptions = {
  phases?: NightlyPhase[];
};

export type NightlyResult = {
  ok: true;
  rule: { events: number; stage: string };
  gardener?: GardenerResult;
};

export async function runCompanionNightly(options: NightlyOptions = {}): Promise<NightlyResult> {
  const phases = options.phases ?? ['rule', 'gardener'];
  let ruleResult = { events: 0, stage: 'stranger' };

  if (phases.includes('rule')) {
    const profile = applyFamiliarityStage(await readProfile());
    await writeProfile(profile);
    const events = listJournalEvents(200);
    await writeCompiledNotes(profile);
    appendJournalEvent('nightly_consolidate', {
      event_count: events.length,
      stage: profile.familiarity.stage,
      phase: 'rule',
    });
    ruleResult = { events: events.length, stage: profile.familiarity.stage };
  }

  let gardenerResult: GardenerResult | undefined;
  if (phases.includes('gardener')) {
    gardenerResult = await applyCompanionGardener();
  }

  return {
    ok: true,
    rule: ruleResult,
    gardener: gardenerResult,
  };
}
