#!/usr/bin/env node
/**
 * fetch-pricing.mjs
 *
 * Fetches the DeepSeek API pricing page and extracts the peak/off-peak data
 * into src/data/pricing.json (committed, used as the app's data source).
 *
 * Runs automatically via the `predev` / `prebuild` npm hooks.
 *
 * Environment knobs:
 *   PRICING_URL   override the source URL (e.g. file:///tmp/fixture.html for tests)
 *   STRICT=1      any failure exits 1 (used in CI); otherwise falls back to the
 *                 existing committed data with a warning when a fetch fails
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRICING_URL =
  process.env.PRICING_URL ?? 'https://api-docs.deepseek.com/quick_start/pricing/';
const STRICT = process.env.STRICT === '1';
const OUT = join(process.cwd(), 'src', 'data', 'pricing.json');

const USER_AGENT =
  'deepseek-peakprice/0.1 (+https://github.com/akaytatsu/deepseek-peakprice)';

// ---------------------------------------------------------------------------
// Fetch

async function fetchPage(url) {
  if (url.startsWith('file://')) {
    return readFileSync(fileURLToPath(url), 'utf8');
  }
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Parsing helpers

/** Strip tags -> spaces, decode HTML entities, collapse whitespace. */
function normalizeHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const PRICE_RE = /\$\s?(\d+(?:\.\d+)?)/g;
// Matches lowercase kebab-case model ids (e.g. deepseek-v4-flash).
// Case-sensitive on purpose: rejects the uppercase "MODEL VERSION" row
// (DeepSeek-V4-Flash-0731) and uppercase label cells.
const MODEL_CELL_RE = /^[a-z][a-z0-9-]+$/;

function rowCells(rowHtml) {
  return [...rowHtml.matchAll(CELL_RE)].map((m) =>
    normalizeHtml(m[1].replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ' ')),
  );
}

function rowText(rowHtml) {
  return normalizeHtml(rowHtml);
}

function countPrices(text) {
  return (text.match(PRICE_RE) ?? []).length;
}

function toHHMM(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Parsing

function parsePricing(html) {
  const text = normalizeHtml(html);

  // 1. Peak windows — scoped to the "Peak hours ..." sentence so other
  //    HH:MM tokens elsewhere on the page can never be misread.
  const sentence = text.match(/Peak hours?\b[^.!?]*/i)?.[0];
  if (!sentence) {
    throw new Error('Could not find the "Peak hours ..." sentence on the page');
  }
  const windows = [...sentence.matchAll(/\b(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})\b/g)].map(
    (m) => {
      const sh = Number(m[1]);
      const sm = Number(m[2]);
      const eh = Number(m[3]);
      const em = Number(m[4]);
      if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
        throw new Error(`Invalid time range in peak-hours sentence: ${m[0]}`);
      }
      return { start: toHHMM(sh, sm), end: toHHMM(eh, em) };
    },
  );
  if (windows.length === 0) {
    throw new Error('No HH:MM - HH:MM ranges found in the peak-hours sentence');
  }

  // 2. Off-peak discount note (verbatim, only if present).
  const offPeakNote = /off-peak rates are half of the peak rates/i.test(text)
    ? 'Off-peak rates are half of the peak rates.'
    : undefined;

  // 3. Pricing table — pick the table containing the most prices.
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  if (tables.length === 0) {
    throw new Error('No <table> found on the page');
  }
  tables.sort((a, b) => countPrices(b) - countPrices(a));
  const table = tables[0];

  const rows = table.split(/<tr[^>]*>/i).filter((r) => r.trim());
  const parsedRows = rows.map((r) => ({
    cells: rowCells(r),
    text: rowText(r),
    prices: [...rowText(r).matchAll(PRICE_RE)].map((m) => Number(m[1])),
  }));

  // 4. Model ids — the header row is transposed: model ids are the first data
  //    row of the table (after the "MODEL" label cell).
  let modelsRow = parsedRows.find(
    (r) => r.text.toUpperCase().startsWith('MODEL') && r.cells.filter((c) => MODEL_CELL_RE.test(c)).length > 0,
  );
  let models = modelsRow?.cells.filter((c) => MODEL_CELL_RE.test(c)) ?? [];
  if (models.length === 0) {
    // Fallback: scan every row for lowercase kebab-case cells.
    const candidates = parsedRows.map((r) => r.cells.filter((c) => MODEL_CELL_RE.test(c)));
    const best = candidates.reduce((a, b) => (b.length > a.length ? b : a), []);
    models = best;
    if (models.length === 0) {
      throw new Error('Could not find model ids in the pricing table');
    }
  }

  // 5. Price rows — each row holds one price per model (transposed layout).
  //    Bands/tiers are label-driven; the table order today is:
  //      cache-hit OFF-PEAK, cache-hit PEAK, cache-miss OFF-PEAK,
  //      cache-miss PEAK, output OFF-PEAK, output PEAK.
  const bandOf = (rowText) => {
    if (/CACHE\s+HIT/i.test(rowText)) return 'cacheHit';
    if (/CACHE\s+MISS/i.test(rowText)) return 'cacheMiss';
    if (/OUTPUT/i.test(rowText)) return 'output';
    return null;
  };
  const tierOf = (rowText) => {
    // OFF-PEAK first: it contains "PEAK".
    if (/OFF\s*[-–—]?\s*PEAK/i.test(rowText)) return 'offPeak';
    if (/PEAK/i.test(rowText)) return 'peak';
    return null;
  };

  const priceRows = parsedRows.filter((r) => r.prices.length > 0);

  // Label-driven mapping with band inheritance. The page's price rows come in
  // OFF-PEAK/PEAK pairs: only the OFF-PEAK row carries the band label
  // (e.g. "1M INPUT TOKENS (CACHE HIT)"), and the following "PEAK" row is a
  // continuation without it — so the band is inherited from the previous row.
  const bands = [];
  let currentBand = null;
  let labelsOk = true;
  for (const r of priceRows) {
    const tier = tierOf(r.text);
    const band = bandOf(r.text) ?? currentBand;
    if (!tier || !band || r.prices.length !== models.length) {
      labelsOk = false;
      break;
    }
    currentBand = band;
    bands.push([band, tier, r.prices]);
  }

  if (!labelsOk) {
    // Positional fallback: labels missing entirely (format drift) — use page order.
    const EXPECTED = [
      ['cacheHit', 'offPeak'],
      ['cacheHit', 'peak'],
      ['cacheMiss', 'offPeak'],
      ['cacheMiss', 'peak'],
      ['output', 'offPeak'],
      ['output', 'peak'],
    ];
    if (priceRows.length !== EXPECTED.length) {
      throw new Error(
        `Pricing table layout changed: ${priceRows.length} price rows found, labels missing`,
      );
    }
    console.warn('[fetch-pricing] warning: price-row labels not found; using positional mapping');
    bands.length = 0;
    priceRows.forEach((r, i) => bands.push([EXPECTED[i][0], EXPECTED[i][1], r.prices]));
  }

  const modelData = {};
  for (const model of models) {
    modelData[model] = { cacheHit: {}, cacheMiss: {}, output: {} };
  }
  for (const [band, tier, prices] of bands) {
    models.forEach((model, i) => {
      modelData[model][band][tier] = prices[i];
    });
  }

  // 6. Sanity checks.
  const REQUIRED = [
    ['cacheHit', 'offPeak'],
    ['cacheHit', 'peak'],
    ['cacheMiss', 'offPeak'],
    ['cacheMiss', 'peak'],
    ['output', 'offPeak'],
    ['output', 'peak'],
  ];
  for (const model of models) {
    for (const [band, tier] of REQUIRED) {
      if (typeof modelData[model][band][tier] !== 'number') {
        throw new Error(`Model ${model} is missing ${band}.${tier}`);
      }
    }
    // The page states off-peak rates are half of the peak rates — a breach of
    // this invariant is a canary that the discount semantics changed.
    for (const band of ['cacheHit', 'cacheMiss', 'output']) {
      const { offPeak, peak } = modelData[model][band];
      if (Math.abs(offPeak * 2 - peak) > 0.002) {
        console.warn(
          `[fetch-pricing] warning: ${model} ${band} is not 2x (offPeak=${offPeak}, peak=${peak})`,
        );
      }
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl: PRICING_URL,
    currency: 'USD',
    unit: 'per 1M tokens',
    peakWindows: windows,
    ...(offPeakNote ? { offPeakNote } : {}),
    models: modelData,
  };
}

// ---------------------------------------------------------------------------
// Main

async function main() {
  try {
    const html = await fetchPage(PRICING_URL);
    const data = parsePricing(html);
    mkdirSync(dirname(OUT), { recursive: true });
    const tmp = `${OUT}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, OUT);
    const modelList = Object.keys(data.models).join(', ');
    console.log(
      `[fetch-pricing] wrote ${Object.keys(data.models).length} models, ${data.peakWindows.length} windows -> ${OUT} (${modelList})`,
    );
  } catch (err) {
    const message = `[fetch-pricing] failed to update pricing data: ${err.message}`;
    if (STRICT) {
      console.error(message);
      process.exit(1);
    }
    if (existsSync(OUT)) {
      console.warn(`${message}\n[fetch-pricing] keeping existing ${OUT}`);
      process.exit(0);
    }
    console.error(`${message}\n[fetch-pricing] no existing data to fall back to`);
    process.exit(1);
  }
}

main();
