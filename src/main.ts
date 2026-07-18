import "./style.css";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { buildFrame, renderFilter, type FilterDef } from "./filters";
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
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

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
let stream: MediaStream | null = null;
let running = false;
let lastVideoTime = -1;

let dayKey = todayKey();
let assignment: Record<Category, FilterDef> | null = null;
const smoother = new CategorySmoother();
let manualCategory: Category | null = null; // tap to override auto-detection
let classify: typeof ClassifyOnce | null = null; // set after lazy-loading the classifier

function setStatus(msg: string) {
  status.textContent = msg;
}

/** The category we're currently rendering for (manual override wins). */
function activeCategory(): Category | null {
  return manualCategory ?? smoother.category;
}

function activeFilter(): FilterDef | null {
  const cat = activeCategory();
  return cat && assignment ? assignment[cat] : null;
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
      // toggle manual override for this category
      manualCategory = manualCategory === cat ? null : cat;
      refreshPanel();
    };
    categoriesEl.appendChild(btn);
  }
}

function refreshPanel() {
  if (!assignment) return;
  const active = activeCategory();
  for (const btn of Array.from(categoriesEl.children) as HTMLButtonElement[]) {
    const cat = btn.dataset.cat as Category;
    const flt = btn.querySelector(".flt")!;
    flt.textContent = assignment[cat]?.name ?? "…";
    btn.setAttribute("aria-current", String(cat === active));
  }
}

function refreshDetectedBadge() {
  const auto = smoother.category;
  if (manualCategory) {
    const m = CATEGORY_META[manualCategory];
    detectedBadge.textContent = `${m.emoji} ${m.label} · manual`;
  } else if (auto) {
    const m = CATEGORY_META[auto];
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
    // filters DB (online) + models, in parallel
    const [{ filters, source }, fileset] = await Promise.all([
      loadFilters(),
      FilesetResolver.forVisionTasks(WASM_BASE),
    ]);

    assignment = dailyAssignment(filters, dayKey);
    todayEl.textContent = `Today · ${dayKey} · ${filters.length} filters (${source})`;
    refreshPanel();

    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
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
    setStatus("Look at the camera — your filter is picked for you.");
    requestAnimationFrame(renderLoop);

    // classifier is optional + heavy; lazy-load it in the background
    import("./classify")
      .then(async (mod) => {
        await mod.initClassifier();
        classify = mod.classifyOnce;
        refreshDetectedBadge();
        classifyLoop();
      })
      .catch((e) => {
        console.warn("classifier unavailable:", e);
        detectedBadge.textContent = "auto-detect off · tap a category";
        // fall back to a default so a filter still shows
        if (!manualCategory) manualCategory = "man";
        refreshPanel();
      });
    refreshDetectedBadge();
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    setStatus("Camera/model failed: " + (err as Error).message);
  }
}

function renderLoop() {
  if (!running || !landmarker) return;

  if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
    lastVideoTime = video.currentTime;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const res = landmarker.detectForVideo(video, performance.now());
    const filter = activeFilter();
    if (res.faceLandmarks?.length && filter) {
      for (const lm of res.faceLandmarks) {
        renderFilter(ctx, buildFrame(lm, canvas.width, canvas.height), filter);
      }
    }
  } else {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(renderLoop);
}

// ---- classification loop (throttled, ~1/sec) ----
async function classifyLoop() {
  while (running) {
    try {
      const reading = classify ? await classify(video) : null;
      if (reading) {
        smoother.push(reading);
        // roll over at midnight if the app is left open
        const nowKey = todayKey();
        if (nowKey !== dayKey && assignment) {
          dayKey = nowKey;
          assignment = dailyAssignment(Object.values(assignment), dayKey);
        }
        refreshPanel();
        refreshDetectedBadge();
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
