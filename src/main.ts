import "./style.css";
import { FilesetResolver, ObjectDetector, type Detection } from "@mediapipe/tasks-vision";
import { RULES } from "./rules";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm";
const OBJECT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.task";

interface Box {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const video = $<HTMLVideoElement>("#video");
const canvas = $<HTMLCanvasElement>("#canvas");
const ctx = canvas.getContext("2d")!;
const hint = $<HTMLDivElement>("#hint");
const recDot = $<HTMLDivElement>("#rec-dot");
const startBtn = $<HTMLButtonElement>("#start");
const spinBtn = $<HTMLButtonElement>("#spin");
const recordBtn = $<HTMLButtonElement>("#record");
const shareBtn = $<HTMLAnchorElement>("#share");
const status = $<HTMLParagraphElement>("#status");

// ---- state ----
let objectDetector: ObjectDetector | null = null;
let stream: MediaStream | null = null;
let running = false;
let lastObjTime = 0;

interface Person {
  id: number;
  box: Box;
  rule: number; // locked rule index
}
let people: Person[] = [];
let nextId = 1;

let spinning = false;
let spinStart = 0;
let spinNonce = 0;
const SPIN_MS = 2600;
const SPINS = 5;

function setStatus(msg: string) {
  status.textContent = msg;
}

// ---- helpers ----
const randInt = (n: number) => Math.floor(Math.random() * n);
const centerOf = (b: Box) => ({ x: b.originX + b.width / 2, y: b.originY + b.height / 2 });
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

function lerpBox(a: Box, b: Box, t: number): Box {
  return {
    originX: a.originX + (b.originX - a.originX) * t,
    originY: a.originY + (b.originY - a.originY) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

/** Per-person pseudo-random offset that changes every spin (via spinNonce). */
function offsetUnits(id: number): number {
  const x = Math.sin(id * 127.1 + spinNonce * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * RULES.length;
}

function displayedRule(p: Person, now: number): number {
  if (!spinning) return p.rule;
  const prog = Math.min((now - spinStart) / SPIN_MS, 1);
  const pos = easeOutCubic(prog) * SPINS * RULES.length;
  return Math.floor(pos + offsetUnits(p.id)) % RULES.length;
}

function startSpin() {
  if (!running) return;
  spinNonce = Math.random() * 1000;
  spinStart = performance.now();
  spinning = true;
  spinBtn.textContent = "🎲 Spinning…";
  setStatus("Spinning the rules…");
}

function maybeLock(now: number) {
  if (spinning && now - spinStart >= SPIN_MS) {
    spinning = false;
    for (const p of people) p.rule = Math.floor(offsetUnits(p.id)) % RULES.length;
    spinBtn.textContent = "🎲 Spin again";
    setStatus("Rules locked in! Record & share 🏓");
  }
}

// ---- person tracking (greedy nearest-box match keeps a rule stuck to a person) ----
function personBoxes(dets: readonly Detection[]): Box[] {
  const out: Box[] = [];
  for (const d of dets) {
    const c = d.categories?.[0];
    if (c && d.boundingBox && c.categoryName === "person" && c.score >= 0.4) {
      out.push(d.boundingBox);
    }
  }
  return out;
}

function updatePeople(boxes: Box[]) {
  const used = new Set<number>();
  const next: Person[] = [];
  for (const b of boxes) {
    const bc = centerOf(b);
    let best = -1;
    let bestD = Infinity;
    people.forEach((p, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(bc.x - centerOf(p.box).x, bc.y - centerOf(p.box).y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD < b.width * 0.9) {
      used.add(best);
      const p = people[best];
      next.push({ id: p.id, rule: p.rule, box: lerpBox(p.box, b, 0.5) });
    } else {
      next.push({ id: nextId++, rule: randInt(RULES.length), box: b });
    }
  }
  people = next;
}

// ---- label drawing ----
function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawLabel(box: Box, text: string, live: boolean) {
  const fs = Math.max(15, Math.min(28, Math.round(canvas.width * 0.023)));
  ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
  const maxW = Math.min(canvas.width * 0.46, Math.max(box.width * 1.5, canvas.width * 0.3));
  const lines = wrap(text, maxW);
  const lineH = fs * 1.18;
  const padX = fs * 0.7;
  const padY = fs * 0.5;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = textW + padX * 2;
  const h = lines.length * lineH + padY * 2;

  const cx = Math.max(w / 2 + 4, Math.min(canvas.width - w / 2 - 4, box.originX + box.width / 2));
  const gap = fs * 0.6;
  let top = box.originY - gap - h;
  const above = top >= 4;
  if (!above) top = box.originY + gap;

  // pointer to the head (only when the label sits above)
  if (above) {
    ctx.fillStyle = live ? "#ffd23f" : "#ff2d78";
    ctx.beginPath();
    ctx.moveTo(cx - fs * 0.4, top + h - 1);
    ctx.lineTo(cx + fs * 0.4, top + h - 1);
    ctx.lineTo(cx, top + h + fs * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  roundRect(cx - w / 2, top, w, h, fs * 0.5);
  ctx.fillStyle = "rgba(12,12,18,0.86)";
  ctx.fill();
  ctx.lineWidth = Math.max(2, fs * 0.12);
  ctx.strokeStyle = live ? "#ffd23f" : "#ff2d78";
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, cx, top + padY + i * lineH));
}

// ---- boot ----
async function start() {
  startBtn.disabled = true;
  setStatus("Loading detector…");
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    objectDetector = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      scoreThreshold: 0.4,
      maxResults: 10,
      categoryAllowlist: ["person"],
    });

    setStatus("Requesting camera…");
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    hint.hidden = true;
    startBtn.hidden = true;
    spinBtn.hidden = false;
    recordBtn.hidden = false;
    running = true;
    requestAnimationFrame(renderLoop);
    startSpin();
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    setStatus("Camera/detector failed: " + (err as Error).message);
  }
}

function renderLoop() {
  if (!running) return;
  const now = performance.now();
  if (video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (objectDetector && now - lastObjTime > 150) {
      lastObjTime = now;
      const res = objectDetector.detectForVideo(video, now);
      updatePeople(personBoxes(res.detections));
    }
    maybeLock(now);

    if (people.length === 0 && !spinning) {
      // gentle nudge when nobody's found yet
      ctx.font = `700 ${Math.round(canvas.width * 0.03)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Point at some people 🏓", canvas.width / 2, canvas.height / 2);
    }
    for (const p of people) drawLabel(p.box, RULES[displayedRule(p, now)], spinning);
  }
  requestAnimationFrame(renderLoop);
}

// ---- recording ----
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

function pickMime(): string {
  const prefs = ["video/mp4;codecs=h264,aac", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return prefs.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function startRecording() {
  if (!stream) return;
  const canvasStream = canvas.captureStream(30);
  for (const track of stream.getAudioTracks()) canvasStream.addTrack(track);
  const mimeType = pickMime();
  recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => finishRecording(mimeType);
  recorder.start();
  recDot.hidden = false;
  recordBtn.textContent = "■ Stop";
  recordBtn.classList.add("recording");
  shareBtn.hidden = true;
  setStatus("Recording…");
}

function stopRecording() {
  recorder?.stop();
  recDot.hidden = true;
  recordBtn.textContent = "● Record";
  recordBtn.classList.remove("recording");
}

function finishRecording(mimeType: string) {
  const type = mimeType || "video/webm";
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type });
  const file = new File([blob], `pickleball-rules-${Date.now()}.${ext}`, { type });
  const url = URL.createObjectURL(blob);
  const canShareFile =
    typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  shareBtn.hidden = false;
  if (canShareFile) {
    shareBtn.textContent = "Share ↗";
    shareBtn.onclick = async (e) => {
      e.preventDefault();
      try {
        await navigator.share({ files: [file], title: "Pickleball rules" });
      } catch {
        /* cancelled */
      }
    };
    setStatus("Tap Share → Instagram.");
  } else {
    shareBtn.textContent = "Download ↓";
    shareBtn.href = url;
    shareBtn.download = file.name;
    shareBtn.onclick = null;
    setStatus("Saved. Upload to Instagram from your phone.");
  }
}

recordBtn.onclick = () => {
  if (recorder && recorder.state === "recording") stopRecording();
  else startRecording();
};
spinBtn.onclick = startSpin;
startBtn.onclick = start;
