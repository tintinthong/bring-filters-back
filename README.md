# Bring 3rd-party filters back 🐶🕶️

A mobile-web **face AR filter** you record in the browser and share to Instagram.
Since Meta shut down Spark AR, this is the open path: on-device face tracking in
any modern mobile browser, record a clip, share it via the native share sheet.

- **Face tracking:** [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe) (478 points, runs on-device via WebGL)
- **Rendering:** 2D canvas overlay — filters are plain functions, easy to add
- **Recording:** `MediaRecorder` on the canvas stream + mic audio
- **Sharing:** Web Share API (files) → Instagram / Reels / Stories; download fallback on desktop
- **Hosting:** static build on Cloudflare Pages (HTTPS is required for camera access)

## Develop

```bash
npm install
npm run dev        # opens on localhost (secure context → camera works)
```

To test on a phone during dev, use Cloudflare Pages preview deploys (below) —
`localhost` is a secure context but a LAN IP is not, so camera access needs HTTPS.

## Add a filter

Edit `src/filters.ts`, add a `Filter` to the `FILTERS` array. Each filter draws
onto a 2D context using a rotation/scale-invariant `FaceFrame` (eye axis + scale).
The UI builds a chip for it automatically.

## Deploy (Cloudflare Pages)

```bash
npm run deploy     # vite build + wrangler pages deploy dist
```

Requires `CLOUDFLARE_API_TOKEN` (Pages: Edit) in the environment. Every push to
`main` can also auto-deploy once the repo is connected in the Cloudflare dashboard
(Workers & Pages → the project → Settings → Builds & deployments → connect to Git).

## Roadmap

- [ ] Vendor MediaPipe wasm + model into `/public` (remove CDN runtime dependency)
- [ ] More filters (crown, face paint, LUT color grades)
- [ ] Photo capture (in addition to video)
- [ ] Mouth-open / blink triggers via face blendshapes
