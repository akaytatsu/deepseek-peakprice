# CLAUDE.md

## What this is

A static single-page status site that answers "is DeepSeek charging peak-hour or off-peak rates right now?" — in the visitor's own timezone, with per-model prices and a countdown to the next rate change. English-only UI. No backend and no runtime network calls; pricing is scraped at build time and served statically on GitHub Pages. See `PRODUCT.md` (product spec) and `README.md` (setup/deploy).

## Architecture / data flow

1. **Build time** — `scripts/fetch-pricing.mjs` runs automatically via the `predev` / `prebuild` npm hooks. It fetches the official DeepSeek pricing page (`PRICING_URL`, default `https://api-docs.deepseek.com/quick_start/pricing/`), extracts the peak windows, the weekday-only rule, and the per-model off-peak/peak prices, and writes `src/data/pricing.json`.
2. **Committed data** — `src/data/pricing.json` is intentionally committed: it is the offline fallback when the DeepSeek site is unreachable during a build (a failed fetch keeps it with a warning; `STRICT=1` fails the build instead). Commit scraper regenerations.
3. **Runtime** — `src/App.tsx` imports that JSON and derives everything through pure functions in `src/lib/pricing.ts` (`getStatus`, `isPeakAt`, `minutesUntilNextChange`, `localWindows`, `dayStripSegments`). Peak determination is always UTC-based; display is projected to the visitor's timezone with `Intl` (DST-safe).
4. **Deploy** — push to `main` → `.github/workflows/deploy.yml` builds with `STRICT=1` and publishes to GitHub Pages under `/deepseek-peakprice/` (`base` set in `vite.config.ts`).

## Pricing-schedule data model

(`PricingData` in `src/lib/pricing.ts` ↔ the shape of `src/data/pricing.json`)

- `peakWindows`: `{start, end}` UTC `"HH:MM"` ranges, **half-open** (end excluded). `start === end` = whole-day window; `start > end` = window crossing midnight.
- `weekendOffPeak?: boolean`: when `true`, peak windows apply only Monday–Friday; weekends (UTC Saturday/Sunday) are off-peak all day. `undefined` = windows apply every day (legacy data; keep the field optional for backward compatibility). Day-of-week is deliberately UTC-based: the windows sit at 01:00–10:00 UTC, hours in which the UTC date always equals the Beijing date, so there is no timezone ambiguity.
- `offPeakNote?`: a verbatim sentence scraped from the page — keep it verbatim, never append to it.
- `models`: per-model `{cacheHit, cacheMiss, output} × {offPeak, peak}` in USD per 1M tokens. Invariant: off-peak × 2 ≈ peak (the scraper warns on breach — a canary that the discount semantics changed).

## Commands

```sh
npm install
npm run dev                # Vite dev server (runs fetch:pricing first via predev)
npm run build              # tsc -b + vite build (prebuild runs fetch:pricing)
npm run fetch:pricing      # regenerate src/data/pricing.json from the live page
STRICT=1 npm run fetch:pricing        # fail on any fetch/parse error (CI default)
PRICING_URL=file:///path/to/saved.html npm run fetch:pricing   # test against a saved copy
make up | stop | restart | logs | build    # Docker dev environment (port 5173)
```

Node ≥ 18.17 (`engines`); `.nvmrc` pins 22.

## Conventions

- **English only** in the UI and user-facing copy.
- **No tests** exist. `src/lib/pricing.ts` must stay pure and side-effect-free; verify logic changes against fixed dates (e.g. `node --experimental-strip-types` importing the module) or in the browser devtools.
- **Schedule facts are scraped, never hardcoded** — UI labels may be hardcoded, but windows, prices, and the weekday rule must come from `pricing.json`.
- Scraper policy-drift canaries (the off-peak × 2 invariant, a missing weekday clause) only warn; hard parse errors throw. `STRICT=1` fails only on real errors.
- `src/App.tsx` memoizes rendering (`memo`, module-level `pricing`) so the 1s clock tick does not re-render the price table.
- `.claude/skills/` is tracked on purpose (`.gitignore` ignores `.claude/*` except it) — do not delete it.
