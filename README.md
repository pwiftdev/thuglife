# $THUG — Thug Life

Landing page for the $THUG memecoin. Plain HTML/CSS/JS, no build step.

## Structure

```
index.html          page markup
css/style.css       styles
js/main.js          hero intro, copy-CA, scroll reveals
js/studio.js        "Thug yourself" photo editor (canvas, runs fully client-side)
js/joint-data.js    joint cut-out as a data URI (keeps canvas export untainted)
assets/             glasses.svg, joint.png, favicon.svg, og.jpg
vercel.json         headers / clean URLs
```

## Run locally

```bash
python3 -m http.server 5179
```

Then open http://localhost:5179.

## Deploy (Vercel)

Import the repo in Vercel and keep the defaults:

- Framework preset: **Other**
- Build command: *(empty)*
- Output directory: *(empty — repo root)*

Every push to `main` deploys to production.

## After you have a domain

Replace the relative `og:image` / `twitter:image` in `index.html` with the
absolute URL (e.g. `https://yourdomain.com/assets/og.jpg`) so link previews
on X and Telegram show the banner.

## Editing CSS/JS

`index.html` loads `css/style.css?v=N` and `js/*.js?v=N`. Bump `N` when you
change those files so returning visitors get the new version.
