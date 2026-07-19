/**
 * The filter set — bundled with the app (single source of truth).
 *
 * A filter is a list of `parts`; each part is either an `emoji` or a vector shape
 * the renderer knows how to draw (glasses, puppyEars, puppyNose, tongue, whiskers)
 * anchored to a face landmark with along/up/scale offsets in eye-distance units.
 *
 * Add a filter by adding an entry here, then `npm run deploy` (or push — the repo
 * can auto-deploy). Adding a genuinely new KIND of part means adding a renderer in
 * filters.ts; that's code, by design.
 */

import type { FilterDef } from "./filters";

export const FILTERS: FilterDef[] = [
  {
    id: "puppy",
    name: "Puppy",
    emoji: "🐶",
    parts: [{ type: "puppyEars" }, { type: "puppyNose" }, { type: "tongue" }],
  },
  {
    id: "kitty",
    name: "Kitty",
    emoji: "🐱",
    parts: [
      { type: "whiskers", color: "#ffffff" },
      { type: "puppyNose", color: "#ff9db0" },
      { type: "emoji", char: "🐱", anchor: "forehead", up: 1.5, scale: 1.7 },
    ],
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
    id: "tophat",
    name: "Dapper",
    emoji: "🎩",
    parts: [
      { type: "emoji", char: "🎩", anchor: "forehead", up: 1.6, scale: 2.3 },
      { type: "glasses" },
    ],
  },
  {
    id: "grad",
    name: "Grad",
    emoji: "🎓",
    parts: [
      { type: "emoji", char: "🎓", anchor: "forehead", up: 1.4, scale: 2.2 },
      { type: "glasses" },
    ],
  },
  {
    id: "stars",
    name: "Stars",
    emoji: "⭐",
    parts: [
      { type: "emoji", char: "⭐", anchor: "leftEye", along: -1.4, up: 1.2, scale: 0.7 },
      { type: "emoji", char: "🌟", anchor: "forehead", up: 1.35, scale: 0.85 },
      { type: "emoji", char: "⭐", anchor: "rightEye", along: 1.4, up: 1.2, scale: 0.7 },
    ],
  },
  {
    id: "flowers",
    name: "Flowers",
    emoji: "🌸",
    parts: [
      { type: "emoji", char: "🌸", anchor: "forehead", up: 1.25, scale: 1.3 },
      { type: "emoji", char: "🌸", anchor: "leftCheek", along: -0.3, up: 0.6, scale: 1.0 },
      { type: "emoji", char: "🌷", anchor: "rightCheek", along: 0.3, up: 0.6, scale: 1.0 },
    ],
  },
  {
    id: "rainbow",
    name: "Rainbow",
    emoji: "🌈",
    parts: [{ type: "emoji", char: "🌈", anchor: "aboveHead", up: 0.5, scale: 3.0 }],
  },
  {
    id: "love",
    name: "Love",
    emoji: "❤️",
    parts: [
      { type: "emoji", char: "❤️", anchor: "leftEye", scale: 0.8 },
      { type: "emoji", char: "❤️", anchor: "rightEye", scale: 0.8 },
      { type: "emoji", char: "💕", anchor: "aboveHead", up: 0.4, scale: 1.1 },
    ],
  },
  {
    id: "beach",
    name: "Beach",
    emoji: "👒",
    parts: [
      { type: "emoji", char: "👒", anchor: "forehead", up: 1.4, scale: 2.6 },
      { type: "glasses" },
    ],
  },
  {
    id: "party",
    name: "Party",
    emoji: "🥳",
    parts: [
      { type: "emoji", char: "🎉", anchor: "leftEye", along: -1.8, up: 1.3, scale: 1.1 },
      { type: "emoji", char: "🎊", anchor: "rightEye", along: 1.8, up: 1.3, scale: 1.1 },
      { type: "emoji", char: "🎩", anchor: "forehead", up: 1.6, scale: 2.0 },
    ],
  },
];
