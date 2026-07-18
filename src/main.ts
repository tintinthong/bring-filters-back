import "./style.css";
import { FilesetResolver, FaceLandmarker, ObjectDetector, type Detection } from "@mediapipe/tasks-vision";
import { buildFrame, frameFromBox, renderFilter, type FaceFrame, type FilterDef, type Box } from "./filters";
import {
  loadFilters,
  dailyAssignment,
  todayKey,
  CATEGORIES,
  CATEGORY_META,
  type Category,
} from "./filtersDb";
import { CategorySmoother } from "./smoother";
import type { classifyOnce as ClassifyOnce } from "./classify";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const OBJECT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.task";

// COCO classes we treat as "animal".
const ANIMAL_SET = new Set([
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
]);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const video = $<HTMLVideoElement>("#video");
const canvas = $<HTMLCanvasElement>("#canvas");
const ctx = canvas.getContext("2d")!;
const hint = $<HTMLDivElement>("#hint");
const recDot = $<HTMLDivElement>("#rec-dot");
const detectedBadge = $<HTMLDivElement>("#detected");
const todayEl = $<HTMLDivElement>("#today");
const categoriesEl = $<HTMLDivElement>("#categories");
const startBtn = $<HTMLButtonElement>("#start");
const recordBtn = $<HTMLButtonElement>("#record");
const shareBtn = $<HTMLAnchorElement>("#share");
const status = $<HTMLParagraphElement>("#status");

// ---- state ----
let landmarker: FaceLandmarker | null = null;
let objectDetector: ObjectDetector | null = null;
let stream: MediaStream | null = null;
let running = false;
let lastVideoTime = -1;
let lastObjTime = 0;

let allFilters: FilterDef[] = [];
let dayKey = todayKey();
let assignment: Record<Category, FilterDef> | null = null;

const smoother = new CategorySmoother();
let autoCategory: Category | null = null; // what we currently detect (human or animal)
let manualCategory: Category | null = null; // tap to override detection
let classify: typeof ClassifyOnce | null = null; // set after lazy-loading the classifier

// animal detection (throttled, so we keep + smooth the last box)
let animalBox: Box | null = null;
let animalSeenAt = 0;

function setStatus(msg: string) {
  status.textContent = msg;
}

function activeCategory(): Category | null {
  return manualCategory ?? autoCategory;
}

function activeFilter(): FilterDef | null {
  const cat = activeCategory();
  return cat && assignment ? assignment[cat] : null;
}

function onCategoryChange() {
  refreshPanel();
  refreshDetectedBadge();
}

// ---- category panel ----
function buildCategoryPanel() {
  categoriesEl.innerHTML = "";
  for (const cat of CATEGORIES) {
    const meta = CATEGORY_META[cat];
    const btn = document.createElement("button");
    btn.className = "cat";
    btn.dataset.cat = cat;
    btn.innerHTML = `<span class="who">${meta.emoji}</span><span class="flt">…</span>`;
    btn.onclick = () => {
      manualCategory = manualCategory === cat ? null : cat;
      onCategoryChange();
    };
    categoriesEl.appendChild(btn);
  }
}

function refreshPanel() {
  if (!assignment) return;
  const active = activeCategory();
  for (const btn of Array.from(categoriesEl.children) as HTMLButtonElement[]) {
    const cat = btn.dataset.cat as Category;
    btn.querySelector(".flt")!.textContent = assignment[cat]?.name ?? "…";
    btn.setAttribute("aria-current", String(cat === active));
  }
}

function refreshDetectedBadge() {
  if (manualCategory) {
    const m = CATEGORY_META[manualCategory];
    detectedBadge.textContent = `${m.emoji} ${m.label} · manual`;
  } else if (autoCategory === "animal") {
    detectedBadge.textContent = "🐾 Animal";
  } else if (autoCategory) {
    const m = CATEGORY_META[autoCategory];
    detectedBadge.textContent = `${m.emoji} ${m.label} · ~${smoother.age}y`;
  } else {
    detectedBadge.textContent = "detecting…";
  }
}

// ---- boot ----
async function start() {
  startBtn.disabled = true;
  setStatus("Loading filters + models…");

  try {
    const [{ filters, source }, fileset] = await Promise.all([
      loadFilters(),
      FilesetResolver.forVisionTasks(WASM_BASE),
    ]);

    allFilters = filters;
    assignment = dailyAssignment(allFilters, dayKey);
    todayEl.textContent = `Today · ${dayKey} · ${filters.length} filters (${source})`;
    refreshPanel();

    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
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
    recordBtn.hidden = false;
    running = true;
    setStatus("Look at the camera — a pet works too 🐾");
    requestAnimationFrame(renderLoop);

    // Human age/gender classifier — heavy, so lazy-load in the background.
    import("./classify")
      .then(async (mod) => {
        await mod.initClassifier();
        classify = mod.classifyOnce;
        classifyLoop();
      })
      .catch((e) => {
        console.warn("classifier unavailable:", e);
        if (!manualCategory && !autoCategory) {
          manualCategory = "man";
          onCategoryChange();
        }
      });

    // Animal detector — also loads in the background.
    ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      scoreThreshold: 0.4,
      maxResults: 5,
    })
      .then((od) => {
        objectDetector = od;
      })
      .catch((e) => console.warn("object detector unavailable:", e));

    refreshDetectedBadge();
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    setStatus("Camera/model failed: " + (err as Error).message);
  }
}

function pickAnimalBox(detections: readonly Detection[]): Box | null {
  let best: Box | null = null;
  let bestScore = 0;
  for (const d of detections) {
    const c = d.categories?.[0];
    if (!c || !d.boundingBox) continue;
    if (ANIMAL_SET.has(c.categoryName) && c.score >= 0.4 && c.score > bestScore) {
      bestScore = c.score;
      best = d.boundingBox;
    }
  }
  return best;
}

function lerpBox(a: Box, b: Box, t: number): Box {
  return {
    originX: a.originX + (b.originX - a.originX) * t,
    originY: a.originY + (b.originY - a.originY) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

function renderLoop() {
  if (!running || !landmarker) return;
  const now = performance.now();

  if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
    lastVideoTime = video.currentTime;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const faceRes = landmarker.detectForVideo(video, now);
    const hasFace = !!faceRes.faceLandmarks?.length;

    // Object detection is throttled; keep + smooth the last animal box.
    if (objectDetector && now - lastObjTime > 160) {
      lastObjTime = now;
      const od = objectDetector.detectForVideo(video, now);
      const box = pickAnimalBox(od.detections);
      if (box) {
        animalBox = animalBox ? lerpBox(animalBox, box, 0.5) : box;
        animalSeenAt = now;
      }
    }
    const animalRecent = !!animalBox && now - animalSeenAt < 700;

    // Decide what we're looking at, and where to draw.
    let frame: FaceFrame | null = null;
    let auto: Category | null = null;
    if (hasFace) {
      frame = buildFrame(faceRes.faceLandmarks[0], canvas.width, canvas.height);
      auto = smoother.category;
    } else if (animalRecent) {
      frame = frameFromBox(animalBox!);
      auto = "animal";
    }

    if (auto !== autoCategory) {
      autoCategory = auto;
      onCategoryChange();
    }

    const filter = activeFilter();
    if (frame && filter) renderFilter(ctx, frame, filter);
  } else {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(renderLoop);
}

// ---- human classification loop (throttled, ~1/sec) ----
async function classifyLoop() {
  while (running) {
    try {
      const reading = classify ? await classify(video) : null;
      if (reading) {
        smoother.push(reading);
        const nowKey = todayKey();
        if (nowKey !== dayKey && allFilters.length) {
          dayKey = nowKey;
          assignment = dailyAssignment(allFilters, dayKey);
        }
        onCategoryChange();
      }
    } catch (e) {
      console.warn(e);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
}

// ---- recording ----
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

function pickMime(): string {
  const prefs = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
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
  const file = new File([blob], `filter-${Date.now()}.${ext}`, { type });
  const url = URL.createObjectURL(blob);

  const canShareFile =
    typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });

  shareBtn.hidden = false;
  if (canShareFile) {
    shareBtn.textContent = "Share ↗";
    shareBtn.onclick = async (e) => {
      e.preventDefault();
      try {
        await navigator.share({ files: [file], title: "My filter" });
      } catch {
        /* user cancelled */
      }
    };
    setStatus("Tap Share → Instagram (or save to Reels/Stories).");
  } else {
    shareBtn.textContent = "Download ↓";
    shareBtn.href = url;
    shareBtn.download = file.name;
    shareBtn.onclick = null;
    setStatus("Saved. Open Instagram and upload the clip.");
  }
}

recordBtn.onclick = () => {
  if (recorder && recorder.state === "recording") stopRecording();
  else startRecording();
};

buildCategoryPanel();
startBtn.onclick = start;
