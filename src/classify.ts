/**
 * Age + gender classification → boy / girl / woman / man.
 *
 * Uses @vladmandic/face-api (a maintained face-api.js) with a tiny detector and
 * the age+gender net. This module is heavy (bundles tfjs), so main.ts imports it
 * dynamically AFTER the camera is already live. MediaPipe still does the smooth
 * landmark tracking that the overlay draws to — this only picks WHICH filter.
 */

import * as faceapi from "@vladmandic/face-api";
import type { Reading } from "./smoother";

// Model weights come from the package's published /model dir on a CDN.
const MODELS_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

let ready = false;

export async function initClassifier(): Promise<void> {
  try {
    // tf is re-exported by face-api; types don't surface these but they exist at runtime.
    const tf = faceapi.tf as unknown as {
      setBackend: (b: string) => Promise<boolean>;
      ready: () => Promise<void>;
    };
    await tf.setBackend("webgl");
    await tf.ready();
  } catch {
    /* backend auto-selects if webgl is unavailable */
  }
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
    faceapi.nets.ageGenderNet.loadFromUri(MODELS_URL),
  ]);
  ready = true;
}

const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

/** One classification pass over the current video frame. */
export async function classifyOnce(video: HTMLVideoElement): Promise<Reading | null> {
  if (!ready) return null;
  const res = await faceapi.detectSingleFace(video, detectorOpts).withAgeAndGender();
  if (!res) return null;
  return {
    age: res.age,
    gender: res.gender as "male" | "female",
    genderProbability: res.genderProbability,
  };
}
