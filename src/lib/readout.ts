import { BATTERY_GAP_SEC, batteryPeak, batteryValues, energyOf, SERIES, type SeriesKey } from './battery';
import { decimal, mmss, toUnit } from './format';
import type { SessionDetail } from './sessions.svelte';

// The line under the session chart that names the value it shows and gives its number: now while
// the session runs, at the touched moment while a finger holds the chart, the whole session's
// otherwise. And the arrows and the swipe that move the chart from one value to the next.

/** What the readout needs to know about the session besides its samples. */
export interface ReadoutSession {
  detail: SessionDetail | null;
  unit: 'C' | 'F';
  /** The device reports a live temperature (CRAFTY, VOLCANO), not only the target. */
  live: boolean;
  readySec: number | null;
  /** Seconds from the start to heater off; null while it runs. */
  endSec: number | null;
  peak: number | null;
  target: number | null;
}

/** Index of the last of the ascending `ts` at or before `t`; -1 if all are after it. */
function atOrBefore(ts: number[], t: number): number {
  let i = -1;
  for (let k = 0; k < ts.length && ts[k] <= t; k++) i = k;
  return i;
}

/** Index of the sample nearest to `t`: where a touch on the chart snaps to. -1 without samples. */
export function nearestIndex(ts: number[], t: number): number {
  let best = -1;
  for (let k = 0; k < ts.length; k++) if (best < 0 || Math.abs(ts[k] - t) < Math.abs(ts[best] - t)) best = k;
  return best;
}

/** The temperature the chart draws at sample `i`: the live one, or without it (VENTY) the target once Ready. */
export function tempAt(s: ReadoutSession, i: number): number | null {
  const d = s.detail;
  if (!d || i < 0 || i >= d.ts.length) return null;
  if (s.live) return d.c[i];
  return s.readySec !== null && d.ts[i] >= s.readySec ? d.g[i] : null;
}

/**
 * A value at `t` seconds: the last reading at or before it. The battery is read less often than the
 * temperature, so between two readings the earlier one stands; across a gap there is none.
 */
export function valueAt(s: ReadoutSession, key: SeriesKey, t: number): number | null {
  const d = s.detail;
  if (!d) return null;
  if (key === 'temp') return tempAt(s, Math.max(0, atOrBefore(d.ts, t)));
  const b = d.battery;
  if (!b?.ts.length) return null;
  let i = atOrBefore(b.ts, t);
  if (i < 0) i = 0;
  if (Math.abs(t - b.ts[i]) > BATTERY_GAP_SEC) return null;
  return batteryValues(b, key)[i] ?? null;
}

/** The latest value: what the readout says "now" with. */
export function latest(s: ReadoutSession, key: SeriesKey): number | null {
  const d = s.detail;
  if (!d) return null;
  const ts = key === 'temp' ? d.ts : d.battery?.ts ?? [];
  return ts.length ? valueAt(s, key, ts[ts.length - 1]) : null;
}

/** A value with its unit; amps always "A", so "Current" cannot read as "the current session". */
export function formatValue(key: SeriesKey, v: number | null, unit: 'C' | 'F'): string {
  if (v === null) return '–';
  switch (key) {
    case 'temp':
    case 'batteryTemp':
      return `${toUnit(v, unit)}°`;
    case 'battery':
      return `${Math.round(v)} %`;
    case 'voltage':
      return `${decimal(v, 2)} V`;
    case 'current':
      return `${decimal(v, 1)} A`;
    case 'power':
      return `${decimal(v, 1)} W`;
  }
}

/** The legend's name for a value: with its unit, as "Current" alone could mean the session. */
export function legendName(key: SeriesKey, unit: 'C' | 'F'): string {
  const u = { temp: `°${unit}`, battery: '%', voltage: 'V', current: 'A', power: 'W', batteryTemp: `°${unit}` }[key];
  return `${SERIES[key].name} (${u})`;
}

/** A moment of the session as the chart's axis writes it: m:ss from the start, +m:ss into the cool-down. */
export function timeLabel(t: number, endSec: number | null): string {
  if (endSec !== null && t > endSec) return `+${mmss(t - endSec)}`;
  return t < 0 ? `−${mmss(-t)}` : mmss(t);
}

function readings(s: ReadoutSession, key: Exclude<SeriesKey, 'temp'>) {
  const b = s.detail?.battery;
  if (!b) return [];
  return batteryValues(b, key)
    .map((v, i) => ({ t: b.ts[i], v }))
    .filter((p): p is { t: number; v: number } => p.v !== null);
}

/** One number that says the most about the value so far: beside "now" while the session runs. */
function headline(s: ReadoutSession, key: SeriesKey): string {
  const f = (v: number) => formatValue(key, v, s.unit);
  if (key === 'temp') return s.live && s.peak !== null ? `peak ${f(s.peak)}` : '';
  const pts = readings(s, key);
  if (!pts.length) return '';
  const vs = pts.map((p) => p.v);
  if (key === 'battery') return `start ${f(vs[0])}`;
  if (key === 'voltage') return `low ${f(Math.min(...vs))}`;
  if (key === 'batteryTemp') return `max ${f(Math.max(...vs))}`;
  // In a session from 0.1.77–0.1.79 the drawn points are 5 s means; the true peak of the 2 s reads is kept apart.
  return `peak ${f(batteryPeak(s.detail?.battery, key) ?? Math.max(...vs))}`;
}

/** The whole session in a line, for a finished one. */
export function summaryLine(s: ReadoutSession, key: SeriesKey): string {
  const f = (v: number) => formatValue(key, v, s.unit);
  if (key === 'temp') {
    const parts = [s.live && s.peak !== null ? `peak ${f(s.peak)}` : '', s.target !== null ? `target ${f(s.target)}` : ''];
    return parts.filter(Boolean).join(' · ');
  }
  const pts = readings(s, key);
  if (pts.length < 2) return '';
  const vs = pts.map((p) => p.v);
  const first = vs[0];
  const last = vs[vs.length - 1];
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const energy = energyOf(s.detail?.battery);
  const wh = energy ? ` · ${decimal(energy.wh, 2)} Wh` : '';
  switch (key) {
    case 'battery':
      return `${first} → ${f(last)}${first > last ? ` · −${first - last} %` : ''}`;
    case 'voltage':
      return `${decimal(first, 2)} → ${f(last)} · low ${f(min)}`;
    case 'current':
    case 'power':
      return `peak ${f(batteryPeak(s.detail?.battery, key) ?? max)}${wh}`;
    case 'batteryTemp': {
      const top = pts.reduce((a, p) => (p.v > a.v ? p : a));
      return `${toUnit(first, s.unit)} → ${f(max)} · max at ${timeLabel(top.t, s.endSec)}`;
    }
  }
}

export type ReadoutMode = { kind: 'now' } | { kind: 'at'; t: number } | { kind: 'summary' };

/** The readout's line for the value on the chart. */
export function readoutLine(s: ReadoutSession, key: SeriesKey, mode: ReadoutMode): string {
  if (mode.kind === 'at') return `At ${timeLabel(mode.t, s.endSec)} · ${formatValue(key, valueAt(s, key, mode.t), s.unit)}`;
  if (mode.kind === 'summary') return summaryLine(s, key);
  const now = latest(s, key);
  return [now === null ? '' : `${formatValue(key, now, s.unit)} now`, headline(s, key)].filter(Boolean).join(' · ');
}

/** Every value at `t`, for the bubble over a held chart; the temperatures say which is which. */
export function valuesAt(s: ReadoutSession, keys: SeriesKey[], t: number): { key: SeriesKey; text: string; tag: string }[] {
  const tags: Partial<Record<SeriesKey, string>> = { temp: 'temp', batteryTemp: 'batt' };
  return keys.map((key) => ({ key, text: formatValue(key, valueAt(s, key, t), s.unit), tag: tags[key] ?? '' }));
}

/** A finger has to move this far, px, before its direction counts. */
export const SLOP_PX = 10;

/**
 * What a finger on the chart is doing, from how far it moved: too little to tell, a sideways swipe
 * (clearly more across than down), or anything else, which is left to the page to scroll.
 */
export function swipeIntent(dx: number, dy: number): 'wait' | 'swipe' | 'scroll' {
  if (Math.hypot(dx, dy) < SLOP_PX) return 'wait';
  return Math.abs(dx) > Math.abs(dy) * 1.5 ? 'swipe' : 'scroll';
}

/**
 * Where a finished swipe moves the chart: 1 to the next value (finger to the left), -1 back, 0 not
 * at all. Far enough (a fifth of the chart, at most 64 px), or a short flick.
 */
export function swipeStep(dx: number, ms: number, width: number): -1 | 0 | 1 {
  const far = Math.abs(dx) >= Math.min(64, width / 5);
  const flick = Math.abs(dx) >= 24 && Math.abs(dx) / Math.max(1, ms) > 0.4;
  if (!far && !flick) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * The value a step away from `sel`, going round: past the last comes the first again, so the
 * stepper's arrows always lead somewhere and a swipe never hits an end it cannot show.
 */
export function stepFrom(keys: SeriesKey[], sel: SeriesKey, step: number): SeriesKey {
  const n = keys.length;
  if (!n) return sel;
  const i = Math.max(0, keys.indexOf(sel));
  return keys[(((i + step) % n) + n) % n];
}

/** Where the stepper's arrows lead from `sel`; null with fewer than two values, so no arrows. */
export function neighbours(keys: SeriesKey[], sel: SeriesKey): { prev: SeriesKey; next: SeriesKey } | null {
  if (keys.length < 2) return null;
  return { prev: stepFrom(keys, sel, -1), next: stepFrom(keys, sel, 1) };
}
