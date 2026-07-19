# Pickleball Rule Roulette 🏓

Point your phone at your friends. The app detects **every person** in the shot and
**slot-machine-spins a dumb pickleball rule onto each of their heads**, then locks
one in. Record the clip and share it to Instagram.

- **People detection:** [MediaPipe ObjectDetector](https://ai.google.dev/edge/mediapipe) (EfficientDet-Lite / COCO, `person` class), on-device
- **The spin:** each head's label cycles fast then eases to a stop; tap **Spin again** to re-roll
- **Recording:** `MediaRecorder` on the canvas stream + mic audio
- **Sharing:** Web Share API (files) → Instagram / Reels / Stories; download fallback on desktop
- **Hosting:** static build on Cloudflare Pages (HTTPS is required for camera access)

## The rules

Edit [`src/rules.ts`](src/rules.ts) — it's just a list of strings. Add/remove freely.

## Develop

```bash
npm install
npm run dev        # localhost is a secure context, so the camera works
npm run deploy     # vite build + wrangler pages deploy (needs CLOUDFLARE_API_TOKEN)
```

## Notes / limits

- People tracking is a lightweight nearest-box match, so a rule mostly stays stuck to
  a person as they move; fast movement or people crossing can swap labels. It's a party gag.
- The preview is **not mirrored** (so the text reads correctly) — front-camera group selfies
  look slightly "unmirrored", which is expected.
