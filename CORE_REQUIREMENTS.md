# slidecast — System Requirements

slidecast requires OS-level packages and fonts that go beyond npm dependencies.
These are declared generically in `package.json` under `waiveo.systemDeps` and
`fonts/` so the core Dockerfile never hard-codes the slidecast extension name.

## OS packages (`waiveo.systemDeps` in package.json)

| Package | Purpose |
|---|---|
| `chromium` | Headless browser for slide PNG rendering via Playwright |
| `nss` | NSS crypto libraries (Chromium runtime dependency) |
| `freetype` | Font rendering library (Chromium dependency) |
| `harfbuzz` | Text shaping engine (Chromium dependency) |
| `ttf-freefont` | Fallback fonts for Chromium |
| `font-noto-emoji` | Emoji rendering inside slides |
| `font-noto` | Noto font family (Unicode coverage) |
| `fontconfig` | Font discovery/cache — required for `fc-cache -f` |
| `ffmpeg` | Video looping, concatenation, and transitions (VideoProcessor.js) |

The Dockerfile reads this list from package.json at build time and installs the
union across all extensions via `apk add --no-cache` — no package name is
hard-coded in the Dockerfile.

## Fonts (`fonts/`)

The `fonts/` subdirectory contains Google Font TTF files (SIL Open Font License)
used by the Satori (SVG) and Chromium (PNG) render pipelines:

- Inter, Roboto, Roboto Mono, Open Sans, Lato, Montserrat, Oswald,
  Playfair Display, Poppins

The Dockerfile copies all `extensions/*/fonts/` directories into
`/usr/share/fonts/extensions/<ext-name>/` and rebuilds the font cache once,
generically — slidecast is not named.

**Hard rule:** any extension that ships a `fonts/` directory MUST also list `fontconfig` in its `waiveo.systemDeps` — without it, fonts are copied but `fc-cache` is never called and fonts are silently never registered with the system font cache.

## Playwright executable path

The render pipeline (`render-browser-config.js`) resolves the Chromium binary at
runtime via:
1. `process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (if set)
2. `process.env.CHROMIUM_PATH` (if set)
3. Hardcoded fallback: `/usr/bin/chromium-browser` (the Alpine system Chromium path)

No `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` ENV is baked into the core Docker image.
The fallback covers standard Alpine installs; set the env var explicitly in
`docker-compose.yml` only if you install Chromium at a non-standard path.

`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set during the Dockerfile's npm-install
loop (build-time only) to prevent Playwright from downloading its own Chromium
bundle — the system Chromium is used instead.
