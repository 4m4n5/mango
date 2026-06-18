import type { ContentRail } from "./types";

/** Placeholder until stremio-service backs Continue / recommendations. */
export const MOCK_RAILS: ContentRail[] = [
  {
    id: "continue",
    label: "Continue watching",
    cards: [
      { id: "c1", title: "Dune: Part Two", subtitle: "42 min left", accent: "#1a4d3e" },
      { id: "c2", title: "Panchayat", subtitle: "S3 · E4", accent: "#3d2b1f" },
      { id: "c3", title: "Interstellar", subtitle: "1h 12m left", accent: "#1c2840" },
      { id: "c4", title: "The Bear", subtitle: "S2 · E7", accent: "#4a2020" },
    ],
  },
  {
    id: "pick",
    label: "Pick for you",
    cards: [
      { id: "p1", title: "Arrival", subtitle: "Sci-fi · 2016", accent: "#243848" },
      { id: "p2", title: "12th Fail", subtitle: "Drama · 2023", accent: "#3a3020" },
      { id: "p3", title: "Severance", subtitle: "Series", accent: "#1e2838" },
      { id: "p4", title: "Past Lives", subtitle: "Romance · 2023", accent: "#402838" },
      { id: "p5", title: "Blade Runner 2049", subtitle: "Sci-fi · 2017", accent: "#182838" },
    ],
  },
];
