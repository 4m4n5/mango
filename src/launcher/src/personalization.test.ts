import assert from "node:assert/strict";
import test from "node:test";
import {
  activeViewerProfile,
  canActivatePersonalizedCatalogCache,
  moodDisplayLabel,
  needsProfileOnboarding,
  PersonalizationOwnedCache,
  personalizationExpectationBody,
  personalizationExpectationParams,
  personalizationOwnerFromPayload,
  personalizationAriaLabel,
  personalizationControlsVisible,
  profileInitial,
  samePersonalizationOwner,
  samePersonalizationRequestVersion,
  type PersonalizationPayload,
} from "./personalization.js";

function payload(
  activeProfileId = "household",
  mood: string | null = null,
): PersonalizationPayload {
  return {
    ok: true,
    profiles: [
      {
        profile_id: "household",
        name: "Household",
        kind: "household",
        onboarding_complete: true,
        sort_order: 0,
        created_at: 1,
        updated_at: 1,
      },
      {
        profile_id: "aman",
        name: "Aman",
        kind: "personal",
        onboarding_complete: false,
        sort_order: 1,
        created_at: 2,
        updated_at: 2,
      },
    ],
    state: {
      active_profile_id: activeProfileId,
      mood,
      mood_started_at: mood ? 10 : null,
      mood_expires_at: mood ? 20 : null,
      updated_at: 10,
    },
  };
}

test("active profile and explicit mood produce couch-readable chrome copy", () => {
  const state = payload("aman", "deep");
  assert.equal(activeViewerProfile(state).name, "Aman");
  assert.equal(moodDisplayLabel(state.state.mood), "Thoughtful");
  assert.equal(
    personalizationAriaLabel(state),
    "Personalization settings. Aman profile. Thoughtful.",
  );
});

test("unknown profile safely falls back to the household", () => {
  assert.equal(activeViewerProfile(payload("removed-profile")).profile_id, "household");
});

test("profile controls fail closed until the server explicitly reports profile mode", () => {
  assert.equal(personalizationControlsVisible(null), false);
  assert.equal(personalizationControlsVisible(payload()), false);
  assert.equal(personalizationControlsVisible({ ...payload(), household_only: true }), false);
  assert.equal(personalizationControlsVisible({ ...payload(), household_only: false }), true);
});

test("personal profile onboarding is optional and never applies to Household", () => {
  assert.equal(needsProfileOnboarding(payload("aman")), true);
  const completed = payload("aman");
  completed.profiles[1]!.onboarding_complete = true;
  assert.equal(needsProfileOnboarding(completed), false);
  assert.equal(needsProfileOnboarding(payload("household")), false);
});

test("companion-defined moods remain readable without rendering raw separators", () => {
  assert.equal(moodDisplayLabel("science_fiction"), "Science fiction");
  assert.equal(moodDisplayLabel(null), "Any mood");
});

test("profile initials support Unicode names and a safe empty fallback", () => {
  assert.equal(profileInitial("  Élodie"), "É");
  assert.equal(profileInitial(""), "M");
});

test("async personalization ownership requires the same request, profile, and revision", () => {
  const captured = {
    catalogRequestSeq: 7,
    profileId: "aman",
    personalizationUpdatedAt: 41,
  };
  assert.equal(samePersonalizationRequestVersion(captured, { ...captured }), true);
  assert.equal(samePersonalizationRequestVersion(captured, {
    ...captured,
    catalogRequestSeq: 8,
  }), false);
  assert.equal(samePersonalizationRequestVersion(captured, {
    ...captured,
    profileId: "household",
  }), false);
  assert.equal(samePersonalizationRequestVersion(captured, {
    ...captured,
    personalizationUpdatedAt: 42,
  }), false);
});

test("profile-owned requests serialize and validate the exact server echo", () => {
  const owner = { profileId: "aman", personalizationUpdatedAt: 41 };
  assert.deepEqual(
    Object.fromEntries(personalizationExpectationParams(owner)),
    {
      expected_profile_id: "aman",
      expected_personalization_updated_at: "41",
    },
  );
  assert.deepEqual(personalizationExpectationBody(owner), {
    expected_profile_id: "aman",
    expected_personalization_updated_at: 41,
  });
  assert.deepEqual(personalizationOwnerFromPayload({
    profile_id: "aman",
    personalization_updated_at: 41,
  }), owner);
  assert.equal(samePersonalizationOwner(owner, { ...owner }), true);
  assert.equal(samePersonalizationOwner(owner, {
    ...owner,
    personalizationUpdatedAt: 42,
  }), false);
  assert.equal(personalizationOwnerFromPayload({ profile_id: "aman" }), null);
  assert.equal(personalizationOwnerFromPayload({
    profile_id: "aman",
    personalization_updated_at: 1.5,
  }), null);
});

test("a missed companion notification withholds a cached tab after the server owner changes", () => {
  const cachedAlice = { profileId: "alice", personalizationUpdatedAt: 17 };
  assert.equal(canActivatePersonalizedCatalogCache(cachedAlice, {
    active_profile_id: "alice",
    updated_at: 17,
  }), true);
  assert.equal(canActivatePersonalizedCatalogCache(cachedAlice, {
    active_profile_id: "bob",
    updated_at: 18,
  }), false);
  assert.equal(canActivatePersonalizedCatalogCache(cachedAlice, {
    active_profile_id: "alice",
    updated_at: 18,
  }), false);
});

test("a Settings owner refresh cannot activate a cache produced for the previous profile", () => {
  const alice = { profileId: "alice", personalizationUpdatedAt: 17 };
  const movies = new PersonalizationOwnedCache<string, string[]>();
  movies.set("movies", ["alice-only-title"], alice);
  const bob = { profileId: "bob", personalizationUpdatedAt: 18 };

  // This is the missed-notification sequence that a global owner check alone
  // cannot catch: Settings has already advanced the launcher to Bob, and the
  // fresh server read also says Bob, while the tab cache still belongs to Alice.
  assert.equal(canActivatePersonalizedCatalogCache(bob, {
    active_profile_id: "bob",
    updated_at: 18,
  }), true);
  assert.equal(movies.get("movies", bob), undefined);
  movies.set("movies", ["bob-title"], bob);
  assert.deepEqual(movies.get("movies", bob), ["bob-title"]);
});

test("a failed forced refresh retains last-good rails until a successful commit", async () => {
  const owner = { profileId: "aman", personalizationUpdatedAt: 41 };
  const movies = new PersonalizationOwnedCache<string, string[]>();
  const lastGood = ["last-good-title"];
  movies.set("movies", lastGood, owner);

  async function forcedRefresh(load: () => Promise<string[]>): Promise<void> {
    const refresh = movies.beginRefresh("movies", owner, { bypassRead: true });
    assert.equal(refresh.cachedValue, undefined, "forced refresh must bypass read-through");
    assert.equal(refresh.lastGoodValue, lastGood, "fallback remains available to the load");
    refresh.commit(await load(), owner);
  }

  await assert.rejects(
    forcedRefresh(async () => { throw new Error("catalog unavailable"); }),
    /catalog unavailable/,
  );
  assert.equal(movies.get("movies", owner), lastGood, "failure cannot erase durable fallback");

  const replacement = ["new-title"];
  await forcedRefresh(async () => replacement);
  assert.equal(movies.get("movies", owner), replacement, "success atomically replaces fallback");
});
