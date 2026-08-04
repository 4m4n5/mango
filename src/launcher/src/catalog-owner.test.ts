import assert from "node:assert/strict";
import test from "node:test";
import { CatalogOwnershipChangedError } from "./catalog-errors.js";
import {
  isNotInterestedCard,
  loadCatalogRails,
  loadNextPrompt,
  notInterestedCard,
  playCard,
  undoNotInterestedCard,
} from "./catalog.js";
import { loadFireWaterRating } from "./ratings.js";
import {
  fetchSavedIds,
  publishCurrentLibraryContext,
  saveCard,
  unsaveCard,
} from "./saved.js";
import {
  fetchHiddenTitlesForOwner,
  restoreHiddenTitleForOwner,
  type HiddenRecommendationItem,
} from "./settings.js";

const owner = { profileId: "alice", personalizationUpdatedAt: 17 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withMockFetch<T>(
  implementation: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("strict VOD load sends one owner-bound batch request and never falls back after 409", async () => {
  const calls: string[] = [];
  await withMockFetch(async (input) => {
    calls.push(String(input));
    return jsonResponse({ error: "profile changed" }, 409);
  }, async () => {
    await assert.rejects(
      loadCatalogRails("movies", { expectedOwner: owner }),
      CatalogOwnershipChangedError,
    );
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!, "http://launcher.test");
  assert.equal(url.pathname, "/api/catalog/rails/items");
  assert.equal(url.searchParams.get("expected_profile_id"), "alice");
  assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
});

test("VOD and YouTube loads require the exact echoed owner", async () => {
  await withMockFetch(async (input) => {
    const url = new URL(String(input), "http://launcher.test");
    if (url.pathname === "/api/catalog/rails/items") {
      return jsonResponse({
        tab: "movies",
        profile_id: "alice",
        personalization_updated_at: 17,
        rails: [],
      });
    }
    return jsonResponse({
      slate_sequence: 4,
      profile_id: "alice",
      personalization_updated_at: 17,
      rails: [],
    });
  }, async () => {
    assert.deepEqual(await loadCatalogRails("movies", { expectedOwner: owner }), {
      rails: [],
      owner,
    });
    assert.deepEqual(await loadCatalogRails("youtube", { expectedOwner: owner }), {
      rails: [],
      owner,
    });
  });

  await withMockFetch(async () => jsonResponse({
    slate_sequence: 4,
    profile_id: "bob",
    personalization_updated_at: 18,
    rails: [],
  }), async () => {
    await assert.rejects(
      loadCatalogRails("youtube", { expectedOwner: owner }),
      CatalogOwnershipChangedError,
    );
  });
});

test("Saved IDs on every personalized tab use the same owner handshake", async () => {
  const calls: string[] = [];
  await withMockFetch(async (input) => {
    calls.push(String(input));
    const url = new URL(String(input), "http://launcher.test");
    assert.equal(url.searchParams.get("expected_profile_id"), "alice");
    assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
    const tab = url.searchParams.get("tab");
    return jsonResponse({
      profile_id: "alice",
      personalization_updated_at: 17,
      saved: [{ source: "mango", tab, type: "movie", id: `tt-${tab}`, title: "One", poster: null, saved_at: 1 }],
    });
  }, async () => {
    for (const tab of ["movies", "series", "youtube"] as const) {
      assert.deepEqual([...await fetchSavedIds(tab, owner)], [`mango:movie:tt-${tab}`]);
    }
  });
  assert.equal(calls.length, 3);

  await withMockFetch(async () => jsonResponse({ saved: [] }), async () => {
    await assert.rejects(fetchSavedIds("movies", owner), CatalogOwnershipChangedError);
  });
});

test("Live Saved lookup remains explicitly unowned", async () => {
  await withMockFetch(async (input) => {
    const url = new URL(String(input), "http://launcher.test");
    assert.equal(url.searchParams.get("tab"), "live");
    assert.equal(url.searchParams.has("expected_profile_id"), false);
    assert.equal(url.searchParams.has("expected_personalization_updated_at"), false);
    return jsonResponse({ saved: [] });
  }, async () => {
    assert.deepEqual([...await fetchSavedIds("live")], []);
  });
});

test("Detail rating reads carry the immutable owner and reject a stale echo", async () => {
  await withMockFetch(async (input) => {
    const url = new URL(String(input), "http://launcher.test");
    assert.equal(url.pathname, "/api/catalog/library/ratings");
    assert.equal(url.searchParams.get("type"), "movie");
    assert.equal(url.searchParams.get("id"), "tt-one");
    assert.equal(url.searchParams.get("expected_profile_id"), "alice");
    assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
    return jsonResponse({
      ok: true,
      enabled: true,
      rating: null,
      prompt: { eligible: false, presented_at: null, resolved_at: null },
      profile_id: "alice",
      personalization_updated_at: 17,
    });
  }, async () => {
    assert.equal((await loadFireWaterRating({
      id: "tt-one", type: "movie", title: "One", subtitle: "2026",
    }, owner)).rating, null);
  });

  await withMockFetch(async () => jsonResponse({
    ok: true,
    enabled: true,
    rating: null,
    prompt: { eligible: false, presented_at: null, resolved_at: null },
    profile_id: "bob",
    personalization_updated_at: 18,
  }), async () => {
    await assert.rejects(loadFireWaterRating({
      id: "tt-one", type: "movie", title: "One", subtitle: "2026",
    }, owner), CatalogOwnershipChangedError);
  });
});

test("Detail Saved and current-context mutations require the captured owner echo", async () => {
  const methods: string[] = [];
  await withMockFetch(async (_input, init) => {
    methods.push(String(init?.method));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.expected_profile_id, "alice");
    assert.equal(body.expected_personalization_updated_at, 17);
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
    });
  }, async () => {
    const card = { id: "tt-one", type: "movie", title: "One", subtitle: "2026" };
    await saveCard("movies", card, owner);
    await unsaveCard(card, owner);
    await publishCurrentLibraryContext("movies", card, owner);
  });
  assert.deepEqual(methods, ["POST", "DELETE", "POST"]);

  await withMockFetch(async () => jsonResponse({
    ok: true,
    profile_id: "bob",
    personalization_updated_at: 18,
  }), async () => {
    await assert.rejects(saveCard("movies", {
      id: "tt-one", type: "movie", title: "One", subtitle: "2026",
    }, owner), CatalogOwnershipChangedError);
  });
});

test("Not-for-me reads and mutations are owner-bound independently of attribution", async () => {
  const methods: string[] = [];
  await withMockFetch(async (input, init) => {
    methods.push(String(init?.method ?? "GET"));
    if (!init?.body) {
      const url = new URL(String(input), "http://launcher.test");
      assert.equal(url.searchParams.get("expected_profile_id"), "alice");
      assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
      return jsonResponse({
        hidden: false,
        profile_id: "alice",
        personalization_updated_at: 17,
      });
    }
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(body.expected_profile_id, "alice");
    assert.equal(body.expected_personalization_updated_at, 17);
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
    });
  }, async () => {
    const card = { id: "tt-one", type: "movie", title: "One", subtitle: "2026" };
    assert.equal(await isNotInterestedCard(card, owner), false);
    await notInterestedCard(card, "movies", owner);
    await undoNotInterestedCard(card, "movies", owner);
  });
  assert.deepEqual(methods, ["GET", "POST", "DELETE"]);
});

test("playback acceptance and next-episode reads require the captured owner", async () => {
  await withMockFetch(async (input, init) => {
    const url = new URL(String(input), "http://launcher.test");
    if (url.pathname === "/api/catalog/play/next-prompt") {
      assert.equal(url.searchParams.get("expected_profile_id"), "alice");
      assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
      return jsonResponse({
        show: false,
        profile_id: "alice",
        personalization_updated_at: 17,
      });
    }
    assert.equal(url.pathname, "/api/catalog/play-session");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.expected_profile_id, "alice");
    assert.equal(body.expected_personalization_updated_at, 17);
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
      session: {
        session_id: "session-one",
        version: 1,
        state: "playing",
        ever_ready: true,
        error: null,
        result: { ok: true },
      },
    }, 202);
  }, async () => {
    assert.equal((await loadNextPrompt(owner)).show, false);
    assert.equal((await playCard({
      id: "tt-one", type: "movie", title: "One", subtitle: "2026",
    }, { expectedOwner: owner })).ok, true);
  });

  await withMockFetch(async () => jsonResponse({
    error: "profile changed",
  }, 409), async () => {
    await assert.rejects(playCard({
      id: "tt-one", type: "movie", title: "One", subtitle: "2026",
    }, { expectedOwner: owner }), CatalogOwnershipChangedError);
  });
});

const hiddenItem: HiddenRecommendationItem = {
  source: "mango",
  type: "movie",
  id: "tt-hidden",
  title: "Hidden",
  tab: "movies",
};

test("Hidden-title Settings GET is owner-bound and rejects a stale echo", async () => {
  await withMockFetch(async (input) => {
    const url = new URL(String(input), "http://launcher.test");
    assert.equal(url.pathname, "/api/catalog/library/not-interested");
    assert.equal(url.searchParams.get("expected_profile_id"), "alice");
    assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
    return jsonResponse({
      profile_id: "alice",
      personalization_updated_at: 17,
      items: [hiddenItem],
    });
  }, async () => {
    assert.deepEqual(await fetchHiddenTitlesForOwner(owner), [hiddenItem]);
  });

  await withMockFetch(async () => jsonResponse({
    profile_id: "bob",
    personalization_updated_at: 18,
    items: [hiddenItem],
  }), async () => {
    await assert.rejects(fetchHiddenTitlesForOwner(owner), CatalogOwnershipChangedError);
  });

  await withMockFetch(async () => jsonResponse({ error: "profile changed" }, 409), async () => {
    await assert.rejects(fetchHiddenTitlesForOwner(owner), CatalogOwnershipChangedError);
  });
});

test("Hidden-title restore sends the immutable owner and requires its echo", async () => {
  await withMockFetch(async (_input, init) => {
    assert.equal(init?.method, "DELETE");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.id, "tt-hidden");
    assert.equal(body.expected_profile_id, "alice");
    assert.equal(body.expected_personalization_updated_at, 17);
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
    });
  }, async () => {
    await restoreHiddenTitleForOwner(hiddenItem, owner);
  });

  await withMockFetch(async () => jsonResponse({
    ok: true,
    profile_id: "bob",
    personalization_updated_at: 18,
  }), async () => {
    await assert.rejects(restoreHiddenTitleForOwner(hiddenItem, owner), CatalogOwnershipChangedError);
  });

  await withMockFetch(async () => jsonResponse({ error: "profile changed" }, 409), async () => {
    await assert.rejects(restoreHiddenTitleForOwner(hiddenItem, owner), CatalogOwnershipChangedError);
  });
});
