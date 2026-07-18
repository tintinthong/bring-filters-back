import "./style.css";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { FILTERS, buildFrame, type Filter } from "./filters";

// MediaPipe wasm + model are loaded from a CDN for v1. To make the deploy fully
// self-contained later, vendor these into /public and point the URLs at them.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const video = $<HTMLVideoElement>("#video");
const canvas = $<HTMLCanvasElement>("#canvas");
const ctx = canvas.getContext("2d")!;
const hint = $<HTMLDivElement>("#hint");
const recDot = $<HTMLDivElement>("#rec-dot");
const filtersBar = $<HTMLDivElement>("#filters");
const startBtn = $<HTMLButtonElement>("#start");
const recordBtn = $<HTMLButtonElement>("#record");
const shareBtn = $<HTMLAnchorElement>("#share");
const status = $<HTMLParagraphElement>("#status");

let current: Filter = FILTERS[0];
let landmarker: FaceLandmarker | null = null;
let stream: MediaStream | null = null;
let running = false;
let lastVideoTime = -1;

// ---- filter chips ----
for (const f of FILTERS) {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = f.label;
  chip.setAttribute("aria-pressed", String(f.id === current.id));
  chip.onclick = () => {
    current = f;
    for (const c of filtersBar.children) c.setAttribute("aria-pressed", "false");
    chip.setAttribute("aria-pressed", "true");
  };
  filtersBar.appendChild(chip);
}

function setStatus(msg: string) {
  status.textContent = msg;
}

// ---- boot camera + model ----
async function start() {
  startBtn.disabled = true;
  setStatus("Loading face model…");
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
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
    setStatus("Pick a filter, then Record.");
    requestAnimationFrame(renderLoop);
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
    if (res.faceLandmarks?.length) {
      for (const lm of res.faceLandmarks) {
        current.draw(ctx, buildFrame(lm, canvas.width, canvas.height));
      }
    }
  } else {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(renderLoop);
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
    // Desktop / unsupported: download, then upload to Instagram from phone.
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

startBtn.onclick = start;
