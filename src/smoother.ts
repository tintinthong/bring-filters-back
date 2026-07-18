/**
 * Category smoothing — no ML deps, so it stays in the main bundle while the
 * heavy face-api classifier is lazy-loaded (see classify.ts).
 */

import type { Category } from "./filtersDb";

// Below this estimated age we consider the face a child (boy/girl).
const ADULT_AGE = 18;

export interface Reading {
  age: number;
  gender: "male" | "female";
  genderProbability: number;
}

/**
 * Smooths noisy per-frame readings into a stable category.
 * Gender is a running score (+male / -female); age is an EMA.
 */
export class CategorySmoother {
  private ageEMA = 25;
  private genderScore = 0;
  private seen = false;

  push(r: Reading) {
    const g = (r.gender === "male" ? 1 : -1) * Math.max(0.5, r.genderProbability);
    if (!this.seen) {
      this.ageEMA = r.age;
      this.genderScore = g;
      this.seen = true;
    } else {
      this.ageEMA = this.ageEMA * 0.6 + r.age * 0.4;
      this.genderScore = this.genderScore * 0.6 + g * 0.4;
    }
  }

  get category(): Category | null {
    if (!this.seen) return null;
    const male = this.genderScore >= 0;
    const child = this.ageEMA < ADULT_AGE;
    if (male) return child ? "boy" : "man";
    return child ? "girl" : "woman";
  }

  get age(): number {
    return Math.round(this.ageEMA);
  }
}
