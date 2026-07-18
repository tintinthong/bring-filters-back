/**
 * Filter registry.
 *
 * A filter draws onto the 2D canvas given the current face landmarks.
 * Add a new one by pushing to `FILTERS` — the UI builds chips automatically.
 *
 * Landmarks are MediaPipe FaceLandmarker's 478 normalized points ([0..1]).
 * We pre-resolve a small face "frame" (eye axis + scale) so each filter can
 * anchor art in a rotation/scale-invariant way.
 */

export interface Pt {
  x: number;
  y: number;
}

/** A stable local coordinate frame derived from the face, in canvas pixels. */
export interface FaceFrame {
  /** point lookup: normalized landmark index -> canvas pixel coords */
  p: (i: number) => Pt;
  /** unit vector along the eye line (left eye -> right eye) */
  ux: Pt;
  /** unit vector pointing "up" out of the top of the head */
  uy: Pt;
  /** scale unit ≈ distance between the eyes, in pixels */
  s: number;
  /** how open the mouth is, 0..~1 (normalized by face scale) */
  mouthOpen: number;
}

export interface Filter {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, f: FaceFrame) => void;
}

// ---- landmark indices (MediaPipe canonical face mesh) ----
const L_EYE_OUTER = 33;
const R_EYE_OUTER = 263;
const NOSE_TIP = 1;
const FOREHEAD = 10;
const UPPER_LIP = 13;
const LOWER_LIP = 14;

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}
function len(a: Pt): number {
  return Math.hypot(a.x, a.y);
}
function norm(a: Pt): Pt {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}
function add(a: Pt, ...vs: Pt[]): Pt {
  return vs.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), a);
}
function scale(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

/** Build the face frame from raw landmarks + the canvas size. */
export function buildFrame(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number
): FaceFrame {
  const p = (i: number): Pt => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });

  const le = p(L_EYE_OUTER);
  const re = p(R_EYE_OUTER);
  const eyeVec = sub(re, le);
  const s = len(eyeVec) || 1;
  const ux = norm(eyeVec);

  // "up" is perpendicular to the eye axis, chosen to point toward the forehead.
  let uy: Pt = { x: -ux.y, y: ux.x };
  const upRef = sub(p(FOREHEAD), p(NOSE_TIP));
  if (uy.x * upRef.x + uy.y * upRef.y < 0) uy = scale(uy, -1);

  const mouthOpen = len(sub(p(LOWER_LIP), p(UPPER_LIP))) / s;

  return { p, ux, uy, s, mouthOpen };
}

// ---- small drawing helpers, all in the face frame ----

/** place a point at `along` units on the eye axis and `up` units toward forehead, from origin */
function at(origin: Pt, f: FaceFrame, along: number, up: number): Pt {
  return add(origin, scale(f.ux, along * f.s), scale(f.uy, up * f.s));
}

function ear(ctx: CanvasRenderingContext2D, tip: Pt, base: Pt, halfW: Pt, outer: string, inner: string) {
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(base.x - halfW.x, base.y - halfW.y);
  ctx.lineTo(base.x + halfW.x, base.y + halfW.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = inner;
  const it = { x: (tip.x + base.x) / 2, y: (tip.y + base.y) / 2 };
  ctx.beginPath();
  ctx.moveTo(it.x, it.y);
  ctx.lineTo(base.x - halfW.x * 0.5, base.y - halfW.y * 0.5);
  ctx.lineTo(base.x + halfW.x * 0.5, base.y + halfW.y * 0.5);
  ctx.closePath();
  ctx.fill();
}

// ---- the filters ----

const puppy: Filter = {
  id: "puppy",
  label: "🐶 Puppy",
  draw(ctx, f) {
    const fore = f.p(FOREHEAD);
    const halfW = scale(f.ux, 0.42 * f.s);

    // ears — anchored above the forehead, splayed along the eye axis
    const lBase = at(fore, f, -0.95, 0.55);
    const lTip = at(fore, f, -1.35, 1.55);
    ear(ctx, lTip, lBase, halfW, "#6b4a2b", "#caa06e");

    const rBase = at(fore, f, 0.95, 0.55);
    const rTip = at(fore, f, 1.35, 1.55);
    ear(ctx, rTip, rBase, halfW, "#6b4a2b", "#caa06e");

    // nose
    const nose = f.p(NOSE_TIP);
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.ellipse(nose.x, nose.y, 0.28 * f.s, 0.2 * f.s, Math.atan2(f.ux.y, f.ux.x), 0, Math.PI * 2);
    ctx.fill();
    // nose shine
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    const shine = at(nose, f, -0.07, 0.05);
    ctx.beginPath();
    ctx.ellipse(shine.x, shine.y, 0.06 * f.s, 0.045 * f.s, 0, 0, Math.PI * 2);
    ctx.fill();

    // tongue — only when the mouth opens
    if (f.mouthOpen > 0.22) {
      const mouth = f.p(LOWER_LIP);
      const tip = at(mouth, f, 0, -0.9);
      ctx.fillStyle = "#ff6b81";
      ctx.beginPath();
      ctx.moveTo(mouth.x - halfW.x * 0.4, mouth.y - halfW.y * 0.4);
      ctx.lineTo(mouth.x + halfW.x * 0.4, mouth.y + halfW.y * 0.4);
      ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#e04b60";
      ctx.lineWidth = Math.max(1, 0.03 * f.s);
      const mid = at(mouth, f, 0, -0.45);
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
  },
};

const shades: Filter = {
  id: "shades",
  label: "🕶️ Shades",
  draw(ctx, f) {
    const le = f.p(L_EYE_OUTER);
    const re = f.p(R_EYE_OUTER);
    const r = 0.42 * f.s;
    const lensOffset = scale(f.uy, 0.05 * f.s);
    const lc = add(le, lensOffset);
    const rc = add(re, lensOffset);

    ctx.fillStyle = "rgba(10,10,14,0.9)";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(2, 0.06 * f.s);

    for (const c of [lc, rc]) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r, r * 0.72, Math.atan2(f.ux.y, f.ux.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // gleam
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      const g = add(c, scale(f.ux, -0.12 * f.s), scale(f.uy, 0.1 * f.s));
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, r * 0.28, r * 0.16, Math.atan2(f.ux.y, f.ux.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // bridge
    ctx.beginPath();
    ctx.moveTo(lc.x + f.ux.x * r * 0.9, lc.y + f.ux.y * r * 0.9);
    ctx.lineTo(rc.x - f.ux.x * r * 0.9, rc.y - f.ux.y * r * 0.9);
    ctx.stroke();
  },
};

const both: Filter = {
  id: "both",
  label: "🐶🕶️ Both",
  draw(ctx, f) {
    puppy.draw(ctx, f);
    shades.draw(ctx, f);
  },
};

export const FILTERS: Filter[] = [puppy, shades, both];
