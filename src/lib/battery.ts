import type { HeatMode } from './devices/types';
import type { BatterySamples, SessionDetail, SessionEvent } from './sessions.svelte';

// The battery readings a session keeps (sessions.svelte.ts), as the session chart draws them and as
// energy. Energy is voltage × current added up over the readings: Glow's own count, not the device's.
// While heating, a CRAFTY's voltage and current are read every ~2 s and kept as 5 s means
// (BatteryMeans): the heater current jumps between 0 and ~8 A, faster than 5 s readings can follow.

export type SeriesKey = 'temp' | 'battery' | 'voltage' | 'current' | 'power' | 'batteryTemp';

export const SERIES: Record<SeriesKey, { name: string }> = {
  temp: { name: 'Temperature' },
  battery: { name: 'Battery' },
  voltage: { name: 'Voltage' },
  current: { name: 'Current' },
  power: { name: 'Power' },
  batteryTemp: { name: 'Battery temp' },
};

/** Readings further apart than this (the connection was lost) are not joined, or added up across. */
export const BATTERY_GAP_SEC = 45;

/**
 * One battery value per reading, null where there is none: battery %, volts, amps and watts drawn
 * from the battery (charging comes out negative), battery °C.
 */
export function batteryValues(b: BatterySamples | undefined, key: Exclude<SeriesKey, 'temp'>): (number | null)[] {
  if (!b) return [];
  const at = (list: (number | null)[] | undefined, i: number) => list?.[i] ?? null;
  return b.ts.map((_, i) => {
    const v = at(b.v, i);
    const a = at(b.i, i);
    switch (key) {
      case 'battery':
        return b.p[i];
      case 'voltage':
        return v === null ? null : v / 1000;
      case 'current':
        return a === null ? null : -a / 1000;
      case 'power': {
        // The mean of voltage × current where the readings were averaged, else this reading's.
        const w = at(b.w, i);
        if (w !== null) return -w / 1000;
        return v === null || a === null ? null : (-v * a) / 1e6;
      }
      case 'batteryTemp': {
        const t = at(b.t, i);
        return t === null ? null : t / 10;
      }
    }
  });
}

/**
 * The highest current (A) or power (W) drawn in a session: of the readings themselves, which the 5 s
 * means smooth out, where the session kept them (`min`), else of the values the chart draws.
 */
export function batteryPeak(b: BatterySamples | undefined, key: 'current' | 'power'): number | null {
  const drawn = batteryValues(b, key).filter((v): v is number => v !== null);
  const read = b?.min ? (key === 'current' ? -b.min.i / 1000 : -b.min.w / 1000) : null;
  if (!drawn.length && read === null) return null;
  return Math.max(...drawn, ...(read === null ? [] : [read]));
}

/** The values the chart can show for a session: the temperature always, then what it has two readings of. */
export function seriesOf(detail: SessionDetail | null): SeriesKey[] {
  const out: SeriesKey[] = ['temp'];
  for (const key of ['battery', 'voltage', 'current', 'power', 'batteryTemp'] as const) {
    if (batteryValues(detail?.battery, key).filter((v) => v !== null).length >= 2) out.push(key);
  }
  return out;
}

/**
 * A scale of `n` equal steps that holds lo…hi, the steps a round 1, 2, 2.5 or 5 × 10ⁿ, from a
 * multiple of the step.
 */
export function niceScale(lo: number, hi: number, n: number): { from: number; step: number } {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, n);
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10, 20]) {
    const step = m * exp;
    const from = Math.floor(lo / step + 1e-9) * step;
    if (from + step * n >= hi - 1e-9) return { from, step };
  }
  return { from: lo, step: raw };
}

/** One stretch between two readings and the energy drawn in it, Wh. */
export interface EnergySpan {
  from: number;
  to: number;
  wh: number;
}

export interface Energy {
  /** Drawn from the battery, Wh. */
  wh: number;
  /** Charge drawn, mAh: to compare with the device's own count of the remaining capacity. */
  mah: number;
  spans: EnergySpan[];
}

/**
 * The energy drawn from the battery: voltage × current, added up between readings, counting only
 * what drains it. A reading that is the mean of those since the one before (`w`, while heating) covers
 * that stretch by itself; between others (the cool-down, sessions recorded before Glow kept means) the
 * trapezoid rule. Null without both voltage and current (VENTY, VEAZY, sessions recorded before Glow
 * kept them). Stretches longer than BATTERY_GAP_SEC count as nothing.
 */
export function energyOf(b: BatterySamples | undefined): Energy | null {
  if (!b?.v || !b.i) return null;
  const drawn = (k: number) => {
    const v = b.v![k];
    const a = b.i![k];
    return v === null || a === null ? null : { w: Math.max(0, (-v * a) / 1e6), a: Math.max(0, -a) };
  };
  let wh = 0;
  let mah = 0;
  let any = false;
  const spans: EnergySpan[] = [];
  for (let k = 1; k < b.ts.length; k++) {
    const dt = b.ts[k] - b.ts[k - 1];
    if (dt <= 0 || dt > BATTERY_GAP_SEC) continue;
    const mean = b.w?.[k] ?? null;
    const a = b.i[k];
    let w: number;
    let amps: number;
    if (mean !== null && a !== null) {
      w = Math.max(0, -mean / 1000);
      amps = Math.max(0, -a);
    } else {
      const p = drawn(k - 1);
      const q = drawn(k);
      if (!p || !q) continue;
      w = (p.w + q.w) / 2;
      amps = (p.a + q.a) / 2;
    }
    any = true;
    const e = w * (dt / 3600);
    wh += e;
    mah += amps * (dt / 3600);
    spans.push({ from: b.ts[k - 1], to: b.ts[k], wh: e });
  }
  return any ? { wh, mah, spans } : null;
}

/** A reading not followed by another for this long (nothing heard from the device) counts no further. */
export const HOLD_MAX_MS = 15_000;

/** Voltage (mV), current (mA) and power (mW, voltage × current) as means, with the lowest current and power read. */
export interface BatteryMean {
  v: number;
  i: number;
  w: number;
  lo: { i: number; w: number };
}

/**
 * The battery readings between two samples of the session log, as one time-weighted mean: each
 * reading counts from when it came until the next one (or the sample). Power is the mean of voltage
 * × current, not the product of the means: the voltage sags while the current is high. Times in ms.
 */
export class BatteryMeans {
  private at: number | null = null;
  private v = 0;
  private i = 0;
  private sum = { v: 0, i: 0, w: 0, ms: 0 };
  private lo: { i: number; w: number } | null = null;

  /** The readings as they stand at `now`; undefined when there are none (no battery reported). */
  add(now: number, v: number | undefined, i: number | undefined) {
    this.hold(now);
    if (v === undefined || i === undefined) {
      this.at = null;
      return;
    }
    this.at = now;
    this.v = v;
    this.i = i;
    const w = (v * i) / 1000;
    this.lo = this.lo ? { i: Math.min(this.lo.i, i), w: Math.min(this.lo.w, w) } : { i, w };
  }

  /**
   * The mean since the last take, up to `now`; null without readings or without time between (the
   * first sample of a session). The last reading carries on.
   */
  take(now: number): BatteryMean | null {
    this.hold(now);
    const { v, i, w, ms } = this.sum;
    if (!this.lo || ms === 0) return null;
    const mean = { v: v / ms, i: i / ms, w: w / ms, lo: this.lo };
    this.sum = { v: 0, i: 0, w: 0, ms: 0 };
    this.lo = this.at === null ? null : { i: this.i, w: (this.v * this.i) / 1000 };
    return mean;
  }

  /** A new session, or the device was away: nothing carries on. */
  reset() {
    this.at = null;
    this.sum = { v: 0, i: 0, w: 0, ms: 0 };
    this.lo = null;
  }

  private hold(now: number) {
    if (this.at === null) return;
    const dt = now - this.at;
    if (dt > 0 && dt <= HOLD_MAX_MS) {
      this.sum.v += this.v * dt;
      this.sum.i += this.i * dt;
      this.sum.w += ((this.v * this.i) / 1000) * dt;
      this.sum.ms += dt;
    }
    // Too old to go on with: expired until the next reading.
    if (dt > HOLD_MAX_MS) this.at = null;
    else if (dt > 0) this.at = now;
  }
}

export type Phase = 'heatup' | 'holding' | 'boost' | 'superboost' | 'after';

export const PHASES: Record<Phase, string> = {
  heatup: 'Heat-up',
  holding: 'Holding',
  boost: 'Boost',
  superboost: 'Superboost',
  after: 'After off',
};

/** What the session was doing at `t`: heating up, holding the target, boosting, or done. */
export function phaseAt(t: number, readySec: number | null, endSec: number | null, events: SessionEvent[]): Phase {
  if (endSec !== null && t >= endSec) return 'after';
  let mode: HeatMode = 'normal';
  for (const e of events) if (e.k === 'mode' && e.t <= t) mode = e.v;
  if (mode !== 'normal') return mode;
  return readySec !== null && t >= readySec ? 'holding' : 'heatup';
}

/**
 * The energy split by what the session was doing, in this order, leaving out what took none. A
 * stretch between two readings that crosses a change is shared out by time.
 */
export function energySplit(
  e: Energy,
  readySec: number | null,
  endSec: number | null,
  events: SessionEvent[],
): { phase: Phase; wh: number; share: number }[] {
  const cuts = [readySec, endSec, ...events.filter((x) => x.k === 'mode').map((x) => x.t)].filter((t): t is number => t !== null);
  const by = new Map<Phase, number>();
  for (const s of e.spans) {
    const edges = [s.from, ...cuts.filter((t) => t > s.from && t < s.to).sort((a, b) => a - b), s.to];
    for (let k = 1; k < edges.length; k++) {
      const phase = phaseAt((edges[k - 1] + edges[k]) / 2, readySec, endSec, events);
      by.set(phase, (by.get(phase) ?? 0) + (s.wh * (edges[k] - edges[k - 1])) / (s.to - s.from));
    }
  }
  return (Object.keys(PHASES) as Phase[])
    .filter((p) => (by.get(p) ?? 0) > 0)
    .map((p) => ({ phase: p, wh: by.get(p)!, share: e.wh > 0 ? by.get(p)! / e.wh : 0 }));
}
