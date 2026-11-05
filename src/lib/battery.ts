import type { BatterySamples, SessionDetail } from './sessions.svelte';

// The battery readings a session keeps (sessions.svelte.ts), as the session chart draws them and as
// energy. Energy is voltage × current added up over the readings: Glow's own count, not the device's.

export type SeriesKey = 'temp' | 'battery' | 'voltage' | 'current' | 'power' | 'batteryTemp';

export const SERIES: Record<SeriesKey, { chip: string; name: string }> = {
  temp: { chip: 'Temp', name: 'Temperature' },
  battery: { chip: 'Battery', name: 'Battery' },
  voltage: { chip: 'Voltage', name: 'Voltage' },
  current: { chip: 'Current', name: 'Current' },
  power: { chip: 'Power', name: 'Power' },
  batteryTemp: { chip: 'Batt temp', name: 'Battery temp' },
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
      case 'power':
        return v === null || a === null ? null : (-v * a) / 1e6;
      case 'batteryTemp': {
        const t = at(b.t, i);
        return t === null ? null : t / 10;
      }
    }
  });
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
 * The energy drawn from the battery: voltage × current, added up between readings (the trapezoid
 * rule), counting only what drains it. Null without both voltage and current (VENTY, VEAZY, sessions
 * recorded before Glow kept them). Stretches longer than BATTERY_GAP_SEC count as nothing.
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
    const p = drawn(k - 1);
    const q = drawn(k);
    if (!p || !q || dt <= 0 || dt > BATTERY_GAP_SEC) continue;
    any = true;
    const e = ((p.w + q.w) / 2) * (dt / 3600);
    wh += e;
    mah += ((p.a + q.a) / 2) * (dt / 3600);
    spans.push({ from: b.ts[k - 1], to: b.ts[k], wh: e });
  }
  return any ? { wh, mah, spans } : null;
}
