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
  cardSavedKey,
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

test("YouTube v2 keeps the active personal owner as its public request fence", async () => {
  await withMockFetch(async (input) => {
    const url = new URL(String(input), "http://launcher.test");
    assert.equal(url.pathname, "/api/catalog/youtube/rails");
    assert.equal(url.searchParams.get("expected_profile_id"), "alice");
    assert.equal(url.searchParams.get("expected_personalization_updated_at"), "17");
    return jsonResponse({
      slate_sequence: 12,
      // Internal served-slate ownership is intentionally opaque to the
      // launcher. The public field fences the active personalization request.
      profile_id: "alice",
      personalization_updated_at: 17,
      rails: [],
    });
  }, async () => {
    assert.deepEqual(await loadCatalogRails("youtube", { expectedOwner: owner }), {
      rails: [],
      owner,
    });
  });

  await withMockFetch(async () => jsonResponse({
    slate_sequence: 13,
    profile_id: "household",
    personalization_updated_at: 17,
    rails: [],
  }), async () => {
    await assert.rejects(
      loadCatalogRails("youtube", { expectedOwner: owner }),
      CatalogOwnershipChangedError,
      "an internal Household owner must not masquerade as the public personalization fence",
    );
  });
});

test("YouTube setup_required survives alongside a non-empty Saved utility rail", async () => {
  await withMockFetch(async () => jsonResponse({
    slate_sequence: 4,
    profile_id: "alice",
    personalization_updated_at: 17,
    setup_required: true,
    rails: [{
      rail_id: "saved",
      label: "Saved",
      items: [{
        id: "saved-video",
        kind: "video",
        title: "Saved video",
        subtitle: "Saved channel",
        thumbnail: "https://img.example/saved.jpg",
      }],
    }],
  }), async () => {
    const result = await loadCatalogRails("youtube", { expectedOwner: owner });
    assert.deepEqual(result.rails.map((rail) => rail.id), ["youtube_setup", "saved"]);
    assert.equal(result.rails[0]?.cards[0]?.type, "youtube_setup");
  });
});

test("legacy-source YouTube cards preserve their durable key on Saved and normal rails", async () => {
  const result = await withMockFetch(async () => jsonResponse({
    slate_sequence: 5,
    profile_id: "alice",
    personalization_updated_at: 17,
    rails: [{
      rail_id: "history",
      label: "History",
      items: [{
        id: "LegacyHistoryCase",
        kind: "video",
        title: "Legacy history video",
        subtitle: "Legacy channel",
        thumbnail: "https://img.example/legacy.jpg",
        library_source: "mango",
      }],
    }, {
      rail_id: "saved",
      label: "Saved",
      items: [{
        id: "LegacySavedCase",
        kind: "video",
        title: "Legacy Saved video",
        subtitle: "Legacy channel",
        thumbnail: "https://img.example/legacy-saved.jpg",
        library_source: "mango",
      }],
    }],
  }), () => loadCatalogRails("youtube", { expectedOwner: owner }));
  const card = result.rails.find((rail) => rail.id === "history")?.cards[0];
  const savedCard = result.rails.find((rail) => rail.id === "saved")?.cards[0];
  assert.ok(card);
  assert.ok(savedCard);
  assert.equal(card.source, "youtube");
  assert.equal(card.librarySource, "mango");
  assert.equal(cardSavedKey(card), "mango:youtube_video:LegacyHistoryCase");
  assert.equal(cardSavedKey(savedCard), "mango:youtube_video:LegacySavedCase");
  const savedIds = await withMockFetch(async () => jsonResponse({
    profile_id: "alice",
    personalization_updated_at: 17,
    saved: [{
      source: "mango", tab: "youtube", type: "youtube_video",
      id: "LegacyHistoryCase", title: "Legacy history video", poster: null, saved_at: 1,
    }],
  }), () => fetchSavedIds("youtube", owner));
  assert.equal(savedIds.has(cardSavedKey(card)), true);

  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  await withMockFetch(async (input, init) => {
    mutations.push({
      path: new URL(String(input), "http://launcher.test").pathname,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
    });
  }, async () => {
    await saveCard("youtube", card, owner);
    await unsaveCard(card, owner);
    await notInterestedCard(card, "youtube", owner);
    await undoNotInterestedCard(card, "youtube", owner);
  });
  assert.deepEqual(mutations.map(({ path, body }) => ({
    path, source: body.source, type: body.type, id: body.id, tab: body.tab,
  })), [
    { path: "/api/catalog/library/saved", source: "mango", type: "youtube_video", id: "LegacyHistoryCase", tab: "youtube" },
    { path: "/api/catalog/library/saved", source: "mango", type: "youtube_video", id: "LegacyHistoryCase", tab: undefined },
    { path: "/api/catalog/library/not-interested", source: "mango", type: "youtube_video", id: "LegacyHistoryCase", tab: "youtube" },
    { path: "/api/catalog/library/not-interested", source: "mango", type: "youtube_video", id: "LegacyHistoryCase", tab: "youtube" },
  ]);

  let playbackBody: Record<string, unknown> | null = null;
  await withMockFetch(async (_input, init) => {
    playbackBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
      session: {
        session_id: "legacy-youtube-play",
        version: 1,
        state: "playing",
        ever_ready: true,
        error: null,
        result: { ok: true },
      },
    }, 202);
  }, () => playCard(card, { expectedOwner: owner }));
  assert.equal(playbackBody?.source, "youtube");
  assert.equal(playbackBody?.library_source, "mango");
});

test("YouTube tab and Search play the same session payload including resume", async () => {
  const card = {
    id: "VideoCase",
    type: "youtube_video" as const,
    source: "youtube" as const,
    title: "Video",
    subtitle: "Channel",
    resumeSec: 42,
    railId: "for_you",
    attributionToken: "token-one",
  };
  const bodies: Record<string, unknown>[] = [];
  await withMockFetch(async (_input, init) => {
    if (init?.body) {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    }
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
      session: {
        session_id: "youtube-parity",
        version: 1,
        state: "playing",
        ever_ready: true,
        error: null,
        result: { ok: true },
      },
    }, 202);
  }, async () => {
    await playCard(card, { expectedOwner: owner });
    await playCard({ ...card, railId: "search" }, { expectedOwner: owner, startSec: 42 });
  });
  assert.equal(bodies.length, 2);
  for (const body of bodies) {
    assert.equal(body.source, "youtube");
    assert.equal(body.type, "youtube_video");
    assert.equal(body.id, "VideoCase");
    assert.equal(body.start_sec, 42);
    assert.equal(body.recommendation_item_id, "VideoCase");
  }
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

test("Saved and context payloads canonicalize card identity instead of Search origin", async () => {
  const payloads: Array<Record<string, unknown>> = [];
  await withMockFetch(async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return jsonResponse({
      ok: true,
      profile_id: "alice",
      personalization_updated_at: 17,
    });
  }, async () => {
    const dune = { id: "tt1160419", type: "movie", title: "Dune", subtitle: "2021" };
    await saveCard("series", dune, owner);
    await publishCurrentLibraryContext("series", dune, owner, 1_000);
    await saveCard("movies", {
      id: "VideoCase", type: "youtube_video", title: "Video", subtitle: "Channel",
    }, owner);
    await saveCard("movies", {
      id: "LegacyVideoCase", type: "youtube_video", source: "mango",
      title: "Legacy video", subtitle: "Channel",
    }, owner);
  });
  assert.deepEqual(
    payloads.map(({ source, type, tab }) => ({ source, type, tab })),
    [
      { source: "mango", type: "movie", tab: "movies" },
      { source: "mango", type: "movie", tab: "movies" },
      { source: "youtube", type: "youtube_video", tab: "youtube" },
      { source: "mango", type: "youtube_video", tab: "youtube" },
    ],
  );
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
