import type { DeviceState } from './devices/types';
import { load, save } from './prefs';

// Hours of operation. The device only reports its lifetime total, so Glow keeps
// a snapshot of it every time it is connected (one per hour at most) and works
// out the weekly usage from those snapshots.

interface Snap {
  /** epoch ms */
  t: number;
  /** operating minutes */
  m: number;
}

export interface WeekBar {
  label: string;
  hours: number | null;
  current: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEEP = 400 * DAY;

class Usage {
  now = $state(Date.now());
  snaps = $state.raw<Snap[]>([]);
  /** The latest device reading and when it arrived. */
  reading = $state<{ m: number; t: number } | null>(null);
  heating = $state(false);
  sessionStart = $state<number | null>(null);
  lastSessionSec = $state(0);
  /** Measured heating rate, °C per second. */
  rate = $state(0);

  private key = '';
  private shown = 0;
  private lastTemp: { t: number; c: number } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    setInterval(() => (this.now = Date.now()), 1000);
  }

  async bind(key: string, seed?: Snap[]) {
    if (key === this.key) return;
    this.key = key;
    this.shown = 0;
    this.reading = null;
    this.snaps = seed ?? (await load<Snap[]>(`usage:${key}`, []));
  }

  observe(d: DeviceState) {
    const now = Date.now();
    if (d.operatingMinutes !== undefined && d.operatingMinutes !== this.reading?.m) {
      this.reading = { m: d.operatingMinutes, t: now };
      this.record(d.operatingMinutes, now);
    }
    if (d.heaterOn && !this.heating) {
      this.sessionStart = now;
      this.rate = 0;
    } else if (!d.heaterOn && this.heating && this.sessionStart) {
      this.lastSessionSec = (now - this.sessionStart) / 1000;
      this.sessionStart = null;
    }
    this.heating = d.heaterOn;
    if (d.currentTemp !== undefined) {
      if (this.lastTemp && now - this.lastTemp.t >= 900) {
        const r = (d.currentTemp - this.lastTemp.c) / ((now - this.lastTemp.t) / 1000);
        this.rate = this.rate === 0 ? r : this.rate * 0.7 + r * 0.3;
        this.lastTemp = { t: now, c: d.currentTemp };
      } else if (!this.lastTemp) {
        this.lastTemp = { t: now, c: d.currentTemp };
      }
    }
  }

  /** Lifetime seconds, counting on between device readings while the heater runs. */
  lifetimeSec(now = this.now): number | null {
    if (!this.reading) return null;
    const extra = this.heating ? Math.max(0, now - this.reading.t) / 1000 : 0;
    const value = this.reading.m * 60 + Math.min(extra, 120);
    this.shown = Math.max(this.shown, value);
    return this.shown;
  }

  sessionSec(now = this.now): number {
    return this.sessionStart ? (now - this.sessionStart) / 1000 : this.lastSessionSec;
  }

  /** Seconds until the target is reached, from the measured heating rate. */
  etaSec(current?: number, target?: number): number | null {
    if (current === undefined || target === undefined || !this.heating) return null;
    const left = target - current;
    if (left <= 0.5) return 0;
    if (this.rate < 0.05) return null;
    return Math.ceil(left / this.rate);
  }

  weeks(count = 8, now = this.now): WeekBar[] {
    const live = this.lifetimeSec(now);
    const start = startOfIsoWeek(now);
    const bars: WeekBar[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const from = start - i * 7 * DAY;
      const to = from + 7 * DAY;
      const current = i === 0;
      const end = current && live !== null ? live / 60 : this.at(to);
      const begin = this.at(from) ?? this.snaps.find((s) => s.t >= from && s.t < to)?.m;
      const hours = end === undefined || begin === undefined ? null : Math.max(0, end - begin) / 60;
      bars.push({ label: current ? 'Now' : `W${isoWeek(from)}`, hours, current });
    }
    return bars;
  }

  private at(t: number): number | undefined {
    let m: number | undefined;
    for (const s of this.snaps) {
      if (s.t > t) break;
      m = s.m;
    }
    return m;
  }

  private record(m: number, t: number) {
    const snaps = this.snaps.filter((s) => s.t > t - KEEP);
    const last = snaps[snaps.length - 1];
    if (last && Math.floor(last.t / HOUR) === Math.floor(t / HOUR)) snaps[snaps.length - 1] = { t, m };
    else snaps.push({ t, m });
    this.snaps = snaps;
    clearTimeout(this.saveTimer);
    const key = this.key;
    this.saveTimer = setTimeout(() => key && save(`usage:${key}`, this.snaps), 2000);
  }
}

export function startOfIsoWeek(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function isoWeek(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
}

/** Made-up history for demo mode only. */
export function demoHistory(minutesNow: number): Snap[] {
  const weekly = [1.2, 2.8, 1.9, 3.4, 2.2, 2.9, 1.6];
  const start = startOfIsoWeek(Date.now());
  const snaps: Snap[] = [];
  let m = minutesNow - 2.4 * 60 - weekly.reduce((a, b) => a + b, 0) * 60;
  for (let i = 0; i < weekly.length; i++) {
    snaps.push({ t: start - (weekly.length - i) * 7 * DAY - 60_000, m });
    m += weekly[i] * 60;
  }
  snaps.push({ t: start - 60_000, m });
  return snaps;
}

export const usage = new Usage();
