import { memo, useEffect, useState } from 'react';
import rawPricing from './data/pricing.json';
import {
  dayStripSegments,
  formatMinutesHuman,
  getStatus,
  nowDayFraction,
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

/** Rough, language-neutral data age for the footer ("3h ago", "2d ago"). */
function formatAge(fetchedAt: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - fetchedAt.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
          <th scope="col">Model</th>
          <th scope="col">Cache Hit</th>
          <th scope="col">Cache Miss</th>
          <th scope="col">Output</th>
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
  const fetchedAtValid = Number.isFinite(fetchedAt.getTime());
  const fetchedAtLabel = fetchedAtValid ? fetchedAtFmt.format(fetchedAt) : 'unknown time';
  const dataAge = fetchedAtValid ? formatAge(fetchedAt, now) : null;
  const segments = dayStripSegments(pricing, now);
  const nowFraction = nowDayFraction(now);

  /* Keep the tab glanceable: the status prefix flips with the rate tier. */
  useEffect(() => {
    document.title = `${status.isPeak ? 'Peak hour' : 'Off-peak'} · DeepSeek API — Peak / Off-Peak Status`;
  }, [status.isPeak]);

  return (
    <div className={`page ${status.isPeak ? 'page-peak' : 'page-off-peak'}`}>
      <header className="header">
        <h1>DeepSeek API Pricing</h1>
        <p className="subtitle">Live peak / off-peak status, in your timezone</p>
      </header>

      <main>
        <section
          className={`hero ${status.isPeak ? 'hero-peak' : 'hero-off-peak'}`}
          aria-label="Current pricing status"
        >
          <div className="hero-ambient" aria-hidden="true">
            <span className={`ambient-layer ambient-peak ${status.isPeak ? 'is-on' : ''}`} />
            <span className={`ambient-layer ambient-off ${status.isPeak ? '' : 'is-on'}`} />
          </div>
          {/* Keyed by status: the pop + ping replay exactly when the tier flips. */}
          <div
            className={`badge ${status.isPeak ? 'badge-peak' : 'badge-off-peak'}`}
            role="status"
          >
            <span key={status.isPeak ? 'peak' : 'off'} className="badge-inner">
              <span className="badge-dot" aria-hidden="true" />
              <span>{status.isPeak ? 'PEAK HOUR' : 'OFF-PEAK'}</span>
            </span>
          </div>
          <p className="hero-label">
            {status.isPeak
              ? 'DeepSeek is currently charging peak-hour rates'
              : 'DeepSeek is currently charging off-peak rates (50% discount)'}
          </p>
          <p className="hero-clock">
            <strong>{status.localTimeLabel.slice(0, 5)}</strong>
            {/* Keyed by second: a quiet tick that proves the clock is live. */}
            <span key={status.localTimeLabel.slice(6)} className="clock-seconds" aria-hidden="true">
              {status.localTimeLabel.slice(6)}
            </span>
            <span className="hero-tz">({status.tzLabel})</span>
          </p>
          <p className="hero-utc">UTC {status.utcTimeLabel}</p>
          {status.nextChangeMinutes !== null && (
            <p className="hero-countdown">
              {status.isPeak ? 'Peak ends in' : 'Off-peak ends in'}{' '}
              {/* Keyed by minute: a small bump when the countdown ticks down. */}
              <strong key={status.nextChangeMinutes} className="countdown-value">
                {formatMinutesHuman(status.nextChangeMinutes)}
              </strong>
            </p>
          )}
        </section>

        <section className="card" aria-label="Peak hours in your timezone">
          <h2>Peak hours — your timezone</h2>
          <p className="hint">Windows are defined in UTC and converted to your timezone.</p>
          {status.windowsLocal.length > 0 ? (
            <>
              {/* Decorative: the exact labels live in the list below. */}
              <div className="day-strip" aria-hidden="true">
                <div className="strip-track">
                  {segments.map((s, i) => (
                    <span
                      key={i}
                      className={`strip-segment ${s.isActive ? 'strip-segment-active' : ''}`}
                      style={{ left: `${s.start * 100}%`, width: `${(s.end - s.start) * 100}%` }}
                    />
                  ))}
                  <span className="strip-now" style={{ left: `${nowFraction * 100}%` }}>
                    <span className="strip-now-dot" />
                    <span className="strip-now-line" />
                  </span>
                </div>
                <div className="strip-hours">
                  {['00:00', '06:00', '12:00', '18:00', '24:00'].map((h) => (
                    <span key={h}>{h}</span>
                  ))}
                </div>
              </div>
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
            </>
          ) : (
            <p className="hint">No peak windows are defined in the bundled data.</p>
          )}
        </section>

        <section className="card" aria-label="Pricing table">
          <h2>Pricing</h2>
          {pricing.offPeakNote && <p className="hint">{pricing.offPeakNote}</p>}
          {Object.keys(pricing.models).length > 0 ? (
            <PricingTable models={pricing.models} />
          ) : (
            <p className="hint">No model pricing is bundled with this build.</p>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>
          Data fetched from{' '}
          <a href={pricing.sourceUrl} target="_blank" rel="noreferrer">
            {pricing.sourceUrl}
          </a>{' '}
          at {fetchedAtLabel}
          {dataAge !== null && <span className="footer-age"> · {dataAge}</span>} (build time).
        </p>
        <p>
          Rates are in {pricing.currency} per 1M tokens.
        </p>
      </footer>
    </div>
  );
}
