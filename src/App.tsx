import { memo, useEffect, useState } from 'react';
import rawPricing from './data/pricing.json';
import {
  formatMinutesHuman,
  getStatus,
  type ModelPrices,
  type PricingData,
} from './lib/pricing';

const pricing = rawPricing as unknown as PricingData;

const priceFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

const fetchedAtFmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatPrice(value: number): string {
  return `$${priceFmt.format(value)}`;
}

/** "offPeak / peak" for one pricing tier. */
function TierPrices({ tier }: { tier: { offPeak: number; peak: number } }) {
  return (
    <span className="tier-prices">
      <span className="price-off-peak">{formatPrice(tier.offPeak)}</span>
      <span className="price-slash"> / </span>
      <span className="price-peak">{formatPrice(tier.peak)}</span>
    </span>
  );
}

/* `pricing` is a module constant, so memo means the table renders once
   instead of on every 1s clock tick. */
const PricingTable = memo(function PricingTable({
  models,
}: {
  models: Record<string, ModelPrices>;
}) {
  return (
    <table className="pricing-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Cache Hit</th>
          <th>Cache Miss</th>
          <th>Output</th>
        </tr>
        <tr className="thead-sub">
          <th aria-hidden="true"></th>
          <th colSpan={3}>off-peak / peak (per 1M tokens)</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(models).map(([model, m]) => (
          <tr key={model}>
            <th scope="row" className="model-name">
              {model}
            </th>
            <td>
              <TierPrices tier={m.cacheHit} />
            </td>
            <td>
              <TierPrices tier={m.cacheMiss} />
            </td>
            <td>
              <TierPrices tier={m.output} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

export default function App() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = getStatus(pricing, now);
  const fetchedAt = new Date(pricing.fetchedAt);

  return (
    <div className="page">
      <header className="header">
        <h1>DeepSeek API Pricing</h1>
        <p className="subtitle">Live peak / off-peak status, in your timezone</p>
      </header>

      <main>
        <section className="hero" aria-label="Current pricing status">
          <div className={`badge ${status.isPeak ? 'badge-peak' : 'badge-off-peak'}`} role="status">
            <span className="badge-dot" aria-hidden="true" />
            {status.isPeak ? 'PEAK HOUR' : 'OFF-PEAK'}
          </div>
          <p className="hero-label">
            {status.isPeak
              ? 'DeepSeek is currently charging peak-hour rates'
              : 'DeepSeek is currently charging off-peak rates (50% discount)'}
          </p>
          <p className="hero-clock">
            <strong>{status.localTimeLabel}</strong>
            <span className="hero-tz">({status.tzLabel})</span>
          </p>
          <p className="hero-utc">UTC {status.utcTimeLabel}</p>
          {status.nextChangeMinutes !== null && (
            <p className="hero-countdown">
              {status.isPeak ? 'Peak ends in' : 'Off-peak ends in'}{' '}
              <strong>{formatMinutesHuman(status.nextChangeMinutes)}</strong>
            </p>
          )}
        </section>

        <section className="card" aria-label="Peak hours in your timezone">
          <h2>Peak hours — your timezone</h2>
          <p className="hint">Windows are defined in UTC and converted to your timezone.</p>
          <ul className="window-list">
            {status.windowsLocal.map((w) => (
              <li
                key={`${w.start}-${w.end}`}
                className={`window-item ${w.isActive ? 'window-active' : ''}`}
              >
                <span className="window-time">
                  {w.startLabel} – {w.endLabel}
                  {w.crossesMidnight && <span className="next-day"> (next day)</span>}
                </span>
                {w.isActive && <span className="window-now">now</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-label="Pricing table">
          <h2>Pricing</h2>
          {pricing.offPeakNote && <p className="hint">{pricing.offPeakNote}</p>}
          <PricingTable models={pricing.models} />
        </section>
      </main>

      <footer className="footer">
        <p>
          Data fetched from{' '}
          <a href={pricing.sourceUrl} target="_blank" rel="noreferrer">
            {pricing.sourceUrl}
          </a>{' '}
          at {fetchedAtFmt.format(fetchedAt)} (build time). Rates are in {pricing.currency} per
          1M tokens.
        </p>
      </footer>
    </div>
  );
}
