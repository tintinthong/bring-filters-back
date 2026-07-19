# Bring filters back 🐶🕶️

A mobile-web **face AR filter** you record in the browser and share to Instagram.
Since Meta shut down Spark AR, this is the open path: on-device face tracking in
any modern mobile browser, record a clip, share it via the native share sheet.

**The twist:** the app looks at who's in frame (**boy / girl / woman / man**, or an
**animal** 🐾) and serves each a **filter of the day** — deterministic per date,
reshuffled every day.

- **Face tracking:** [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe) (478 points, on-device via WebGL)
- **Who's in frame:** [@vladmandic/face-api](https://github.com/vladmandic/face-api) age + gender, throttled + smoothed (lazy-loaded chunk)
- **Animals:** MediaPipe ObjectDetector (EfficientDet-Lite / COCO — cat, dog, bird, horse…); the filter anchors to the pet's bounding box
- **Filters:** bundled in [`src/filters.data.ts`](src/filters.data.ts) — emoji + vector parts anchored to landmarks
- **Recording:** `MediaRecorder` on the canvas stream + mic audio
- **Sharing:** Web Share API (files) → Instagram / Reels / Stories; download fallback on desktop
- **Hosting:** static build on Cloudflare Pages (HTTPS is required for camera access)

## How the daily filter is chosen

1. If a human face is found: age + gender are estimated on-device and smoothed into
   `boy / girl / woman / man`. If no face but a cat/dog/etc. is detected, the category
   is `animal` and the filter anchors to the pet's bounding box (a face wins over a pet).
2. Today's date (`YYYY-MM-DD`, local) seeds a PRNG → the filter list is shuffled →
   one filter is assigned per category. Same day = same filters; next day = reshuffled.
   Distinct per category when the DB has ≥ 4 filters. (See `dailyAssignment` in `src/filtersDb.ts`.)
3. Tap any category chip to override detection manually (handy for testing).

## Adding / editing filters

Filters are **bundled in the app** (`src/filters.data.ts`) — the reliable choice:
they work offline, there's no "database down" failure mode, and every change is
reviewable in git. A filter is a list of `parts`; a part is either an `emoji` or a
vector shape (`glasses`, `puppyEars`, `puppyNose`, `tongue`, `whiskers`) anchored to
the face (`forehead`, `aboveHead`, `leftEye`, `noseTip`, `leftCheek`, …) with
`along` / `up` / `scale` offsets in eye-distance units.

- **New combo of existing parts / any emoji:** add an entry to `FILTERS`, then deploy.
- **A genuinely new *kind* of part** (new shape, warp, color grade): add a renderer in
  `src/filters.ts`. That's code — because a filter is behavior, not just data.

## Develop

```bash
npm install
npm run dev        # opens on localhost (secure context → camera works)
```

To test on a phone during dev, use Cloudflare deploys (below) — `localhost` is a
secure context but a LAN IP is not, so camera access needs HTTPS.

## Deploy (Cloudflare Pages)

```bash
npm run deploy     # vite build + wrangler pages deploy dist
```

Requires `CLOUDFLARE_API_TOKEN` (Pages: Edit) in the environment. Every push to
`main` can also auto-deploy once the repo is connected in the Cloudflare dashboard
(Workers & Pages → the project → Settings → Builds & deployments → connect to Git).

## Roadmap

- [ ] Vendor MediaPipe wasm + model into `/public` (remove CDN runtime dependency)
- [ ] Better age buckets (child threshold is a rough 18y; face-api age is noisy)
- [ ] Photo capture (in addition to video)
- [ ] Mouth-open / blink triggers via face blendshapes
- [ ] Optional: support remote image/SVG/Lottie sticker URLs (safe way to add *art* without a deploy)
