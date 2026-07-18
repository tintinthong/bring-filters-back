/**
 * The filter "database".
 *
 * Filters are fetched at runtime from an online JSON file so the set can be
 * edited without redeploying the app. Resolution order:
 *   1. ?filters=<url>            (override, for testing)
 *   2. REMOTE_URL                (raw GitHub — edit filters.json on `main`)
 *   3. /filters.json             (same-origin copy shipped with the deploy)
 *   4. FALLBACK                  (bundled, so the app always works offline)
 */

import type { FilterDef } from "./filters";

const REMOTE_URL =
  "https://raw.githubusercontent.com/tintinthong/bring-filters-back/main/public/filters.json";

const FALLBACK: FilterDef[] = [
  {
    id: "puppy",
    name: "Puppy",
    emoji: "🐶",
    parts: [{ type: "puppyEars" }, { type: "puppyNose" }, { type: "tongue" }],
  },
  {
    id: "crown",
    name: "Crown",
    emoji: "👑",
    parts: [{ type: "emoji", char: "👑", anchor: "forehead", up: 1.35, scale: 2.2 }],
  },
  {
    id: "cool",
    name: "Cool",
    emoji: "🕶️",
    parts: [
      { type: "glasses" },
      { type: "emoji", char: "✨", anchor: "leftEye", along: -1.7, up: 0.7, scale: 0.8 },
      { type: "emoji", char: "✨", anchor: "rightEye", along: 1.7, up: 0.7, scale: 0.8 },
    ],
  },
  {
    id: "love",
    name: "Love",
    emoji: "❤️",
    parts: [
      { type: "emoji", char: "❤️", anchor: "leftEye", scale: 0.8 },
      { type: "emoji", char: "❤️", anchor: "rightEye", scale: 0.8 },
    ],
  },
];

export type Category = "boy" | "girl" | "woman" | "man" | "animal";
export const CATEGORIES: Category[] = ["boy", "girl", "woman", "man", "animal"];

export const CATEGORY_META: Record<Category, { emoji: string; label: string }> = {
  boy: { emoji: "👦", label: "Boy" },
  girl: { emoji: "👧", label: "Girl" },
  woman: { emoji: "👩", label: "Woman" },
  man: { emoji: "👨", label: "Man" },
  animal: { emoji: "🐾", label: "Animal" },
};

async function tryFetch(url: string): Promise<FilterDef[] | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.filters;
    if (Array.isArray(list) && list.length) return list as FilterDef[];
  } catch {
    /* network / parse error — fall through */
  }
  return null;
}

/** Load the filter set from the online DB, with graceful fallback. */
export async function loadFilters(): Promise<{ filters: FilterDef[]; source: string }> {
  const override = new URLSearchParams(location.search).get("filters");
  const candidates: Array<[string, string]> = [];
  if (override) candidates.push([override, "override"]);
  candidates.push([REMOTE_URL, "remote"], ["/filters.json", "local"]);

  for (const [url, source] of candidates) {
    const filters = await tryFetch(url);
    if (filters) return { filters, source };
  }
  return { filters: FALLBACK, source: "bundled" };
}

// ---- deterministic "filter of the day" ----

/** Local date as YYYY-MM-DD — the daily seed. */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Assign one filter per category for a given day.
 * Deterministic: same dayKey → same assignment. Different day → reshuffled.
 * Distinct filters per category when the DB has ≥ 4.
 */
export function dailyAssignment(
  filters: FilterDef[],
  dayKey: string
): Record<Category, FilterDef> {
  const rng = mulberry32(fnv1a(dayKey));
  const shuffled = shuffle(filters, rng);
  const map = {} as Record<Category, FilterDef>;
  CATEGORIES.forEach((cat, i) => {
    map[cat] = shuffled[i % shuffled.length];
  });
  return map;
}
