/**
 * Data-driven filter engine.
 *
 * A filter is DATA, not code — a list of `Part`s (emoji or vector shapes)
 * anchored to face landmarks. That's what lets filters live in an online JSON
 * "database" (see filtersDb.ts) and be added without shipping code.
 *
 * Landmarks are MediaPipe FaceLandmarker's 478 normalized points ([0..1]).
 * We resolve a rotation/scale-invariant face "frame" so parts anchor correctly
 * regardless of head size or tilt.
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

// ---- landmark indices (MediaPipe canonical face mesh) ----
const L_EYE_OUTER = 33;
const R_EYE_OUTER = 263;
const NOSE_TIP = 1;
const FOREHEAD = 10;
const CHIN = 152;
const L_CHEEK = 234;
const R_CHEEK = 454;
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
function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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

  let uy: Pt = { x: -ux.y, y: ux.x };
  const upRef = sub(p(FOREHEAD), p(NOSE_TIP));
  if (uy.x * upRef.x + uy.y * upRef.y < 0) uy = scale(uy, -1);

  const mouthOpen = len(sub(p(LOWER_LIP), p(UPPER_LIP))) / s;

  return { p, ux, uy, s, mouthOpen };
}

// ---- data model (matches filters.json) ----

export type Anchor =
  | "forehead"
  | "aboveHead"
  | "noseTip"
  | "leftEye"
  | "rightEye"
  | "betweenEyes"
  | "mouth"
  | "chin"
  | "leftCheek"
  | "rightCheek";

export type PartType = "emoji" | "glasses" | "puppyEars" | "puppyNose" | "tongue" | "whiskers";

export interface Part {
  type: PartType;
  char?: string;
  anchor?: Anchor;
  along?: number; // offset along the eye axis, in face-scale units
  up?: number; // offset toward the forehead, in face-scale units
  scale?: number; // size in face-scale units
  rotate?: number; // extra rotation (radians) on top of head tilt
  color?: string;
  inner?: string;
  opacity?: number;
}

export interface FilterDef {
  id: string;
  name: string;
  emoji?: string; // shown in UI chips
  parts: Part[];
}

// ---- anchors + placement ----

function anchorPt(f: FaceFrame, a: Anchor): Pt {
  switch (a) {
    case "forehead":
      return f.p(FOREHEAD);
    case "aboveHead":
      return add(f.p(FOREHEAD), scale(f.uy, 1.2 * f.s));
    case "noseTip":
      return f.p(NOSE_TIP);
    case "leftEye":
      return f.p(L_EYE_OUTER);
    case "rightEye":
      return f.p(R_EYE_OUTER);
    case "betweenEyes":
      return mid(f.p(L_EYE_OUTER), f.p(R_EYE_OUTER));
    case "mouth":
      return mid(f.p(UPPER_LIP), f.p(LOWER_LIP));
    case "chin":
      return f.p(CHIN);
    case "leftCheek":
      return f.p(L_CHEEK);
    case "rightCheek":
      return f.p(R_CHEEK);
  }
}

function place(f: FaceFrame, part: Part): Pt {
  return add(
    anchorPt(f, part.anchor ?? "forehead"),
    scale(f.ux, (part.along ?? 0) * f.s),
    scale(f.uy, (part.up ?? 0) * f.s)
  );
}

function headAngle(f: FaceFrame): number {
  return Math.atan2(f.ux.y, f.ux.x);
}

// ---- part renderers ----

function drawEmoji(ctx: CanvasRenderingContext2D, f: FaceFrame, part: Part) {
  const pos = place(f, part);
  const size = (part.scale ?? 1.5) * f.s;
  ctx.save();
  ctx.globalAlpha = part.opacity ?? 1;
  ctx.translate(pos.x, pos.y);
  ctx.rotate(headAngle(f) + (part.rotate ?? 0));
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(part.char ?? "❓", 0, 0);
  ctx.restore();
}

function drawGlasses(ctx: CanvasRenderingContext2D, f: FaceFrame, part: Part) {
  const le = f.p(L_EYE_OUTER);
  const re = f.p(R_EYE_OUTER);
  const r = 0.42 * f.s;
  const lensOffset = scale(f.uy, 0.05 * f.s);
  const lc = add(le, lensOffset);
  const rc = add(re, lensOffset);
  const ang = headAngle(f);

  ctx.fillStyle = part.color ?? "rgba(10,10,14,0.9)";
  ctx.globalAlpha = part.opacity ?? 1;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(2, 0.06 * f.s);

  for (const c of [lc, rc]) {
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * 0.72, ang, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    const g = add(c, scale(f.ux, -0.12 * f.s), scale(f.uy, 0.1 * f.s));
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, r * 0.28, r * 0.16, ang, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(lc.x + f.ux.x * r * 0.9, lc.y + f.ux.y * r * 0.9);
  ctx.lineTo(rc.x - f.ux.x * r * 0.9, rc.y - f.ux.y * r * 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPuppyEars(ctx: CanvasRenderingContext2D, f: FaceFrame, part: Part) {
  const outer = part.color ?? "#6b4a2b";
  const inner = part.inner ?? "#caa06e";
  const fore = f.p(FOREHEAD);
  const halfW = scale(f.ux, 0.42 * f.s);
  const ear = (base: Pt, tip: Pt) => {
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(base.x - halfW.x, base.y - halfW.y);
    ctx.lineTo(base.x + halfW.x, base.y + halfW.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = inner;
    const it = mid(tip, base);
    ctx.beginPath();
    ctx.moveTo(it.x, it.y);
    ctx.lineTo(base.x - halfW.x * 0.5, base.y - halfW.y * 0.5);
    ctx.lineTo(base.x + halfW.x * 0.5, base.y + halfW.y * 0.5);
    ctx.closePath();
    ctx.fill();
  };
  ear(
    add(fore, scale(f.ux, -0.95 * f.s), scale(f.uy, 0.55 * f.s)),
    add(fore, scale(f.ux, -1.35 * f.s), scale(f.uy, 1.55 * f.s))
  );
  ear(
    add(fore, scale(f.ux, 0.95 * f.s), scale(f.uy, 0.55 * f.s)),
    add(fore, scale(f.ux, 1.35 * f.s), scale(f.uy, 1.55 * f.s))
  );
}

function drawPuppyNose(ctx: CanvasRenderingContext2D, f: FaceFrame, part: Part) {
  const nose = f.p(NOSE_TIP);
  ctx.fillStyle = part.color ?? "#2a2a2a";
  ctx.beginPath();
  ctx.ellipse(nose.x, nose.y, 0.28 * f.s, 0.2 * f.s, headAngle(f), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  const shine = add(nose, scale(f.ux, -0.07 * f.s), scale(f.uy, 0.05 * f.s));
  ctx.beginPath();
  ctx.ellipse(shine.x, shine.y, 0.06 * f.s, 0.045 * f.s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTongue(ctx: CanvasRenderingContext2D, f: FaceFrame, part: Part) {
  if (f.mouthOpen <= 0.22) return;
  const mouth = f.p(LOWER_LIP);
  const halfW = scale(f.ux, 0.42 * f.s);
  const tip = add(mouth, scale(f.uy, -0.9 * f.s));
  ctx.fillStyle = part.color ?? "#ff6b81";
  ctx.beginPath();
  ctx.moveTo(mouth.x - halfW.x * 0.4, mouth.y - halfW.y * 0.4);
  ctx.lineTo(mouth.x + halfW.x * 0.4, mouth.y + halfW.y * 0.4);
  ctx.lineTo(tip.x, tip.y);
  ctx.closePath();
  ctx.fill();
}

function drawWhiskers(ctx: CanvasRenderingContext2D, f: FaceFrame, part: Part) {
  const nose = f.p(NOSE_TIP);
  ctx.strokeStyle = part.color ?? "#ffffff";
  ctx.lineWidth = Math.max(1, 0.028 * f.s);
  for (const side of [-1, 1]) {
    const base = add(nose, scale(f.ux, side * 0.5 * f.s));
    for (const k of [-0.28, 0, 0.28]) {
      const end = add(base, scale(f.ux, side * 1.5 * f.s), scale(f.uy, k * f.s));
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
}

/** Render one filter definition onto the 2D context. */
export function renderFilter(ctx: CanvasRenderingContext2D, f: FaceFrame, def: FilterDef) {
  for (const part of def.parts) {
    switch (part.type) {
      case "emoji":
        drawEmoji(ctx, f, part);
        break;
      case "glasses":
        drawGlasses(ctx, f, part);
        break;
      case "puppyEars":
        drawPuppyEars(ctx, f, part);
        break;
      case "puppyNose":
        drawPuppyNose(ctx, f, part);
        break;
      case "tongue":
        drawTongue(ctx, f, part);
        break;
      case "whiskers":
        drawWhiskers(ctx, f, part);
        break;
    }
  }
}
