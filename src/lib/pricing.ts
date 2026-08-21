/**
 * Pure logic for DeepSeek peak/off-peak determination.
 *
 * Peak windows are defined by DeepSeek in UTC clock ranges (e.g. 01:00-04:00
 * and 06:00-10:00 UTC). "Is it peak right now" is therefore computed in UTC
 * minutes; windows are then *projected onto real instants of the current UTC
 * day* and formatted in the user's timezone with Intl — never by doing
 * arithmetic on local wall-clock strings (which would break across DST).
 */

export interface TimeWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface PriceTier {
  offPeak: number;
  peak: number;
}

export interface ModelPrices {
  cacheHit: PriceTier;
  cacheMiss: PriceTier;
  output: PriceTier;
}

export interface PricingData {
  fetchedAt: string;
  sourceUrl: string;
  currency: string;
  unit: string;
  peakWindows: TimeWindow[];
  offPeakNote?: string;
  models: Record<string, ModelPrices>;
}

export interface LocalWindow extends TimeWindow {
  startLabel: string; // e.g. "22:00" (user's timezone)
  endLabel: string; // e.g. "01:00"
  crossesMidnight: boolean; // end is on the next local calendar day
  isActive: boolean;
}

export interface Status {
  isPeak: boolean;
  now: Date;
  tzLabel: string;
  localTimeLabel: string;
  utcTimeLabel: string;
  windowsLocal: LocalWindow[];
  nextChangeMinutes: number | null;
}

export interface DayStripSegment {
  /** Fraction (0..1) of the local day where the window begins. */
  start: number;
  /** Fraction (0..1) of the local day where the window ends. */
  end: number;
  isActive: boolean;
}

const MINUTES_PER_DAY = 24 * 60;

/** "HH:MM" -> minutes since midnight (0..1439). Throws on malformed input. */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}", expected "HH:MM"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${hhmm}"`);
  return h * 60 + min;
}

/** Whether `minutes` (0..1439, UTC) falls inside a window. Half-open: end is excluded. */
export function isInWindow(window: TimeWindow, minutes: number): boolean {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  if (start === end) return true; // whole-day window
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // window crossing midnight
}

/** True if the price is at peak rate at the given instant (UTC windows). */
export function isPeakAt(pricing: PricingData, date: Date): boolean {
  const now = date.getUTCHours() * 60 + date.getUTCMinutes();
  return pricing.peakWindows.some((w) => isInWindow(w, now));
}

/**
 * Minutes until the peak/off-peak status next flips (0..1439), or null if the
 * pricing data has no windows. 0 only when we are exactly on a boundary.
 *
 * Computed in seconds: with minute precision, the just-passed edge of a
 * window computes as "0 minutes away" for the whole first minute after a
 * flip, which would claim the new tier ends right as it begins.
 */
export function minutesUntilNextChange(pricing: PricingData, date: Date): number | null {
  const now = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  const edges = pricing.peakWindows.flatMap((w) => [toMinutes(w.start), toMinutes(w.end)]);
  if (edges.length === 0) return null;
  const SECONDS_PER_DAY = MINUTES_PER_DAY * 60;
  return Math.min(
    ...edges.map((edge) => Math.floor(((edge * 60 - now + SECONDS_PER_DAY) % SECONDS_PER_DAY) / 60)),
  );
}

/** Local calendar date of an instant, as a comparable string ("2026-08-21"). */
function localDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const mo = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${mo}-${d}`;
}
/** h23, not hour12:false — avoids the "24:00" midnight quirk in some engines. */
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = timeFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tz,
    });
    timeFormatters.set(tz, fmt);
  }
  return fmt;
}

/** Same memoization for the H:M:S clock, rebuilt once per timezone per second. */
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = clockFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: tz,
    });
    clockFormatters.set(tz, fmt);
  }
  return fmt;
}

function formatMinutes(minutes: number, ref: Date, tz: string): string {
  const d = new Date(ref.getTime()); // project onto the ref's UTC day
  d.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return timeFormatter(tz)
    .formatToParts(d)
    .filter((p) => p.type === 'hour' || p.type === 'minute')
    .map((p) => p.value)
    .join(':');
}

/**
 * True if the window's local end falls on a later calendar day than its local
 * start (both instants are projected onto `ref`'s UTC day, so the comparison
 * is exact even when the window crosses UTC midnight or a DST boundary).
 */
function crossesLocalMidnight(startMinutes: number, endMinutes: number, ref: Date, tz: string): boolean {
  const s = new Date(ref.getTime());
  s.setUTCHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  const e = new Date(ref.getTime());
  e.setUTCHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  return localDateKey(s, tz) !== localDateKey(e, tz);
}

/** The peak windows converted to the user's timezone. */
export function localWindows(
  pricing: PricingData,
  ref: Date,
  tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): LocalWindow[] {
  const now = ref.getUTCHours() * 60 + ref.getUTCMinutes();
  return pricing.peakWindows.map((w) => ({
    ...w,
    startLabel: formatMinutes(toMinutes(w.start), ref, tz),
    endLabel: formatMinutes(toMinutes(w.end), ref, tz),
    crossesMidnight: crossesLocalMidnight(toMinutes(w.start), toMinutes(w.end), ref, tz),
    isActive: isInWindow(w, now),
  }));
}

/** The user's IANA timezone id, e.g. "America/Sao_Paulo". */
export function getTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getStatus(pricing: PricingData, now: Date): Status {
  const tzLabel = getTimeZoneLabel();
  return {
    isPeak: isPeakAt(pricing, now),
    now,
    tzLabel,
    localTimeLabel: clockFormatter(tzLabel).format(now),
    utcTimeLabel: clockFormatter('UTC').format(now),
    windowsLocal: localWindows(pricing, now, tzLabel),
    nextChangeMinutes: minutesUntilNextChange(pricing, now),
  };
}

/** "92" -> "1h 32m" (for the status countdown). */
export function formatMinutesHuman(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

const dayPartFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes since local midnight (0..1439) of an instant, in the given timezone. */
function localMinutesOfDay(date: Date, tz: string): number {
  let fmt = dayPartFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tz,
    });
    dayPartFormatters.set(tz, fmt);
  }
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/**
 * The peak windows drawn on a 24-hour timeline of the *local* day, as
 * fractions (0..1) of that day. A window that crosses local midnight becomes
 * two segments. Uses the same "project the window onto ref's UTC day" trick as
 * formatMinutes, so segment edges agree exactly with the window labels.
 */
export function dayStripSegments(
  pricing: PricingData,
  ref: Date,
  tz: string = getTimeZoneLabel(),
): DayStripSegment[] {
  const utcMinutes = ref.getUTCHours() * 60 + ref.getUTCMinutes();
  const day = MINUTES_PER_DAY;
  const segments: DayStripSegment[] = [];
  for (const window of pricing.peakWindows) {
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    const isActive = isInWindow(window, utcMinutes);
    if (start === end) {
      segments.push({ start: 0, end: 1, isActive }); // whole-day window
      continue;
    }
    const s = new Date(ref);
    s.setUTCHours(Math.floor(start / 60), start % 60, 0, 0);
    const e = new Date(ref);
    e.setUTCHours(Math.floor(end / 60), end % 60, 0, 0);
    const ls = localMinutesOfDay(s, tz);
    const le = localMinutesOfDay(e, tz);
    if (ls < le) {
      segments.push({ start: ls / day, end: le / day, isActive });
    } else if (ls > le) {
      // Crosses local midnight: draw the two ends separately.
      segments.push(
        { start: ls / day, end: 1, isActive },
        { start: 0, end: le / day, isActive },
      );
    }
    // ls === le only when a DST shift maps both edges to the same local
    // minute; draw nothing rather than mislabel the whole day.
  }
  return segments;
}

/** Fraction (0..1) of the local day elapsed at `ref` — the strip's "now" marker. */
export function nowDayFraction(ref: Date, tz: string = getTimeZoneLabel()): number {
  const parts = clockFormatter(tz).formatToParts(ref);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (get('hour') * 3600 + get('minute') * 60 + get('second')) / 86400;
}
