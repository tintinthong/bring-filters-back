# Bring filters back 🐶🕶️

A mobile-web **face AR filter** you record in the browser and share to Instagram.
Since Meta shut down Spark AR, this is the open path: on-device face tracking in
any modern mobile browser, record a clip, share it via the native share sheet.

**The twist:** the app looks at who's in frame (**boy / girl / woman / man**) and
serves each a **filter of the day** — deterministic per date, reshuffled every day.
Filters live in an online JSON database you can edit without redeploying.

- **Face tracking:** [MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe) (478 points, on-device via WebGL)
- **Who's in frame:** [@vladmandic/face-api](https://github.com/vladmandic/face-api) age + gender, throttled + smoothed (lazy-loaded chunk)
- **Filters as data:** emoji + vector parts anchored to landmarks — see [`public/filters.json`](public/filters.json)
- **Recording:** `MediaRecorder` on the canvas stream + mic audio
- **Sharing:** Web Share API (files) → Instagram / Reels / Stories; download fallback on desktop
- **Hosting:** static build on Cloudflare Pages (HTTPS is required for camera access)

## How the daily filter is chosen

1. Age + gender are estimated on-device and smoothed into one of `boy / girl / woman / man`.
2. Today's date (`YYYY-MM-DD`, local) seeds a PRNG → the filter list is shuffled →
   one filter is assigned per category. Same day = same filters; next day = reshuffled.
   Distinct per category when the DB has ≥ 4 filters. (See `dailyAssignment` in `src/filtersDb.ts`.)
3. Tap any category chip to override detection manually (handy for testing).

## The filter database (edit filters without redeploying)

Filters are fetched at runtime, in this order (first hit wins):

1. `?filters=<url>` query override (testing)
2. **`raw.githubusercontent.com/.../main/public/filters.json`** — edit this on GitHub and it goes live (CDN-cached ~5 min)
3. `/filters.json` shipped with the deploy
4. a small bundled fallback (works offline)

Each filter is a list of `parts`; a part is either an `emoji` or a vector shape
(`glasses`, `puppyEars`, `puppyNose`, `tongue`, `whiskers`) anchored to the face
(`forehead`, `aboveHead`, `leftEye`, `noseTip`, `leftCheek`, …) with `along` / `up`
/ `scale` offsets in eye-distance units. Add an entry → a new filter exists. No code.

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
- [ ] Move the filter DB to a real endpoint (KV/D1) with an editor UI
