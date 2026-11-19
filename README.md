# VICEFEED · $VICEFEED

Clip GTA 6, post it with the VICEFEED watermark, claim it, get paid per 1K views.

## How it fits together

| Route        | What it does                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| `/`          | Landing page                                                                 |
| `/start`     | Sign in with a Solana wallet (Phantom), pick a username, link TikTok and X   |
| `/studio`    | Dashboard: claim clips, see processing status, views and earnings            |
| `/editor/`   | VICEFEED Studio, the browser video editor (built from `clip-editor/`)        |
| `/api/*`     | Vercel functions: auth, profile, claims, view fetching, daily refresh        |

### Sign-in
1. The browser asks Phantom to connect, then calls `GET /api/auth/nonce?wallet=…`.
2. Phantom signs the returned message (free, no transaction).
3. `POST /api/auth/verify` checks the ed25519 signature and the single-use nonce, then sets an
   HttpOnly session cookie (30 days). There are no passwords or emails.

### Claims
1. `POST /api/claims { url }` accepts TikTok links (`tiktok.com/@user/video/…`, `vm.tiktok.com/…`) and X links (`x.com/user/status/…`).
2. The claim starts as **processing**. The studio immediately calls `POST /api/claims/process`, which fetches the public views:
   - **TikTok:** reads the public video page. Set `TIKTOK_VIEWS_API` to use a data provider instead.
   - **X:** uses the X API v2 when `X_BEARER_TOKEN` is set, otherwise the public embed endpoint.
3. The claim ends as one of:
   - **live**: views counted and paid per 1K.
   - **not_yours**: the author isn't the linked handle.
   - **review**: views couldn't be read automatically.
   - **rejected**: the post is missing or has no video.
4. Each video can only be claimed once, across all accounts.
5. `/api/cron` refreshes live claims daily through Vercel Cron.

### Editor
`clip-editor/` is the editor source (mediabunny + WebCodecs, all on-device). VICEFEED additions:
- `src/brand.js`: the watermark (badge, handle, wordmark or corner bug) with the clipper's handle. It's drawn in the preview **and burned into the export**.
- **Brand kit panel:** style, handle, position, size, opacity, and branded text presets (Glossy 3D, Hook, Caption box).
- **Defaults:** a 9:16 frame and MP4 export.
- **Theme:** VICEFEED styling, links back to the studio, and a "claim it" prompt after export.

Rebuild after changing the editor:

```bash
cd clip-editor && npm ci && OUTDIR=../editor npm run build
```

Commit the built `editor/` folder. Vercel serves it as static files, so no build step is needed.

## Deploy (Vercel)

1. Import the repo with framework preset **Other**. Leave the build and output settings empty.
2. **Storage:** Marketplace → **Upstash Redis** (or Vercel KV) → connect to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Environment variables:**
   - `SESSION_SECRET`: required, a long random string (`openssl rand -hex 32`).
   - `CRON_SECRET`: required for the daily view refresh.
   - `RATE_PER_1K`: optional, default `0.5`.
   - `X_BEARER_TOKEN`: optional, for X API v2 view counts.
   - `TIKTOK_VIEWS_API`: optional, a provider URL with `{id}` or `{url}` placeholders.
4. Redeploy.

## Run locally

```bash
node dev.js
```

Then open http://localhost:5180. Local data is saved in `.data/db.json`, which is gitignored.

## Not built yet
- Payout sending: earnings are tracked, and SOL payouts are still manual.
- An admin view for claims in **review**.
- Instagram and YouTube claims (only TikTok and X for now).
