# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

App builders and operators running DeepSeek API workloads in production. They visit to monitor the current rate tier and plan or schedule cost-heavy batch jobs around off-peak windows. (Secondary, unconfirmed: developers exploring DeepSeek pricing.)

## Product Purpose

A static, one-page status site that answers "is DeepSeek charging peak-hour or off-peak rates right now?" in the visitor's own timezone, with the current per-model prices and a countdown to the next rate change. Success: the visitor learns the current tier and when it changes, without reading DeepSeek's docs or doing timezone math.

## Positioning

Freshness with zero runtime dependence: pricing is fetched from DeepSeek's official pricing page at build time, committed to the repo, and served statically on GitHub Pages. Peak/off-peak windows and prices are projected to the visitor's timezone with DST-safe client-side math. A neighboring site could copy the facts but not the zero-backend freshness and timezone correctness.

## Operating Context

Visitors check the page ad-hoc from anywhere; the timezone display adapts automatically. Data is refreshed on every build (`fetch:pricing` runs prebuild; `STRICT=1` in CI fails the build loudly on parse failure; a failed fetch keeps the last committed data with a warning). The footer shows when the bundled data was fetched so visitors can judge freshness. The page runs with no backend and no runtime network calls.

## Capabilities and Constraints

- One page: current PEAK/OFF-PEAK status badge, local + UTC clock (updates every second), countdown to next rate change, peak windows in local time with "now" / "(next day)" markers, price table (model × cache hit / cache miss / output; off-peak / peak; USD per 1M tokens).
- Off-peak rates are exactly half of peak rates; peak windows currently 01:00–04:00 and 06:00–10:00 UTC (both may change — windows are scraped, not hardcoded).
- Three models: deepseek-v4-flash, deepseek-v4-pro, deepseek-v4-flash-vision-exp.
- No backend, no runtime network calls; all timezone math client-side via `Intl` (DST-safe).
- Static hosting on GitHub Pages under `/deepseek-peakprice/`; English only.
- Scope confirmed: status page is the product; no planned extensions recorded.

## Brand Commitments

- Name: "DeepSeek Peak Price" (page title "DeepSeek API — Peak / Off-Peak Status").
- Independent community tool about the DeepSeek API: no affiliation, endorsement, or official status. "DeepSeek" is used factually; never imply affiliation or adopt DeepSeek's brand as owned.

## Evidence on Hand

- Committed pricing data: `src/data/pricing.json` (fetched 2026-08-21T12:10:09Z — 3 models, peak windows, off-peak note).
- Source of truth: https://api-docs.deepseek.com/quick_start/pricing/ (fetched at build time by `scripts/fetch-pricing.mjs`).
- `README.md` documents the mechanism and GitHub Pages deployment.
- No testimonials, customers, benchmarks, or press exist — future work must not fabricate them.

## Product Principles

1. **Truthfulness first:** prices and windows come from DeepSeek's official page, and data age is shown, never hidden.
2. **Zero-dependency freshness:** the build pipeline, not runtime requests, keeps data current.
3. **The visitor's timezone is the product:** every time fact is expressed in local time.
4. **Glanceable:** the peak/off-peak answer must be readable in a second.
5. **Static and robust:** no backend; fails loudly at build time rather than silently serving stale data.
