/**
 * Categories + the deterministic "filter of the day" logic.
 * The filter set itself is bundled in filters.data.ts (single source of truth).
 */

import type { FilterDef } from "./filters";
import { FILTERS } from "./filters.data";

export type Category = "boy" | "girl" | "woman" | "man" | "animal";
export const CATEGORIES: Category[] = ["boy", "girl", "woman", "man", "animal"];

export const CATEGORY_META: Record<Category, { emoji: string; label: string }> = {
  boy: { emoji: "👦", label: "Boy" },
  girl: { emoji: "👧", label: "Girl" },
  woman: { emoji: "👩", label: "Woman" },
  man: { emoji: "👨", label: "Man" },
  animal: { emoji: "🐾", label: "Animal" },
};

/** The bundled filter set. */
export function getFilters(): FilterDef[] {
  return FILTERS;
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
